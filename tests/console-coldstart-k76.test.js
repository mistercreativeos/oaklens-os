// @vitest-environment happy-dom
//
// K76 (2026-10-06): the cold start, observed (Chrome and WebKit, a 1.2s
// sync). Every cold open toasted "✓ Synced from GitHub main" at the
// ignition's crest (the session holds no last-imported revision, so its first
// sync always counts as new); the lamp showed green at 0.13s, amber from
// 0.49s to 1.7s, then green; it asked for the same amber a dozen times in
// 30ms; and the pictures popped in through the heat. The owner: "the green
// status light contract will be more than enough on first load to indicate
// to the user that the system is 'ready'". After: no toast, the lamp amber
// from the ignition's start and green once, at 1.35s, as the crest arrives.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const CSS = read('css/field-console.css').replace(/\/\*[\s\S]*?\*\//g, '');

afterEach(() => { vi.restoreAllMocks(); });

describe('a sync the console runs on its own says nothing; the lamp does', () => {
  it('a quiet sync makes no toast; one you asked for, or are waiting on, does', () => {
    const P = read('js/console/publish.js');
    expect(P).toMatch(/const quiet = opts\?\.quiet === true;/);
    expect(P).toMatch(/if \(!upToDate && !quiet\) toast\('✓ Synced from GitHub main', 'success'\);/);
    // Failures and the disarmed guard still speak, quiet or not.
    expect(P).toMatch(/showToast\(`⚠ Couldn't read main's revision/);
    // The pull after a publish refused for stale state: you are waiting on it.
    expect(P).toMatch(/toast\('⚠ Out of sync with main — pulling latest, then re-publish\.', 'error'\);\s*syncFromServer\(\);/);
    expect(read('dev/field-console.html')).toMatch(/onclick="syncFromServer\(\{ force: true \}\)"/);
  });

  it('the cold start, a return to the app, a login and a reconnect are quiet', () => {
    const I = read('js/console/init.js');
    expect(I).toMatch(/setTimeout\(\(\) => syncFromServer\(\{ quiet: true \}\), 0\);/);
    expect(I).toMatch(/_lastFocusSync = now;\s*syncFromServer\(\{ quiet: true \}\);/);
    expect(read('js/console/session.js')).toMatch(/setTimeout\(\(\) => syncFromServer\(\{ quiet: true \}\), 200\);/);
    expect(read('js/console/publish.js')).toMatch(/_syncPendingReconnect = false; syncFromServer\(\{ quiet: true \}\);/);
  });

  it('starts with the Bridge\'s first reads, not 400ms after them', () => {
    expect(read('js/console/init.js')).not.toMatch(/setTimeout\(syncFromServer, 400\)/);
  });

  it('the whole pull is one span on the lamp, on a channel of its own', () => {
    const P = read('js/console/publish.js');
    expect(P).toMatch(/export async function syncFromServer\(opts\) \{\s*if \(!isLoggedIn\(\)\) return _syncFromServer\(opts\);\s*const done = beginActivity\('sync-run', 'SYNC ▼'\);\s*try \{ return await _syncFromServer\(opts\); \} finally \{ done\(\); \}\s*\}/);
  });
});

describe('the lamp writes only what changed', () => {
  it('the same state asked for again touches nothing', async () => {
    vi.resetModules();
    document.body.innerHTML = '<button id="sys-lamp" data-state="idle"><span id="sys-lamp-label">SYS.IDLE</span></button>';
    const T = await import('../js/console-telemetry.js');
    const label = document.getElementById('sys-lamp-label');
    const end1 = T.beginActivity('a', 'BENCH ▼');
    expect(document.getElementById('sys-lamp').dataset.state).toBe('busy');
    const node = label.firstChild;
    const end2 = T.beginActivity('b', 'BENCH ▼');
    expect(label.firstChild).toBe(node);   // the same text node: nothing was rewritten
    end2(); end1();
    expect(document.getElementById('sys-lamp').dataset.state).not.toBe('busy');
    expect(read('js/console-telemetry.js')).toMatch(/if \(lamp\.dataset\.state !== state\) lamp\.dataset\.state = state;/);
  });
});

describe('a picture fades up as it arrives', () => {
  it('a picture still on its way is hidden and fades in when it loads; one in hand shows at once', async () => {
    vi.resetModules();
    document.body.innerHTML = '<ol id="l"><li><img class="br-thumb" id="a"></li><li><img class="br-thumb" id="b"></li></ol>';
    const B = await import('../js/console/bridge.js');
    const a = document.getElementById('a'), b = document.getElementById('b');
    Object.defineProperty(a, 'complete', { value: true }); Object.defineProperty(a, 'naturalWidth', { value: 480 });
    Object.defineProperty(b, 'complete', { value: false }); Object.defineProperty(b, 'naturalWidth', { value: 0 });
    B.settleThumbs(document.getElementById('l'));
    expect(a.classList.contains('is-in')).toBe(true);
    expect(b.classList.contains('is-in')).toBe(false);
    B.bridgeThumbIn(b);
    expect(b.classList.contains('is-in')).toBe(true);
  });

  it('both lists of pictures wear it, and the fade is only where motion is welcome', () => {
    expect(read('js/console/bridge.js')).toMatch(/onload="bridgeThumbIn\(this\)" onerror="bridgeThumbFailed\(this\)"/);
    expect(read('js/console/bridge.js')).toMatch(/paintHTML\(\$\('br-front'\)[^\n]*\n\s*settleThumbs\(\$\('br-front'\)\);/);
    expect(read('js/console/capture.js')).toMatch(/onload="bridgeThumbIn\(this\)" onerror="bridgeThumbFailed\(this\)"/);
    expect(read('js/console/capture.js')).toMatch(/list\.innerHTML = html; settleThumbs\(list\);/);
    expect(CSS).toMatch(/img\.br-thumb:not\(\.is-in\) \{ opacity: 0; \}/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*img\.br-thumb \{ transition: opacity var\(--dur-3\) var\(--ease-out\); \}/);
    expect(CSS).toMatch(/\.br-cite\.is-provisional \.br-thumb\.is-in \{ opacity: 0\.7; \}/);
  });
});
