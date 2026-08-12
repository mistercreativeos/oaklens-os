// Branded short links: site.config.js → shortLinks → `<origin>/<code>` 302s.
//
// Paired with tests/shortlinks-off.test.js the same way the webring tests are
// paired — "empty by default" only means something if filling the table
// demonstrably changes the answer. The mocked codes are deliberately NOT this
// instance's, so every assertion here reads the same on a fork.
import { describe, it, expect, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    default: Object.freeze({
      ...actual.default,
      // Explicitly unscoped. The spread above carries the REAL config, and
      // this instance scopes its links to `os.` — without this line every
      // assertion below would silently test the scoped path on a hostname the
      // scope rejects, and read as "short links don't work".
      shortLinkHost: '',
      shortLinks: {
        talk: 'https://example.com/a-talk',
        Prints: 'https://shop.example.com/prints?ref=card',
        // Refused at resolve time, each for its own reason — see below.
        about: 'https://evil.example.com/',
        api: 'https://evil.example.com/',
        'bad code': 'https://example.com/',
        js: 'javascript:alert(1)',
        rel: '/somewhere-else',
      },
    }),
  };
});

const worker = (await import('../worker.js')).default;
const { resolveShortLink } = await import('../src/shared/shortlinks.js');

const ENV = { ASSETS: { fetch: async () => new Response('nope', { status: 404 }) } };
const get = (path, method = 'GET') =>
  worker.fetch(new Request(`https://example.com${path}`, { method }), ENV, { waitUntil() {} });

describe('a configured code redirects', () => {
  it('302s to the target, and nothing caches the hop', async () => {
    const res = await get('/talk');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://example.com/a-talk');
    // Re-pointable by design: a 301 cached for a year is a link you no longer
    // own, which defeats the entire reason for putting it on your own domain.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('carries the same security headers as any other worker-built response', async () => {
    const res = await get('/talk');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });

  it('is case-insensitive on both sides, and tolerates a trailing slash', () => {
    const target = 'https://shop.example.com/prints?ref=card';
    expect(resolveShortLink('/prints')).toBe(target);
    expect(resolveShortLink('/PRINTS')).toBe(target);
    expect(resolveShortLink('/prints/')).toBe(target);
  });

  it('answers HEAD — link checkers and previews probe with it', async () => {
    expect((await get('/talk', 'HEAD')).status).toBe(302);
  });

  it('does not answer a write method', async () => {
    expect((await get('/talk', 'POST')).status).not.toBe(302);
  });
});

describe('a code cannot shadow the site', () => {
  // The router consults the table before the asset layer, which is the only
  // placement where a bare `/talk` can resolve at all — so this is the guard
  // that keeps a config typo from turning a real page into a redirect.
  it('refuses a public page', () => {
    expect(resolveShortLink('/about')).toBeNull();
  });

  it('refuses a worker-owned prefix', () => {
    expect(resolveShortLink('/api')).toBeNull();
  });

  it('refuses anything that is not one plain lowercase segment', () => {
    expect(resolveShortLink('/bad code')).toBeNull();
    expect(resolveShortLink('/talk/extra')).toBeNull();
    expect(resolveShortLink('/')).toBeNull();
  });

  it('refuses a target that is not an absolute http(s) URL', () => {
    expect(resolveShortLink('/js')).toBeNull();
    expect(resolveShortLink('/rel')).toBeNull();
  });

  it('leaves an unconfigured path alone', async () => {
    expect(resolveShortLink('/nothing-here')).toBeNull();
    expect((await get('/nothing-here')).status).toBe(404);
  });
});

// No `shortLinkHost` in the mock above, so every assertion in this file so far
// ran on the unscoped default — which is the fork's case, and has to keep
// working whatever hostname the request arrives on.
describe('unscoped is the default', () => {
  it('answers on any host', () => {
    for (const h of ['example.com', 'os.example.com', 'fork.workers.dev', '']) {
      expect(resolveShortLink('/talk', h)).toBe('https://example.com/a-talk');
    }
  });
});

// RESERVED_SEGMENTS is a hand-kept list, and the repo grows directories. This
// is the half that cannot drift: it reads what is actually on disk and checks
// the REAL config's codes against it, so a new top-level folder named after an
// existing short link fails here instead of silently swallowing the redirect.
describe('the real table collides with nothing on disk', () => {
  it('no configured code matches a top-level file or directory', async () => {
    const { default: realConfig } = await vi.importActual('../site.config.js');
    const codes = Object.keys(realConfig.shortLinks || {}).map((c) => c.toLowerCase());
    const onDisk = new Set(
      readdirSync(join(import.meta.dirname, '..'))
        .map((e) => e.replace(/\.[^.]+$/, '').toLowerCase()),
    );
    expect(codes.filter((c) => onDisk.has(c))).toEqual([]);
  });
});
