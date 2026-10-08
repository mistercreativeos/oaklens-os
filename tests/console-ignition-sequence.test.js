// @vitest-environment happy-dom
//
// THE IGNITION SEQUENCE (K41b, 2026-09-26) — the console's cold start.
//
// The owner: "an ignition sequence for the first load of the console that
// includes the organic breathing … a restrained rhythm and the interface
// elements glowing hot and cooling down … paying attention to the physics …
// and then we keep what we have already and the interface in practice is
// still just the SYS lamp."
//
// What must stay true: the sequence is BOUNDED (one root attribute set, one
// removed, nothing loops); it is off under reduced motion, off where the
// registered property it rides on is missing, off in a hidden tab, and runs
// once per session; the light comes up on the console's own two curves and
// overshoots before it settles; the bay's breath is damped and ends dark;
// the engine keeps its frames only while the root says so; and on paper
// nothing ignites.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const INIT = readFileSync(join(process.cwd(), 'js', 'console', 'init.js'), 'utf8');
const LIGHTING = readFileSync(join(process.cwd(), 'js', 'console', 'lighting.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The seam's derived tokens are declared on every seam host and, since
// 2026-10-02, on the planes (modals and sheets), which resolve them too.
const SEAM_HOSTS = '\\[data-seam\\], \\[data-tier\\],\\n\\.modal-overlay \\.modal, \\.sheet-overlay \\.sheet, \\.sheet-overlay \\.welcome';
const rule = (sel) => {
  const m = RULES.match(new RegExp(`(?:^|\\n)${sel}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${sel}`);
  return m[1];
};
const keyframes = (name) => {
  const m = RULES.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`no keyframes ${name}`);
  return m[1];
};
const studio = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf(':root[data-theme="light"]'));
// A pair is written with its named curve since K50 (`1.5s var(--ease-heat)`);
// the engine reads the substituted value, so resolve it the same way here.
const curve = (name) => {
  const m = studio.match(new RegExp(`${name}:\\s*([\\d.]+)s (cubic-bezier\\([^)]*\\)|var\\(--ease-[a-z]+\\))`));
  let bez = m[2];
  const v = bez.match(/^var\((--ease-[a-z]+)\)$/);
  if (v) bez = studio.match(new RegExp(`${v[1]}:\\s*(cubic-bezier\\([^)]*\\))`))[1];
  return { s: Number(m[1]), bez };
};

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });
const { igniteConsole, IGNITE_DUR_MS, IGNITE_HOLD_MS, IGNITE_ROW_AT_MS, IGNITE_ROW_HOT_MS } = await import('../js/console-ui.js');
const CHROME = await import('../js/console/chrome.js');
const CHROME_SRC = readFileSync(join(process.cwd(), 'js', 'console', 'chrome.js'), 'utf8');
const HTML = readFileSync(join(process.cwd(), 'dev', 'field-console.html'), 'utf8');

// ------------------------------------------------------------- the stylesheet

describe('the ignition is one dial for the whole room (K41b; one curve since K64)', () => {
  // The owner, 2026-10-06: "a simple, smooth, ramp/heat up from oled black
  // from the background light sources, and rubber banding back down to its
  // resting state." One registered number on the root, one curve.
  // K78: the curve and its clock are chrome.js's. The stylesheet animated a
  // registered number on <html> and another on .main, and WebKit restyled
  // and repainted the whole page for them every frame (Safari: 15 fps).
  it('animates nothing on the root or the pane: no registered room numbers, no room keyframes', () => {
    expect(RULES).not.toMatch(/@property --ignite\b|@property --floor\b/);
    expect(RULES).not.toMatch(/room-ignite|floor-ignite/);
    expect(RULES).not.toMatch(/:root\[data-ignition\]\s*\{[^}]*animation/);
  });

  it('the seam\'s derived tokens stay still; the engine spends the dial on the light', () => {
    const host = rule(SEAM_HOSTS);
    // A box-shadow that moves every frame repaints the whole panel every
    // frame (K50c, the phone's freeze), so the glass's edge never carries it.
    expect(host).toMatch(/--seam-halo:\s*calc\(var\(--seam-halo-a\) \* var\(--seam-halo-k, 1\)\);/);
    expect(host).not.toMatch(/--ignite/);
    for (const g of ['--glass-lip', '--glass-edge']) {
      expect(host, g).toMatch(new RegExp(`${g}:[^;]*var\\(--seam-halo\\)`));
    }
    // K78: the pools are drawn at rest; the room is the canvases' opacity.
    expect(LIGHTING).toMatch(/const seamLevel = \(el\) => dial\(el, '--seam-level'\);/);
    const rootBlock = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')));
    expect(rootBlock).toMatch(/--seam-level:/);
  });

  it('heats from black on the heat curve, crests, and rubber-bands to rest on the cool curve', () => {
    const heat = curve('--arm-heat');
    const { IGNITE_CURVE, IGNITE_CREST, igniteLevel, bezier } = CHROME;
    expect(IGNITE_CURVE).toHaveLength(4);
    const [black, crest, dip, rest] = IGNITE_CURVE;
    expect(black).toEqual([0, 0]);                 // OLED black
    expect(crest[1]).toBeGreaterThan(1);           // the heat overshoots…
    expect(crest[1]).toBeLessThanOrEqual(2);       // …under the engine's ceiling
    expect(dip[1]).toBeLessThan(1);                // the rubber band: down past rest
    expect(rest).toEqual([1, 1]);
    expect(IGNITE_CREST).toBe(Math.max(...IGNITE_CURVE.map((x) => x[1])));
    // The heat is the console's heat, in its own time; the rest is the cool.
    expect(crest[0] * IGNITE_DUR_MS).toBeCloseTo(heat.s * 1000, 5);
    expect(CHROME_SRC).toMatch(/const heatCurve = easeToken\('--ease-heat'\), coolCurve = easeToken\('--ease-cool'\);/);
    const parse = (name) => studio.match(new RegExp(`${name}:\\s*cubic-bezier\\(([^)]*)\\)`))[1].split(',').map(Number);
    const h = bezier(...parse('--ease-heat')), c = bezier(...parse('--ease-cool'));
    expect(igniteLevel(0, h, c)).toBe(0);
    expect(igniteLevel(crest[0] * IGNITE_DUR_MS, h, c)).toBeCloseTo(crest[1], 6);
    expect(igniteLevel(dip[0] * IGNITE_DUR_MS, h, c)).toBeCloseTo(dip[1], 6);
    expect(igniteLevel(IGNITE_DUR_MS, h, c)).toBe(1);
    expect(igniteLevel(IGNITE_DUR_MS + 500, h, c)).toBe(1);
    // The heat rises the whole way, and the eye sees little at the start.
    let was = -1;
    for (let t = 0; t <= crest[0] * IGNITE_DUR_MS; t += 50) { const v = igniteLevel(t, h, c); expect(v).toBeGreaterThanOrEqual(was); was = v; }
    expect(igniteLevel(0.1 * crest[0] * IGNITE_DUR_MS, h, c)).toBeLessThan(0.05);
  });

  it('the Bridge\'s floor light is a layer of its own, drawn at the crest and faded by opacity alone', () => {
    const floor = rule('\\.room-floor');
    expect(floor).toMatch(new RegExp(`--floor-crest: ${CHROME.IGNITE_CREST};`));
    expect(floor).toMatch(/calc\(0\.24 \* var\(--floor-crest\)\)/);
    expect(floor).toMatch(/position: absolute;\s*grid-area: 1 \/ -2 \/ 2 \/ -1;\s*inset: 0;\s*pointer-events: none;/);
    expect(floor).toMatch(/opacity: 0;/);   // dark off the Bridge (K79: it fades with the crossfade)
    expect(rule('\\.layout:has\\(> \\.main > #view-bridge\\.active\\) > \\.room-floor')).toMatch(/opacity: calc\(1 \/ var\(--floor-crest\)\);/);
    expect(rule(':root\\[data-ignition\\] \\.room-floor')).toMatch(/will-change: opacity;/);
    expect(HTML).toMatch(/<div class="layout">\s*<!--[\s\S]*?-->\s*<div class="room-floor" aria-hidden="true"><\/div>/);
    // Nothing the scroller paints moves with the cold start any more.
    expect(RULES).not.toMatch(/\.main:has\(> #view-bridge\.active\)\s*\{[^}]*background/);
  });

  it('the sweep from the fed corner and the bay\'s breaths are gone: one shape, one code path', () => {
    expect(RULES).not.toMatch(/seam-ignite|bay-breathe|--ignite-at|--ignite-breath/);
  });

  it('on paper the seam is a printed rule with no dial', () => {
    const paper = rule(':root\\[data-theme="light"\\] \\[data-seam\\], :root\\[data-theme="light"\\] \\[data-tier\\]');
    expect(paper).toMatch(/--seam-rim:\s*var\(--line-2\)/);
    expect(paper).not.toMatch(/--ignite/);
  });
});

// ------------------------------------------------------------- the orchestrator

describe('igniteConsole() decides whether it runs, and lights the keys at the crest', () => {
  let rects;
  beforeEach(() => {
    vi.useFakeTimers();
    rects = new Map();
    sessionStorage.clear();
    document.documentElement.removeAttribute('data-ignition');
    document.body.innerHTML = `
      <header id="bar" class="topbar" data-seam="bottom">
        <button id="b1"></button><button class="sys-lamp" id="lamp"></button><button id="b2"></button><button id="b3"></button><button id="off"></button>
      </header>`;
    for (const id of ['b1', 'lamp', 'b2', 'b3']) rects.set(document.getElementById(id), { left: 10, top: 10, width: 30, height: 30 });
    Element.prototype.getBoundingClientRect = function () {
      return rects.get(this) || { left: 0, top: 0, width: 0, height: 0 };
    };
    globalThis.CSS = { registerProperty() {} };
    window.matchMedia = () => ({ matches: false, addEventListener() {} });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  // K77: the clock starts on the first frame the page is drawn in, as the
  // CSS curve does; nothing counts down before it.
  // K77: one clock, kept by the frames: each adds the time since the last;
  // K78: a gap past IGNITE_STALL_MS counts as one frame, so a stall freezes
  // the sequence and a slow page still keeps its time.
  let frame = null, clock = 0;
  const drawn = (ms, step = 16) => { for (let t = 0; t < ms && frame; t += step) { const f = frame; frame = null; clock += step; f(clock); } };
  const firstFrame = () => drawn(16);
  beforeEach(() => { frame = null; clock = 0; vi.stubGlobal('requestAnimationFrame', (cb) => { frame = cb; return 1; }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('marks the root for the length of the curve, then lets go, once per session', () => {
    const timer = igniteConsole();
    expect(timer).not.toBe(0);
    const root = document.documentElement;
    expect(root.hasAttribute('data-ignition')).toBe(true);
    vi.advanceTimersByTime(IGNITE_HOLD_MS + 500);   // no frame drawn: no time has passed
    expect(root.hasAttribute('data-ignition')).toBe(true);
    firstFrame();
    drawn(IGNITE_HOLD_MS - 64);
    expect(root.hasAttribute('data-ignition')).toBe(true);
    drawn(200);
    expect(root.hasAttribute('data-ignition')).toBe(false);
    expect(igniteConsole()).toBe(0);
    expect(root.hasAttribute('data-ignition')).toBe(false);
  });

  it('a stall freezes it: a long gap between frames counts as one frame', async () => {
    const { ignitionTime, IGNITE_FRAME_MS } = await import('../js/console/chrome.js');
    igniteConsole();
    firstFrame();
    const before = ignitionTime();
    drawn(1500, 1500);   // one frame after a 1.5s stall
    expect(ignitionTime() - before).toBeCloseTo(IGNITE_FRAME_MS, 6);
    expect(document.getElementById('b1').getAttribute('data-heat')).toBeNull();   // not at the crest
  });

  it('a slow page keeps the sequence\'s time: a 65 ms frame is 65 ms of it (K78: Safari played it in slow motion)', async () => {
    const { ignitionTime, IGNITE_STALL_MS } = await import('../js/console/chrome.js');
    expect(IGNITE_STALL_MS).toBeGreaterThan(65);
    igniteConsole();
    firstFrame();
    const before = ignitionTime();
    drawn(650, 65);
    expect(ignitionTime() - before).toBe(650);
  });

  it('the room\'s level runs from black to the crest and back on the clock; the floor takes it as opacity, then lets go', async () => {
    const { ignitionLevel, IGNITE_CREST } = await import('../js/console/chrome.js');
    document.body.insertAdjacentHTML('beforeend', '<div class="room-floor"></div>');
    const floor = document.querySelector('.room-floor');
    igniteConsole();
    expect(ignitionLevel()).toBe(0);
    expect(floor.style.opacity).toBe('0');
    firstFrame();
    drawn(IGNITE_ROW_AT_MS - 16);
    expect(ignitionLevel()).toBeGreaterThan(1.1);
    expect(Number(floor.style.opacity)).toBeCloseTo(ignitionLevel() / IGNITE_CREST, 6);
    drawn(IGNITE_HOLD_MS);
    expect(document.documentElement.hasAttribute('data-ignition')).toBe(false);
    expect(ignitionLevel()).toBe(1);
    expect(floor.style.opacity).toBe('');
  });

  it('holds the root at least as long as the curve, so the engine follows it to rest', () => {
    expect(IGNITE_HOLD_MS).toBeGreaterThanOrEqual(IGNITE_DUR_MS);
  });

  it('lights the top row together at the crest, hot then cooling, never the lamp', () => {
    igniteConsole();
    firstFrame();
    const heatOf = (id) => document.getElementById(id).getAttribute('data-heat');
    drawn(IGNITE_ROW_AT_MS - 32);
    expect(heatOf('b1')).toBeNull();
    drawn(32);
    for (const id of ['b1', 'b2', 'b3']) expect(heatOf(id), id).toBe('hot');
    // The lamp owns the heartbeat; a hidden control is skipped.
    expect(heatOf('lamp')).toBeNull();
    expect(heatOf('off')).toBeNull();
    drawn(IGNITE_ROW_HOT_MS);
    for (const id of ['b1', 'b2', 'b3']) expect(heatOf(id), id).toBe('');
    vi.advanceTimersByTime(3000);
    for (const id of ['b1', 'b2', 'b3']) expect(heatOf(id), id).toBeNull();
    // The crest is where the heat ends.
    expect(IGNITE_ROW_AT_MS).toBe(curve('--arm-heat').s * 1000);
  });

  it('does not run under reduced motion, without @property, in a hidden tab — and force overrides only the gates', () => {
    window.matchMedia = () => ({ matches: true, addEventListener() {} });
    expect(igniteConsole()).toBe(0);
    window.matchMedia = () => ({ matches: false, addEventListener() {} });
    globalThis.CSS = {};
    expect(igniteConsole()).toBe(0);
    globalThis.CSS = { registerProperty() {} };
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    expect(igniteConsole()).toBe(0);
    expect(document.documentElement.hasAttribute('data-ignition')).toBe(false);
    expect(igniteConsole({ force: true })).not.toBe(0);
    expect(document.documentElement.hasAttribute('data-ignition')).toBe(true);
  });

  it('is called once at boot, after the start view and its resting lamp are seated', () => {
    const seat = INIT.indexOf('seatView(start);');
    const call = INIT.indexOf('igniteConsole();');
    expect(seat).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(seat);
  });
});

// ------------------------------------------------------------------ the engine

describe('the engine reads the room\'s dial once a frame and spends it on every light', () => {
  it('reads chrome\'s level, handed in by init, while the ignition runs, clamped to a ceiling above 1 so the crest can overshoot', () => {
    expect(LIGHTING).toMatch(/const IGNITE_CEIL = 2;/);
    expect(LIGHTING).not.toMatch(/getPropertyValue\('--ignite'\)/);
    expect(LIGHTING).toMatch(/if \(!igniting\(\) \|\| !roomSource\) return 1;/);
    expect(LIGHTING).toMatch(/export function lightingInit\(\{ room: level \} = \{\}\) \{\s*if \(typeof level === 'function'\) roomSource = level;/);
    expect(INIT).toMatch(/lightingInit\(\{ room: ignitionLevel \}\);/);
  });

  it('the canvases come up from black with it, and the seams carry its crest and dip', () => {
    expect(LIGHTING).toMatch(/const v = \(L\.expo \? L\.expo\.level : 1\) \* Math\.min\(1, room\);/);
    expect(LIGHTING).toMatch(/canvas\.style\.opacity = o;/);
    expect(LIGHTING).toMatch(/room = roomIgnite\(\);\s*if \(room !== was\) applyRoom\(\);/);
  });

  it('keeps its frames while the root says the ignition is running, and watches the attribute come off', () => {
    expect(LIGHTING).toMatch(/inFlight = movingLit \|\| movingSeam \|\| movingExpo \|\| \(gain > 0 && \(igniting\(\) \|\| dialing\(\)\)\);/);
    expect(LIGHTING).toMatch(/attributeFilter: \['data-theme', 'data-ignition'\]/);
  });
});

describe('the ignition dial stays on the element that animates it (K56)', () => {
  it('nothing in the stylesheet reads --ignite', () => {
    expect(RULES).not.toMatch(/var\(--ignite\)/);
  });
});
