// auth.js relies on Web Crypto (crypto.subtle) + btoa/atob/TextEncoder, which the
// Workers runtime provides globally. Node 20+ exposes globalThis.crypto already;
// this polyfill keeps the suite green on older Node too.
import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';

if (!globalThis.crypto) {
  // eslint-disable-next-line no-global-assign
  globalThis.crypto = webcrypto;
}

// The suite tests the ENGINE, and site.config.js → demoMode rewires the whole
// write surface: on an instance that ships demoMode: true (the public demo),
// every upload/draft/publish/subscribe test would 403 and CI would be
// permanently red — found by running the fork suite against the demo's real
// config before its first deploy. So the suite runs with demoMode stripped
// from the instance config, and the gate itself is pinned explicitly by
// tests/demo-mode.test.js, whose own file-level vi.mock registers after this
// one and forces demoMode: true. (Config-flag tests that spread the actual
// config — csp-analytics, console-gate-optout — also re-mock per file, so
// this strip never leaks into what they assert.)
vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  const { demoMode, ...rest } = actual.default;
  return { default: Object.freeze(rest) };
});
