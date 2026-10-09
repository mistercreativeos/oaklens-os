// The first-run welcome is decided by the site, once (src/api/welcome.js).
//
// It used to be decided by the browser, and a device that keeps nothing
// (THIS DEVICE 0%) welcomed an established site with 729 frames as brand new,
// while every new device, home-screen app or cleared browser got it again
// (2026-10-08). These pin the site's answer: shown once, only to a site that
// has published nothing; anything uncertain says no. (The demo's answer is
// in tests/demo-mode.test.js, where demoMode can be switched on.)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleGetWelcome, handlePostWelcome, WELCOME_KV_KEY } from '../src/api/welcome.js';
import { createToken } from '../src/shared/auth.js';

let _savedCaches;
beforeEach(() => {
  _savedCaches = globalThis.caches;
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) { const hit = store.get(req.url); return hit ? new Response(hit) : undefined; },
      async put(req, res) { store.set(req.url, await res.text()); },
    },
  };
});
afterEach(() => { globalThis.caches = _savedCaches; });

/** A site: its published data files (missing = 404) and a KV namespace. */
function site(files = {}, { kv = new Map(), assetsDown = false, kvDown = false } = {}) {
  return {
    SESSION_SECRET: 'test-secret-for-welcome-0123456789abcdef',
    ASSETS: {
      async fetch(req) {
        if (assetsDown) return new Response('down', { status: 503 });
        const name = new URL(req.url).pathname.replace(/^\/data\//, '').replace(/\.json$/, '');
        return name in files ? new Response(JSON.stringify(files[name]), { status: 200 }) : new Response('nf', { status: 404 });
      },
    },
    SUBSCRIBERS: {
      async get(k) { if (kvDown) throw new Error('kv down'); return kv.has(k) ? kv.get(k) : null; },
      async put(k, v) { if (kvDown) throw new Error('kv down'); kv.set(k, v); },
    },
    _kv: kv,
  };
}

async function call(handler, env, method = 'GET', { auth = true } = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${await createToken(env)}`;
  const res = await handler(new Request('https://example.test/api/welcome', { method, headers }), env);
  return { status: res.status, body: await res.json() };
}

describe('GET /api/welcome: the site decides', () => {
  it('shows to a site that has published nothing (a fresh install: files missing or empty)', async () => {
    const env = site({ posts: [], buffer: [] });
    expect((await call(handleGetWelcome, env)).body).toMatchObject({ ok: true, show: true });
  });

  it('never shows to a site with published work, and remembers that for the day it empties', async () => {
    const env = site({ buffer: [{ id: 'f1' }] });
    expect((await call(handleGetWelcome, env)).body).toMatchObject({ ok: true, show: false, reason: 'has-content' });
    expect(env._kv.has(WELCOME_KV_KEY), 'marked so an emptied buffer later is not "new"').toBe(true);
  });

  it('checks every surface that makes a site not new', async () => {
    for (const name of ['posts', 'buffer', 'archive', 'wallpapers', 'library']) {
      const env = site({ [name]: [{ id: 'x' }] });
      expect((await call(handleGetWelcome, env)).body.show, name).toBe(false);
    }
  });

  it('shows once: after a dismissal no device is told to show it', async () => {
    const env = site({});
    expect((await call(handleGetWelcome, env)).body.show).toBe(true);
    expect((await call(handlePostWelcome, env, 'POST')).body).toEqual({ ok: true });
    expect((await call(handleGetWelcome, env)).body).toMatchObject({ show: false, reason: 'welcomed' });
  });

  it('says no when it cannot tell (data unreadable, KV down)', async () => {
    expect((await call(handleGetWelcome, site({}, { assetsDown: true }))).body).toMatchObject({ show: false, reason: 'unknown' });
    expect((await call(handleGetWelcome, site({}, { kvDown: true }))).body).toMatchObject({ show: false, reason: 'unknown' });
  });

  it('answers only the console', async () => {
    expect((await call(handleGetWelcome, site({}), 'GET', { auth: false })).status).toBe(401);
    expect((await call(handlePostWelcome, site({}), 'POST', { auth: false })).status).toBe(401);
  });

  it('a dismissal that could not be kept says so', async () => {
    expect((await call(handlePostWelcome, site({}, { kvDown: true }), 'POST')).status).toBe(503);
  });
});
