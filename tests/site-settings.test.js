import { describe, it, expect } from 'vitest';
import { PAGE_ROUTES } from '../src/shared/pages.js';
import worker from '../worker.js';
import siteConfig from '../site.config.js';

// GET /api/site/settings — the console's read-only Site Settings card feed.
// Public by design (everything in it is already visible on the rendered
// site), so the shape is a contract: exactly ok/name/theme/pages, nothing
// else can ever leak through it.

const env = {
  SESSION_SECRET: 'test-secret-please-ignore',
  SUBSCRIBERS: { get: async () => null, put: async () => {} },
  ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
};
const ctx = { waitUntil() {} };

const getSettings = async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/site/settings'), env, ctx
  );
  return { res, body: await res.json() };
};

describe('GET /api/site/settings', () => {
  it('answers 200 with the template state', async () => {
    const { res, body } = await getSettings();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.name).toBe(siteConfig.name);
    expect(body.theme.preset).toBe(siteConfig.theme.preset);
    expect(body.theme.defaultMode).toBe(siteConfig.theme.defaultMode);
    expect(body.theme.toggle).toBe(true);
  });

  it('resolves every PAGE_ROUTES key to a boolean (missing key = enabled)', async () => {
    const { body } = await getSettings();
    const keys = Object.keys(body.pages).sort();
    // Derived from PAGE_ROUTES, not a literal: the extracted engine tree drops
    // the OAKLENS marketing pages, and this contract travels with it.
    expect(keys).toEqual(Object.keys(PAGE_ROUTES).sort());
    for (const v of Object.values(body.pages)) expect(typeof v).toBe('boolean');
  });

  it('leaks no unexpected keys — the response is ONLY ok/name/theme/pages + the two posture flags', async () => {
    const { body } = await getSettings();
    expect(Object.keys(body).sort()).toEqual(['demoMode', 'name', 'ok', 'pages', 'repoConnected', 'theme']);
    expect(Object.keys(body.theme).sort()).toEqual(['defaultMode', 'preset', 'toggle']);
  });

  it('reports the posture flags as booleans (absent config = false)', async () => {
    const { body } = await getSettings();
    expect(body.demoMode).toBe(siteConfig.demoMode === true);
    expect(body.repoConnected).toBe(siteConfig.repoConnected === true);
  });

  it('POST is not routed (read-only endpoint)', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/site/settings', { method: 'POST' }), env, ctx
    );
    expect(res.status).not.toBe(200);
  });
});
