// The deploy token: what the edge data cache is keyed on, and what
// /api/version reports (src/edge/data.js, src/api/site-meta.js).
//
// The incident (2026-08-23, act two): loadDataJson cached data/*.json in
// caches.default under a key with no deploy component, and nothing purged it
// on deploy. `assets.directory: "."` means one deploy ships code AND content,
// so after a publish's build landed, the Worker kept serving the PREVIOUS
// content for up to _DATA_CACHE_TTL (300s). That cache is per-colo and lives
// at Cloudflare, so checking in a private window — or three different browsers
// — could not bypass it. A correct publish looked broken for five minutes.
//
// The fix folds the Cloudflare version id into the key, so a new deploy simply
// misses every entry from the old one. These pin that, the fallback that keeps
// an un-merged fork working exactly as before, and the endpoint that finally
// makes "which deploy is live?" answerable from outside the dashboard.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../worker.js';
import { _deployToken, loadDataJson } from '../src/edge/data.js';

const ORIGIN = 'https://example.com';

describe('_deployToken', () => {
  it('uses the version id when the binding is present', () => {
    expect(_deployToken({ CF_VERSION_METADATA: { id: 'abc123-def456' } })).toBe('abc123-def456');
  });

  it('falls back to v0 with no binding, no env, or a non-string id', () => {
    // Every one of these is a fork that has not merged the wrangler.jsonc
    // binding. None may throw: they get the old TTL-bounded behavior instead.
    expect(_deployToken({})).toBe('v0');
    expect(_deployToken(undefined)).toBe('v0');
    expect(_deployToken({ CF_VERSION_METADATA: null })).toBe('v0');
    expect(_deployToken({ CF_VERSION_METADATA: {} })).toBe('v0');
    expect(_deployToken({ CF_VERSION_METADATA: { id: 12345 } })).toBe('v0');
  });

  it('sanitises to one safe path segment and clamps the length', () => {
    // The token is spliced into a cache-key URL path, so a slash or a space
    // would silently reshape the key rather than scope it.
    expect(_deployToken({ CF_VERSION_METADATA: { id: '../../etc/passwd' } })).toBe('etcpasswd');
    expect(_deployToken({ CF_VERSION_METADATA: { id: 'a b/c?d#e' } })).toBe('abcde');
    expect(_deployToken({ CF_VERSION_METADATA: { id: '!!!' } })).toBe('v0');
    expect(_deployToken({ CF_VERSION_METADATA: { id: 'x'.repeat(500) } })).toHaveLength(64);
  });
});

describe('loadDataJson — a deploy invalidates the cache', () => {
  // A cache that actually stores, so a miss/hit is observable.
  let store;
  let reads;
  let _savedCaches;

  function envFor(versionId, body) {
    return {
      CF_VERSION_METADATA: versionId ? { id: versionId } : undefined,
      ASSETS: {
        async fetch() {
          reads++;
          return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      },
    };
  }

  beforeEach(() => {
    store = new Map();
    reads = 0;
    _savedCaches = globalThis.caches;
    globalThis.caches = {
      default: {
        async match(req) {
          const hit = store.get(req.url);
          return hit ? hit.clone() : undefined;
        },
        async put(req, res) { store.set(req.url, res.clone()); },
      },
    };
  });
  afterEach(() => { globalThis.caches = _savedCaches; });

  it('serves the second read of one deploy from cache', async () => {
    const env = envFor('deploy-one', '[{"id":"a"}]');
    expect(await loadDataJson(ORIGIN, env, 'data/buffer.json')).toEqual([{ id: 'a' }]);
    expect(await loadDataJson(ORIGIN, env, 'data/buffer.json')).toEqual([{ id: 'a' }]);
    expect(reads, 'the cache still earns its keep within a deploy').toBe(1);
  });

  it('MISSES across two deploys — this is the whole fix', async () => {
    // Deploy one caches the old content. Deploy two must not see it: before
    // this, the new version served deploy one's bytes until the TTL expired.
    await loadDataJson(ORIGIN, envFor('deploy-one', '[{"id":"old"}]'), 'data/buffer.json');
    const fresh = await loadDataJson(ORIGIN, envFor('deploy-two', '[{"id":"new"}]'), 'data/buffer.json');

    expect(fresh, 'a new deploy must read through, not serve the old copy').toEqual([{ id: 'new' }]);
    expect(reads).toBe(2);
  });

  it('scopes the key by deploy AND by path', async () => {
    await loadDataJson(ORIGIN, envFor('deploy-one', '[]'), 'data/buffer.json');
    const keys = [...store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(`${ORIGIN}/__datacache/deploy-one/data/buffer.json`);
  });

  it('an instance with no binding still caches, exactly as before', async () => {
    // The un-merged fork: same TTL-bounded behavior it has today, no error.
    const env = envFor(null, '[{"id":"a"}]');
    await loadDataJson(ORIGIN, env, 'data/buffer.json');
    await loadDataJson(ORIGIN, env, 'data/buffer.json');
    expect(reads).toBe(1);
    expect([...store.keys()][0]).toBe(`${ORIGIN}/__datacache/v0/data/buffer.json`);
  });

  it('still distinguishes a missing file from a transient failure', async () => {
    // The 404-vs-error split the feed depends on must survive the re-key.
    const env = {
      CF_VERSION_METADATA: { id: 'deploy-one' },
      ASSETS: { async fetch() { return new Response('nope', { status: 404 }); } },
    };
    await expect(loadDataJson(ORIGIN, env, 'data/posts.json')).rejects.toMatchObject({ status: 404 });
  });
});

describe('GET /api/version — which deploy is live?', () => {
  const ctx = { waitUntil() {} };
  const req = () => new Request('https://example.com/api/version');
  const baseEnv = { SESSION_SECRET: 'test-secret-please-ignore', SUBSCRIBERS: { get: async () => null, put: async () => {} } };

  it('reports the version, when it deployed, and what the cache is scoped by', async () => {
    const res = await worker.fetch(req(), {
      ...baseEnv,
      CF_VERSION_METADATA: { id: 'abc123-def456', timestamp: '2026-08-23T14:21:08.000Z', tag: 'whatever' },
    }, ctx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe('abc123-def456');
    expect(body.deployed).toBe('2026-08-23T14:21:08.000Z');
    expect(body.cacheScope, 'the endpoint and the cache must agree').toBe('abc123-def456');
  });

  it('never returns the operator-set tag', async () => {
    // `tag` is free text a fork could have typed anything into — including
    // something identifying. The endpoint is public; it stays out.
    const res = await worker.fetch(req(), {
      ...baseEnv,
      CF_VERSION_METADATA: { id: 'abc', timestamp: 'now', tag: 'prod-oaklens-personal' },
    }, ctx);
    const body = await res.json();
    expect(body.tag).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('prod-oaklens-personal');
  });

  it('is never cached — a cached "is it live yet" is a wrong answer', async () => {
    const res = await worker.fetch(req(), { ...baseEnv, CF_VERSION_METADATA: { id: 'abc' } }, ctx);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers an honest unknown on an instance with no binding', async () => {
    // A fork that has not merged the wrangler.jsonc binding: 200 with nulls,
    // never a 404 (which would read as "this engine has no such endpoint").
    const res = await worker.fetch(req(), baseEnv, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBeNull();
    expect(body.deployed).toBeNull();
    expect(body.cacheScope).toBe('v0');
  });

  it('needs no console auth — the point is curl from a phone', async () => {
    const res = await worker.fetch(req(), { ...baseEnv, CF_VERSION_METADATA: { id: 'abc' } }, ctx);
    expect(res.status).not.toBe(401);
  });
});
