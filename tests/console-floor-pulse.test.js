// @vitest-environment happy-dom
// THE FLOOR AND THE PULSE (K51, 2026-10-04 — the owner, on the iPad and the
// phone, on the first emissive tab bar): the bar's translucency shifted
// during every surface switch; it read loud, floaty and stroked; and a tap
// should send "a light pulse emitted outward, left and right, end to end
// across the bar from the point of the button".
//   • the floor is its own layer in the View Transition: no old picture, no
//     animation, and the hand is never held up by the crossfade;
//   • the pulse's physics (chrome.js pulseFront / pulseArrival) — one
//     launch, friction, decay, every wall reached;
//   • tabPulse() builds the light the stylesheet dresses, and nothing when
//     the dial is 0 (paper, reduced motion).
// The slab itself (opaque, feathered, wells hotter than the floor) is pinned
// in tests/console-touch-polish.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PULSE, pulseArrival, pulseFront, tabPulse, _initTabPulse, whenDrawing } from '../js/console/chrome.js';

const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const INIT = readFileSync(join(process.cwd(), 'js', 'console', 'init.js'), 'utf8');
const rule = (sel) => (RULES.match(new RegExp(`\\n${sel} \\{([^}]*)\\}`)) || [])[1];

describe('the floor stays still while the surfaces crossfade', () => {
  it('the bar is its own transition layer, drawn live: no old picture and no animation', () => {
    expect(rule('\\.tabbar')).toMatch(/view-transition-name: console-floor;/);
    expect(RULES).toMatch(/::view-transition-group\(console-floor\),\s*::view-transition-new\(console-floor\) \{ animation: none; \}/);
    expect(RULES).toMatch(/::view-transition-old\(console-floor\) \{ display: none; \}/);
  });
  it('a layer is drawn in isolation, so the bar must not sample a backdrop', () => {
    expect(rule('\\.tabbar')).not.toMatch(/backdrop-filter/);
    // …including the no-blur fallback, which used to name the bar.
    expect(RULES).not.toMatch(/\.tabbar, \.sheet \{ background: var\(--surface-1\); \}/);
  });
  it('a tap during the crossfade reaches the page', () => {
    expect(RULES).toMatch(/::view-transition \{ pointer-events: none; \}/);
  });
  it('a tab key\'s press draws no edges and does not dim its own light (K52)', () => {
    expect(RULES).toMatch(/\.tab-btn\.tab-btn:active \{ box-shadow: none; opacity: 1; \}/);
  });
});

describe('the pulse\'s physics', () => {
  const W = 1000, x0 = 700;
  const L = Math.max(x0, W - x0) * PULSE.REACH;
  const xOf = (f) => Number(f.transform.match(/translateX\((-?[\d.]+)px\)/)[1]);

  it('reaches every wall: the launch carries the far front past its wall', () => {
    expect(PULSE.REACH).toBeGreaterThan(1);
    expect(Number.isFinite(pulseArrival(x0, L))).toBe(true);
    expect(pulseArrival(L, L)).toBe(Infinity);
  });
  it('slows as it travels: equal distances take longer the further out', () => {
    const a = pulseArrival(200, L), b = pulseArrival(400, L) - a, c = pulseArrival(600, L) - pulseArrival(400, L);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
  it('a front leaves the key, runs one way, and is out by its last frame', () => {
    for (const [dir, d] of [[-1, x0], [1, W - x0]]) {
      const f = pulseFront(x0, d, dir, L);
      expect(f.frames[0].opacity).toBe(0);
      expect(xOf(f.frames[0])).toBeCloseTo(x0, 5);
      const xs = f.frames.map(xOf);
      for (let i = 1; i < xs.length; i++) expect(dir * (xs[i] - xs[i - 1])).toBeGreaterThan(0);
      expect(f.frames.at(-1).opacity).toBe(0);
      // It meets the wall at wallMs, and the fade runs past it.
      expect(f.ms).toBeCloseTo(f.wallMs + PULSE.FADE * 1000, 5);
      expect(dir * (xs.at(-1) - x0)).toBeGreaterThanOrEqual(d - 0.5);
      // Mirrored, not a second drawing: the left front is the right one flipped.
      expect(f.frames[3].transform).toMatch(dir < 0 ? /scaleX\(-/ : /scaleX\(\d/);
    }
  });
  it('the near wall is struck first and brighter, the far one later and dimmer', () => {
    const near = pulseFront(x0, W - x0, 1, L), far = pulseFront(x0, x0, -1, L);
    expect(near.wallMs).toBeLessThan(far.wallMs);
    expect(near.atWall).toBeGreaterThan(far.atWall);
    expect(far.atWall).toBeGreaterThan(0);
  });
  it('brightness never exceeds the dial, and scales with it', () => {
    const full = pulseFront(x0, x0, -1, L, 1), half = pulseFront(x0, x0, -1, L, 0.5);
    for (const f of full.frames) expect(f.opacity).toBeLessThanOrEqual(1);
    expect(half.atWall).toBeCloseTo(full.atWall / 2, 5);
  });
});

describe('tabPulse() — the light on the floor', () => {
  let calls;
  const rect = (el, left, width) => { el.getBoundingClientRect = () => ({ left, width, top: 700, height: 56, right: left + width, bottom: 756, x: left, y: 700 }); };
  beforeEach(() => {
    calls = [];
    Element.prototype.animate = function (frames, opts) {
      calls.push({ el: this, frames, opts });
      return { finished: new Promise(() => {}), cancel() {} };
    };
    document.body.innerHTML = `<nav class="tabbar" style="--tab-pulse: 1">
      <button class="tab-btn" data-view="buffer"></button>
      <button class="tab-btn" data-view="fn"></button>
      <button class="tab-btn" data-view="archive"></button>
      <button class="tab-btn" data-view="publish"></button>
      <button class="tab-btn" id="tab-more-btn"></button></nav>`;
    const bar = document.querySelector('.tabbar');
    rect(bar, 0, 1000);
    document.querySelectorAll('.tab-btn').forEach((b, i) => rect(b, i * 200, 200));
  });
  afterEach(() => { delete Element.prototype.animate; document.body.innerHTML = ''; });

  it('init gives every key a catch-light; the press is the key\'s own light and the wave leaves on the click (K52b)', () => {
    _initTabPulse();
    expect(document.querySelectorAll('.tab-btn > .tab-catch').length).toBe(5);
    const key = document.querySelector('[data-view="publish"]');
    key.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(document.querySelectorAll('.tabbar-pulse .tp-front').length).toBe(0);
    key.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelectorAll('.tabbar-pulse .tp-front').length).toBe(2);
    expect(INIT).toMatch(/_initTabPulse\(\);/);
  });
  it('a switch freezes the page, and the wave waits for it to draw again (K52b)', async () => {
    const CHROME = readFileSync(join(process.cwd(), 'js', 'console', 'chrome.js'), 'utf8');
    // The switch records when drawing resumes, and the wave is launched through it.
    expect(CHROME).toMatch(/const vt = document\.startViewTransition\(\(\) => swap\(true\)\);[\s\S]{0,200}const resumed = vt\.ready\.catch\(\(\) => \{\}\);\s*_drawing = resumed;/);
    expect(CHROME).toMatch(/whenDrawing\(\(\) => tabPulse\(bar, key\)\)/);
    // With no switch in flight it runs at once.
    let ran = 0;
    whenDrawing(() => { ran++; });
    expect(ran).toBe(1);
  });
  it('a strike is a flash, a front and a wall each way, and every key catching it', () => {
    _initTabPulse();
    tabPulse(document.querySelector('.tabbar'), document.querySelector('[data-view="publish"]'));
    const layer = document.querySelector('.tabbar > .tabbar-pulse');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.querySelectorAll('.tp-flash').length).toBe(1);
    expect(layer.querySelectorAll('.tp-front').length).toBe(2);
    expect(layer.querySelectorAll('.tp-kiss--left, .tp-kiss--right').length).toBe(2);
    const catches = calls.filter((c) => c.el.classList.contains('tab-catch'));
    expect(catches.length).toBe(5);
    // The struck key first; the others as the wave arrives, the further the later.
    const delay = (v) => catches.find((c) => c.el.parentElement.dataset.view === v).opts.delay;
    expect(delay('publish')).toBe(0);
    expect(delay('fn')).toBeGreaterThan(delay('archive'));
    expect(delay('buffer')).toBeGreaterThan(delay('fn'));
    // Compositor work only.
    for (const c of calls) for (const f of c.frames) for (const k of Object.keys(f)) expect(['offset', 'opacity', 'transform']).toContain(k);
  });
  it('keeps at most PULSE.LIVE pulses on the floor', () => {
    const bar = document.querySelector('.tabbar'), key = document.querySelector('[data-view="fn"]');
    for (let i = 0; i < PULSE.LIVE + 3; i++) tabPulse(bar, key);
    expect(bar.querySelectorAll('.tp-group').length).toBe(PULSE.LIVE);
  });
  it('the dial at 0 (paper, reduced motion) draws nothing', () => {
    const bar = document.querySelector('.tabbar');
    bar.style.setProperty('--tab-pulse', '0');
    tabPulse(bar, document.querySelector('[data-view="fn"]'));
    expect(bar.querySelector('.tabbar-pulse')).toBe(null);
    expect(calls.length).toBe(0);
  });
  it('the stylesheet sets the dial: on in the Darkroom, off on paper and under reduced motion', () => {
    expect(RULES).toMatch(/\.tabbar \{ --tab-pulse: 1; \}/);
    expect(RULES).toMatch(/:root\[data-theme="light"\] \.tabbar \{ --tab-pulse: 0; \}/);
    expect(RULES).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.tabbar \{ --tab-pulse: 0; \} \}/);
  });
});
