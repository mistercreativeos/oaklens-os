// The shipped fork default: no short links at all.
//
// Its own file because vi.mock is hoisted per-file, and the pairing is the
// point — tests/shortlinks.test.js proves a filled table redirects, this
// proves an empty one is inert. A fork must not inherit a redirect, and must
// not pay for a feature it has not configured.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: Object.freeze({ ...actual.default, shortLinks: {} }) };
});

const worker = (await import('../worker.js')).default;
const { resolveShortLink } = await import('../src/shared/shortlinks.js');
const { BACKFILL, resolveConfig } = await import('../src/shared/config.js');

describe('with no shortLinks configured', () => {
  it('is what the engine ships', () => {
    expect(BACKFILL.shortLinks).toEqual({});
    // A fork's config predates every key the engine adds later, so the absent
    // case is the normal case — it must resolve, not throw.
    expect(resolveConfig({ name: 'A Fork' }).shortLinks).toEqual({});
  });

  it('resolves nothing, whatever the path', () => {
    for (const p of ['/demo', '/coldrun', '/anything', '/']) {
      expect(resolveShortLink(p)).toBeNull();
    }
  });

  it('an unknown path still reaches the asset layer', async () => {
    let reached = false;
    const env = {
      ASSETS: {
        fetch: async () => { reached = true; return new Response('404', { status: 404 }); },
      },
    };
    await worker.fetch(new Request('https://example.com/demo'), env, { waitUntil() {} });
    expect(reached, 'the short-link check must not swallow the request').toBe(true);
  });
});
