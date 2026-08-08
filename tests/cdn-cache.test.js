// /api/cdn edge caching (src/api/assets.js).
//
// `run_worker_first: true` means nothing on this route is cached automatically:
// every image view was one Worker invocation AND one R2 read. A photo grid is
// 20–40 images, and the Workers free tier is 100k requests/day, so a
// zero-config fork could exhaust a day's budget on a few hundred page views.
// The proxy now serves full GETs from `caches.default`.
//
// What these pin is the part that is easy to get subtly wrong: the cache must
// never answer with a partial body, never let a bundled sample shadow a real
// object, and must be purgeable by the key the upload path actually deletes.
import { describe, it, expect } from 'vitest';
import worker from '../worker.js';
import { createToken } from '../src/shared/auth.js';

const SESSION_SECRET = 'test-secret-please-ignore';
const ctx = { waitUntil(p) { this.pending.push(p); }, pending: [] };
const newCtx = () => ({ pending: [], waitUntil(p) { this.pending.push(p); } });

// Minimal caches.default: a Map keyed by request URL, with call counters so a
// test can prove a hit did NOT reach R2.
function makeCache(seed = {}) {
  const store = new Map(Object.entries(seed));
  const calls = { match: [], put: [], delete: [] };
  return {
    store,
    calls,
    default: {
      async match(req) {
        const url = typeof req === 'string' ? req : req.url;
        calls.match.push(url);
        const hit = store.get(url);
        return hit ? hit.clone() : undefined;
      },
      async put(req, res) {
        const url = typeof req === 'string' ? req : req.url;
        calls.put.push(url);
        store.set(url, res);
      },
      async delete(req) {
        const url = typeof req === 'string' ? req : req.url;
        calls.delete.push(url);
        return store.delete(url);
      },
    },
  };
}

// R2 stub that counts reads, so "served from cache" is provable rather than
// inferred from a matching body.
function makeCdn(keys = [], { size = 5 } = {}) {
  const objects = new Map(keys.map((k) => [k, 'bytes']));
  const reads = [];
  const stored = [];
  return {
    reads,
    stored,
    objects,
    async get(key, opts) {
      reads.push(key);
      if (!objects.has(key)) return null;
      if (opts && opts.range) {
        return { body: 'part', size, range: opts.range, httpMetadata: { contentType: 'image/webp' } };
      }
      return { body: objects.get(key), size, httpMetadata: { contentType: 'image/webp' } };
    },
    async put(key) { stored.push(key); objects.set(key, 'bytes'); },
    async delete(key) { objects.delete(key); },
  };
}

const ORIGIN = 'https://example.com';
const proxyUrl = (key) => `${ORIGIN}/api/cdn/${key.split('/').map(encodeURIComponent).join('/')}`;

async function withCaches(cache, fn) {
  const saved = globalThis.caches;
  globalThis.caches = cache;
  try { return await fn(); } finally { globalThis.caches = saved; }
}

const proxyGet = (key, cdn, { range, cx = newCtx() } = {}) =>
  worker.fetch(
    new Request(proxyUrl(key), range ? { headers: { Range: range } } : undefined),
    { SESSION_SECRET, CDN: cdn },
    cx
  );

const KEY = 'archive/frame-480w.webp';

describe('/api/cdn edge cache — full GETs', () => {
  it('a miss reads R2 once and populates the cache', async () => {
    const cache = makeCache();
    const cdn = makeCdn([KEY]);
    const cx = newCtx();
    const res = await withCaches(cache, () => proxyGet(KEY, cdn, { cx }));

    expect(res.status).toBe(200);
    expect(cdn.reads, 'one R2 read on a miss').toEqual([KEY]);
    await Promise.all(cx.pending);   // the put runs under waitUntil
    expect(cache.calls.put).toEqual([proxyUrl(KEY)]);
  });

  it('a hit is served from the cache without touching R2', async () => {
    const cache = makeCache();
    const cdn = makeCdn([KEY]);
    await withCaches(cache, async () => {
      const cx = newCtx();
      await proxyGet(KEY, cdn, { cx });
      await Promise.all(cx.pending);
    });
    expect(cdn.reads).toHaveLength(1);

    // Second view of the same frame — the whole point of the change.
    const res = await withCaches(cache, () => proxyGet(KEY, cdn));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('bytes');
    expect(cdn.reads, 'a cache hit must not re-read R2').toHaveLength(1);
  });

  it('never blocks the response on the cache write', async () => {
    // The put is handed to ctx.waitUntil, not awaited: a cache that hangs
    // forever must not hold the image.
    const cache = makeCache();
    cache.default.put = () => new Promise(() => {});
    const cx = newCtx();
    const res = await withCaches(cache, () => proxyGet(KEY, makeCdn([KEY]), { cx }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('bytes');
  });

  it('keys the cache by the URL the pages actually request (percent-encoded)', async () => {
    // js/lighttable.js encodeURIComponent's the basename, so `+` arrives as
    // %2B. A cache key built from the raw R2 key would never be hit — or
    // worse, would be purged under a URL nothing ever wrote.
    const key = 'archive/shot+one-480w.webp';
    const cache = makeCache();
    const cx = newCtx();
    await withCaches(cache, () => proxyGet(key, makeCdn([key]), { cx }));
    await Promise.all(cx.pending);
    expect(cache.calls.put).toEqual([`${ORIGIN}/api/cdn/archive/shot%2Bone-480w.webp`]);
  });

  it('still serves when the cache API is unavailable', async () => {
    const res = await withCaches(undefined, () => proxyGet(KEY, makeCdn([KEY])));
    expect(res.status).toBe(200);
  });
});

describe('/api/cdn edge cache — Range requests bypass it', () => {
  it('a Range request neither reads nor writes the cache', async () => {
    const cache = makeCache();
    const cx = newCtx();
    const res = await withCaches(cache, () => proxyGet('archive/clip.mp4', makeCdn(['archive/clip.mp4'], { size: 500 }), { range: 'bytes=0-99', cx }));

    expect(res.status).toBe(206);
    expect(cache.calls.match, 'no cache read for a Range request').toEqual([]);
    await Promise.all(cx.pending);
    expect(cache.calls.put, '206 bodies are not cacheable').toEqual([]);
  });

  it('a cached full object never answers a Range request with a 200 body', async () => {
    // The corrupt-hit shape: whole object in cache, browser asks for bytes.
    // Safari would take a 200 here as "server ignores Range" and refuse to
    // play the video.
    const key = 'archive/clip.mp4';
    const cache = makeCache({ [proxyUrl(key)]: new Response('whole file') });
    const res = await withCaches(cache, () => proxyGet(key, makeCdn([key], { size: 500 }), { range: 'bytes=0-99' }));
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-99/500');
  });
});

describe('/api/cdn edge cache — the sample fallback is never cached', () => {
  const env = (cdn) => ({
    SESSION_SECRET,
    CDN: cdn,
    ASSETS: {
      async fetch(req) {
        return new URL(req.url).pathname.startsWith('/assets/samples/')
          ? new Response('sample-bytes', { headers: { 'Content-Type': 'image/webp' } })
          : new Response('nope', { status: 404 });
      },
    },
  });

  it('does not store a bundled sample under the real key', async () => {
    // A fork sees samples until it uploads. If the sample were cached under
    // the object's own URL, the first real upload would be shadowed for the
    // TTL — and `cache.delete` only purges the colo that runs it, so the
    // upload purge could not clear it everywhere.
    const cache = makeCache();
    const cx = newCtx();
    const res = await withCaches(cache, () =>
      worker.fetch(new Request(proxyUrl(KEY)), env(makeCdn([])), cx));
    await Promise.all(cx.pending);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('sample-bytes');
    expect(cache.calls.put).toEqual([]);
    expect(cache.store.size, 'nothing stored under the real key').toBe(0);
  });

  it('a real upload is served immediately after, not shadowed by the sample', async () => {
    const cache = makeCache();
    const cdn = makeCdn([]);
    await withCaches(cache, async () => {
      const cx = newCtx();
      const first = await worker.fetch(new Request(proxyUrl(KEY)), env(cdn), cx);
      expect(await first.text()).toBe('sample-bytes');
      await Promise.all(cx.pending);

      cdn.objects.set(KEY, 'real-bytes');   // the fork uploads its own frame
      const second = await worker.fetch(new Request(proxyUrl(KEY)), env(cdn), newCtx());
      expect(await second.text()).toBe('real-bytes');
    });
  });

  it('does not cache a 404', async () => {
    const cache = makeCache();
    const cx = newCtx();
    const res = await withCaches(cache, () => proxyGet(KEY, makeCdn([]), { cx }));
    expect(res.status).toBe(404);
    await Promise.all(cx.pending);
    expect(cache.calls.put).toEqual([]);
  });
});

describe('/api/cdn edge cache — the purge deletes what the proxy populates', () => {
  async function upload(name, cdn, cache) {
    const env = { SESSION_SECRET, CDN: cdn };
    const token = await createToken(env);
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(8)], name, { type: 'image/webp' }));
    return withCaches(cache, () => worker.fetch(
      new Request(`${ORIGIN}/api/upload`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      }),
      env, newCtx()
    ));
  }

  it('an upload purges the proxy-path key the proxy wrote', async () => {
    // The bug this closes: the purge deleted `${cdnBase}/${key}` while the
    // proxy populated `${origin}/api/cdn/${key}` — so on the serving mode
    // that actually uses the proxy, an overwrite served stale for the TTL.
    const cache = makeCache();
    const cdn = makeCdn([KEY]);
    const cx = newCtx();
    await withCaches(cache, () => proxyGet(KEY, cdn, { cx }));
    await Promise.all(cx.pending);
    expect(cache.store.has(proxyUrl(KEY))).toBe(true);

    const res = await upload(KEY, cdn, cache);
    expect(res.status).toBe(200);
    expect(cache.calls.delete, 'purged the proxy URL').toContain(proxyUrl(KEY));
    expect(cache.store.has(proxyUrl(KEY)), 'stale entry survived the overwrite').toBe(false);
  });

  it('purges the encoded form, matching what the pages request', async () => {
    const key = 'archive/two cyclist=x+y-480w.webp';
    const cache = makeCache();
    await upload(key, makeCdn(), cache);
    expect(cache.calls.delete).toContain(proxyUrl(key));
  });

  it('a delete purges the proxy-path key too', async () => {
    const cache = makeCache();
    const cdn = makeCdn([KEY]);
    const env = { SESSION_SECRET, CDN: cdn };
    const token = await createToken(env);
    const res = await withCaches(cache, () => worker.fetch(
      new Request(`${ORIGIN}/api/delete-assets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [KEY] }),
      }),
      env, newCtx()
    ));
    expect(res.status).toBe(200);
    expect(cache.calls.delete).toContain(proxyUrl(KEY));
  });
});
