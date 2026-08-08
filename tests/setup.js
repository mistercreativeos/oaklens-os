// auth.js relies on Web Crypto (crypto.subtle) + btoa/atob/TextEncoder, which the
// Workers runtime provides globally. Node 20+ exposes globalThis.crypto already;
// this polyfill keeps the suite green on older Node too.
import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';

if (!globalThis.crypto) {
  // eslint-disable-next-line no-global-assign
  globalThis.crypto = webcrypto;
}

// Node 24+ defines `globalThis.localStorage` itself, and it evaluates to
// undefined unless the process was started with `--localstorage-file`. In a
// happy-dom test file that own property shadows the Storage happy-dom installs
// — `window.localStorage` is undefined too — so every console module that
// reads it at import time throws and the whole file fails to load. It is not a
// real defect (CI runs Node 22, where the global does not exist and happy-dom's
// own wins), but a stranger running `npm test` on current Node saw two red
// files on first clone. Backfill a real store only in the DOM environments, and
// only when the shadowing has actually happened, so Node 22 is untouched.
if (typeof globalThis.document !== 'undefined' && !globalThis.localStorage) {
  const makeStorage = () => {
    const store = new Map();
    return {
      getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => void store.set(String(k), String(v)),
      removeItem: (k) => void store.delete(String(k)),
      clear: () => store.clear(),
      key: (i) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    };
  };
  // defineProperty, not assignment: Node's global is an accessor pair, so a
  // plain write goes to its setter and the value never lands.
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(globalThis, name, {
      value: makeStorage(),
      configurable: true,
      writable: true,
    });
  }
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
