// Tests for the first-run scripts — the part of this repo a fork touches
// FIRST and the only part that had no tests at all.
//
// Two layers, deliberately:
//
//   1. Unit tests over scripts/lib/wrangler-parse.mjs — the one step in setup
//      that can produce a plausible *wrong* answer instead of an obvious
//      failure. Every id in wrangler's output is a hex string; picking the
//      wrong one writes a config that looks complete and breaks at runtime.
//
//   2. An end-to-end run of setup.sh against a throwaway repo with a FAKE
//      wrangler on PATH, asserting on the config it produces and the exact
//      commands it issued.
//
// On the fake wrangler, honestly: it encodes what we believe wrangler 4 does,
// which is not the same as what it does. So setup.sh is written to never
// *depend* on that belief — it verifies the config after each step and falls
// back to asking rather than trusting. `stub calls are verified, not assumed`
// below is where that guarantee is pinned: if --update-config silently no-ops
// in the real world, setup.sh notices and asks. The stub cannot paper over it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseD1DatabaseId,
  parseKvNamespaceId,
  looksLikeResourceId,
  findKvNamespaceIdByTitle,
  findD1DatabaseIdByName,
} from '../scripts/lib/wrangler-parse.mjs';
import { remainingPlaceholders, stripJsoncComments } from '../scripts/lib/config-check.mjs';

const ROOT = join(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// 1. The id parser
// ---------------------------------------------------------------------------

describe('parseD1DatabaseId', () => {
  // Real shapes wrangler has printed across versions. If a future wrangler
  // changes again, the fallback in setup.sh is what saves the user — but this
  // is where we notice.
  it('reads the JSONC config block wrangler 4 prints', () => {
    const out = `
✅ Successfully created DB 'photo-portal' in region ENAM
Created your new D1 database.

{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "photo-portal",
      "database_id": "a1b2c3d4-1111-2222-3333-444455556666"
    }
  ]
}`;
    expect(parseD1DatabaseId(out)).toBe('a1b2c3d4-1111-2222-3333-444455556666');
  });

  it('reads the older TOML block', () => {
    const out = `[[d1_databases]]
binding = "DB"
database_name = "photo-portal"
database_id = "aaaabbbb-cccc-dddd-eeee-ffff00001111"`;
    expect(parseD1DatabaseId(out)).toBe('aaaabbbb-cccc-dddd-eeee-ffff00001111');
  });

  it('reads a bare prose line', () => {
    expect(parseD1DatabaseId('Created database, database_id: 12345678-90ab-cdef-1234-567890abcdef'))
      .toBe('12345678-90ab-cdef-1234-567890abcdef');
  });

  it('prefers the LABELLED database_id over another uuid in the banner', () => {
    // The failure this prevents: wrangler prints an account id (or a warning
    // containing one) above the config block. A naive "first uuid" grep takes
    // it, and the deploy fails much later with an unrelated-looking error.
    const out = `
▲ [WARNING] Using account 99999999-8888-7777-6666-555555555555
{ "database_id": "11111111-2222-3333-4444-555555555555" }`;
    expect(parseD1DatabaseId(out)).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('is case-insensitive and normalises to lowercase', () => {
    expect(parseD1DatabaseId('database_id = "AAAABBBB-CCCC-DDDD-EEEE-FFFF00001111"'))
      .toBe('aaaabbbb-cccc-dddd-eeee-ffff00001111');
  });

  it('returns null rather than guessing when there is no id', () => {
    expect(parseD1DatabaseId('✘ [ERROR] A database named photo-portal already exists')).toBeNull();
    expect(parseD1DatabaseId('')).toBeNull();
    expect(parseD1DatabaseId(undefined)).toBeNull();
  });
});

describe('parseKvNamespaceId', () => {
  it('reads the 32-hex id from the config block', () => {
    const out = `🌀 Creating namespace with title "site-SUBSCRIBERS"
✨ Success!
{ "kv_namespaces": [ { "binding": "SUBSCRIBERS", "id": "0f1e2d3c4b5a69788796a5b4c3d2e1f0" } ] }`;
    expect(parseKvNamespaceId(out)).toBe('0f1e2d3c4b5a69788796a5b4c3d2e1f0');
  });

  it('returns null on an error message', () => {
    expect(parseKvNamespaceId('✘ [ERROR] Authentication error')).toBeNull();
  });
});

describe('looksLikeResourceId', () => {
  it('accepts both id shapes, trimmed', () => {
    expect(looksLikeResourceId('  0f1e2d3c4b5a69788796a5b4c3d2e1f0 ')).toBe(true);
    expect(looksLikeResourceId('a1b2c3d4-1111-2222-3333-444455556666')).toBe(true);
  });

  it('rejects the things a confused person actually types', () => {
    // Each of these has been a real support ticket somewhere.
    for (const junk of ['', 'y', 'yes', 'YOUR_D1_DATABASE_ID', 'photo-portal',
      'npx wrangler d1 create photo-portal', 'database_id = "abc"']) {
      expect(looksLikeResourceId(junk), `should reject ${JSON.stringify(junk)}`).toBe(false);
    }
  });
});

describe('remainingPlaceholders', () => {
  it('ignores placeholders named in comments', () => {
    // This exact case shipped as a bug: wrangler.example.jsonc documents its
    // own placeholders in a comment, so the old `grep -q YOUR_` in doctor.sh
    // told a *finished* setup to go run setup again — forever.
    const src = `{
  // Replace every YOUR_THING placeholder with a real value.
  "name": "my-photo-site", /* not YOUR_WORKER_NAME any more */
  "id": "abc123"
}`;
    expect(remainingPlaceholders(src)).toEqual([]);
  });

  it('finds placeholders that are still real values', () => {
    const src = '{ "name": "your-worker-name", "id": "YOUR_KV_NAMESPACE_ID" }';
    expect(remainingPlaceholders(src)).toEqual(['YOUR_KV_NAMESPACE_ID', 'your-worker-name']);
  });

  it('the shipped example config is detected as unfinished', () => {
    // If this ever passes as "finished", the example stopped being an example.
    expect(remainingPlaceholders(readFileSync(join(ROOT, 'wrangler.example.jsonc'), 'utf8')).length)
      .toBeGreaterThan(0);
  });

  it('does not treat a // inside a string as a comment', () => {
    const src = '{ "url": "https://example.com/x", "id": "YOUR_KV_NAMESPACE_ID" }';
    expect(stripJsoncComments(src)).toContain('https://example.com/x');
    expect(remainingPlaceholders(src)).toEqual(['YOUR_KV_NAMESPACE_ID']);
  });
});

// ---------------------------------------------------------------------------
// 2. setup.sh end to end, against a fake wrangler
// ---------------------------------------------------------------------------

/** Records every wrangler invocation and emulates the effects we rely on. */
const FAKE_NPX = `#!/usr/bin/env bash
# Stand-in for npx/wrangler. Logs the argv of every call to $CALL_LOG, then
# emulates just enough of wrangler's behaviour for setup.sh to proceed.
printf '%s\\n' "$*" >> "$CALL_LOG"
cfg="wrangler.jsonc"

case "$*" in
  *"whoami"*)
    if [ "\${FAKE_LOGGED_IN:-1}" = "1" ]; then
      echo "Account Name: Test Account"; echo "Account ID: 99999999888877776666555555555555"; exit 0
    fi
    echo "✘ [ERROR] Not logged in." >&2; exit 1 ;;

  *"kv namespace create"*)
    id="0f1e2d3c4b5a69788796a5b4c3d2e1f0"
    case "$*" in *--preview*) id="9988776655443322110099887766aabb" ;; esac
    # --update-config APPENDS a new binding block; it does NOT fill in the
    # template's placeholder. This stub used to model it as a placeholder
    # substitution, which is why a real run produced a config with SUBSCRIBERS
    # bound twice — a parse error that killed every later wrangler command —
    # while the suite stayed green. Modelled faithfully now, so re-adding the
    # flag fails the duplicate-binding assertion instead of shipping.
    case "$*" in
      *--update-config*)
        sed -i '/kv_namespaces/a { "binding": "SUBSCRIBERS", "id": "FAKEKVID" },' "$cfg"
        sed -i "s/FAKEKVID/\$id/" "$cfg" ;;
    esac
    echo "✨ Success!"; echo "{ \\"kv_namespaces\\": [ { \\"binding\\": \\"SUBSCRIBERS\\", \\"id\\": \\"$id\\" } ] }"
    exit 0 ;;

  *"d1 create"*)
    echo "✅ Successfully created DB in region ENAM"
    echo '{ "d1_databases": [ { "binding": "DB", "database_id": "a1b2c3d4-1111-2222-3333-444455556666" } ] }'
    exit 0 ;;

  *"r2 bucket create"*)
    case "$*" in
      *--update-config*)
        if [ "\${FAKE_NO_UPDATE_CONFIG:-0}" != "1" ]; then
          bucket="\$(printf '%s' "$*" | sed -E 's/.*r2 bucket create ([^ ]+).*/\\1/')"
          sed -i "s/your-bucket-name/\$bucket/g" "$cfg"
        fi ;;
    esac
    echo "✨ Created bucket"; exit 0 ;;

  *"d1 execute"*) echo "🚣 Executed successfully"; exit 0 ;;
  *"secret put"*)
    name="\$(printf '%s' "$*" | sed -E 's/.*secret put ([A-Z_0-9]+).*/\\1/')"
    val="\$(cat)"
    printf 'SECRET %s=%s\\n' "\$name" "\$val" >> "$CALL_LOG"
    echo "✨ Success! Uploaded secret \$name"; exit 0 ;;
  *"secret list"*) echo '[{"name":"AUTH_PASSWORD_HASH"},{"name":"SESSION_SECRET"}]'; exit 0 ;;
  *"deploy"*) echo "Deployed to https://test.workers.dev"; exit 0 ;;
esac
exit 0
`;

/** A throwaway fork: only the files setup.sh reads or writes. */
function makeFork() {
  const dir = mkdtempSync(join(tmpdir(), 'oak-setup-'));
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true });
  mkdirSync(join(dir, 'src', 'portal'), { recursive: true });
  mkdirSync(join(dir, 'src', 'console'), { recursive: true });
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });

  for (const f of ['wrangler.example.jsonc', 'site.config.example.js']) {
    cpSync(join(ROOT, f), join(dir, f));
  }
  cpSync(join(ROOT, 'scripts', 'setup.sh'), join(dir, 'scripts', 'setup.sh'));
  cpSync(join(ROOT, 'scripts', 'doctor.sh'), join(dir, 'scripts', 'doctor.sh'));
  cpSync(join(ROOT, 'scripts', 'lib'), join(dir, 'scripts', 'lib'), { recursive: true });
  for (const s of ['src/portal/schema.sql', 'src/portal/schema-links.sql']) {
    writeFileSync(join(dir, s), '-- test schema\n');
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fork', type: 'module' }));

  // bcryptjs is used to hash the console password; symlinking the real one
  // keeps the hash real (the test asserts it verifies).
  cpSync(join(ROOT, 'node_modules', 'bcryptjs'), join(dir, 'node_modules', 'bcryptjs'), { recursive: true });

  const npx = join(dir, 'bin', 'npx');
  writeFileSync(npx, FAKE_NPX);
  chmodSync(npx, 0o755);
  return dir;
}

/**
 * Run setup.sh with scripted answers.
 * @param {string} dir fork directory
 * @param {string[]} answers stdin lines, in prompt order
 * @param {Record<string,string>} env extra environment
 */
function runSetup(dir, answers, env = {}) {
  const callLog = join(dir, 'calls.log');
  writeFileSync(callLog, '');
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync('bash', [join(dir, 'scripts', 'setup.sh')], {
      cwd: dir,
      input: answers.join('\n') + '\n',
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        CALL_LOG: callLog,
        CI: '', // never take a non-interactive shortcut in these runs
        ...env,
      },
      timeout: 60_000,
    });
  } catch (e) {
    stdout = `${e.stdout || ''}${e.stderr || ''}`;
    status = e.status ?? 1;
  }
  return {
    stdout,
    status,
    calls: readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean),
    config: existsSync(join(dir, 'wrangler.jsonc'))
      ? readFileSync(join(dir, 'wrangler.jsonc'), 'utf8') : null,
    siteConfig: existsSync(join(dir, 'site.config.js'))
      ? readFileSync(join(dir, 'site.config.js'), 'utf8') : null,
  };
}

describe('setup.sh — a clean first run', () => {
  let dir;
  beforeEach(() => { dir = makeFork(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // Answers in prompt order: worker name, D1 name, R2 bucket, preset, password.
  const ANSWERS = ['my-photo-site', 'photo-subscribers', 'photo-portal', 'photo-cdn', '2', 'hunter2hunter2'];

  it('fills in every placeholder in wrangler.jsonc', () => {
    const r = runSetup(dir, ANSWERS);
    expect(r.config).not.toBeNull();
    // The whole point: a config with a placeholder left in it deploys and then
    // fails at runtime, which is the worst possible time to find out.
    // Comment-aware, for the reason documented in remainingPlaceholders.
    expect(remainingPlaceholders(r.config)).toEqual([]);
    expect(r.config).toContain('my-photo-site');
    expect(r.config).toContain('a1b2c3d4-1111-2222-3333-444455556666'); // D1, parsed
    expect(r.config).toContain('0f1e2d3c4b5a69788796a5b4c3d2e1f0');     // KV
    expect(r.config).toContain('photo-cdn');                            // R2
  });

  it('never binds the same name twice in the finished config', () => {
    // The failure this pins, seen on a real run: `--update-config` APPENDS a
    // binding block rather than filling the placeholder, so the config carried
    //     - SUBSCRIBERS assigned to multiple KV Namespace bindings.
    // and every wrangler command after that point died on config parsing —
    // the preview namespace, `d1 create`, everything. A duplicate binding is
    // not a cosmetic problem; it is a config that cannot be read at all.
    const r = runSetup(dir, ANSWERS);
    for (const binding of ['SUBSCRIBERS', 'CDN', 'DB']) {
      const n = (r.config.match(new RegExp(`"binding"\\s*:\\s*"${binding}"`, 'g')) || []).length;
      expect(n, `${binding} is bound ${n} times — wrangler refuses to parse this`).toBe(1);
    }
  });

  it('sets both required secrets, and the password hash actually verifies', async () => {
    const r = runSetup(dir, ANSWERS);
    const secrets = Object.fromEntries(
      r.calls.filter((c) => c.startsWith('SECRET '))
        .map((c) => c.slice(7).split(/=(.*)/s).slice(0, 2)));

    expect(Object.keys(secrets).sort()).toEqual(['AUTH_PASSWORD_HASH', 'SESSION_SECRET']);
    expect(secrets.SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex

    const bcrypt = (await import('bcryptjs')).default;
    expect(await bcrypt.compare('hunter2hunter2', secrets.AUTH_PASSWORD_HASH)).toBe(true);
    expect(await bcrypt.compare('wrong-password', secrets.AUTH_PASSWORD_HASH)).toBe(false);
  });

  it('applies the D1 migrations plus every portal schema the script names', () => {
    // Console tables (fn_drafts + bench_entries) ride wrangler migrations —
    // the identical command the one-click path's package.json deploy script
    // runs (tests/d1-migrations.test.js pins that side). The portal schemas
    // are instance-only plain SQL; the list is derived from setup.sh rather
    // than fixed because the extracted engine tree drops the frozen portal
    // (and its whole loop), and this test travels with it.
    const setupSrc = readFileSync(join(ROOT, 'scripts', 'setup.sh'), 'utf8');
    const expected = [...setupSrc.matchAll(/src\/\w+\/(schema[\w-]*\.sql)/g)].map((m) => m[1]);

    const r = runSetup(dir, ANSWERS);
    const migrated = r.calls.filter((c) => c.includes('d1 migrations apply'));
    expect(migrated, 'console-table migrations were never applied').toHaveLength(1);

    const executed = r.calls.filter((c) => c.includes('d1 execute'));
    expect(executed).toHaveLength(expected.length);
    for (const s of expected) {
      expect(executed.some((c) => c.includes(s)), `${s} was never applied`).toBe(true);
    }
    // --remote, or it writes to a local sqlite file nothing will ever read.
    expect([...migrated, ...executed].every((c) => c.includes('--remote'))).toBe(true);
  });

  it('writes the chosen preset into site.config.js', () => {
    const r = runSetup(dir, ANSWERS); // '2' = passe-partout
    expect(r.siteConfig).toMatch(/preset:\s*'passe-partout'/);
  });

  it('never echoes the password', () => {
    const r = runSetup(dir, ANSWERS);
    expect(r.stdout).not.toContain('hunter2hunter2');
  });
});

describe('setup.sh — the ways it can go wrong', () => {
  let dir;
  beforeEach(() => { dir = makeFork(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const ANSWERS = ['my-photo-site', 'photo-subscribers', 'photo-portal', 'photo-cdn', '2', 'hunter2hunter2'];

  it('stops with a plain-English message when not logged in', () => {
    const r = runSetup(dir, ANSWERS, { FAKE_LOGGED_IN: '0' });
    expect(r.status).not.toBe(0);
    expect(r.stdout.toLowerCase()).toContain('wrangler login');
    // It must stop BEFORE creating anything — half-made resources on a
    // stranger's account are worse than a clean failure.
    expect(r.calls.filter((c) => c.includes('create'))).toHaveLength(0);
  });

  it('still finishes if --update-config does nothing (stub calls are verified, not assumed)', () => {
    // The scenario that makes this suite honest: a wrangler that accepts
    // --update-config and ignores it. setup.sh must notice the placeholder is
    // still there and recover, not hand back a broken config.
    const answers = ['my-photo-site', 'photo-portal', 'photo-cdn', '2', 'hunter2hunter2'];
    const r = runSetup(dir, answers, { FAKE_NO_UPDATE_CONFIG: '1' });
    expect(remainingPlaceholders(r.config)).toEqual([]);
  });

  it('is safe to re-run: it does not recreate resources or clobber the config', () => {
    const first = runSetup(dir, ANSWERS);
    const second = runSetup(dir, ANSWERS);
    expect(second.config).toBe(first.config);
    expect(second.calls.filter((c) => c.includes('kv namespace create'))).toHaveLength(0);
    expect(second.calls.filter((c) => c.includes('r2 bucket create'))).toHaveLength(0);
    expect(second.calls.filter((c) => c.includes('d1 create'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. doctor.sh
// ---------------------------------------------------------------------------

/** Run doctor.sh in a fork, optionally after a completed setup. */
function runDoctor(dir, env = {}) {
  // Fresh log, so what is in it afterwards is doctor's doing and nobody
  // else's — the "never mutates anything" check depends on that.
  const callLog = join(dir, 'calls.log');
  writeFileSync(callLog, '');
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync('bash', [join(dir, 'scripts', 'doctor.sh')], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, CALL_LOG: callLog, ...env },
      timeout: 60_000,
    });
  } catch (e) {
    stdout = `${e.stdout || ''}${e.stderr || ''}`;
    status = e.status ?? 1;
  }
  // Strip ANSI so assertions read plainly.
  return { stdout: stdout.replace(/\[[0-9;]*m/g, ''), status };
}

describe('doctor.sh', () => {
  let dir;
  const ANSWERS = ['my-photo-site', 'photo-subscribers', 'photo-portal', 'photo-cdn', '2', 'hunter2hunter2'];
  beforeEach(() => {
    dir = makeFork();
    // doctor runs `npm test`, which does not exist in the throwaway fork.
    writeFileSync(join(dir, 'bin', 'npm'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(dir, 'bin', 'npm'), 0o755);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('does NOT report placeholders after a successful setup', () => {
    // The bug this pins: the old check was `grep -q YOUR_ wrangler.jsonc`,
    // which matched the example config's own explanatory comment. So doctor
    // told a finished setup to go run setup — every single time. Someone
    // following the docs would loop on that forever with nothing actually
    // wrong. This is the single most demoralising possible first-run bug.
    runSetup(dir, ANSWERS);
    const r = runDoctor(dir);
    expect(r.stdout).toContain('All settings filled in');
    expect(r.stdout).not.toMatch(/settings are still blank/);
    expect(r.status).toBe(0);
  });

  it('does report placeholders on a config that really is unfinished', () => {
    cpSync(join(dir, 'wrangler.example.jsonc'), join(dir, 'wrangler.jsonc'));
    cpSync(join(dir, 'site.config.example.js'), join(dir, 'site.config.js'));
    const r = runDoctor(dir);
    expect(r.stdout).toMatch(/settings are still blank/);
    expect(r.stdout).toContain('YOUR_KV_NAMESPACE_ID');
    expect(r.status).not.toBe(0);
  });

  it('says what to run for every problem it reports', () => {
    // A health check that names a problem without naming the fix is just bad
    // news. Every ✗ line must be followed by a → line.
    const r = runDoctor(dir); // bare fork: no config at all, plenty of failures
    const lines = r.stdout.split('\n');
    const failures = lines.map((l, i) => [l, i]).filter(([l]) => l.trimStart().startsWith('✗'));
    expect(failures.length).toBeGreaterThan(0);
    for (const [line, i] of failures) {
      expect(lines[i + 1]?.trimStart().startsWith('→'),
        `no fix offered after: ${line.trim()}`).toBe(true);
    }
  });

  it('does not raise a false alarm about secrets when not signed in', () => {
    // Signed out, `wrangler secret list` returns nothing — which the old
    // version read as "both required secrets are missing" and reported as two
    // hard failures. The real problem is one thing, not three.
    runSetup(dir, ANSWERS);
    const r = runDoctor(dir, { FAKE_LOGGED_IN: '0' });
    expect(r.stdout).toContain('Not signed in');
    expect(r.stdout).not.toMatch(/Console password isn't set/);
    expect(r.stdout).not.toMatch(/Signing key isn't set/);
  });

  it('reports optional features as notes, never failures', () => {
    // Every optional secret unset is a fully valid, fully working install.
    runSetup(dir, ANSWERS);
    const r = runDoctor(dir);
    expect(r.stdout).toMatch(/Optional features currently off/);
    expect(r.stdout).not.toMatch(/✗.*[Oo]ptional/);
  });

  it('never mutates anything', () => {
    runSetup(dir, ANSWERS);
    const before = readFileSync(join(dir, 'wrangler.jsonc'), 'utf8');
    const r = runDoctor(dir);
    expect(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')).toBe(before);
    // and it issued no command that could change anything
    expect(r.stdout).toBeTruthy();
    const calls = readFileSync(join(dir, 'calls.log'), 'utf8');
    for (const verb of ['create', 'secret put', 'delete', 'deploy', 'd1 execute']) {
      expect(calls, `doctor.sh ran a mutating command: ${verb}`).not.toContain(verb);
    }
  });
});

describe('the scripts do not send people to pages that no longer exist', () => {
  // Walking Cloudflare Access live on 2026-07-26 found four doc defects, one
  // of which left a real hole. The nav path was renamed; both scripts still
  // printed the old one, which is a dead end for anyone following it.
  const SCRIPTS = ['scripts/setup.sh', 'scripts/doctor.sh'];

  it.each(SCRIPTS.map((s) => [s]))('%s does not mention the retired Zero Trust path', (s) => {
    const src = readFileSync(join(ROOT, s), 'utf8');
    expect(src).not.toMatch(/Zero Trust/i);
  });

  it.each(SCRIPTS.map((s) => [s]))('%s names the current Cloudflare One path', (s) => {
    const src = readFileSync(join(ROOT, s), 'utf8');
    if (!/Access/.test(src)) return; // not every script has to mention it
    expect(src).toMatch(/Cloudflare One/i);
  });
});

// ---------------------------------------------------------------------------
// The guard for the bug that got all the way to a real terminal (2026-08-07).
//
// wrangler FORMAT-VALIDATES `name` and `bucket_name` while parsing the config,
// on EVERY command — `login` and `whoami` included. The example shipped
// `YOUR_WORKER_NAME` / `YOUR_BUCKET_NAME` there, which fail those rules, so in
// a fresh fork every wrangler command died before it ran:
//
//     ✘ Expected "name" to be of type string, alphanumeric and lowercase with
//       dashes only but got "YOUR_WORKER_NAME".
//
// That is a total deadlock on first run — you cannot `wrangler login`, and
// setup.sh cannot check whether you are logged in, so it tells you to run the
// command that cannot work. Nothing caught it: the fake wrangler below does not
// validate config, and os-extract.mjs's bundle check substitutes valid names
// before it ever invokes wrangler, so the one gate that DOES run the real
// binary was looking at a config the user never gets.
//
// These assert wrangler's documented rules directly, so they hold without a
// Cloudflare account or a network call.
describe('the example config is valid to wrangler before anything is filled in', () => {
  const example = () => readFileSync(join(ROOT, 'wrangler.example.jsonc'), 'utf8');
  const valueOf = (key) => {
    const m = example().match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    if (!m) throw new Error(`wrangler.example.jsonc has no "${key}"`);
    return m[1];
  };

  // https://developers.cloudflare.com/workers — lowercase alphanumeric + dashes.
  const WORKER_NAME = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  // R2: begins and ends alphanumeric, lowercase + digits + hyphens, 3–63 chars.
  const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

  it('"name" passes wrangler\'s own format rule', () => {
    const v = valueOf('name');
    expect(v, `"${v}" would make every wrangler command fail in a fresh fork`).toMatch(WORKER_NAME);
  });

  it('"bucket_name" passes R2\'s naming rule', () => {
    const v = valueOf('bucket_name');
    expect(v, `"${v}" would make every wrangler command fail in a fresh fork`).toMatch(BUCKET_NAME);
  });

  it('...and both are still detected as unfilled placeholders', () => {
    // Valid-to-wrangler must not mean invisible-to-setup: if these stop being
    // detected, setup.sh skips the steps that fill them and the deploy carries
    // whatever the example happened to say.
    const left = remainingPlaceholders(example());
    expect(left).toContain(valueOf('name'));
    expect(left).toContain(valueOf('bucket_name'));
  });
});

// The naming step gates on the PLACEHOLDER, not on the file existing. A fork
// ships a ready-made wrangler.jsonc (os-extract.mjs installs the example as the
// real config), so `[ -f wrangler.jsonc ]` read as "already named" and the step
// silently skipped — leaving the worker called `your-worker-name` and failing
// the final check only at the very end, after every resource had been created.
describe('setup.sh decides the naming step by placeholder, not by file existence', () => {
  const sh = () => readFileSync(join(ROOT, 'scripts', 'setup.sh'), 'utf8');

  it('does not skip naming just because wrangler.jsonc is present', () => {
    expect(sh()).not.toMatch(/step 2 [\s\S]{0,120}?if \[ -f wrangler\.jsonc \]; then\s*\n\s*good/);
  });

  it('asks the placeholder before offering to name the site', () => {
    expect(sh()).toMatch(/placeholder_left your-worker-name/);
  });

  it('installs dependencies before the first wrangler call', () => {
    // `npx wrangler` with no node_modules downloads whatever is newest on npm,
    // so the first command ran on an unpinned wrangler — and paid a minute for
    // the privilege. Install has to come first for `npx` to resolve locally.
    const s = sh();
    expect(s.indexOf('npm install')).toBeLessThan(s.indexOf('npx wrangler whoami'));
  });
});

// ---------------------------------------------------------------------------
// "Already exists" recovery (2026-08-07, found on the first real run).
//
// `create` fails outright when a name is taken, and that is not an edge case:
//
//   ✘ A KV namespace with the title "SUBSCRIBERS" already exists.
//   ▲ The database name "demo-portal" is already taken.
//
// The KV title was hardcoded to the binding name, and titles are unique per
// account — so the SECOND site on an account could never be set up, which is
// exactly the demo-beside-a-live-site case the launch plan calls for. The D1
// one is every re-run after a partial setup, which this script's own header
// promises is safe. Both dead-ended into asking a photographer to find a
// 32-character id in a wall of terminal output.
describe('finding a resource that already exists', () => {
  const KV_LIST = `
 ⛅️ wrangler 4.103.0
───────────────────
[
  { "id": "0f1e2d3c4b5a69788796a5b4c3d2e1f0", "title": "SUBSCRIBERS", "supports_url_encoding": true },
  { "id": "aaaabbbbccccddddeeeeffff00001111", "title": "photo-subscribers" },
  { "id": "99998888777766665555444433332222", "title": "photo-subscribers_preview" }
]`;

  const D1_LIST = `
 ⛅️ wrangler 4.103.0
───────────────────
[
  { "uuid": "f95fcb52-9be9-4333-8df6-66953d8b309a", "name": "demo-portal", "version": "production" },
  { "uuid": "00000000-0000-4000-8000-000000000000", "name": "something-else" }
]`;

  it('finds a KV namespace by its exact title', () => {
    expect(findKvNamespaceIdByTitle(KV_LIST, 'photo-subscribers'))
      .toBe('aaaabbbbccccddddeeeeffff00001111');
  });

  it('does not confuse a title with its _preview twin', () => {
    // Both contain the same substring; picking the wrong one writes a config
    // that looks finished and reads the wrong namespace at runtime.
    expect(findKvNamespaceIdByTitle(KV_LIST, 'photo-subscribers_preview'))
      .toBe('99998888777766665555444433332222');
  });

  it('finds a D1 database by name', () => {
    expect(findD1DatabaseIdByName(D1_LIST, 'demo-portal'))
      .toBe('f95fcb52-9be9-4333-8df6-66953d8b309a');
  });

  it('reads through the version banner wrangler prints first', () => {
    // JSON.parse(stdout) fails on this output even though it is perfectly good.
    expect(findD1DatabaseIdByName(D1_LIST, 'something-else')).toBeTruthy();
  });

  it('returns null for a name that is not there, rather than guessing', () => {
    // The whole point: a wrong id is worse than no id, because setup.sh has a
    // fallback for "not found" and none for "confidently wrong".
    expect(findKvNamespaceIdByTitle(KV_LIST, 'not-a-namespace')).toBeNull();
    expect(findD1DatabaseIdByName(D1_LIST, 'not-a-database')).toBeNull();
    expect(findKvNamespaceIdByTitle('', 'photo-subscribers')).toBeNull();
    expect(findD1DatabaseIdByName('not json at all', 'demo-portal')).toBeNull();
  });

  it('survives output that is not JSON at all', () => {
    const table = 'id  0f1e2d3c4b5a69788796a5b4c3d2e1f0  title  SUBSCRIBERS';
    expect(findKvNamespaceIdByTitle(table, 'SUBSCRIBERS'))
      .toBe('0f1e2d3c4b5a69788796a5b4c3d2e1f0');
  });
});

describe('setup.sh asks for the subscriber list name', () => {
  const sh = () => readFileSync(join(ROOT, 'scripts', 'setup.sh'), 'utf8');

  it('no longer hardcodes the namespace title to the binding name', () => {
    // `kv namespace create SUBSCRIBERS` — the positional is the TITLE, unique
    // per account, so this could only ever work once per Cloudflare account.
    expect(sh()).not.toMatch(/kv namespace create SUBSCRIBERS/);
  });

  it('does not pass --update-config, which appends instead of filling', () => {
    // The flag reads like a convenience and is a trap: wrangler APPENDS a new
    // binding block rather than filling the template's placeholder, so the
    // config ended up binding SUBSCRIBERS twice — a parse error that killed
    // every wrangler command after it. setup.sh reads the id from the output
    // and writes the placeholder itself, which it already had to do for D1.
    // Comment lines are excluded — the header explains at length why the flag
    // is not used, and matching that prose would make this unfixable.
    const commands = sh().split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(commands).not.toMatch(/--update-config/);
  });

  it('leaves the binding names to the template config, not the CLI', () => {
    // The binding is SUBSCRIBERS because wrangler.example.jsonc says so; the
    // create call only decides the namespace TITLE.
    const cfg = readFileSync(join(ROOT, 'wrangler.example.jsonc'), 'utf8');
    expect(cfg).toMatch(/"binding"\s*:\s*"SUBSCRIBERS"/);
    expect(cfg).toMatch(/"binding"\s*:\s*"CDN"/);
    expect(cfg).toMatch(/"binding"\s*:\s*"DB"/);
  });

  it('falls back to a lookup before asking a human for an id', () => {
    const s = sh();
    expect(s).toMatch(/lookup_id kv/);
    expect(s).toMatch(/lookup_id d1/);
    for (const m of s.matchAll(/ask_id_manually/g)) expect(m).toBeTruthy();
    // the lookup has to come before the manual prompt in both branches
    expect(s.indexOf('lookup_id kv')).toBeLessThan(s.lastIndexOf('ask_id_manually'));
  });
});

// ---------------------------------------------------------------------------
// What the script SAYS, not just what it does (2026-08-07, from the live run).
//
// The screen read, verbatim:
//
//     ✘ [ERROR] A KV namespace with the title "demo-subscribers" already exists.
//     ✓ Subscriber list ready.
//
// A red error, a green tick, and nothing between them saying which one won. The
// recovery was working perfectly and looked indistinguishable from the script
// ignoring a failure — and the question it left open ("did that overwrite my
// existing list?") is the one that would matter most if the answer were yes.
describe('setup.sh says what happened when it recovers', () => {
  let dir;
  beforeEach(() => { dir = makeFork(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const ANSWERS = ['my-photo-site', 'photo-subscribers', 'photo-portal', 'photo-cdn', '2', 'hunter2hunter2'];

  it('recaps every resource by name, and whether it made it', () => {
    const r = runSetup(dir, ANSWERS);
    expect(r.stdout).toContain('What your site is using');
    for (const name of ['photo-subscribers', 'photo-portal', 'photo-cdn']) {
      expect(r.stdout, `the summary should name ${name}`).toContain(name);
    }
    expect(r.stdout).toContain('created just now');
  });

  it('warns before the storage step that "already exists" is survivable', () => {
    // Pre-empting it is what stops wrangler's red text reading as a failure.
    const r = runSetup(dir, ANSWERS);
    const preamble = r.stdout.slice(0, r.stdout.indexOf('Subscriber list…'));
    expect(preamble).toContain('already exists');
  });

  it('never leaves a recovery unexplained — no bare tick after an error', () => {
    // The shape of the original complaint: a red ✘ followed by a green ✓ with
    // nothing in between. Every branch that adopts an existing resource says
    // "reusing" first, so the words carry the outcome and not just the colour.
    const sh = readFileSync(join(ROOT, 'scripts', 'setup.sh'), 'utf8');
    const lookups = (sh.match(/lookup_id /g) || []).length;
    const explains = (sh.match(/explain_create_failure/g) || []).length;
    // one definition + one call before each lookup
    expect(explains, 'every lookup should be introduced').toBeGreaterThanOrEqual(lookups);
    expect(sh).toMatch(/reusing/i);
  });
});
