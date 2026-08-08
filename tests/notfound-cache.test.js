// A 404 must never outlive the miss that produced it.
//
// Workers Assets applies `_headers` rules by URL pattern, status-blind: a
// request for a missing `/*.webp` (or `/js/*`, `/css/*` …) URL serves the
// 404 page WITH that pattern's `public, max-age=31536000, immutable` — and
// the edge cache keeps it. Observed live 2026-08-06: `cf-cache-status: HIT`
// on a 404 answering with a year of immutable. The worker now forces
// `no-store` onto every asset-layer 404 (HTML and non-HTML paths both).
//
// Also pinned here: HEAD reaches the /api/cdn proxy. The prefix route was
// GET-only, so `curl -I` and uptime monitors' HEAD probes fell through to the
// asset layer and read "404" for every real image — which is exactly how the
// bug above was found.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../worker.js';

const NOTFOUND_MARKER = '404 page marker';
// What Workers Assets actually does to a missing /*.webp URL: answers with
// 404.html, stamped with the `_headers` rule matched by the REQUEST path.
const POISONED = 'public, max-age=31536000, immutable';

const env = {
  SESSION_SECRET: 'test-secret-please-ignore',
  SUBSCRIBERS: { get: async () => null, put: async () => {} },
  CDN: {
    async get(key) {
      if (key !== 'archive/real-frame-480w.webp') return null;
      return { body: 'bytes', size: 5, httpMetadata: { contentType: 'image/webp' } };
    },
  },
  ASSETS: {
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path.endsWith('.txt')) {
        // Non-HTML 404 shape (e.g. an asset host that answers plain text).
        return new Response('not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain', 'Cache-Control': POISONED },
        });
      }
      if (path === '/real-page.html' || path === '/') {
        return new Response('<!DOCTYPE html><html><body>page</body></html>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
        });
      }
      // Everything else: the not_found_handling 404 page, poisoned by the
      // URL-pattern `_headers` rule exactly as observed live.
      return new Response(`<!DOCTYPE html><html><body>${NOTFOUND_MARKER}</body></html>`, {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': POISONED },
      });
    },
  },
};

const ctx = { waitUntil() {} };
const fetchPath = (path, method = 'GET') =>
  worker.fetch(new Request(`https://example.com${path}`, { method }), env, ctx);

let _savedRewriter, _savedCaches;
beforeEach(() => {
  _savedRewriter = globalThis.HTMLRewriter;
  _savedCaches = globalThis.caches;
  globalThis.HTMLRewriter = class {
    on() { return this; }
    transform(res) { return new Response(res.body, res); }
  };
  globalThis.caches = {
    default: {
      // Weather cache only — the CDN proxy's cache lookups must MISS here so
      // the HEAD tests exercise the real R2 path.
      async match(req) {
        const u = typeof req === 'string' ? req : req.url;
        return u.includes('__wx_cache')
          ? new Response(JSON.stringify({ temp: 60, ts: Date.now() }))
          : undefined;
      },
      async put() {},
      async delete() {},
    },
  };
});
afterEach(() => {
  globalThis.HTMLRewriter = _savedRewriter;
  globalThis.caches = _savedCaches;
});

describe('asset-layer 404s are never cacheable', () => {
  it('a missing .webp URL serves the 404 page with no-store, not the _headers immutable', async () => {
    const res = await fetchPath('/archive/deleted-frame-480w.webp');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(NOTFOUND_MARKER);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy(); // still a public path
  });

  it('a missing versioned JS URL gets the same no-store', async () => {
    const res = await fetchPath('/js/typo-module.js?v=99');
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('a non-HTML 404 is also stripped to no-store', async () => {
    const res = await fetchPath('/missing.txt');
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('a 200 asset keeps whatever Cache-Control the asset layer set', async () => {
    const res = await fetchPath('/real-page.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
  });
});

describe('HEAD reaches the /api/cdn proxy', () => {
  it('HEAD on a real key answers 200 with the proxy headers, not the 404 page', async () => {
    const res = await fetchPath('/api/cdn/archive/real-frame-480w.webp', 'HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });

  it('HEAD on a genuinely missing key still 404s (no sample on this stub)', async () => {
    const res = await fetchPath('/api/cdn/archive/never-existed-480w.webp', 'HEAD');
    expect(res.status).toBe(404);
  });
});
