import { describe, it, expect } from 'vitest';
import {
  _b64url,
  _b64urlDecode,
  createRawToken,
  verifyRawToken,
  createToken,
  verifyToken,
  sha256Hex,
  randomLinkCode,
} from '../src/shared/auth.js';

const SECRET = 'test-secret-please-ignore';
const env = { SESSION_SECRET: SECRET };

// Minimal stand-in for a Workers Request — verifyToken only reads the
// Authorization header.
const reqWith = (authHeader) => ({
  headers: { get: (k) => (k.toLowerCase() === 'authorization' ? authHeader : null) },
});

describe('base64url codec', () => {
  it('round-trips ASCII', () => {
    const s = 'hello.world-123_ABC';
    expect(new TextDecoder().decode(_b64urlDecode(_b64url(s)))).toBe(s);
  });

  it('round-trips multi-byte UTF-8', () => {
    const s = 'café — naïve — 日本語 — 🌒';
    expect(new TextDecoder().decode(_b64urlDecode(_b64url(s)))).toBe(s);
  });

  it('emits URL-safe output (no +, /, or = padding)', () => {
    const out = _b64url('any/string+with=stuff????');
    expect(out).not.toMatch(/[+/=]/);
  });
});

describe('createRawToken / verifyRawToken', () => {
  it('verifies a freshly minted token and returns its payload', async () => {
    const tok = await createRawToken(SECRET, { project: 'demo', role: 'client' }, 3600);
    const payload = await verifyRawToken(tok, SECRET);
    expect(payload).toMatchObject({ project: 'demo', role: 'client' });
    expect(payload.iat).toBeTypeOf('number');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('rejects a token signed with a different secret', async () => {
    const tok = await createRawToken(SECRET, {}, 3600);
    expect(await verifyRawToken(tok, 'wrong-secret')).toBeNull();
  });

  it('rejects a tampered payload (signature mismatch)', async () => {
    const tok = await createRawToken(SECRET, { role: 'guest' }, 3600);
    const [h, , s] = tok.split('.');
    const forged = `${h}.${_b64url(JSON.stringify({ role: 'admin' }))}.${s}`;
    expect(await verifyRawToken(forged, SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const tok = await createRawToken(SECRET, {}, -10); // already expired
    expect(await verifyRawToken(tok, SECRET)).toBeNull();
  });

  it('rejects structurally malformed tokens', async () => {
    expect(await verifyRawToken('', SECRET)).toBeNull();
    expect(await verifyRawToken('only.two', SECRET)).toBeNull();
    expect(await verifyRawToken('a.b.c.d', SECRET)).toBeNull();
    expect(await verifyRawToken('garbage', SECRET)).toBeNull();
  });
});

describe('console token scope boundary (privilege-escalation guard)', () => {
  it('createToken stamps scope:"console"', async () => {
    const tok = await createToken(env);
    expect(await verifyRawToken(tok, SECRET)).toMatchObject({ scope: 'console' });
  });

  it('verifyToken accepts a real console token', async () => {
    const tok = await createToken(env);
    expect(await verifyToken(reqWith(`Bearer ${tok}`), env)).toBe(true);
  });

  it('verifyToken REJECTS a validly-signed portal token (no console scope)', async () => {
    // This is the exact escalation that was open: a portal guest/client token is
    // signed with the same SESSION_SECRET but carries no scope. It must NOT
    // satisfy the console API auth.
    for (const role of ['guest', 'client', 'admin']) {
      const portalTok = await createRawToken(SECRET, { project: 'p', role }, 3600);
      expect(await verifyToken(reqWith(`Bearer ${portalTok}`), env)).toBe(false);
    }
  });

  it('verifyToken rejects a token with a wrong/foreign scope', async () => {
    const otherScope = await createRawToken(SECRET, { scope: 'portal' }, 3600);
    expect(await verifyToken(reqWith(`Bearer ${otherScope}`), env)).toBe(false);
  });

  it('verifyToken rejects missing / malformed Authorization headers', async () => {
    const tok = await createToken(env);
    expect(await verifyToken(reqWith(null), env)).toBe(false);
    expect(await verifyToken(reqWith(''), env)).toBe(false);
    expect(await verifyToken(reqWith(tok), env)).toBe(false);          // no "Bearer " prefix
    expect(await verifyToken(reqWith(`Basic ${tok}`), env)).toBe(false);
  });

  it('verifyToken rejects a console-scoped token signed with the wrong secret', async () => {
    const tok = await createToken({ SESSION_SECRET: 'attacker-secret' });
    expect(await verifyToken(reqWith(`Bearer ${tok}`), env)).toBe(false);
  });
});

describe('portal link helpers (hashed / revocable)', () => {
  it('sha256Hex matches a known vector', async () => {
    // printf 'abc' | sha256sum
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('sha256Hex is deterministic and 64 lowercase hex chars', async () => {
    const a = await sha256Hex('oaklens');
    expect(await sha256Hex('oaklens')).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('randomLinkCode is URL-safe, long, and unique', () => {
    const a = randomLinkCode();
    const b = randomLinkCode();
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/[+/=]/);
    expect(a.length).toBeGreaterThanOrEqual(20);
  });

  it('a link code cannot be reversed from its stored hash', async () => {
    // The DB stores only sha256Hex(code); knowing the hash must not reveal the code.
    const code = randomLinkCode();
    const hash = await sha256Hex(code);
    expect(hash).not.toContain(code);
    expect(hash).toHaveLength(64);
  });
});
