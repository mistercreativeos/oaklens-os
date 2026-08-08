// GET /.well-known/analogs.txt with a seat configured.
//
// Isolated in its own file for the same reason as tests/csp-apple-music.test.js:
// vi.mock is hoisted per-file, and tests/webring-off.test.js needs the flag off
// to prove the shipped fork default serves nothing. The pairing is the point —
// "off by default" only means something if turning it on demonstrably changes
// the answer.
//
// The mocked seat is deliberately NOT this instance's (node 0 / oaklens-art):
// these assertions must read the same on a fork as they do here.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    default: Object.freeze({
      ...actual.default,
      webring: { node: 7, slug: 'example-node' },
    }),
  };
});

const worker = (await import('../worker.js')).default;
const { buildCsp } = await import('../src/shared/csp.js');

const ORIGIN = 'https://example.com';
// A non-GET falls past EXACT_ROUTES to the asset path, which needs a binding.
const ENV = { ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } };
const get = (path, method = 'GET') =>
  worker.fetch(new Request(`${ORIGIN}${path}`, { method }), ENV, { waitUntil() {} });

describe('GET /.well-known/analogs.txt — member', () => {
  it('serves the ownership claim as one line of plain text', async () => {
    const res = await get('/.well-known/analogs.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('analogs.network//node-007//example-node\n');
  });

  it('is readable cross-origin — the ring has to be able to fetch it', async () => {
    const res = await get('/.well-known/analogs.txt');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
  });

  it('is a read, so it answers under demo mode and needs no auth', async () => {
    // No Authorization header anywhere above; the claim is public by design.
    const res = await get('/.well-known/analogs.txt');
    expect(res.status).toBe(200);
  });

  it('does not answer other methods on that path', async () => {
    const res = await get('/.well-known/analogs.txt', 'POST');
    expect(res.status).not.toBe(200);
  });
});

describe('the webring widens no policy', () => {
  // The whole reason the ring chip is a chip and not the ring's own hotlinked
  // 88x31 button: an <img> from analogs.network would need img-src widened for
  // every fork, and would render broken in the offline site export. Membership
  // must cost the CSP nothing.
  it('names no ring host in the policy on either surface', async () => {
    // Note this asserts absence only — it deliberately does NOT pin frame-src
    // or any other directive, because those vary with the instance's own flags
    // (this one runs appleMusicEmbeds). What must hold for every instance is
    // that joining a ring adds nothing to the policy.
    for (const strict of [true, false]) {
      expect(buildCsp(ORIGIN, strict), `strict=${strict}`).not.toContain('analogs');
    }
  });

  it('names no ring host in any fetch directive', async () => {
    const res = await get('/.well-known/analogs.txt');
    expect(res.headers.get('Content-Security-Policy')).toBeNull(); // not an HTML surface
    expect(buildCsp(ORIGIN, true)).not.toContain('analogs.network');
  });
});
