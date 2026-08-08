// Pulling resource IDs out of wrangler's output.
//
// setup.sh used to print each `wrangler ... create` command and then ask the
// person to copy the ID out of their terminal and paste it back. That is the
// single worst moment in the whole setup for someone who is not a developer:
// it asks them to know which of several 32-character strings is the one that
// matters, at the exact point where a wrong answer produces a broken deploy
// with no obvious cause.
//
// Wrangler 4 can write KV and R2 straight into the config itself
// (`--update-config`). D1 cannot, so its ID still has to be read out of the
// command's output — which is what this does.
//
// Why a module and not a grep in bash: this parse is the one step in setup
// that silently produces a *plausible wrong answer* if it drifts. A 32-hex
// string is a 32-hex string; picking the wrong one writes a config that looks
// finished and fails at runtime. So it gets real tests against real output
// shapes, and — just as important — it reports "I could not find it" rather
// than guessing, so setup.sh can fall back to asking instead of writing
// garbage into wrangler.jsonc.

/** A Cloudflare resource UUID/hex id, as it appears in wrangler output. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const HEX32 = '[0-9a-f]{32}';

/**
 * Extract a D1 `database_id` from the output of `wrangler d1 create <name>`.
 *
 * Wrangler prints a ready-to-paste config block; across versions it has been
 * TOML, JSONC, and a bare "created your database ... id" line, so all three
 * shapes are matched. Ordered most-specific first: a labelled `database_id`
 * always wins over a loose id-shaped token elsewhere in the output (an account
 * id in a banner, say).
 *
 * @param {string} out raw stdout+stderr from the create command
 * @returns {string|null} the id, or null if nothing was confidently found
 */
export function parseD1DatabaseId(out) {
  if (!out) return null;
  const patterns = [
    // JSONC: "database_id": "…"   TOML: database_id = "…"
    new RegExp(`database_id"?\\s*[:=]\\s*"(${UUID})"`, 'i'),
    // "Created your new D1 database ... (<uuid>)" / "database_id: <uuid>"
    new RegExp(`database_id"?\\s*[:=]?\\s*(${UUID})`, 'i'),
    // Last resort: a lone UUID anywhere. Only safe because we tried the
    // labelled forms first.
    new RegExp(`(${UUID})`, 'i'),
  ];
  for (const re of patterns) {
    const m = out.match(re);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Extract a KV namespace id from `wrangler kv namespace create`.
 * Only needed as a fallback — `--update-config` handles this on wrangler 4.
 *
 * @param {string} out raw output
 * @returns {string|null}
 */
export function parseKvNamespaceId(out) {
  if (!out) return null;
  const patterns = [
    new RegExp(`"?id"?\\s*[:=]\\s*"(${HEX32})"`, 'i'),
    new RegExp(`(${HEX32})`, 'i'),
  ];
  for (const re of patterns) {
    const m = out.match(re);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Pull the first JSON array out of wrangler `list` output.
 *
 * The list commands print a version banner (and sometimes a proxy warning)
 * before the payload, so `JSON.parse(stdout)` fails on output that is perfectly
 * good. Returns [] rather than throwing — a lookup that cannot read the list is
 * a lookup that found nothing, and the caller already has a fallback.
 *
 * @param {string} out
 * @returns {object[]}
 */
function jsonArray(out) {
  if (!out) return [];
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const v = JSON.parse(out.slice(start, end + 1));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Find an existing KV namespace's id by its title, from `wrangler kv namespace
 * list` output.
 *
 * This is the "already exists" recovery path. Creating a namespace fails when
 * the title is taken — which happens on any account that already runs an
 * instance of this engine, and on every RE-RUN after a partial setup. Without
 * a lookup the script dead-ends into asking a non-developer to find a
 * 32-character id in a wall of terminal output.
 *
 * @param {string} out raw output of `wrangler kv namespace list`
 * @param {string} title the namespace title to match (exact, case-sensitive)
 * @returns {string|null}
 */
export function findKvNamespaceIdByTitle(out, title) {
  if (!title) return null;
  const hit = jsonArray(out).find((n) => n && n.title === title);
  if (hit && typeof hit.id === 'string' && new RegExp(`^${HEX32}$`, 'i').test(hit.id)) {
    return hit.id.toLowerCase();
  }
  // Fallback for a non-JSON/table rendering: the id on the same line as the title.
  const line = String(out || '').split('\n').find((l) => l.includes(title));
  const m = line && line.match(new RegExp(`(${HEX32})`, 'i'));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Find an existing D1 database's id by name, from `wrangler d1 list --json`.
 * Same recovery path as findKvNamespaceIdByTitle.
 *
 * @param {string} out raw output of `wrangler d1 list --json`
 * @param {string} name the database name to match
 * @returns {string|null}
 */
export function findD1DatabaseIdByName(out, name) {
  if (!name) return null;
  const hit = jsonArray(out).find((d) => d && d.name === name);
  const id = hit && (hit.uuid || hit.database_id || hit.id);
  if (typeof id === 'string' && new RegExp(`^${UUID}$`, 'i').test(id)) return id.toLowerCase();
  const line = String(out || '').split('\n').find((l) => l.includes(name));
  const m = line && line.match(new RegExp(`(${UUID})`, 'i'));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Is this string plausibly a resource id the user pasted by hand?
 * Used to sanity-check a manual fallback answer before writing it into the
 * config, so a stray "y" or a pasted whole command never lands there.
 *
 * @param {string} v
 * @returns {boolean}
 */
export function looksLikeResourceId(v) {
  const s = String(v || '').trim();
  return new RegExp(`^(${UUID}|${HEX32})$`, 'i').test(s);
}

// CLI: `node wrangler-parse.mjs d1|kv` reads the output on stdin and prints the
// id, or exits 1 with nothing on stdout so bash can detect the failure.
// CLI: `node wrangler-parse.mjs d1|kv` reads CREATE output on stdin.
//      `node wrangler-parse.mjs find-kv|find-d1 <name>` reads LIST output.
// Either way: prints the id, or exits 1 with nothing on stdout.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const kind = process.argv[2];
  const name = process.argv[3];
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => {
    const id =
      kind === 'kv' ? parseKvNamespaceId(buf)
      : kind === 'find-kv' ? findKvNamespaceIdByTitle(buf, name)
      : kind === 'find-d1' ? findD1DatabaseIdByName(buf, name)
      : parseD1DatabaseId(buf);
    if (!id) process.exit(1);
    process.stdout.write(id);
  });
}
