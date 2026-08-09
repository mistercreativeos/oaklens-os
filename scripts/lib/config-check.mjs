// Is wrangler.jsonc actually finished?
//
// The naive version of this check — `grep -q 'YOUR_' wrangler.jsonc` — is what
// doctor.sh used to do, and it was wrong in the most demoralising way
// possible: wrangler.example.jsonc explains itself in a comment that contains
// the literal placeholder token, so a *correctly completed* setup still
// reported "still has placeholders — run scripts/setup.sh". Someone following
// the instructions would run setup, be told setup had not worked, run it
// again, and get the same answer forever.
//
// So the check ignores comments and only looks at real values.
//
// Usage:  node scripts/lib/config-check.mjs [path]
//   exit 0 -> nothing left to fill in
//   exit 1 -> prints one remaining placeholder per line, on stdout
//
// `-` reads stdin instead of a file. doctor.sh uses it to check the copy of the
// config saved in git history (`git show HEAD:wrangler.jsonc`) without writing
// a temp file — that copy is what Cloudflare Builds actually deploys from, and
// it can be the blank template while the one on disk is perfectly filled in.

import { readFileSync } from 'node:fs';

/**
 * Strip JSONC comments so a placeholder mentioned in prose is not mistaken
 * for one that still needs filling in. String-aware, so a `//` inside a URL
 * survives.
 *
 * @param {string} src
 * @returns {string}
 */
export function stripJsoncComments(src) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') { out += src[++i] ?? ''; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') { inLine = true; i++; continue; }
    if (c === '/' && next === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}

/**
 * Placeholders still present in a wrangler config's actual values.
 *
 * @param {string} src raw wrangler.jsonc text
 * @returns {string[]} unique placeholder names, sorted
 */
export function remainingPlaceholders(src) {
  // TWO SHAPES. `YOUR_*` is the loud one, used everywhere wrangler treats a
  // value as opaque. But wrangler FORMAT-VALIDATES `name` and `bucket_name` on
  // every command it runs — `login` and `whoami` included — and rejects an
  // uppercase token outright, which deadlocked first-run setup on a fresh fork:
  // you could not log in, and setup.sh could not check whether you had. Those
  // two fields therefore carry lowercase-and-dashes placeholders, which wrangler
  // accepts and a human still reads as unfilled. Both shapes must be detected
  // here or setup.sh silently skips the step that fills them.
  const found = stripJsoncComments(src)
    .match(/YOUR_[A-Z0-9_]+|your-[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
  return [...new Set(found)].sort();
}

if (process.argv[1]?.endsWith('config-check.mjs')) {
  const path = process.argv[2] || 'wrangler.jsonc';
  // NB: `process.exit()` right after writing to a *pipe* truncates the output
  // — Node does not flush first. setup.sh reads this over a pipe, so setting
  // exitCode and letting the process end naturally is load-bearing, not style.
  let src;
  try {
    src = readFileSync(path === '-' ? 0 : path, 'utf8');
  } catch {
    console.log('MISSING_CONFIG');
    process.exitCode = 1;
    src = null;
  }
  if (src !== null) {
    const left = remainingPlaceholders(src);
    if (left.length) {
      console.log(left.join('\n'));
      process.exitCode = 1;
    }
  }
}
