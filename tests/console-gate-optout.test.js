import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The opt-out posture: site.config.js → consoleShellPublic: true serves the
// console shell publicly again (the pre-gate behavior — API auth still
// applies). Isolated in its own file because vi.mock is hoisted per-file and
// the main gate suite needs the real (gated) config.

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: Object.freeze({ ...actual.default, consoleShellPublic: true }) };
});

const { default: worker } = await import('../worker.js');

const SHELL_MARKER = 'console shell marker';

const env = {
  SESSION_SECRET: 'test-secret-please-ignore',
  SUBSCRIBERS: { get: async () => null, put: async () => {} },
  ASSETS: {
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === '/dev/field-console' || path === '/dev/field-console.html') {
        return new Response(`<!DOCTYPE html><html><head></head><body>${SHELL_MARKER}</body></html>`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response('not found', { status: 404 });
    },
  },
};

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

describe('consoleShellPublic opt-out', () => {
  it('serves the shell with no cookie when the flag is true', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/dev/field-console'),
      env,
      { waitUntil() {} }
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(SHELL_MARKER);
  });
});
