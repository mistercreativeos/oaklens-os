// @vitest-environment happy-dom
//
// K72 (2026-10-06, the owner's notes from the desk): a key pressed again
// goes home; the storage gauge is a bank of tubes that heats with the
// ignition; the clock is a light source; the spark's status lights when it
// updates, and its row's name lights when there are words in it.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
const BODY = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
const CSS = readFileSync(join(ROOT, 'css/field-console.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a top-row key, pressed again, goes back to the Bridge', () => {
  it('Pulse up: its key returns to the Bridge; elsewhere it opens Pulse; the Bridge key stays home', async () => {
    vi.resetModules();
    document.body.innerHTML = BODY;
    const chrome = await import('../js/console/chrome.js');
    const active = () => document.querySelector('.view.active')?.id;
    chrome.showView('pulse');
    expect(active()).toBe('view-pulse');
    chrome.topbarKey('pulse');
    expect(active()).toBe('view-bridge');
    chrome.topbarKey('pulse');
    expect(active()).toBe('view-pulse');
    chrome.topbarKey('bridge');
    expect(active()).toBe('view-bridge');
    chrome.topbarKey('bridge');
    expect(active()).toBe('view-bridge');
    expect(document.getElementById('pulse-topbar-btn').getAttribute('aria-pressed')).toBe('false');
    expect(html).toMatch(/id="bridge-topbar-btn"[^>]*onclick="topbarKey\('bridge'\)"/);
  });

  it('a key cools at the bar\'s small pool, not only while it is on', () => {
    expect(CSS).toMatch(/\.topbar :is\(\.settings-btn, \.sidebar-toggle, \.publish-btn\) \{ --lit-level: 0\.15; \}/);
    expect(CSS).not.toMatch(/\.topbar \[data-lit\] \{ --lit-level/);
  });
});

describe('the storage gauge is a bank of tubes', () => {
  it('lights a tube per twentieth in use, any use lights one, and past the tier all are lit', async () => {
    vi.resetModules();
    document.body.innerHTML = BODY;
    const B = await import('../js/console/bridge.js');
    expect(B.GAUGE_TUBES).toBe(20);
    expect(B.gaugeLit(0)).toBe(0);
    expect(B.gaugeLit(0.001)).toBe(1);
    expect(B.gaugeLit(0.12)).toBe(3);
    expect(B.gaugeLit(0.5)).toBe(10);
    expect(B.gaugeLit(1)).toBe(20);
    expect(B.gaugeLit(1.4)).toBe(20);
  });

  it('is still the meter, with its numbers and words on its element', () => {
    const src = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    expect(src).toMatch(/role="meter" aria-valuemin="0" aria-valuemax="\$\{room\.free\}" aria-valuenow="\$\{room\.used\}" aria-valuetext="\$\{escapeHTML\(valueText\)\}" aria-label="Storage used">\$\{gaugeTubes\(room\.share\)\}<\/div>/);
    expect(src).toMatch(/<span class="br-tubes" aria-hidden="true">/);
  });

  // K75: the heat in order became the tachometer's sweep; K77: on the
  // ignition's clock, in bridge.js (console-bridge-k75).
  it('heats with the ignition, and not under reduced motion', () => {
    const src = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    expect(src).toMatch(/if \(_sweeping \|\| !document\.documentElement\.hasAttribute\('data-ignition'\)\) return;/);
  });
});

describe('the clock is a light source', () => {
  it('is backlit glass in its own phosphor, off on paper', () => {
    expect(html).toMatch(/<div class="br-clock" id="br-clock" data-backlit><\/div>/);
    expect(CSS).toMatch(/#view-bridge \.br-clock \{[^}]*--lit-rgb: var\(--vfd-rgb\);[^}]*--backlight: [\d.]+;/);
    expect(CSS).toMatch(/:root\[data-theme="light"\] #view-bridge \.br-clock \{ --backlight: 0; \}/);
  });
});

describe('the spark lights', () => {
  it('its row\'s name burns while the field holds words', () => {
    expect(html).toMatch(/<h2 class="br-h br-h--lead" data-text="live">/);
    expect(CSS).toMatch(/\.br-intake:has\(\.br-spark-input:not\(:placeholder-shown\)\) \.br-h--lead,[^{]*\{ --text-emit: var\(--text-hot\); \}/);
  });

  it('its status flares when a save lands', async () => {
    vi.resetModules();
    document.body.innerHTML = BODY;
    vi.useFakeTimers();
    try {
      const cap = await import('../js/console/capture.js');
      const field = document.getElementById('br-spark');
      const said = document.getElementById('br-spark-said');
      field.value = 'a thought';
      cap.sparkInput();
      expect(said.hasAttribute('data-flare')).toBe(false);
      vi.advanceTimersByTime(900);
      expect(said.textContent).toBe('kept · private');
      expect(said.hasAttribute('data-flare')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the fit pass runs only when a list changed', () => {
  it('keeps its last fit for the same lines at the same height, and fits afresh when they are repainted', async () => {
    vi.resetModules();
    document.body.innerHTML = BODY;
    const B = await import('../js/console/bridge.js');
    const ol = document.createElement('ol');
    const paint = (n) => { ol.innerHTML = Array.from({ length: n }, (_, i) => `<li class="br-item">line ${i + 1}</li>`).join(''); };
    let reads = 0;
    Object.defineProperty(ol, 'clientHeight', { get: () => 100 });
    Object.defineProperty(ol, 'scrollHeight', { get: () => { reads++; return [...ol.children].filter((li) => !li.hidden).length * 30; } });
    paint(5);
    expect(B._bridgeFit(ol)).toBe(3);
    const before = reads;
    expect(B._bridgeFit(ol)).toBe(3);
    expect(reads).toBe(before);   // untouched: no layout read, no DOM write
    paint(6);
    expect(B._bridgeFit(ol)).toBe(4);
    expect(reads).toBeGreaterThan(before);
  });
});
