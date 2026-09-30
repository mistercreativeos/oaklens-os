// One-click deploy: the two things that made it impossible, and their gates.
//
// A "Deploy to Cloudflare" button can provision KV/D1/R2 from wrangler.jsonc
// and prompt the deployer for secrets. It cannot ask a photographer to produce
// a bcrypt hash, and it should not ask them to invent 32 bytes of hex. Those
// were the two hard blockers:
//
//   AUTH_PASSWORD_HASH -> also accept AUTH_PASSWORD (the password itself)
//   SESSION_SECRET     -> generate one and keep it in KV when unset
//
// Both touch authentication, so both are pinned here — including the ways they
// must NOT weaken the existing gates. In particular the console/shell scope
// separation has to survive a generated secret exactly as it does a configured
// one, or the one-click path would quietly ship a weaker install than the CLI.

import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import {
  createToken, verifyToken, createShellToken, verifyShellRequest,
  resolveSessionSecret, _resetSessionSecretCache, shellCookie,
} from '../src/shared/auth.js';
import { handleAuth, _checkPassword, _hasConfiguredPassword } from '../src/api/console-auth.js';

/** Minimal in-memory KV with the surface these paths use. */
function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
  };
}

const authRequest = (password, ip = '1.2.3.4') => new Request('https://example.com/api/auth', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
  body: JSON.stringify({ password }),
});

beforeEach(() => { _resetSessionSecretCache(); });

// ---------------------------------------------------------------------------
// The password
// ---------------------------------------------------------------------------

describe('console password — hash or plaintext', () => {
  it('accepts a bcrypt hash (the CLI setup path, unchanged)', async () => {
    const env = { AUTH_PASSWORD_HASH: await bcrypt.hash('correct horse', 10) };
    expect(await _checkPassword(env, 'correct horse')).toBe(true);
    expect(await _checkPassword(env, 'wrong horse')).toBe(false);
  });

  it('accepts a plaintext password (the one-click path)', async () => {
    const env = { AUTH_PASSWORD: 'correct horse' };
    expect(await _checkPassword(env, 'correct horse')).toBe(true);
    expect(await _checkPassword(env, 'correct hors')).toBe(false);
    expect(await _checkPassword(env, 'correct horse ')).toBe(false);
    expect(await _checkPassword(env, '')).toBe(false);
  });

  it('the hash wins when both are set', async () => {
    // Otherwise a stale AUTH_PASSWORD left over from a one-click install would
    // keep working after the owner moved to a hash — two live passwords, one
    // of which they think they retired.
    const env = {
      AUTH_PASSWORD_HASH: await bcrypt.hash('the real one', 10),
      AUTH_PASSWORD: 'the old one',
    };
    expect(await _checkPassword(env, 'the real one')).toBe(true);
    expect(await _checkPassword(env, 'the old one')).toBe(false);
  });

  it('refuses everything when neither is set', async () => {
    expect(_hasConfiguredPassword({})).toBe(false);
    expect(await _checkPassword({}, '')).toBe(false);
    expect(await _checkPassword({}, 'anything')).toBe(false);
    // Belt and braces: an unconfigured instance must not be open, it must be shut.
    const res = await handleAuth(authRequest('anything'), { SUBSCRIBERS: fakeKV() });
    expect(res.status).toBe(401);
  });

  it('a real login with a plaintext password mints both credentials', async () => {
    const env = { AUTH_PASSWORD: 'studio-lights-2026', SUBSCRIBERS: fakeKV() };
    const res = await handleAuth(authRequest('studio-lights-2026'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeTruthy();
    expect(res.headers.get('Set-Cookie')).toMatch(/console_shell=.+HttpOnly.+Secure.+SameSite=Strict/);
  });

  it('a wrong plaintext password is still a 401', async () => {
    const env = { AUTH_PASSWORD: 'studio-lights-2026', SUBSCRIBERS: fakeKV() };
    const res = await handleAuth(authRequest('studio-lights-2025'), env);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// The signing key
// ---------------------------------------------------------------------------

describe('session secret resolution', () => {
  it('a configured SESSION_SECRET always wins', async () => {
    const kv = fakeKV({ __oaklens_session_secret: 'from-kv' });
    expect(await resolveSessionSecret({ SESSION_SECRET: 'configured', SUBSCRIBERS: kv }))
      .toBe('configured');
  });

  it('generates a 32-byte key when none is configured, and stores it', async () => {
    const kv = fakeKV();
    const secret = await resolveSessionSecret({ SUBSCRIBERS: kv });
    expect(secret).toMatch(/^[0-9a-f]{64}$/); // 32 bytes, hex
    expect(kv.store.get('__oaklens_session_secret')).toBe(secret);
  });

  it('reuses the stored key instead of generating a new one each boot', async () => {
    const kv = fakeKV();
    const first = await resolveSessionSecret({ SUBSCRIBERS: kv });
    _resetSessionSecretCache(); // simulate a fresh isolate
    const second = await resolveSessionSecret({ SUBSCRIBERS: kv });
    expect(second).toBe(first);
    // A new key every isolate would log everyone out constantly, which reads
    // as "this thing is broken" rather than as a security setting.
  });

  it('generated keys are not predictable', async () => {
    const a = await resolveSessionSecret({ SUBSCRIBERS: fakeKV() });
    _resetSessionSecretCache();
    const b = await resolveSessionSecret({ SUBSCRIBERS: fakeKV() });
    expect(a).not.toBe(b);
  });

  it('returns null — never a made-up key — with no secret and no KV', async () => {
    // Inventing a per-isolate key here would "work" and then log people out at
    // random as isolates recycle. Refusing is the honest failure.
    expect(await resolveSessionSecret({})).toBeNull();
    expect(await resolveSessionSecret({ SUBSCRIBERS: null })).toBeNull();
  });

  it('token creation refuses rather than signing with nothing', async () => {
    expect(await createToken({})).toBeNull();
    expect(await createShellToken({})).toBeNull();
  });
});

describe('a generated key is a real key — the gates still hold', () => {
  it('signs and verifies a console token round-trip', async () => {
    const env = { SUBSCRIBERS: fakeKV() };
    const token = await createToken(env);
    expect(token).toBeTruthy();
    const req = new Request('https://example.com/api/x', { headers: { Authorization: `Bearer ${token}` } });
    expect(await verifyToken(req, env)).toBe(true);
  });

  it('a token from one instance does not verify against another', async () => {
    const envA = { SUBSCRIBERS: fakeKV() };
    const token = await createToken(envA);
    _resetSessionSecretCache();
    const envB = { SUBSCRIBERS: fakeKV() }; // different instance, different key
    const req = new Request('https://example.com/api/x', { headers: { Authorization: `Bearer ${token}` } });
    expect(await verifyToken(req, envB)).toBe(false);
  });

  it('the shell cookie still cannot authorize an API mutation', async () => {
    // The scope separation is the reason there is no CSRF surface on the admin
    // API. It must survive a generated key exactly as it survives a set one.
    const env = { SUBSCRIBERS: fakeKV() };
    const shell = await createShellToken(env);
    const req = new Request('https://example.com/api/x', { headers: { Authorization: `Bearer ${shell}` } });
    expect(await verifyToken(req, env)).toBe(false);
  });

  it('a bearer token still cannot unlock the console document', async () => {
    const env = { SUBSCRIBERS: fakeKV() };
    const bearer = await createToken(env);
    const req = new Request('https://example.com/dev/field-console', {
      headers: { Cookie: shellCookie(bearer) },
    });
    expect(await verifyShellRequest(req, env)).toBe(false);
  });

  it('the shell cookie verifies for its own purpose', async () => {
    const env = { SUBSCRIBERS: fakeKV() };
    const shell = await createShellToken(env);
    const req = new Request('https://example.com/dev/field-console', {
      headers: { Cookie: shellCookie(shell) },
    });
    expect(await verifyShellRequest(req, env)).toBe(true);
  });

  it('an unsigned or tampered token is rejected', async () => {
    const env = { SUBSCRIBERS: fakeKV() };
    const token = await createToken(env);
    // Not just `+ 'xy'`: a token that already ends in "xy" would be rebuilt
    // identical and the assertion would be testing a VALID token.
    const tampered = `${token.slice(0, -2)}${token.endsWith('xy') ? 'zz' : 'xy'}`;
    const req = new Request('https://example.com/api/x', { headers: { Authorization: `Bearer ${tampered}` } });
    expect(await verifyToken(req, env)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The deploy button's contract with wrangler.jsonc
// ---------------------------------------------------------------------------

describe('wrangler.example.jsonc supports a one-click deploy', () => {
  const cfg = () => {
    const raw = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dirname, '..', 'wrangler.example.jsonc'), 'utf8');
    return raw;
  };

  it('documents both password forms, and points the button at .dev.vars.example', () => {
    // The `secrets` line ships COMMENTED on purpose: a name listed there is
    // required to deploy, which would block the CLI install that sets
    // AUTH_PASSWORD_HASH instead. The button is asked for the password by
    // `.dev.vars.example` (below), so nobody has to flip anything.
    const raw = cfg();
    expect(raw).toContain('AUTH_PASSWORD_HASH');
    expect(raw).toContain('AUTH_PASSWORD');
    expect(raw).toContain('.dev.vars.example');
    expect(raw).toMatch(/\/\/\s*"secrets":\s*\["AUTH_PASSWORD"\]/);
  });

  it('does not ship an active required-secrets list', () => {
    // If this ever goes live in the example config, every CLI fork that
    // followed setup.sh stops being able to deploy.
    const active = cfg().split('\n').filter((l) => !l.trim().startsWith('//'));
    expect(active.join('\n')).not.toMatch(/"secrets"\s*:/);
  });

  it('still declares every binding the engine needs', () => {
    const raw = cfg();
    for (const binding of ['SUBSCRIBERS', 'DB', 'CDN', 'ASSETS']) {
      expect(raw, `${binding} binding missing`).toContain(`"${binding}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// The deploy button's password prompt
// ---------------------------------------------------------------------------

describe('.dev.vars.example makes the button ask for a password', () => {
  // Found on a real button run, 2026-09-29: with no secret declared anywhere
  // the button deployed cleanly and the console then refused every password,
  // with nothing to say why. The button reads `.dev.vars.example` for the
  // secrets to ask about; this file is that list.
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(import.meta.dirname, '..');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const entries = () => read('.dev.vars.example').split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('='));

  it('lists AUTH_PASSWORD', () => {
    expect(entries().map(([k]) => k)).toContain('AUTH_PASSWORD');
  });

  it('ships every value empty', () => {
    // A value here is a default the dialog pre-fills: every install that
    // clicked through would share one known password.
    for (const [k, ...v] of entries()) expect(v.join('='), `${k} has a value`).toBe('');
  });

  it('never lists AUTH_PASSWORD_HASH or SESSION_SECRET', () => {
    // Nobody can type a bcrypt hash into a dialog, and SESSION_SECRET
    // generates itself. Listing either would ask a question with no good answer.
    const keys = entries().map(([k]) => k);
    expect(keys).not.toContain('AUTH_PASSWORD_HASH');
    expect(keys).not.toContain('SESSION_SECRET');
  });

  it('is never served as a page', () => {
    // assets.directory is the repo root, so anything not in .assetsignore is
    // public. The example holds no values, but .dev.vars itself does.
    expect(read('.assetsignore').split('\n')).toContain('.dev.vars*');
  });
});
