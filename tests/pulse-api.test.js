// Pulse — the storage contract and the endpoint.
//
// The load-bearing claims, in order of how much a break would cost:
//
//   1. THE PUBLIC READ NEVER FAILS. Whatever is wrong underneath — no D1, an
//      unmigrated database, a query that throws — GET /api/pulse answers 200
//      { pulse: null } and the homepage renders exactly as it does with nothing
//      posted. A pulse is a garnish; it must never be why a front page breaks.
//   2. WRITES ARE GATED. Posting or retiring a pulse is a privileged mutation
//      and takes a scoped console bearer. The console-shell cookie must not
//      reach it (no CSRF surface).
//   3. EXPIRY IS A QUERY, NOT A CRON. The current pulse is the newest row still
//      ahead of now, so an expired pulse disappears with nothing running.
//   4. THE LOG SURVIVES RETIREMENT. Taking a pulse down moves expires_at; the
//      row stays, because the log is the point.
import { describe, it, expect } from 'vitest';
import worker from '../worker.js';
import { createToken, createShellToken, SHELL_COOKIE } from '../src/shared/auth.js';
import {
  normalizePulseInput, normalizeLocalTime, normalizeState, pulseToPublic,
  clampTtlHours, pulseTierLen, PULSE_STATES, DEFAULT_STATE, LIMITS,
} from '../src/shared/pulse.js';

const SESSION_SECRET = 'test-secret-please-ignore';
const HOUR = 3600 * 1000;

// ---- a tiny in-memory D1 that understands only the statements pulse.js issues ----
//
// It models the REAL semantics rather than the ones that make a test pass. The
// UPDATE in particular expires EVERY live row, because that is what
// `WHERE expires_at > ?1` does — the earlier fake expired only the newest, which
// mirrored the bug in the handler and would have let a test for the fix pass
// against a fake that was still broken.
function fakeDB(rows = []) {
  const db = {
    rows,
    prepare(sql) {
      let args = [];
      const isUpdate = /^\s*UPDATE/i.test(sql);
      // The fake distinguishes the two UPDATE shapes rather than treating every
      // UPDATE as "expire everything". That distinction IS the bug: the old
      // statement was `WHERE id = (SELECT … LIMIT 1)` (newest only), the fixed
      // one is `WHERE expires_at > ?1` (all live rows). A fake that collapsed
      // them would make the regression test pass against the broken handler,
      // which is worse than not having it.
      const newestOnly = /WHERE\s+id\s*=/i.test(sql);
      const expireLive = (now) => {
        let live = db.rows.filter((r) => r.expires_at > now);
        if (newestOnly) live = live.sort((a, b) => b.posted_at - a.posted_at).slice(0, 1);
        for (const r of live) r.expires_at = now;
        return live.length;
      };
      const insert = () => {
        const [id, text, glyphs, state, foot_left, foot_right, local_time, posted_at, expires_at, ambient] = args;
        db.rows.push({ id, text, glyphs, state, foot_left, foot_right, local_time, posted_at, expires_at, ambient });
      };
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          if (/^\s*SELECT/i.test(sql)) {
            const now = args[0];
            return db.rows
              .filter((r) => r.expires_at > now)
              .sort((a, b) => b.posted_at - a.posted_at)[0] || null;
          }
          return null;
        },
        async all() {
          const limit = args[0] || 50;
          return { results: db.rows.slice().sort((a, b) => b.posted_at - a.posted_at).slice(0, limit) };
        },
        async run() {
          if (isUpdate) return { success: true, meta: { changes: expireLive(args[0]) } };
          insert();
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    // D1 runs a batch as one transaction. Order matters here: POST relies on the
    // expiry landing before its own insert, or it would expire the row it just
    // wrote and nothing would ever be live.
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return db;
}

function tablelessDB() {
  const raise = () => { throw new Error('D1_ERROR: no such table: pulses: SQLITE_ERROR'); };
  return {
    prepare() { const s = { bind: () => s, async first() { raise(); }, async all() { raise(); }, async run() { raise(); } }; return s; },
    // POST goes through batch() now. A real unmigrated D1 throws the same
    // missing-table error there, and without this the fake threw a TypeError
    // instead — which reads as a 500 fault rather than the deliberate 501
    // "feature off" the console knows how to explain.
    async batch() { raise(); },
  };
}

function row(over = {}) {
  const posted = Date.now();
  return {
    id: 'm1', text: 'Eight bar loop. Send help.', glyphs: '🎧', state: 'flow',
    foot_left: '', foot_right: '', local_time: '20:14',
    posted_at: posted, expires_at: posted + 18 * HOUR, ambient: null, ...over,
  };
}

async function call(path, { method = 'GET', env, body, auth = true, cookie } = {}) {
  const e = env || { SESSION_SECRET, DB: fakeDB() };
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${await createToken(e)}`;
  if (cookie) headers.Cookie = cookie;
  const res = await worker.fetch(new Request(`https://example.com${path}`, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
  }), e);
  return { res, data: await res.json() };
}

// ============================================================================
describe('GET /api/pulse never fails the homepage', () => {
  it.each([
    ['no D1 binding at all', { SESSION_SECRET }],
    ['an unmigrated D1', { SESSION_SECRET, DB: tablelessDB() }],
    ['a D1 that throws for real', { SESSION_SECRET, DB: { prepare() { const s = { bind: () => s, async first() { throw new Error('D1_ERROR: database is locked'); } }; return s; } } }],
    ['a database with nothing in it', { SESSION_SECRET, DB: fakeDB() }],
  ])('%s → 200 { pulse: null }', async (_label, env) => {
    const { res, data } = await call('/api/pulse', { env, auth: false });
    expect(res.status).toBe(200);
    expect(data.pulse).toBeNull();
  });

  it('is edge-cacheable and CORS-open — it feeds a client-rendered grid', async () => {
    const { res } = await call('/api/pulse', { auth: false });
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=60/);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('returns the live pulse, camelCased, without the ambient stamp', async () => {
    const env = { SESSION_SECRET, DB: fakeDB([row({ ambient: '{"t":14}' })]) };
    const { data } = await call('/api/pulse', { env, auth: false });
    expect(data.pulse.text).toBe('Eight bar loop. Send help.');
    expect(data.pulse.footLeft).toBe('');
    expect(data.pulse.localTime).toBe('20:14');
    // The weather stamp is for the log, not for visitors.
    expect(data.pulse.ambient).toBeUndefined();
  });

  it('an EXPIRED pulse is invisible with no cron having run', async () => {
    const old = Date.now() - 40 * HOUR;
    const env = { SESSION_SECRET, DB: fakeDB([row({ posted_at: old, expires_at: old + 18 * HOUR })]) };
    const { data } = await call('/api/pulse', { env, auth: false });
    expect(data.pulse).toBeNull();
  });

  it('the NEWEST unexpired pulse wins — posting replaces, never stacks', async () => {
    const now = Date.now();
    const env = { SESSION_SECRET, DB: fakeDB([
      row({ id: 'older', text: 'Older.', posted_at: now - HOUR, expires_at: now + HOUR }),
      row({ id: 'newer', text: 'Newer.', posted_at: now, expires_at: now + HOUR }),
    ]) };
    const { data } = await call('/api/pulse', { env, auth: false });
    expect(data.pulse.id).toBe('newer');
  });
});

// ============================================================================
describe('writes are privileged', () => {
  it.each([
    ['POST', '/api/pulse'],
    ['DELETE', '/api/pulse'],
    ['GET', '/api/pulse/log'],
  ])('%s %s without a token is 401', async (method, path) => {
    const { res } = await call(path, { method, auth: false, body: method === 'POST' ? { text: 'x' } : undefined });
    expect(res.status).toBe(401);
  });

  it('the console-SHELL cookie cannot post a pulse (no CSRF surface)', async () => {
    const env = { SESSION_SECRET, DB: fakeDB() };
    const shell = await createShellToken(env);
    const { res } = await call('/api/pulse', {
      method: 'POST', env, auth: false, body: { text: 'Sneaky.' }, cookie: `${SHELL_COOKIE}=${shell}`,
    });
    expect(res.status).toBe(401);
  });

  it('an unmigrated D1 answers the 501 notConfigured shape, not a raw 500', async () => {
    const env = { SESSION_SECRET, DB: tablelessDB() };
    const { res, data } = await call('/api/pulse', { method: 'POST', env, body: { text: 'Hello.' } });
    expect(res.status).toBe(501);
    expect(data.notConfigured).toBe(true);
    expect(data.error).toContain('wrangler d1 migrations apply');
  });
});

// ============================================================================
describe('POST /api/pulse', () => {
  it('stores a pulse and hands back what the homepage will show', async () => {
    const env = { SESSION_SECRET, DB: fakeDB() };
    const { res, data } = await call('/api/pulse', {
      method: 'POST', env,
      body: { text: 'Tracking. Take 14.', glyphs: '🎙️', state: 'flow', localTime: '02:40' },
    });
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.pulse.text).toBe('Tracking. Take 14.');
    expect(data.pulse.localTime).toBe('02:40');
    // …and it is immediately the live pulse on the public read.
    const { data: pub } = await call('/api/pulse', { env, auth: false });
    expect(pub.pulse.id).toBe(data.pulse.id);
  });

  it('rejects a pulse carrying neither a line nor a glyph', async () => {
    const { res, data } = await call('/api/pulse', { method: 'POST', body: { text: '   ' } });
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/line or a glyph/);
  });

  it('accepts a glyph with no words at all', async () => {
    const { res } = await call('/api/pulse', { method: 'POST', body: { glyphs: '🕯️' } });
    expect(res.status).toBe(200);
  });

  it('rejects a body that is not JSON', async () => {
    const env = { SESSION_SECRET, DB: fakeDB() };
    const res = await worker.fetch(new Request('https://example.com/api/pulse', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await createToken(env)}` },
      body: 'not json',
    }), env);
    expect(res.status).toBe(400);
  });
});

// ============================================================================
describe('DELETE /api/pulse retires without erasing', () => {
  it('takes the live pulse down but keeps the row in the log', async () => {
    const env = { SESSION_SECRET, DB: fakeDB([row()]) };
    const { data } = await call('/api/pulse', { method: 'DELETE', env });
    expect(data.retired).toBe(1);

    const { data: pub } = await call('/api/pulse', { env, auth: false });
    expect(pub.pulse).toBeNull();

    const { data: log } = await call('/api/pulse/log', { env });
    expect(log.pulses).toHaveLength(1);
    expect(log.pulses[0].id).toBe('m1');
    expect(log.pulses[0].live).toBe(false);
  });

  it('is a no-op when nothing is live', async () => {
    const { res, data } = await call('/api/pulse', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(data.retired).toBe(0);
  });

  // THE BUG THIS FILE EXISTS TO STOP COMING BACK (reported 2026-08-13).
  //
  // Taking a pulse down used to expire only the NEWEST live row. With an 18h
  // TTL every pulse posted that day was still unexpired, stacked behind the
  // visible one — so the homepage did not return to real work, it showed the
  // previous pulse. Press again, get the one before that.
  it('takes the grid back to real work, not to the previous pulse', async () => {
    const now = Date.now();
    const env = { SESSION_SECRET, DB: fakeDB([
      row({ id: 'oldest', posted_at: now - 3000, expires_at: now + 18 * HOUR }),
      row({ id: 'middle', posted_at: now - 2000, expires_at: now + 18 * HOUR }),
      row({ id: 'newest', posted_at: now - 1000, expires_at: now + 18 * HOUR }),
    ]) };

    const { data } = await call('/api/pulse', { method: 'DELETE', env });
    expect(data.retired, 'all three were live, so all three come down').toBe(3);

    // ONE press. Not three.
    const { data: pub } = await call('/api/pulse', { env, auth: false });
    expect(pub.pulse, 'a stale pulse was promoted instead of the grid healing').toBeNull();

    // …and nothing was erased — every one is still reusable from the console.
    const { data: log } = await call('/api/pulse/log', { env });
    expect(log.pulses.map((p) => p.id)).toEqual(['newest', 'middle', 'oldest']);
    expect(log.pulses.every((p) => p.live === false)).toBe(true);
  });
});

// ============================================================================
describe('at most one pulse is live at a time', () => {
  it('posting expires the pulse before it, in the same batch', async () => {
    const env = { SESSION_SECRET, DB: fakeDB([row({ id: 'before' })]) };
    await call('/api/pulse', { method: 'POST', env, body: { text: 'The new one.' } });

    const liveRows = env.DB.rows.filter((r) => r.expires_at > Date.now());
    expect(liveRows, 'two pulses were live at once').toHaveLength(1);
    expect(liveRows[0].text).toBe('The new one.');

    const { data: pub } = await call('/api/pulse', { env, auth: false });
    expect(pub.pulse.text).toBe('The new one.');
  });

  it('a post never expires itself — order inside the batch is load-bearing', async () => {
    // The expiry is bounded by `expires_at > posted_at` and runs BEFORE the
    // insert. Reverse them and the new row is expired the instant it lands, so
    // posting would silently do nothing.
    const env = { SESSION_SECRET, DB: fakeDB() };
    await call('/api/pulse', { method: 'POST', env, body: { text: 'Only one.' } });
    const { data: pub } = await call('/api/pulse', { env, auth: false });
    expect(pub.pulse, 'the post expired the row it had just written').not.toBeNull();
  });

  it('the log flags exactly one live row, even on a database that stacked them', async () => {
    // Simulates a database written under the old behaviour: three unexpired
    // rows. The console showed a LIVE badge on every one of them. Only the row
    // the homepage actually serves may carry it.
    const now = Date.now();
    const env = { SESSION_SECRET, DB: fakeDB([
      row({ id: 'a', posted_at: now - 3000, expires_at: now + HOUR }),
      row({ id: 'b', posted_at: now - 2000, expires_at: now + HOUR }),
      row({ id: 'c', posted_at: now - 1000, expires_at: now + HOUR }),
    ]) };

    const { data: log } = await call('/api/pulse/log', { env });
    expect(log.pulses.filter((p) => p.live)).toHaveLength(1);

    // …and it is the one the public read serves, not just any of them.
    const { data: pub } = await call('/api/pulse', { env, auth: false });
    expect(log.pulses.find((p) => p.live).id).toBe(pub.pulse.id);
  });
});

// ============================================================================
describe('GET /api/pulse/log', () => {
  it('is newest-first, flags what is live, and carries the TTL', async () => {
    const now = Date.now();
    const env = { SESSION_SECRET, DB: fakeDB([
      row({ id: 'a', posted_at: now - 2 * HOUR, expires_at: now - HOUR }),
      row({ id: 'b', posted_at: now, expires_at: now + HOUR }),
    ]) };
    const { data } = await call('/api/pulse/log', { env });
    expect(data.pulses.map((m) => m.id)).toEqual(['b', 'a']);
    expect(data.pulses[0].live).toBe(true);
    expect(data.pulses[1].live).toBe(false);
    expect(data.ttlHours).toBeGreaterThan(0);
  });

  it('clamps a hostile ?limit rather than trusting it', async () => {
    const env = { SESSION_SECRET, DB: fakeDB([row()]) };
    for (const q of ['?limit=99999', '?limit=-5', '?limit=abc']) {
      const { res } = await call(`/api/pulse/log${q}`, { env });
      expect(res.status).toBe(200);
    }
  });
});

// ============================================================================
describe('normalizePulseInput — the hygiene layer', () => {
  const NOW = 1_700_000_000_000;

  it('flattens a multi-line paste into one line', () => {
    const { pulse } = normalizePulseInput({ text: "Coffee in.\n\nYesterday's draft deleted." }, NOW);
    expect(pulse.text).toBe("Coffee in. Yesterday's draft deleted.");
  });

  it('strips control characters instead of bouncing the post', () => {
    const { pulse } = normalizePulseInput({ text: 'Flow\u0000state\u0007activated.' }, NOW);
    expect(pulse.text).toBe('Flow state activated.');
  });

  it('caps every field so a token cannot write a novel to the homepage', () => {
    const { pulse } = normalizePulseInput({ text: 'x'.repeat(5000), glyphs: 'y'.repeat(500) }, NOW);
    expect(pulse.text).toHaveLength(LIMITS.text);
    expect(pulse.glyphs).toHaveLength(LIMITS.glyphs);
  });

  it('IGNORES a stray kicker — the card names itself, and no caller can override it', () => {
    // The card's title is a constant (src/shared/pulse.js PULSE_LABEL), not a
    // field. An old client, a replayed request or a hand-rolled curl can still
    // send the field this feature shipped with; none of them may put a category
    // back on the homepage. Ignored rather than rejected: a 400 would break an
    // old console for a field that no longer matters.
    const { ok, pulse } = normalizePulseInput({ text: 'Tracking.', kicker: 'MUSIC' }, NOW);
    expect(ok).toBe(true);
    expect(pulse.kicker).toBeUndefined();
    expect(Object.keys(pulse)).not.toContain('kicker');
  });

  it('accepts footLeft/footRight and their snake_case twins', () => {
    expect(normalizePulseInput({ text: 'a', footLeft: 'L', footRight: 'R' }, NOW).pulse.foot_left).toBe('L');
    expect(normalizePulseInput({ text: 'a', foot_left: 'L2' }, NOW).pulse.foot_left).toBe('L2');
  });

  it('stamps expiry from the TTL and clamps a silly one', () => {
    expect(normalizePulseInput({ text: 'a', ttlHours: 2 }, NOW).pulse.expires_at).toBe(NOW + 2 * HOUR);
    // A year would pin a pulse to the homepage until someone noticed.
    expect(normalizePulseInput({ text: 'a', ttlHours: 9000 }, NOW).pulse.expires_at).toBe(NOW + 168 * HOUR);
    expect(normalizePulseInput({ text: 'a', ttlHours: 0 }, NOW).pulse.expires_at).toBe(NOW + HOUR);
  });

  it('drops an ambient stamp that is too big rather than failing the post', () => {
    expect(normalizePulseInput({ text: 'a', ambient: { t: 14 } }, NOW).pulse.ambient).toBe('{"t":14}');
    expect(normalizePulseInput({ text: 'a', ambient: { big: 'x'.repeat(1000) } }, NOW).pulse.ambient).toBeNull();
  });

  it("keeps the author's clock only when it is a real clock", () => {
    expect(normalizeLocalTime('06:18')).toBe('06:18');
    expect(normalizeLocalTime('23:59')).toBe('23:59');
    // A wrong time is worse than no time.
    for (const bad of ['25:00', '6:18', '18:60', 'now', '', null]) expect(normalizeLocalTime(bad)).toBe('');
  });

  it('falls back to the default palette rather than trusting a state name', () => {
    for (const s of PULSE_STATES) expect(normalizeState(s)).toBe(s);
    expect(normalizeState('EMBER')).toBe('ember');
    expect(normalizeState('darkroom')).toBe(DEFAULT_STATE);
    expect(normalizeState(undefined)).toBe(DEFAULT_STATE);
  });

  it('clampTtlHours holds the 1h–1week band', () => {
    expect(clampTtlHours(0.1)).toBe(1);
    expect(clampTtlHours(18)).toBe(18);
    expect(clampTtlHours(1e9)).toBe(168);
  });

  it('pulseToPublic tolerates a null row', () => {
    expect(pulseToPublic(null)).toBeNull();
  });
});

// ============================================================================
describe('pulseTierLen counts what a reader would call a character', () => {
  it('a ZWJ emoji is ONE — the bug the specimen shipped with', () => {
    // \p{Extended_Pictographic} reads 😵‍💫 as 2, which tiered a one-glyph pulse
    // as a two-glyph one and cost it the hero treatment.
    expect(pulseTierLen('😵‍💫')).toBe(1);
    expect('😵‍💫'.match(/\p{Extended_Pictographic}/gu)).toHaveLength(2);
  });

  it('a variation-selector emoji is ONE, not two code units', () => {
    expect(pulseTierLen('🎛️')).toBe(1);
    expect('🎛️'.length).toBe(3);
  });

  it('counts non-Latin text the way a reader does', () => {
    expect(pulseTierLen('日暮れ')).toBe(3);
  });

  it('matches String.length for plain Latin, so text cards do not move', () => {
    const s = 'Blinking cursor. It is winning.';
    expect(pulseTierLen(s)).toBe(s.length);
  });
});
