// The KV-generated session secret's split-brain heal (src/shared/auth.js).
//
// On an install with no SESSION_SECRET, the secret is generated into KV. Two
// isolates booting together can both generate; one write wins. The LOSING
// isolate memoizes its own losing key — and a memo never re-read KV, so the
// loser kept signing and rejecting with the wrong secret until the isolate
// recycled (hours), not the "one login in the first minute" the design
// promised. verifyToken/verifyShellRequest now re-read KV once after a failed
// verification (cooldown-limited) and adopt the winning secret.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  verifyToken, createToken, createRawToken, verifyRawToken,
  resolveSessionSecret, _resetSessionSecretCache,
} from '../src/shared/auth.js';

function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  const gets = [];
  return {
    store,
    gets,
    async get(k) { gets.push(k); return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
  };
}

const SECRET_KEY = '__oaklens_session_secret';
const WINNER = 'w'.repeat(64);

const bearerReq = (token) => new Request('https://example.com/api/bench', {
  headers: { Authorization: `Bearer ${token}` },
});

// Put an isolate into the losing state: it generated + memoized its own
// secret, but KV now holds another isolate's winning one.
async function loseTheRace(kv) {
  _resetSessionSecretCache();
  const losing = await resolveSessionSecret({ SUBSCRIBERS: kv }); // generates + memoizes
  kv.store.set(SECRET_KEY, WINNER); // the other isolate's write won
  return losing;
}

describe('KV session secret — losing-isolate heal', () => {
  beforeEach(() => _resetSessionSecretCache());

  it('a token signed with the winning secret verifies after one KV re-read', async () => {
    const kv = fakeKV();
    const losing = await loseTheRace(kv);
    expect(losing).not.toBe(WINNER);

    const winnerToken = await createRawToken(WINNER, { scope: 'console' });
    expect(await verifyToken(bearerReq(winnerToken), { SUBSCRIBERS: kv })).toBe(true);
  });

  it('after healing, newly minted tokens use the winning secret', async () => {
    const kv = fakeKV();
    await loseTheRace(kv);
    const winnerToken = await createRawToken(WINNER, { scope: 'console' });
    await verifyToken(bearerReq(winnerToken), { SUBSCRIBERS: kv }); // heals the memo

    const minted = await createToken({ SUBSCRIBERS: kv });
    expect(await verifyRawToken(minted, WINNER)).not.toBeNull();
  });

  it('garbage tokens cannot re-read KV more than once per cooldown', async () => {
    const kv = fakeKV();
    await loseTheRace(kv);
    const before = kv.gets.filter((k) => k === SECRET_KEY).length;

    await verifyToken(bearerReq('garbage.garbage.garbage'), { SUBSCRIBERS: kv });
    await verifyToken(bearerReq('garbage.garbage.garbage'), { SUBSCRIBERS: kv });
    await verifyToken(bearerReq('garbage.garbage.garbage'), { SUBSCRIBERS: kv });

    const after = kv.gets.filter((k) => k === SECRET_KEY).length;
    expect(after - before).toBe(1); // one refresh, then the cooldown holds
  });

  it('a configured SESSION_SECRET never touches KV on a failed verify', async () => {
    const kv = fakeKV();
    await verifyToken(
      bearerReq('garbage.garbage.garbage'),
      { SESSION_SECRET: 'configured-secret', SUBSCRIBERS: kv }
    );
    expect(kv.gets).toEqual([]);
  });

  it('valid tokens under a healthy memo verify with zero extra KV reads', async () => {
    const kv = fakeKV();
    _resetSessionSecretCache();
    await resolveSessionSecret({ SUBSCRIBERS: kv }); // generate + memoize (1 get)
    const baseline = kv.gets.length;

    const token = await createToken({ SUBSCRIBERS: kv });
    expect(await verifyToken(bearerReq(token), { SUBSCRIBERS: kv })).toBe(true);
    expect(kv.gets.length).toBe(baseline); // memo served everything
  });
});

// KV I/O on the hot path of every authenticated request. Both calls in
// resolveSessionSecret were unguarded, so an outage — or a free-tier write
// budget spent by anonymous traffic on /api/subscribe, which shares this
// namespace — propagated out through verifyToken and turned the whole admin
// API into 500s. It degrades to a clean 401 now: honest (we genuinely cannot
// verify anything) and, unlike a thrown error, something the console handles.
describe('KV session secret — a KV outage degrades, it does not throw', () => {
  beforeEach(() => _resetSessionSecretCache());

  it('returns null instead of throwing when the KV read fails', async () => {
    const kv = { async get() { throw new Error('kv down'); }, async put() {} };
    await expect(resolveSessionSecret({ SUBSCRIBERS: kv })).resolves.toBeNull();
  });

  it('returns null instead of throwing when the generating write fails', async () => {
    // The free-tier write-budget case: reads still work, writes are refused.
    const kv = { async get() { return null; }, async put() { throw new Error('over quota'); } };
    await expect(resolveSessionSecret({ SUBSCRIBERS: kv })).resolves.toBeNull();
  });

  it('does not memoize a secret it failed to persist', async () => {
    // Keeping one would mint tokens no other isolate can verify — random
    // logouts that outlive the outage by the life of the isolate.
    let failWrites = true;
    const store = new Map();
    const kv = {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { if (failWrites) throw new Error('over quota'); store.set(k, v); },
    };
    expect(await resolveSessionSecret({ SUBSCRIBERS: kv })).toBeNull();
    failWrites = false;
    const healed = await resolveSessionSecret({ SUBSCRIBERS: kv });
    expect(healed).toMatch(/^[0-9a-f]{64}$/);
    expect(store.get(SECRET_KEY)).toBe(healed);
  });

  it('answers 401, not 500, while KV is down', async () => {
    const kv = { async get() { throw new Error('kv down'); }, async put() {} };
    await expect(verifyToken(bearerReq('anything'), { SUBSCRIBERS: kv })).resolves.toBe(false);
  });

  it('a configured SESSION_SECRET is unaffected by KV being down', async () => {
    const kv = { async get() { throw new Error('kv down'); }, async put() {} };
    const env = { SESSION_SECRET: 's'.repeat(64), SUBSCRIBERS: kv };
    const token = await createToken(env);
    expect(await verifyToken(bearerReq(token), env)).toBe(true);
  });
});
