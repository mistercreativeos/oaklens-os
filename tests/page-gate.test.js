import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PAGE_ROUTES } from '../src/shared/pages.js';

// Config-driven page gating (starter template): pages[key] === false turns a
// public page off end to end — route 404s (served as the real 404 page,
// no-store), sitemap/Wayback cron drop it, nav filters it — while console
// infrastructure under /dev/ stays reachable. Isolated in its own file
// because vi.mock is hoisted per-file and the rest of the suite needs the
// real (everything-on) config.

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    default: Object.freeze({
      ...actual.default,
      // wall + dev off; archive/fieldNotes/about/os/support keys OMITTED —
      // a missing key must mean enabled.
      pages: Object.freeze({ wall: false, dev: false }),
    }),
  };
});

const { default: worker, pageDisabled, publicPages, _navLinksHtml } = await import('../worker.js');

const PAGE_MARKER = 'wall page marker';
const NOTFOUND_MARKER = '404 page marker';

const env = {
  SESSION_SECRET: 'test-secret-please-ignore',
  SUBSCRIBERS: { get: async () => null, put: async () => {} },
  ASSETS: {
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === '/404.html') {
        return new Response(`<!DOCTYPE html><html><body>${NOTFOUND_MARKER}</body></html>`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      if (path === '/dev/sw.js') {
        return new Response('// sw', { headers: { 'Content-Type': 'text/javascript' } });
      }
      return new Response(`<!DOCTYPE html><html><body>${PAGE_MARKER}</body></html>`, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  },
};

const ctx = { waitUntil() {} };
const get = (path) => worker.fetch(new Request(`https://example.com${path}`), env, ctx);

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
      async match() { return new Response(JSON.stringify({ temp: 60, ts: Date.now() })); },
      async put() {},
    },
  };
});
afterEach(() => {
  globalThis.HTMLRewriter = _savedRewriter;
  globalThis.caches = _savedCaches;
});

describe('pageDisabled', () => {
  it('gates the route root and everything under it', () => {
    expect(pageDisabled('/wall')).toBe(true);
    expect(pageDisabled('/wall/')).toBe(true);
    expect(pageDisabled('/wall/anything')).toBe(true);
  });

  it('a missing key means enabled', () => {
    expect(pageDisabled('/archive')).toBe(false);
    expect(pageDisabled('/about')).toBe(false);
    expect(pageDisabled('/')).toBe(false);
  });

  it('never gates console infrastructure, even with dev:false', () => {
    // The `/dev` *landing page* is only gateable where it exists — the
    // extracted engine tree drops it. What must hold everywhere is the line
    // below it: turning /dev off must never lock the owner out of their own
    // console.
    if (PAGE_ROUTES.dev) {
      expect(pageDisabled('/dev')).toBe(true);
      expect(pageDisabled('/dev/anything')).toBe(true);
    }
    expect(pageDisabled('/dev/field-console')).toBe(false);
    expect(pageDisabled('/dev/field-console.html')).toBe(false);
    expect(pageDisabled('/dev/console-gate.html')).toBe(false);
    expect(pageDisabled('/dev/sw.js')).toBe(false);
    expect(pageDisabled('/dev/manifest.webmanifest')).toBe(false);
  });
});

describe('gated route serving', () => {
  it('a gated page serves the real 404 page with status 404 + no-store', async () => {
    const res = await get('/wall');
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain(NOTFOUND_MARKER);
  });

  it('subpaths of a gated page 404 too', async () => {
    const res = await get('/wall/deep/path');
    expect(res.status).toBe(404);
  });

  it('an enabled page serves normally', async () => {
    const res = await get('/archive');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(PAGE_MARKER);
  });

  it('dev:false does not gate the console shell (shell gate still answers)', async () => {
    const res = await get('/dev/field-console');
    // No cookie → the shell gate's 401 login page, not the page-gate 404.
    expect(res.status).toBe(401);
  });

  it('dev:false does not gate the PWA service worker', async () => {
    const res = await get('/dev/sw.js');
    expect(res.status).toBe(200);
  });
});

describe('sitemap + cron + nav', () => {
  it('sitemap drops gated pages and keeps enabled ones', async () => {
    const res = await get('/sitemap.xml');
    const xml = await res.text();
    expect(xml).not.toContain('/wall');
    expect(xml).not.toContain('/dev');
    expect(xml).toContain('/archive');
    expect(xml).toContain('/archive/manifest.html');
  });

  it('publicPages() (the Wayback-cron list) drops gated pages', () => {
    const pages = publicPages();
    expect(pages).not.toContain('/wall');
    expect(pages).not.toContain('/dev');
    expect(pages).toContain('/');
    expect(pages).toContain('/archive');
  });

  it('nav HTML drops items pointing at gated pages', () => {
    const html = _navLinksHtml('/');
    expect(html).not.toContain('/wall');
    expect(html).not.toContain('>Dev');
    expect(html).toContain('/archive');
    expect(html).toContain('/about');
  });
});
