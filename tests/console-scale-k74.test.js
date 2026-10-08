// @vitest-environment happy-dom
//
// K74 (2026-10-06): the console on a large screen at 1×, and the split-flap in
// Safari. The owner, at 2560 × 1664: half the screen stood empty and the type
// was a laptop's; and the headline's flip "is buttery smooth in chrome and
// confirmed choppy on safari desktop and ipad".
//
// - The page's boot script zooms the whole console in steps, so a large
//   screen lays out like a desk of at least 1500 × 880 (every breakpoint is
//   under that, so each answers as it does on the desk). A touch screen stays
//   at 1×; Settings › Display scale can hold a desk there too.
// - Under a zoom a viewport unit counts twice (both engines) and a container
//   unit counts twice in WebKit; the sheet writes them through tokens that
//   take it back out. Measured in Chrome 154 and Playwright WebKit (2359).
// - A rect, the window and a pointer come back zoomed; a style is written in
//   the page's own px. The light engine and the help overlay convert.
// - The flip: the light engine repainted its whole canvas for every turned
//   letter (229 repaints in four flips). WebKit draws that canvas on the CPU:
//   12–16 dropped frames a flip, 2.1 s of frame callbacks, against 1–2 and
//   31 ms once a turning letter says it stands still (data-light-still).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
const RAW = readFileSync(join(ROOT, 'css/field-console.css'), 'utf8');
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const boot = html.split('<script>')[1].split('</script>')[0];

afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  document.documentElement.removeAttribute('style');
  try { localStorage.clear(); } catch { /* none */ }
});

/** Run the page's boot script at a window size and pointer. */
function bootAt(w, h, { fine = true } = {}) {
  document.documentElement.removeAttribute('style');
  vi.stubGlobal('innerWidth', w);
  vi.stubGlobal('innerHeight', h);
  vi.stubGlobal('matchMedia', (q) => ({ matches: q === '(pointer: fine)' ? fine : false, addEventListener() {} }));
  new Function(boot)();
  return document.documentElement.style;
}

describe('a large screen at 1× zooms the whole console', () => {
  it('to keep a desk of 1500 × 880, in steps of 0.05, from ×1.1', () => {
    expect(bootAt(2560, 1540).zoom).toBe('1.7');        // the owner's screen, full
    expect(bootAt(1920, 970).zoom).toBe('1.1');         // 1080p, a window
    expect(bootAt(3840, 2000).zoom).toBe('2.25');       // 4K at 1×
    expect(bootAt(1470, 860).zoom).toBe('');            // the MacBook: as it is
    expect(bootAt(1680, 950).zoom).toBe('');            // ×1.07 is not worth a zoom
    expect(bootAt(2560, 1540).getPropertyValue('--ui-zoom')).toBe('1.7');
  });

  it('never on a touch screen, and never when Settings holds it at 1×', () => {
    expect(bootAt(2732, 2048, { fine: false }).zoom).toBe('');
    localStorage.setItem('console_scale', '1');
    expect(bootAt(2560, 1540).zoom).toBe('');
  });

  it('re-decides on a resize, and leaves a way to ask again', () => {
    expect(boot).toMatch(/addEventListener\('resize', scale\);/);
    expect(boot).toMatch(/window\.consoleScale = scale;/);
  });

  it('measures once whether container units count the zoom twice (WebKit) and says so in --cq-zoom', () => {
    expect(boot).toMatch(/zoom:2;width:50px;container-type:inline-size/);
    expect(boot).toMatch(/cqTwice = p\.firstChild\.offsetWidth > 75;/);
    expect(boot).toMatch(/de\.style\.setProperty\('--cq-zoom', cqTwice \? String\(z\) : '1'\);/);
  });

  it('every breakpoint in the sheet sits under the desk the zoom keeps', () => {
    for (const m of CSS.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)) {
      expect(+m[3], m[0]).toBeLessThanOrEqual(m[2] === 'width' ? 1500 : 880);
    }
  });
});

describe('the sheet takes the zoom back out of its units', () => {
  it('no viewport or container unit is written bare, but the support test and a fill\'s vmax', () => {
    const tokens = CSS.match(/:root \{[^}]*--ui-zoom: 1;[^}]*\}/)[0];
    const rest = CSS.replace(tokens, '').replace(/@supports not \(height: 100dvh\)/, '');
    const bare = [...rest.matchAll(/(?<![\w.-])\d*\.?\d+(dvh|svh|lvh|vh|dvw|vw|vmin|cqi|cqw|cqh|cqb)\b/g)].map((m) => m[0]);
    expect(bare).toEqual([]);
    expect([...rest.matchAll(/(?<![\w.-])(\d*\.?\d+)vmax\b/g)].every((m) => /inset 0 0 0 100vmax/.test(rest.slice(m.index - 13, m.index + 7)))).toBe(true);
  });

  it('a viewport unit divides by the zoom, a container unit by what the boot measured', () => {
    for (const u of ['vh', 'dvh', 'vw']) expect(CSS).toMatch(new RegExp(`--u-${u}: calc\\(1${u} / var\\(--ui-zoom\\)\\);`));
    for (const u of ['cqi', 'cqw', 'cqh']) expect(CSS).toMatch(new RegExp(`--u-${u}: calc\\(1${u} / var\\(--cq-zoom\\)\\);`));
    expect(CSS).toMatch(/html, body \{ height: calc\(100 \* var\(--u-dvh\)\); \}/);
  });

  it('the Bridge is wide enough to fill a scaled pane', () => {
    expect(CSS).toMatch(/\.bridge \{\s*container-type: inline-size;\s*max-width: 1480px;/);
  });
});

describe('what measures, measures in the page\'s own px', () => {
  it('the light engine: rects and the window divided by the zoom, the device ratio multiplied', async () => {
    const { _lighting } = await import('../js/console/lighting.js');
    document.documentElement.style.zoom = '2';
    expect(_lighting.uiZoom()).toBe(2);
    expect(_lighting.unzoomed({ left: 20, top: 40, right: 220, bottom: 140, width: 200, height: 100, x: 20, y: 40 }))
      .toEqual({ left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50, x: 10, y: 20 });
    document.documentElement.style.zoom = '';
    const r = { left: 1 };
    expect(_lighting.unzoomed(r)).toBe(r);
    const L = read('js/console/lighting.js');
    expect(L).toMatch(/const w = Math\.max\(1, \(window\.innerWidth \|\| 0\) \/ z\);/);
    expect(L).toMatch(/const dpr = Math\.min\(2, \(window\.devicePixelRatio \|\| 1\) \* z\);/);
    expect(L).toMatch(/const r = unzoomed\(el\.getBoundingClientRect\(\)\);/);
    expect(L).toMatch(/const hr = unzoomed\(host\.getBoundingClientRect\(\)\);/);
    expect(L.match(/getBoundingClientRect\(\)/g)).toHaveLength(3);   // each one unzoomed
    expect(L.match(/unzoomed\([a-z]+\.getBoundingClientRect\(\)\)/g)).toHaveLength(3);
  });

  it('the help overlay reads every rect and the window through its unzoomed helpers', () => {
    const H = read('js/console/help.js');
    expect(H.match(/\.getBoundingClientRect\(\)/g)).toHaveLength(1);   // inside _rect
    expect(H).toMatch(/const r = el\.getBoundingClientRect\(\), z = _zoom\(\);/);
    expect(H.match(/window\.inner(Width|Height)/g)).toHaveLength(2);    // inside _vw, _vh
  });

  it('the flip holds a turning letter at its width in the page\'s px; the focal point reads the pointer in them', () => {
    expect(read('js/console/flap.js')).toMatch(/cell\.getBoundingClientRect\(\)\.width \/ z\)/);
    expect(read('js/console/focal.js')).toMatch(/\(\(e\.clientX - box\.left\) \/ z - r\.x\)/);
  });
});

describe('the flip turns without repainting the light for every letter', () => {
  it('a change inside a part that stands still moves no light; a licence, or anything else, does', async () => {
    const { _lighting } = await import('../js/console/lighting.js');
    document.body.innerHTML = '<h1><span><span class="flap" data-light-still>A</span></span></h1><p>x</p>';
    const cell = document.querySelector('.flap');
    const text = cell.firstChild;
    expect(_lighting.STILL_ATTR).toBe('data-light-still');
    expect(_lighting.movesLight({ type: 'childList', target: cell })).toBe(false);
    expect(_lighting.movesLight({ type: 'characterData', target: text })).toBe(false);
    expect(_lighting.movesLight({ type: 'childList', target: document.querySelector('h1') })).toBe(true);
    expect(_lighting.movesLight({ type: 'childList', target: document.querySelector('p') })).toBe(true);
    expect(_lighting.movesLight({ type: 'attributes', target: cell })).toBe(true);
    expect(read('js/console/lighting.js')).toMatch(/new MutationObserver\(\(records\) => \{ if \(records\.some\(movesLight\)\) lightingRepaint\(\); \}\)/);
  });

  it('a turning letter says so, and stops saying so when it has landed', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
      document.body.innerHTML = '<h1 id="h"></h1>';
      const { flapTo } = await import('../js/console/flap.js');
      const h = document.getElementById('h');
      flapTo(h, 'NOTHING WAITING', { animate: false });
      flapTo(h, 'SIGNED OUT');
      const turning = () => h.querySelectorAll('.flap[data-light-still]').length;
      expect(turning()).toBeGreaterThan(0);
      vi.advanceTimersByTime(5000);
      expect(turning()).toBe(0);
      expect(h.textContent.replace(/\s+/g, ' ').trim()).toBe('SIGNED OUT');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Settings › Display scale', () => {
  it('Auto or 1×, per device, and asks the boot to decide again', async () => {
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
    document.body.innerHTML = body;
    const chrome = await import('../js/console/chrome.js');
    const again = vi.fn();
    vi.stubGlobal('consoleScale', again);
    document.documentElement.style.zoom = '1.7';
    chrome.applyScale();
    expect(document.getElementById('settings-fold-scale').textContent).toBe('Auto · ×1.7');
    chrome.scaleSet('1');
    expect(localStorage.getItem('console_scale')).toBe('1');
    expect(again).toHaveBeenCalled();
    expect(document.querySelector('[data-scale-choice="1"]').getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById('settings-fold-scale').textContent).toBe('1×');
    chrome.scaleSet('auto');
    expect(localStorage.getItem('console_scale')).toBeNull();
  });
});
