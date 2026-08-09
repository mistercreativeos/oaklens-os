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

  # R2 has an account-level switch only the dashboard can flip. FAKE_R2_OFF
  # models an account that has not flipped it: every r2 command answers 10042.
  *"r2 "*)
    if [ "\${FAKE_R2_OFF:-0}" = "1" ]; then
      echo "✘ [ERROR] A request to the Cloudflare API failed." >&2
      echo "  Please enable R2 through the Cloudflare Dashboard. [code: 10042]" >&2
      exit 1
    fi
    case "$*" in
      *"r2 bucket create"*)
        # FAKE_R2_CREATE_FAILS models the OTHER way create can fail — the name
        # is taken. Whether the bucket is then adopted depends on \`bucket info\`.
        if [ "\${FAKE_R2_CREATE_FAILS:-0}" = "1" ]; then
          echo "✘ [ERROR] The bucket you tried to create already exists." >&2; exit 1
        fi
        echo "✨ Created bucket"; exit 0 ;;
      *"r2 bucket info"*)
        [ "\${FAKE_R2_BUCKET_MISSING:-0}" = "1" ] && { echo "✘ [ERROR] The specified bucket does not exist." >&2; exit 1; }
        echo "name: photo-cdn"; exit 0 ;;
      *"r2 bucket list"*) echo "[]"; exit 0 ;;
    esac
    exit 0 ;;

  *"d1 execute"*) echo "🚣 Executed successfully"; exit 0 ;;
  *"d1 list"*)
    echo '[{ "uuid": "a1b2c3d4-1111-2222-3333-444455556666", "name": "photo-portal" }]'
    exit 0 ;;
  *"secret put"*)
    name="\$(printf '%s' "$*" | sed -E 's/.*secret put ([A-Z_0-9]+).*/\\1/')"
    val="\$(cat)"
    # Secrets live ON A WORKER. Before anything has deployed there is no worker
    # to put them on, and wrangler asks whether to create one — reading the
    # answer from the same stdin the secret was piped to, so it eats the secret
    # and fails. That is why setup.sh deploys BEFORE this step, and this stub
    # refuses until it has seen a deploy so the ordering is actually pinned.
    if [ "\${FAKE_SECRETS_FAIL:-0}" = "1" ] \\
       || { [ "\${FAKE_SECRETS_NEED_WORKER:-0}" = "1" ] && ! grep -q '^DEPLOYED\$' "$CALL_LOG"; }; then
      echo "✘ [ERROR] There doesn't seem to be a Worker called \\"my-photo-site\\"." >&2
      exit 1
    fi
    printf 'SECRET %s=%s\\n' "\$name" "\$val" >> "$CALL_LOG"
    echo "✨ Success! Uploaded secret \$name"; exit 0 ;;
  *"secret list"*) echo '[{"name":"AUTH_PASSWORD_HASH"},{"name":"SESSION_SECRET"}]'; exit 0 ;;
  *"deploy"*)
    [ "\${FAKE_DEPLOY_FAILS:-0}" = "1" ] && { echo "✘ [ERROR] Please enable R2 through the Cloudflare Dashboard. [code: 10042]" >&2; exit 1; }
    printf 'DEPLOYED\\n' >> "$CALL_LOG"
    msg="Deployed my-photo-site triggers (1.20 sec)
  https://my-photo-site.teststudio.workers.dev"
    # FAKE_DEPLOY_SILENT: a deploy that works and says nothing we can parse.
    [ "\${FAKE_DEPLOY_SILENT:-0}" = "1" ] && msg="Deployed my-photo-site triggers (1.20 sec)"
    echo "\$msg"
    # Real wrangler mirrors its console output into WRANGLER_LOG_PATH, which is
    # how setup.sh reads the address back without piping stdout — piping would
    # make wrangler non-interactive and turn the workers.dev subdomain question
    # into a hard failure instead of a question.
    #
    # THE REFUSAL BELOW IS THE POINT. Real wrangler will not write to a log path
    # that ALREADY EXISTS; it writes nothing at all, silently. setup.sh created
    # that path with \`mktemp\`, which creates the file — so the capture came back
    # empty on the real cold run while this suite stayed green, because the stub
    # used to append unconditionally. A stub more permissive than the binary is
    # not a test, it is a rehearsal of the happy path.
    if [ -n "\${WRANGLER_LOG_PATH:-}" ] && [ ! -e "\$WRANGLER_LOG_PATH" ]; then
      printf '%s\\n' "\$msg" > "\$WRANGLER_LOG_PATH"
    fi
    exit 0 ;;
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
 * Hermetic git. Without this the suite reads whoever is running it: their
 * global identity would silently satisfy the no-identity test below, and a
 * global `commit.gpgsign = true` would hang the commit on a passphrase prompt.
 */
// Two shapes, and the difference bites: runSetup MERGES its env argument over
// a PATH that points at the fake wrangler, so handing it a full `process.env`
// clone puts the real PATH back and runs the real binary. Pass the overrides
// alone to runSetup; the full clone is only for direct `git` calls here.
const GIT_HERMETIC = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const GIT_ENV = { ...process.env, ...GIT_HERMETIC };

/**
 * The same throwaway fork, but a REAL git checkout of it — the shape an
 * installer actually has, because the guide tells them to clone.
 *
 * Real git, not a stub, on purpose. The step under test only matters if a
 * commit lands in a real history, and a fake `git` that always says yes would
 * rehearse the happy path and prove nothing. (The fake wrangler taught us that
 * the expensive way — see the WRANGLER_LOG_PATH note above.)
 *
 * `identity: false` models a machine where git has just been installed and
 * knows nobody. That is the DEFAULT on macOS, not an edge case: git arrives
 * with the Xcode command line tools carrying no user.name/user.email, and
 * `git commit` answers "Please tell me who you are" and exits non-zero.
 */
function makeGitFork({ identity = true } = {}) {
  const dir = makeFork();
  const git = (...args) => execFileSync('git', args, { cwd: dir, env: GIT_ENV, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', 'https://github.com/teststudio/oaklens-os');
  // Both files ship TRACKED and full of placeholders. That is the whole
  // mechanism behind the bug: a fork's GitHub copy keeps the blank template
  // until somebody commits over it.
  cpSync(join(dir, 'wrangler.example.jsonc'), join(dir, 'wrangler.jsonc'));
  cpSync(join(dir, 'site.config.example.js'), join(dir, 'site.config.js'));
  git('add', 'wrangler.jsonc', 'site.config.js');
  git('-c', 'user.name=Engine', '-c', 'user.email=engine@example.invalid',
    'commit', '-q', '-m', 'the template, unfilled');
  // A real install is a CLONE, which arrives with an `origin/main` tracking ref
  // already pointing at what GitHub had. Without this the fixture is a shape no
  // user ever has, and doctor's "have your changes reached GitHub?" check would
  // be exercised only on its can't-tell branch.
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  if (identity) {
    git('config', '--local', 'user.name', 'Test Installer');
    git('config', '--local', 'user.email', 'installer@example.invalid');
  }
  return dir;
}

/** Read back a repo's history. */
function gitLog(dir, ...args) {
  return execFileSync('git', ['log', ...args], { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
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
// 2b. Saving the settings — the step whose absence broke every connected fork
// ---------------------------------------------------------------------------
//
// `wrangler.jsonc` is tracked and ships full of placeholders; setup.sh fills it
// in ON THE USER'S COMPUTER. Nothing used to tell anyone to commit it, so the
// moment they connected their repo, Cloudflare Builds checked out GitHub's copy
// — still `your-worker-name` / `YOUR_KV_NAMESPACE_ID` / `your-bucket-name` —
// deployed under the wrong name, auto-provisioned a junk R2 bucket literally
// called `your-bucket-name`, and died on the KV placeholder. Their site kept
// serving the last hand-deploy, so nothing looked wrong until they wondered why
// Publish did nothing.
describe('setup.sh — saving the settings into the project history', () => {
  let dir;
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const ANSWERS = ['my-photo-site', 'photo-subscribers', 'photo-portal', 'photo-cdn', '2', 'hunter2hunter2'];
  // Two extra prompts, between the preset and the password, on a machine where
  // git has no identity yet.
  const ANSWERS_WITH_IDENTITY = [
    'my-photo-site', 'photo-subscribers', 'photo-portal', 'photo-cdn', '2',
    'Ada Photographer', 'ada@example.invalid',
    'hunter2hunter2',
  ];

  it('commits the filled-in config, so a push carries it', () => {
    dir = makeGitFork();
    const r = runSetup(dir, ANSWERS, GIT_HERMETIC);
    expect(r.status).toBe(0);

    const files = gitLog(dir, '-1', '--name-only', '--format=').trim().split('\n').sort();
    expect(files).toEqual(['site.config.js', 'wrangler.jsonc']);

    // And the committed copy is the FILLED one. Committing the placeholder
    // template would satisfy a naive "did it commit?" assertion while shipping
    // the exact config that broke the build.
    const committed = execFileSync('git', ['show', 'HEAD:wrangler.jsonc'],
      { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
    expect(remainingPlaceholders(committed)).toEqual([]);
    expect(committed).toContain('my-photo-site');
  });

  it('asks who is making the change when git has no identity, and records it locally', () => {
    // Without this, `git commit` fails with "Please tell me who you are" and
    // the whole step reads as the script being broken.
    dir = makeGitFork({ identity: false });
    const r = runSetup(dir, ANSWERS_WITH_IDENTITY, GIT_HERMETIC);
    expect(r.status).toBe(0);

    expect(gitLog(dir, '-1', '--format=%an <%ae>').trim())
      .toBe('Ada Photographer <ada@example.invalid>');
    // --local: their machine-wide git settings are not ours to edit.
    const local = readFileSync(join(dir, '.git', 'config'), 'utf8');
    expect(local).toContain('ada@example.invalid');
  });

  it('offers the repo owner as the default identity, so both answers are a return', () => {
    dir = makeGitFork({ identity: false });
    const r = runSetup(dir, [
      'my-photo-site', 'photo-subscribers', 'photo-portal', 'photo-cdn', '2',
      '', '', // accept both defaults
      'hunter2hunter2',
    ], GIT_HERMETIC);
    expect(r.status).toBe(0);
    // `teststudio` is the owner in the origin URL makeGitFork set.
    expect(gitLog(dir, '-1', '--format=%an <%ae>').trim())
      .toBe('teststudio <teststudio@users.noreply.github.com>');
  });

  it('commits only the two files it wrote, never someone else\'s work in progress', () => {
    dir = makeGitFork();
    writeFileSync(join(dir, 'my-notes.txt'), 'half-finished thoughts\n');
    const r = runSetup(dir, ANSWERS, GIT_HERMETIC);
    expect(r.status).toBe(0);

    const files = gitLog(dir, '-1', '--name-only', '--format=').trim().split('\n');
    expect(files).not.toContain('my-notes.txt');
    expect(existsSync(join(dir, 'my-notes.txt'))).toBe(true);
  });

  it('is safe to re-run: the second pass adds no empty commit', () => {
    dir = makeGitFork();
    runSetup(dir, ANSWERS, GIT_HERMETIC);
    const before = gitLog(dir, '--format=%H').trim();
    // A re-run asks far fewer questions — naming and storage are already done —
    // so the answers are only the ones still on screen: the look, then the
    // password. Pressing return at the look keeps whatever is already set.
    const r = runSetup(dir, ['', 'hunter2hunter2'], GIT_HERMETIC);
    expect(gitLog(dir, '--format=%H').trim()).toBe(before);
    expect(r.stdout).toContain('already saved');
    // The re-run must not have quietly changed the look back to the first
    // option, which is what defaulting to 1 every time used to do.
    expect(r.siteConfig).toMatch(/preset:\s*'passe-partout'/);
  });

  it('says so plainly, and carries on, when the folder is not a git project', () => {
    // A downloaded ZIP rather than a clone. Nothing here is fatal — the site
    // still deploys — but publishing later needs a real repo, so say it now.
    dir = makeFork();
    const r = runSetup(dir, ANSWERS);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/isn't a git project/);
    expect(remainingPlaceholders(r.config)).toEqual([]);
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
      env: {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        CALL_LOG: callLog,
        ...GIT_HERMETIC,
        ...env,
      },
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
    // A git checkout, because that is what an install actually is — and because
    // doctor now reports on what the project's history holds, which a bare
    // directory cannot answer.
    dir = makeGitFork();
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

  // ---- what GitHub actually has -------------------------------------------
  //
  // The state that broke a cold run and left no trace: settings filled in
  // perfectly on the installer's computer, blank template still on GitHub, and
  // Cloudflare building from GitHub. The site kept serving its last hand-deploy,
  // so every visible signal said fine.

  it('catches a config that is filled in here but still blank in the history', () => {
    runSetup(dir, ANSWERS);
    // Undo the commit setup.sh made, keeping the filled file on disk. This is
    // exactly the shape of every install done before setup.sh started
    // committing, and of anyone who edits the config by hand afterwards.
    execFileSync('git', ['reset', '--soft', 'HEAD~1'], { cwd: dir, env: GIT_ENV });
    execFileSync('git', ['reset'], { cwd: dir, env: GIT_ENV });

    const r = runDoctor(dir);
    expect(r.stdout).toMatch(/saved copy of your settings is still the blank template/);
    expect(r.stdout).toMatch(/Cloudflare builds from GitHub's copy/);
    // Fatal, not a note: a site in this state cannot publish, and nothing else
    // will tell them so.
    expect(r.status).not.toBe(0);
    // And it must not contradict itself — the on-disk config really is fine.
    expect(r.stdout).toContain('All settings filled in');
  });

  it('says so when the settings are saved but never sent to GitHub', () => {
    runSetup(dir, ANSWERS);
    const r = runDoctor(dir);
    expect(r.stdout).toMatch(/1 change saved here but not sent to GitHub yet/);
    expect(r.stdout).toMatch(/your GitHub token, not your account password/);
    // Unpushed work is a nudge, not a fault — they may be mid-edit.
    expect(r.stdout).not.toMatch(/✗.*GitHub/);
  });

  it('is quiet about the history once everything is committed and pushed', () => {
    runSetup(dir, ANSWERS);
    // Model the push: origin/main catches up with local main.
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'],
      { cwd: dir, env: GIT_ENV });
    const r = runDoctor(dir);
    expect(r.stdout).toContain('Your settings are saved in your project\'s history');
    expect(r.stdout).toContain('Everything saved here has been sent to GitHub');
    expect(r.stdout).not.toMatch(/not sent to GitHub yet/);
  });

  it('calls out a folder that is not a git project at all', () => {
    // A downloaded ZIP. The site can still deploy by hand, but the Publish
    // button never can, and nothing else in the report would say why.
    const zip = makeFork();
    writeFileSync(join(zip, 'bin', 'npm'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(zip, 'bin', 'npm'), 0o755);
    try {
      const r = runDoctor(zip);
      expect(r.stdout).toMatch(/isn't a git project/);
      expect(r.stdout).toMatch(/downloaded as a ZIP/);
    } finally {
      rmSync(zip, { recursive: true, force: true });
    }
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
  // of which left a real hole: the nav path had been renamed and both scripts
  // still printed the old one.
  //
  // Then it was renamed BACK. The 2026-08-08 cold run's dashboard showed "Zero
  // Trust" in the sidebar — the name these tests were written to forbid — while
  // other accounts still show "Cloudflare One", because Cloudflare rolls the
  // redesign out account by account. Pinning either name alone is therefore
  // guaranteed to be wrong for somebody. So the rule is now: name BOTH, and
  // let the reader match whichever sidebar they are looking at.
  const SCRIPTS = ['scripts/setup.sh', 'scripts/doctor.sh'];

  // A GLOBAL WRANGLER IS NOT A PREREQUISITE, and setup.md had seven commands
  // that assumed one. On the 2026-08-08 cold run every single `wrangler …` line
  // answered `command not found` — including the two that set the required
  // secrets, which is where the install stops being recoverable by guessing.
  // `npx` runs the copy `npm install` already put in the project.
  it('setup.md never tells anyone to run a bare `wrangler`', () => {
    const src = readFileSync(join(ROOT, 'setup.md'), 'utf8');
    const offenders = [];
    let inFence = false;
    for (const [i, line] of src.split('\n').entries()) {
      if (line.startsWith('```')) { inFence = !inFence; continue; }
      if (!inFence) continue;
      if (/^\s*wrangler\s/.test(line)) offenders.push(`${i + 1}: ${line.trim()}`);
    }
    expect(offenders, 'these need `npx` in front').toEqual([]);
  });

  it.each(SCRIPTS.map((s) => [s]))('%s names both labels for the Access sidebar', (s) => {
    const src = readFileSync(join(ROOT, s), 'utf8');
    if (!/Access/.test(src)) return; // not every script has to mention it
    expect(src, 'the redesigned sidebar says "Zero Trust"').toMatch(/Zero Trust/i);
    expect(src, 'accounts on the old sidebar say "Cloudflare One"').toMatch(/Cloudflare One/i);
  });
});

// ---------------------------------------------------------------------------
// R2 has a switch, and only the dashboard can flip it (2026-08-08 cold run).
//
// A stranger's first install died here, ten minutes after the actual mistake.
// `r2 bucket create` failed with `code: 10042 — Please enable R2 through the
// Cloudflare Dashboard`; the script had no branch for that, assumed the only
// other explanation ("must already exist"), printed "Photo storage ready", and
// wrote the bucket name into wrangler.jsonc. From then on the placeholder was
// filled, so every re-run SKIPPED the storage step entirely and the bucket was
// never created. The failure finally surfaced as a dead `wrangler deploy`.
//
// Two properties matter, and neither was true before: ask before creating
// anything, and never claim to have adopted a bucket without looking for it.
describe('setup.sh and the R2 switch', () => {
  let dir;
  beforeEach(() => { dir = makeFork(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const ANSWERS = ['my-photo-site', 'photo-subscribers', 'photo-portal', 'photo-cdn', '2', 'hunter2hunter2'];

  it('stops before creating anything when R2 is not switched on', () => {
    const r = runSetup(dir, ANSWERS, { FAKE_R2_OFF: '1' });
    expect(r.status).not.toBe(0);
    // Half-made resources on a stranger's account are worse than a clean stop.
    expect(r.calls.filter((c) => c.includes('create'))).toHaveLength(0);
  });

  it('says where the switch is, in words someone can follow', () => {
    const r = runSetup(dir, ANSWERS, { FAKE_R2_OFF: '1' });
    expect(r.stdout).toContain('dash.cloudflare.com');
    expect(r.stdout).toMatch(/Storage & databases/);
    expect(r.stdout).toMatch(/run this script again/i);
  });

  it('leaves the bucket placeholder alone so the re-run does the work', () => {
    // The heart of the bug. A filled placeholder means "done" to every later
    // run, so writing it for a bucket that does not exist does not just fail —
    // it makes the failure permanent and invisible.
    const r = runSetup(dir, ANSWERS, { FAKE_R2_OFF: '1' });
    expect(remainingPlaceholders(r.config)).toContain('your-bucket-name');
  });

  it('adopts an existing bucket only after confirming it is really there', () => {
    const r = runSetup(dir, ANSWERS, { FAKE_R2_CREATE_FAILS: '1' });
    expect(r.stdout).toMatch(/reusing/i);
    expect(r.calls.some((c) => c.includes('r2 bucket info')),
      'the reuse claim has to be checked against the account').toBe(true);
    expect(r.config).toContain('photo-cdn');
  });

  it('does not claim reuse when the create failed and no bucket exists', () => {
    const r = runSetup(dir, ANSWERS, {
      FAKE_R2_CREATE_FAILS: '1', FAKE_R2_BUCKET_MISSING: '1',
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toMatch(/Photo storage ready/);
    expect(remainingPlaceholders(r.config)).toContain('your-bucket-name');
  });
});

// ---------------------------------------------------------------------------
// Secrets are stored ON A WORKER (2026-08-08 cold run).
//
// setup.sh used to set them before anything had ever deployed, so there was no
// worker to store them on. Wrangler asks "There doesn't seem to be a Worker
// called X — create one?" and reads the answer from stdin — the same stdin the
// secret is piped to. So the prompt ate the secret, the command failed, and the
// script reported "check you're online", which sent a real person off hunting a
// network problem that did not exist. Both required secrets failed this way on
// every single fresh install; `doctor.sh` then said the password was not set.
describe('setup.sh deploys before it sets secrets', () => {
  let dir;
  beforeEach(() => { dir = makeFork(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const ANSWERS = ['my-photo-site', 'photo-subscribers', 'photo-portal', 'photo-cdn', '2', 'hunter2hunter2'];

  it('both secrets land even when they require an existing worker', () => {
    const r = runSetup(dir, ANSWERS, { FAKE_SECRETS_NEED_WORKER: '1' });
    const names = r.calls.filter((c) => c.startsWith('SECRET '))
      .map((c) => c.slice(7).split('=')[0]).sort();
    expect(names).toEqual(['AUTH_PASSWORD_HASH', 'SESSION_SECRET']);
  });

  it('the deploy really does come first in the call order', () => {
    const r = runSetup(dir, ANSWERS);
    const deployedAt = r.calls.findIndex((c) => c === 'DEPLOYED');
    const firstSecretAt = r.calls.findIndex((c) => c.startsWith('SECRET '));
    expect(deployedAt).toBeGreaterThanOrEqual(0);
    expect(firstSecretAt).toBeGreaterThan(deployedAt);
  });

  it('prints the live address, copyable, on its own line', () => {
    // "When we give the your site is live line are we able to print the url for
    // copy at this moment?" — asked during the cold run, because the address
    // scrolls past inside wrangler's output and is genuinely hard to find.
    //
    // Assert on the CLOSING BLOCK, not on the bare URL. wrangler's own output
    // contains the address too, so `toContain(url)` passes even when our
    // capture failed completely — which is exactly what it did on the real run
    // while this suite stayed green. "live at:" only ever renders when setup.sh
    // genuinely read the address back.
    const r = runSetup(dir, ANSWERS);
    expect(r.stdout).toMatch(/Your site is live at:/);
    const onItsOwn = r.stdout.split('\n')
      .some((l) => l.replace(/\[[0-9;]*m/g, '').trim() === 'https://my-photo-site.teststudio.workers.dev');
    expect(onItsOwn, 'the address should sit alone on a line, not inside a sentence').toBe(true);
    // "Open the address above" is only honest here, where one really is above.
    // The fallback case is guarded by the next test.
  });

  it('says where to find the address even when it could not read one', () => {
    // Belt and braces: the log is wrangler's to write and we do not control it
    // forever. If the capture ever comes back empty again, the closing block
    // has to send someone somewhere real instead of dangling.
    const r = runSetup(dir, ANSWERS, { FAKE_DEPLOY_SILENT: '1' });
    expect(r.stdout).not.toMatch(/the address above/i);
    expect(r.stdout).toMatch(/Workers & Pages/);
    expect(r.stdout).toMatch(/Visit/);
  });

  it('blames the deploy, not the network, when the deploy fails', () => {
    const r = runSetup(dir, ANSWERS, { FAKE_DEPLOY_FAILS: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toMatch(/check you're online/i);
    // and it must not go on to set secrets that cannot possibly stick
    expect(r.calls.filter((c) => c.startsWith('SECRET '))).toHaveLength(0);
  });

  it('quotes wrangler instead of guessing when a secret will not save', () => {
    // The old message was a guess, and it was wrong every time it fired. Only
    // wrangler knows why wrangler failed, so the fix is to stop inventing a
    // reason and show the one it gave.
    const r = runSetup(dir, ANSWERS, { FAKE_SECRETS_FAIL: '1' });
    expect(r.stdout).not.toMatch(/check you're online/i);
    expect(r.stdout).toContain("doesn't seem to be a Worker");
  });

  it('skips the deploy when the repo is wired to Cloudflare', () => {
    // A hand-deploy on a connected repo is undone by the next automatic build.
    cpSync(join(dir, 'site.config.example.js'), join(dir, 'site.config.js'));
    writeFileSync(join(dir, 'site.config.js'),
      `${readFileSync(join(dir, 'site.config.js'), 'utf8').replace(/^export default Object\.freeze\(\{/m,
        'export default Object.freeze({\n  repoConnected: true,')}`);
    const r = runSetup(dir, ANSWERS);
    expect(r.stdout).toMatch(/deploys itself/i);
    expect(r.calls.filter((c) => c === 'DEPLOYED')).toHaveLength(0);
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
