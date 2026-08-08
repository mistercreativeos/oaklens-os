// POST /api/subscribe (worker.js) — the public endpoint the GTD/"get the drop"
// forms post to (shared submitGTD in js/site-common.js). KV-backed via
// env.SUBSCRIBERS. Pins the rate limit, the honeypot short-circuit, email
// normalization + validation, the source clamp, and the KV-failure branches
// (rate-limit KV down → allow through; store KV down → 500).
import { describe, it, expect } from 'vitest';
import worker from '../worker.js';

// KV stub with optional get/put failure injection and a seed for rate-limit rows.
function makeKV({ getThrows = false, putThrows = false, seed = {} } = {}) {
  const store = new Map(Object.entries(seed));
  const puts = [];
  return {
    store,
    puts,
    async get(k) { if (getThrows) throw new Error('kv down'); return store.has(k) ? store.get(k) : null; },
    async put(k, v, opts) { puts.push({ k, v, opts }); if (putThrows) throw new Error('kv down'); store.set(k, v); },
  };
}

const post = (body, kv, ip = '1.2.3.4') =>
  worker.fetch(
    new Request('https://example.com/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { SUBSCRIBERS: kv }
  );

describe('POST /api/subscribe — happy path', () => {
  it('stores a valid email with its source and 200s', async () => {
    const kv = makeKV();
    const res = await post({ email: 'reader@example.com', source: 'wall' }, kv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const stored = JSON.parse(kv.store.get('reader@example.com'));
    expect(stored.source).toBe('wall');
    expect(stored.subscribed_at).toBeTruthy();
  });

  it('normalizes the email (trim + lowercase) into the KV key', async () => {
    const kv = makeKV();
    await post({ email: '  Reader@Example.COM ' }, kv);
    expect(kv.store.has('reader@example.com')).toBe(true);
  });

  it('clamps source to 32 chars and defaults a non-string to "unknown"', async () => {
    const kv = makeKV();
    await post({ email: 'a@b.co', source: 'x'.repeat(50) }, kv);
    expect(JSON.parse(kv.store.get('a@b.co')).source).toHaveLength(32);

    const kv2 = makeKV();
    await post({ email: 'c@d.co', source: { not: 'a string' } }, kv2);
    expect(JSON.parse(kv2.store.get('c@d.co')).source).toBe('unknown');
  });
});

describe('POST /api/subscribe — honeypot + validation', () => {
  it('honeypot: a filled website field silently 200s and stores nothing', async () => {
    const kv = makeKV();
    const res = await post({ email: 'bot@spam.com', website: 'http://spam' }, kv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(kv.store.has('bot@spam.com')).toBe(false);
  });

  it('400s invalid JSON', async () => {
    const res = await post('not json', makeKV());
    expect(res.status).toBe(400);
  });

  it('400s a missing or malformed email', async () => {
    for (const body of [{}, { email: '' }, { email: 'nope' }, { email: 'a@b' }, { email: 42 }]) {
      const res = await post(body, makeKV());
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('POST /api/subscribe — rate limit', () => {
  it('429s the 4th attempt from one IP within the window', async () => {
    const kv = makeKV({ seed: { 'ratelimit:9.9.9.9': '3' } });
    const res = await post({ email: 'a@b.co' }, kv, '9.9.9.9');
    expect(res.status).toBe(429);
    expect(kv.store.has('a@b.co')).toBe(false); // not stored when limited
  });

  it('increments the per-IP counter with a 60s TTL', async () => {
    const kv = makeKV();
    await post({ email: 'a@b.co' }, kv, '5.5.5.5');
    const rl = kv.puts.find((p) => p.k === 'ratelimit:5.5.5.5');
    expect(rl.v).toBe('1');
    expect(rl.opts).toEqual({ expirationTtl: 60 });
  });
});

// This is the ONLY unauthenticated endpoint that writes to KV, and it shares
// that namespace with the token-signing key a one-click install generates
// (src/shared/auth.js). KV's free tier allows ~1k writes/day, so a request
// that costs a write before it has been validated lets anonymous traffic burn
// the write budget the ADMIN surface depends on. Read to decide, write only
// once the request has earned it.
describe('POST /api/subscribe — an invalid request costs no KV write', () => {
  it.each([
    ['unparseable JSON', 'not json at all'],
    ['a missing email', {}],
    ['a malformed email', { email: 'not-an-email' }],
    ['a non-string email', { email: 42 }],
  ])('writes nothing for %s', async (_label, body) => {
    const kv = makeKV();
    const res = await post(body, kv, '7.7.7.7');
    expect(res.status).toBe(400);
    expect(kv.puts).toEqual([]);
  });

  it('writes nothing when the honeypot is filled (a bot never costs quota)', async () => {
    const kv = makeKV();
    const res = await post({ email: 'a@b.co', website: 'spam' }, kv, '7.7.7.7');
    expect(res.status).toBe(200);
    expect(kv.puts).toEqual([]);
  });

  it('still writes both rows for a genuine subscribe', async () => {
    const kv = makeKV();
    await post({ email: 'real@example.com' }, kv, '7.7.7.7');
    expect(kv.puts.map((p) => p.k)).toEqual(['ratelimit:7.7.7.7', 'real@example.com']);
  });

  it('rate-limits before parsing, so a flood still 429s', async () => {
    const kv = makeKV({ seed: { 'ratelimit:8.8.8.8': '3' } });
    const res = await post('garbage', kv, '8.8.8.8');
    expect(res.status).toBe(429);
    expect(kv.puts).toEqual([]);
  });
});

// The structural one. This endpoint takes an attacker-chosen KV key from an
// unauthenticated request, and the namespace it writes into also holds the
// token-signing key (`__oaklens_session_secret`) and the rate-limit counters.
// Nothing but EMAIL_RE stands between the two, so the property is pinned
// explicitly rather than left as a side effect of the validator's shape: a
// public write can never produce a key that is not an email address.
describe('POST /api/subscribe cannot mint an internal KV key', () => {
  it.each([
    ['the signing secret', '__oaklens_session_secret'],
    ['a rate-limit counter', 'ratelimit:1.2.3.4'],
    ['a failed-auth counter', 'authfail:1.2.3.4'],
  ])('refuses to overwrite %s', async (_label, key) => {
    const kv = makeKV({ seed: { [key]: 'ORIGINAL' } });
    const res = await post({ email: key }, kv, '4.4.4.4');
    expect(res.status).toBe(400);
    expect(kv.store.get(key)).toBe('ORIGINAL');
  });

  it('every key a subscribe CAN write contains an @', async () => {
    const kv = makeKV();
    for (const email of ['a@b.co', '__hidden@example.com', 'x+tag@sub.domain.org']) {
      await post({ email }, kv, '4.4.4.4');
    }
    const written = kv.puts.map((p) => p.k).filter((k) => !k.startsWith('ratelimit:'));
    expect(written.length).toBeGreaterThan(0);
    for (const k of written) expect(k, `${k} should be an email`).toContain('@');
  });
});

describe('POST /api/subscribe — KV failure branches', () => {
  it('allows the subscribe through when the rate-limit KV read fails', async () => {
    // get throws (rate-limit skipped) but put still works (email stored).
    const store = new Map();
    const kv = {
      store,
      async get() { throw new Error('kv down'); },
      async put(k, v) { store.set(k, v); },
    };
    const res = await post({ email: 'a@b.co' }, kv);
    expect(res.status).toBe(200);
    expect(store.has('a@b.co')).toBe(true);
  });

  it('500s when the subscriber store write fails', async () => {
    const kv = makeKV({ putThrows: true });
    const res = await post({ email: 'a@b.co' }, kv);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('server error');
  });
});
