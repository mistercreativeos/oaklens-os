// @vitest-environment happy-dom
//
// The canvas bloom (js/console/lighting.js) — phase 2 of the lighting pass,
// made thermal by the emissive pass (K40).
//
// Two kinds of assertion here, and the split is deliberate.
//
// The BEHAVIOUR tests drive paint() against a recording 2D context and a clock
// the test owns. They cannot check that the light looks right — no test can,
// which is why the pass was measured in a browser with getImageData and the
// numbers written into the module — but they can check the things that would
// quietly stop being true: that the emitter set is exactly the licence, that
// the colour is read off the element rather than tabled, that DAYLIGHT paints
// nothing, that every emitter gets punched back out of the frame, that a level
// HEATS over its curve and COOLS after the licence is withdrawn, and above all
// that the engine PARKS — no frame is requested once every level rests.
//
// The SOURCE tests pin the promises the module makes in prose, because each
// one is a rule from somewhere else in the project that a future edit would
// break without any visible symptom: the licence (design-spec §6.5), the
// one-heartbeat budget (motion-language.md), and the iPad cliff that
// mix-blend-mode walks off.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'js', 'console', 'lighting.js'), 'utf8');
// Prose that explains a rule is not the same as code that keeps it — every
// source assertion below runs against the file with its comments removed.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------- the stubs

let calls = [];
let rects = new Map();
let props = new Map();
let clock = 0;
let frames = [];   // rAF callbacks waiting to run

/** A 2D context that records instead of rasterising. */
function recordingCtx() {
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    clearRect(...a) { calls.push(['clearRect', ...a]); },
    beginPath() { calls.push(['beginPath']); },
    roundRect(...a) { calls.push(['roundRect', ...a]); },
    rect(...a) { calls.push(['rect', ...a]); },
    // The composite op AT FILL TIME is the whole point: it is what separates
    // baking the pool from punching the control back out of it.
    fill() {
      calls.push(['fill', this.globalCompositeOperation, this.fillStyle,
        this.shadowColor, this.shadowBlur, this.shadowOffsetY]);
    },
    drawImage(img, x, y) {
      calls.push(['drawImage', this.globalAlpha, this.globalCompositeOperation, img, x, y]);
    },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() { calls.push(['putImageData']); },
    // What a layer reads back for its exposure (K50): a flat field at the
    // luma a test sets, black unless it does.
    getImageData(x, y, w, h) {
      calls.push(['getImageData', x, y, w, h]);
      const d = new Uint8ClampedArray(Math.max(0, w * h) * 4);
      for (let i = 0; i < d.length; i += 4) { d[i] = imageLuma; d[i + 1] = imageLuma; d[i + 2] = imageLuma; d[i + 3] = imageLuma ? 255 : 0; }
      return { data: d };
    },
  };
  return ctx;
}
let imageLuma = 0;   // the field every getImageData returns (K50 adaptation tests set it)

const HEAT = '1.5s cubic-bezier(0.8, 0, 0.45, 1)';
const COOL = '2.6s cubic-bezier(0.4, 0, 0.1, 1)';

/** Give one element a box, a resolved --lit-rgb and the console's curves. */
function lamp(el, { x = 10, y = 10, w = 100, h = 30, rgb = '255, 0, 0', attr = 'data-lit', val = 'accent', curves = true } = {}) {
  el.setAttribute(attr, val);
  rects.set(el, { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
  props.set(el, curves ? { '--lit-rgb': rgb, '--arm-heat': HEAT, '--arm-cool': COOL } : { '--lit-rgb': rgb });
  return el;
}

async function load() {
  vi.resetModules();
  return import('../js/console/lighting.js');
}

/** Run every frame that is waiting, at the current clock. */
function tick(ms = 0) {
  clock += ms;
  const run = frames.splice(0);
  for (const cb of run) cb(clock);
  return run.length;
}

beforeEach(() => {
  calls = [];
  rects = new Map();
  props = new Map();
  clock = 1000;
  frames = [];
  imageLuma = 0;
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');

  HTMLCanvasElement.prototype.getContext = () => recordingCtx();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  // A real ResizeObserver delivers one initial notification per observe() —
  // by spec — which is one extra paint per newly lit control in a browser and
  // noise in a frame count here. The observer section below records it.
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  // Full motion by default. The reduced-motion test below stubs this to match
  // and nothing restores it, so without this reset every test that ran after
  // it saw levels jump to target — invisible until a test that heats something
  // was appended at the end of the file (K41).
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);

  Element.prototype.getBoundingClientRect = function () {
    return rects.get(this) || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  // STUDIO by default: the bloom is on. The haze (K41) is OFF here so that
  // every pool assertion below still counts one draw per emitter; the haze
  // section turns it on for itself. (An unset token reads as 1 in the
  // engine, the stylesheet's default — that is pinned down there too.)
  props.set(document.documentElement, { '--bloom-gain': '1', '--haze-gain': '0' });
  window.getComputedStyle = (el) => ({
    borderTopLeftRadius: '0px',
    getPropertyValue: (name) => (props.get(el) || {})[name] ?? '',
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

/** Boot the module and paint one frame synchronously. */
async function painted() {
  const m = await load();
  m.lightingInit();
  // Run the boot frame rather than discarding it: the coalescing handle is
  // held until the callback runs, and a dropped callback would leave every
  // later repaint parked at the guard — which is a test-harness bug, not a
  // module one, and it hid the first draft of these tests.
  tick();
  return m;
}

const pools = () => calls.filter((c) => c[0] === 'drawImage' && c[2] === 'lighter');
const bakes = () => calls.filter((c) => c[0] === 'fill' && c[1] === 'lighter');
const punches = () => calls.filter((c) => c[0] === 'fill' && c[1] === 'destination-out');
const composites = () => calls.filter((c) => c[0] === 'drawImage' && c[2] === 'source-over');

// ------------------------------------------------------------- the behaviour

describe('the bloom finds its emitters by the licence, and only by it', () => {
  it('lights an element with data-lit and ignores everything else', async () => {
    document.body.innerHTML = `
      <button id="lit"></button>
      <button id="plain"></button>
      <div id="selected" class="is-selected" aria-selected="true"></div>`;
    lamp(document.getElementById('lit'), { curves: false });
    // The two controls that must NOT glow: "this one is picked" is a fact, not
    // activity, and demoting six of those halos is what K37 was for.
    rects.set(document.getElementById('plain'), { left: 0, top: 0, width: 80, height: 20, right: 80, bottom: 20 });
    rects.set(document.getElementById('selected'), { left: 0, top: 40, width: 80, height: 20, right: 80, bottom: 60 });

    const m = await painted();
    expect(m._lighting.emitters().map((e) => e.id)).toEqual(['lit']);
    expect(pools()).toHaveLength(1);
  });

  it('lights a thing in flight — data-heat="hot" — and never a merely warm one', async () => {
    // The emissive pass: hot is the commit ignition and the ingestion rod, and
    // they pool through the same engine as data-lit. Warm is under a hand, in
    // the box only — a hover must never touch the canvas.
    document.body.innerHTML = '<i id="rod"></i><button id="warm"></button>';
    lamp(document.getElementById('rod'), { attr: 'data-heat', val: 'hot', h: 6, curves: false });
    lamp(document.getElementById('warm'), { attr: 'data-heat', val: 'warm', y: 100, curves: false });
    const m = await painted();
    expect(m._lighting.emitters().map((e) => e.id)).toEqual(['rod']);
    expect(pools()).toHaveLength(1);
  });

  it('names no surface, view or id of its own', () => {
    // The moment this module knows what a publish button is, the licence lives
    // in two places and they drift.
    expect(CODE).not.toMatch(/publish|buffer|archive|cards|pulse|sys-lamp|tab-btn|dropzone|lm-rod/i);
    // Two queries, both by attribute: the licence, and (K45) the light-layer
    // hosts — a scroller that carries its own light, named by data-light-layer.
    // (K58: the licence is one constant, read by the roster and by content
    // coming into range.)
    expect(CODE).toMatch(/const LICENCE = '\[data-lit\], \[data-heat="hot"\], \[data-seam\], \[data-backlit\]';/);
    expect(CODE.match(/querySelectorAll\??\.?\([^)]*\)/g))
      .toEqual(['querySelectorAll(LICENCE)', 'querySelectorAll(`[${LAYER_ATTR}]`)', 'querySelectorAll?.(LICENCE)']);
    expect(CODE).toMatch(/const LAYER_ATTR = 'data-light-layer';/);
  });

  it('paints nothing at all when nothing is lit', async () => {
    document.body.innerHTML = '<button id="plain"></button>';
    await painted();
    expect(pools()).toHaveLength(0);
    expect(composites()).toHaveLength(0);
    // …but it still clears, or the last frame would burn in after the light
    // goes out.
    expect(calls.filter((c) => c[0] === 'clearRect').length).toBeGreaterThan(0);
  });

  it('skips a control the breakpoint has hidden', async () => {
    // Both publish controls carry data-lit at once and only one is ever on
    // screen; the hidden one measures 0×0. Without this guard it would burn a
    // pool at the origin every frame.
    document.body.innerHTML = '<button id="hidden"></button>';
    const el = document.getElementById('hidden');
    el.setAttribute('data-lit', 'accent');
    props.set(el, { '--lit-rgb': '255, 0, 0' });
    rects.set(el, { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
    await painted();
    expect(pools()).toHaveLength(0);
  });

  it('skips an emitter scrolled far out of view', async () => {
    document.body.innerHTML = '<div id="far"></div>';
    lamp(document.getElementById('far'), { y: 4000, h: 40, curves: false });
    await painted();
    expect(pools()).toHaveLength(0);
  });
});

describe('colour is read at paint time, never tabled', () => {
  it('takes each emitter colour off the element', async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    lamp(document.getElementById('a'), { rgb: '39, 201, 63', curves: false });
    lamp(document.getElementById('b'), { y: 100, rgb: '230, 168, 23', curves: false });
    await painted();
    // The bake fills twice per sprite — the far tone, then the near one in the
    // emitter's own colour. The near fill is the colour as given.
    const near = bakes().filter((c) => c[2].endsWith(', 0.85)'));
    expect(near.map((c) => c[2])).toEqual([
      'rgba(39, 201, 63, 0.85)', 'rgba(230, 168, 23, 0.85)',
    ]);
  });

  it('cools the far tail toward the ground by arithmetic, not by a second colour', async () => {
    // Depth is attenuation. The far shadow is the same colour dimmed and
    // part-desaturated; nothing here names a tone.
    const m = await load();
    expect(m._lighting.farRgb('255, 0, 0')).toBe('111, 11, 11');
    expect(m._lighting.farRgb('0, 0, 0')).toBe('0, 0, 0');
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { curves: false });
    await painted();
    const [far, near] = bakes();
    expect(far[2]).toBe('rgba(111, 11, 11, 0.595)');
    expect(near[2]).toBe('rgba(255, 0, 0, 0.85)');
    expect(far[4], 'the far shadow reaches further than the near one').toBeGreaterThan(near[4]);
  });

  it('carries no colour literal of its own', () => {
    // Same rule tests/theme-tokens.test.js puts on card-paint.js. A table here
    // would be wrong in DAYLIGHT, wrong in five of six presets, and wrong in
    // every fork. The one literal allowed is the punch-out's, which is a MASK:
    // destination-out reads alpha only, so its colour is never seen.
    // The substrate tile (K41e) is the same kind of mask: destination-in
    // reads alpha only, so its black is never seen either.
    const literals = (CODE.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+[^)]*\)?/g) || [])
      .filter((l) => !/^rgba\(\s*0,\s*0,\s*0,/.test(l));
    expect(literals).toEqual([]);
    expect(CODE).toContain("getPropertyValue('--lit-rgb')");
  });

  it('refuses a malformed --lit-rgb rather than painting the last colour', async () => {
    // fillStyle silently ignores an invalid value and keeps whatever was set
    // before, so a bad token would paint the PREVIOUS emitter's colour.
    document.body.innerHTML = '<div id="bad"></div>';
    lamp(document.getElementById('bad'), { rgb: 'var(--nope)', curves: false });
    await painted();
    expect(pools()).toHaveLength(0);
    expect(bakes()).toHaveLength(0);
  });
});

describe('the pool is baked once and replayed', () => {
  it('bakes a shape+colour on first sight and draws from the cache after', async () => {
    // The analogs makeGlow pattern. Measured: the per-frame cost is flat while
    // a level animates, and the depth tint is a second fill per BAKE.
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { w: 100, h: 30, curves: false });
    const m = await painted();
    expect(bakes()).toHaveLength(2);
    expect(pools()).toHaveLength(1);
    calls = [];
    m._lighting.paint();
    m._lighting.paint();
    expect(bakes(), 'no second bake for the same shape').toHaveLength(0);
    expect(pools()).toHaveLength(2);
  });

  it('spreads the pool with a shadow, not a hard fill', async () => {
    // The measured finding: a flat rect cannot pool, because bilinear upscaling
    // stops at the neighbouring pixel. If this ever goes back to a plain fill
    // the light dies 30px out and nobody notices in a screenshot.
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { w: 100, h: 30, curves: false });
    await painted();
    for (const b of bakes()) expect(b[4], 'the pool must carry a shadow blur').toBeGreaterThan(0);
  });

  it('dithers only where there is light', async () => {
    // A quarter-scale ramp bands on an OLED. The noise tile goes in
    // source-atop — onto the pool, never onto the black ground — and is baked
    // exactly once.
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { curves: false });
    const m = await painted();
    const dither = calls.filter((c) => c[0] === 'drawImage' && c[2] === 'source-atop');
    expect(dither.length).toBeGreaterThan(0);
    expect(dither[0][1]).toBe(m._lighting.DITHER_ALPHA);
    expect(calls.filter((c) => c[0] === 'putImageData')).toHaveLength(1);
    calls = [];
    m._lighting.paint();
    expect(calls.filter((c) => c[0] === 'putImageData'), 'baked once').toHaveLength(0);
  });
});

describe('the light is under the glass', () => {
  it('punches nothing out — a translucent control over its own pool IS the backlit cap', async () => {
    // K40b. The canvas moved from 310 (over the console) to -1 (under it),
    // and with it the punch-out went: what lies over the emitter's box is
    // the control, transmitting or not. The stylesheet pins the z-index.
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    lamp(document.getElementById('a'), { curves: false });
    lamp(document.getElementById('b'), { y: 200, curves: false });
    await painted();
    expect(punches()).toHaveLength(0);
    expect(CODE).not.toMatch(/destination-out/);
  });

  it('dims a big emitter by the area law, and floors it', async () => {
    // Emission falls with area: a hot point is comfortable, a hot panel is
    // glare. Same light, spread over a bay, is dimmer — and never zero.
    document.body.innerHTML = '<button id="btn"></button><div id="bay"></div>';
    lamp(document.getElementById('btn'), { w: 100, h: 32, curves: false });
    lamp(document.getElementById('bay'), { y: 100, w: 900, h: 230, curves: false });
    const m = await painted();
    const [btn, bay] = pools().map((c) => c[1]);
    expect(btn).toBeCloseTo(1, 5);
    expect(bay).toBeCloseTo(m._lighting.AREA_FLOOR, 5);
    calls = [];
    document.getElementById('bay').remove();
    document.body.innerHTML += '<div id="mid"></div>';
    lamp(document.getElementById('mid'), { y: 100, w: 200, h: 64, curves: false });
    m._lighting.paint();
    const mid = pools().at(-1)[1];
    expect(mid).toBeCloseTo(Math.sqrt(m._lighting.AREA_REF / (200 * 64)), 5);
    expect(mid).toBeGreaterThan(m._lighting.AREA_FLOOR);
    expect(mid).toBeLessThan(1);
  });
});

describe('DAYLIGHT paints no bloom', () => {
  it('reads --bloom-gain and stops at zero', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { curves: false });
    props.set(document.documentElement, { '--bloom-gain': '0' });
    const m = await painted();
    expect(m._lighting.bloomGain()).toBe(0);
    expect(pools()).toHaveLength(0);
    expect(composites()).toHaveLength(0);
    expect(frames, 'and asks for no frame — there is nothing to animate').toHaveLength(0);
  });

  it('has no [data-theme] branch of its own', () => {
    // On paper "lit" is a ring and a contact shadow, and that is one token
    // override in CSS — not a second code path here.
    // It may WATCH data-theme — that is how it learns the gain changed — but
    // it may never branch on the value, which is the table this whole module
    // refuses to keep.
    expect(CODE).toContain("attributeFilter: ['data-theme', 'data-ignition']");
    expect(CODE).not.toMatch(/===\s*['"](light|dark)['"]|dataset\.theme\s*[=!]==/);
  });
});

describe('--bloom-gain is a dial that actually turns', () => {
  // ⚠️ THE BUG THIS EXISTS FOR. The first spelling was `globalAlpha = gain`,
  // and the canvas spec CLAMPS globalAlpha to [0,1] — so every value above 1
  // was a silent no-op. The owner asked for 3, it would have rendered exactly
  // like 1, and nothing anywhere would have said so. A knob that looks like it
  // works and does nothing is worse than no knob.
  const passes = () => composites().map((c) => c[1]);

  it('spends gain above 1 as accumulating passes, not as a clamped alpha', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { curves: false });
    props.set(document.documentElement, { '--bloom-gain': '3' });
    await painted();
    expect(passes(), 'three whole passes at full alpha').toEqual([1, 1, 1]);
  });

  it('is byte-identical to what shipped at gain 1 and below', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { curves: false });
    await painted();
    expect(passes()).toEqual([1]);

    calls = [];
    props.set(document.documentElement, { '--bloom-gain': '0.5' });
    await painted();
    expect(passes()).toEqual([0.5]);
  });

  it('spends a fractional remainder rather than rounding it away', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { curves: false });
    props.set(document.documentElement, { '--bloom-gain': '2.5' });
    await painted();
    expect(passes()).toEqual([1, 1, 0.5]);
  });

  it('clamps a typo instead of drawing the canvas three hundred times', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { curves: false });
    props.set(document.documentElement, { '--bloom-gain': '300' });
    const m = await painted();
    expect(m._lighting.bloomGain()).toBe(m._lighting.GAIN_MAX);
    expect(passes().length).toBe(m._lighting.GAIN_MAX);
  });
});

describe('a surface can turn its own lamp down', () => {
  it('multiplies --lit-level in at paint time, clamped, defaulting to 1', async () => {
    document.body.innerHTML = '<button id="full"></button><button id="dim"></button><button id="bad"></button>';
    lamp(document.getElementById('full'), { w: 100, h: 32, curves: false });
    const dim = lamp(document.getElementById('dim'), { y: 100, w: 100, h: 32, curves: false });
    props.get(dim)['--lit-level'] = '0.3';
    const bad = lamp(document.getElementById('bad'), { y: 200, w: 100, h: 32, curves: false });
    props.get(bad)['--lit-level'] = '7';
    const m = await painted();
    expect(pools().map((c) => +c[1].toFixed(3))).toEqual([1, 0.3, 1]);
    expect(m._lighting.litLevel(dim)).toBe(0.3);
    expect(m._lighting.litLevel(document.body)).toBe(1);
  });
});

describe('the light is thermal — it heats, it cools, and then it PARKS', () => {
  // The emissive pass. The box glow heated over --arm-heat while the pool
  // snapped on in one frame; now the pool has a level that follows the same
  // curve, read off the emitter. What has to stay true forever: frames are
  // requested only while a level is moving. A static console costs zero.

  it('a static emitter costs no frame at all', async () => {
    // No curves on the element → no journey → the level is at its target on
    // the first paint, and nothing is requested. This is K38's promise.
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { curves: false });
    const m = await painted();
    expect(m._lighting.levels().get(document.getElementById('a'))).toBe(1);
    expect(m._lighting.inFlight()).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('heats from dark over --arm-heat, and stops asking once it arrives', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    const el = lamp(document.getElementById('a'));
    const m = await painted();
    const level = () => m._lighting.levels().get(el);
    expect(level()).toBe(0);
    expect(m._lighting.inFlight()).toBe(true);
    expect(frames, 'in flight: one frame requested').toHaveLength(1);
    // The pool draws at the level, so the first frame draws nothing…
    expect(pools()).toHaveLength(0);
    // …a quarter of the way in it lags a linear ramp (the curve eases in)…
    expect(tick(375)).toBe(1);
    expect(level()).toBeGreaterThan(0);
    expect(level()).toBeLessThan(0.25);
    // …the middle of the curve draws it dimmed, at exactly the level…
    expect(tick(375)).toBe(1);
    const mid = level();
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    expect(pools().at(-1)[1]).toBeCloseTo(mid, 5);
    // Drive past the end. The frame that arrives at 1 is the LAST one requested.
    let n = 0;
    while (frames.length && n < 200) { tick(100); n++; }
    expect(level()).toBe(1);
    expect(m._lighting.inFlight()).toBe(false);
    expect(frames, 'parked').toHaveLength(0);
    expect(n).toBeLessThan(12);
    // And a later, unrelated paint asks for nothing.
    m._lighting.paint();
    expect(frames).toHaveLength(0);
  });

  it('cools in place after the licence is withdrawn, over --arm-cool, then forgets the emitter', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    const el = lamp(document.getElementById('a'));
    const m = await painted();
    while (frames.length) tick(100);
    expect(m._lighting.levels().get(el)).toBe(1);
    // The button stops being lit. Its light does not vanish; it cools.
    el.removeAttribute('data-lit');
    calls = [];
    m._lighting.paint();
    expect(m._lighting.emitters()).toEqual([]);
    expect(m._lighting.levels().get(el), 'still at 1 the instant it is withdrawn').toBe(1);
    expect(pools(), 'still drawn — the control is still there').toHaveLength(1);
    expect(frames).toHaveLength(1);
    tick(1300);
    const mid = m._lighting.levels().get(el);
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.95);
    let n = 0;
    while (frames.length && n < 200) { tick(100); n++; }
    expect(n, 'cool is 2.6s: more frames than the heat').toBeGreaterThan(10);
    expect(m._lighting.levels().has(el), 'dark and forgotten').toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('re-lighting mid-cool heats from where it is, never from dark', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    const el = lamp(document.getElementById('a'));
    const m = await painted();
    while (frames.length) tick(100);
    el.removeAttribute('data-lit');
    m._lighting.paint();
    tick(1300);
    const mid = m._lighting.levels().get(el);
    el.setAttribute('data-lit', 'accent');
    m._lighting.paint();
    expect(m._lighting.levels().get(el)).toBeCloseTo(mid, 5);
    tick(100);
    expect(m._lighting.levels().get(el)).toBeGreaterThanOrEqual(mid);
  });

  it('drops an emitter that left the DOM while still on — its light has nowhere to be', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    const el = lamp(document.getElementById('a'));
    const m = await painted();
    while (frames.length) tick(100);
    el.remove();
    m._lighting.paint();
    expect(m._lighting.levels().has(el)).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('keeps cooling one that left the DOM while already cooling — a toast fades and leaves', async () => {
    // The notification case: data-lit comes off as the toast starts to fade,
    // the element is removed a moment later, and the light finishes leaving
    // from the last box it was measured in rather than popping.
    document.body.innerHTML = '<div id="t"></div>';
    const el = lamp(document.getElementById('t'));
    const m = await painted();
    while (frames.length) tick(100);
    el.removeAttribute('data-lit');
    m._lighting.paint();
    tick(300);
    el.remove();
    calls = [];
    tick(300);
    expect(m._lighting.levels().has(el), 'still cooling after removal').toBe(true);
    expect(pools(), 'still drawn, from the last box').toHaveLength(1);
    let n = 0;
    while (frames.length && n < 200) { tick(100); n++; }
    expect(m._lighting.levels().has(el)).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('reads the curve off the emitter — the token is the dial, and a missing one is no journey', async () => {
    const m = await load();
    document.body.innerHTML = '<div id="a"></div>';
    const el = document.getElementById('a');
    props.set(el, { '--arm-heat': HEAT, '--arm-cool': '260ms cubic-bezier(0.33, 0.05, 0.2, 1)' });
    expect(m._lighting.curve(el, '--arm-heat')).toEqual({ ms: 1500, bez: [0.8, 0, 0.45, 1] });
    expect(m._lighting.curve(el, '--arm-cool')).toEqual({ ms: 260, bez: [0.33, 0.05, 0.2, 1] });
    expect(m._lighting.curve(el, '--nope')).toEqual({ ms: 0, bez: null });
    props.set(el, { '--arm-heat': '1.5s ease' });
    expect(m._lighting.curve(el, '--arm-heat'), 'a keyword is not a curve this module can follow').toEqual({ ms: 0, bez: null });
    // No literal duration or bezier lives in the file.
    expect(CODE).not.toMatch(/\b(1500|2600|0\.33|0\.4,\s*0,\s*0\.5)\b/);
  });

  it('follows a CSS cubic-bezier to the frame', async () => {
    const m = await load();
    const y = (x) => m._lighting.bezierY([0.4, 0, 0.5, 1], x);
    expect(y(0)).toBeCloseTo(0, 4);
    expect(y(1)).toBeCloseTo(1, 4);
    expect(y(0.25)).toBeLessThan(0.25);   // eases in
    expect(y(0.75)).toBeGreaterThan(0.75); // eases out
    expect(m._lighting.bezierY(null, 0.3)).toBe(0.3);
  });

  it('keeps the state and drops the journey under prefers-reduced-motion', async () => {
    window.matchMedia = () => ({ matches: true, addEventListener() {} });
    document.body.innerHTML = '<div id="a"></div>';
    const el = lamp(document.getElementById('a'));
    const m = await painted();
    expect(m._lighting.levels().get(el)).toBe(1);
    expect(frames).toHaveLength(0);
    el.removeAttribute('data-lit');
    m._lighting.paint();
    expect(m._lighting.levels().has(el)).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('re-arms itself in exactly one place, and only behind the in-flight flag', () => {
    // docs/ideas/motion-language.md allows one heartbeat per page and the SYS
    // lamp owns it. This engine is BOUNDED: it may ask for the next frame only
    // while a level is moving. Source-level guard beside the behaviour above.
    expect(CODE).not.toMatch(/setInterval/);
    const body = CODE.slice(CODE.indexOf('function paint()'), CODE.indexOf('export function lightingRepaint'));
    // K49: the re-arm names WHAT the next frame redraws (a region of a layer,
    // or the fixed canvas) and then schedules — once, inside the in-flight
    // block, and nowhere else in the frame.
    const rearms = body.match(/schedule\(\)|lightingRepaint\(/g) || [];
    expect(rearms).toEqual(['schedule()']);
    expect(body).toMatch(/if \(inFlight\) \{[\s\S]*schedule\(\);\s*\}\s*\}\s*$/);
    expect(body).not.toMatch(/requestAnimationFrame|setTimeout/);
  });

  it('coalesces every event into at most one paint per frame', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { curves: false });
    const m = await load();
    m.lightingInit();
    tick();
    m.lightingRepaint(); m.lightingRepaint(); m.lightingRepaint();
    expect(frames).toHaveLength(1);
  });
});

describe('the size observer never re-arms the frame it runs in', () => {
  // A ResizeObserver delivers an initial notification for every observe() —
  // by spec — so re-pointing it each paint (disconnect + observe) was: paint →
  // notify → repaint → …, a 60fps loop for as long as anything was lit.
  // Headless Chromium, 2026-09-24: 120 rAF callbacks in two idle seconds with
  // one emitter, 0 after the fix. The observer may only ever see the DIFF.
  let log;
  class RecordingRO {
    constructor(cb) { this.cb = cb; }
    observe(el) { log.push(['observe', el.id]); }
    unobserve(el) { log.push(['unobserve', el.id]); }
    disconnect() { log.push(['disconnect']); }
  }
  let realRO;
  beforeEach(() => { log = []; realRO = globalThis.ResizeObserver; globalThis.ResizeObserver = RecordingRO; });
  afterEach(() => { globalThis.ResizeObserver = realRO; });

  it('observes an emitter once, however many frames it stays lit for', async () => {
    document.body.innerHTML = '<button id="a"></button><button id="b"></button>';
    lamp(document.getElementById('a'), { curves: false });
    const m = await painted();
    m._lighting.paint();
    m._lighting.paint();
    expect(log).toEqual([['observe', 'a']]);
    // A second emitter joins: only IT is observed. The first is left alone.
    lamp(document.getElementById('b'), { y: 100, curves: false });
    m._lighting.paint();
    expect(log).toEqual([['observe', 'a'], ['observe', 'b']]);
    // …and leaves: only it is released. Never a disconnect-and-rebuild.
    document.getElementById('a').removeAttribute('data-lit');
    m._lighting.paint();
    expect(log).toEqual([['observe', 'a'], ['observe', 'b'], ['unobserve', 'a']]);
  });

  it('spends the observer only on change at the source level too', () => {
    const fn = CODE.slice(CODE.indexOf('function observeSizes'));
    expect(fn.slice(0, fn.indexOf('\n}'))).not.toMatch(/disconnect\(\)/);
  });
});

describe('it is inert where a canvas cannot be had', () => {
  it('boots without a 2D context instead of taking the console down with it', async () => {
    // happy-dom returns null from getContext, which is exactly the shape of a
    // locked-down browser. tests/console-boot.test.js goes red if this throws.
    HTMLCanvasElement.prototype.getContext = () => null;
    const m = await load();
    expect(() => m.lightingInit()).not.toThrow();
    expect(document.getElementById('lighting-canvas')).toBeNull();
    expect(() => m.lightingRepaint()).not.toThrow();
    expect(() => m._lighting.paint()).not.toThrow();
  });

  it('is built at runtime and appends exactly one canvas, once', async () => {
    const m = await load();
    m.lightingInit();
    m.lightingInit();
    expect(document.querySelectorAll('canvas#lighting-canvas')).toHaveLength(1);
    // Decorative and unreadable — it must never reach the accessibility tree.
    expect(document.getElementById('lighting-canvas').getAttribute('aria-hidden')).toBe('true');
  });

  it('watches all three licence attributes', () => {
    expect(CODE).toContain("attributeFilter: ['data-lit', 'data-heat', 'data-seam', 'data-backlit']");
  });
});

describe('the composite stays off the compositor cliff', () => {
  it('never asks for mix-blend-mode', () => {
    // The bench blends with `screen`, which forces the whole document through a
    // blended composite every paint. The additive part happens inside the
    // emissive buffer instead, where it costs one quarter-scale canvas.
    expect(CODE).not.toMatch(/mixBlendMode|mix-blend-mode/);
    expect(CODE).toContain("globalCompositeOperation = 'lighter'");
  });
});

// ---------------------------------------------------------------- the seams (K41)
//
// The owner's emissive-seams mockup asked for light that LEAVES the line and a
// volumetric haze filling the negative space. The mockup painted the haze by
// hand; here it is the sum of what every emitter casts. What must stay true:
// a seam is a line source and never its panel; it keeps a level of its own;
// the haze is one dial, squared, off in the void and off on paper; and the
// haze sprite is a shadow with no slab under it.

describe('the seams are emitters — a line source, never the panel', () => {
  it('finds a data-seam element by the licence and paints a strip along the named edge', async () => {
    document.body.innerHTML = '<header id="bar"></header>';
    const bar = lamp(document.getElementById('bar'), { x: 0, y: 0, w: 400, h: 60, attr: 'data-seam', val: 'bottom', curves: false });
    const m = await painted();
    expect(m._lighting.emitters().map((e) => e.id)).toEqual(['bar']);
    expect(m._lighting.isLit(bar)).toBe(false);
    expect(m._lighting.seamEdge(bar)).toBe('bottom');
    // One pool, baked as the STRIP: the bar's width by SEAM_SRC, never the bar's box.
    expect(pools()).toHaveLength(1);
    const shape = calls.filter((c) => c[0] === 'roundRect').at(-1);
    expect(shape[3]).toBe(400 * m._lighting.EM_SCALE);
    expect(shape[4]).toBe(m._lighting.SEAM_SRC * m._lighting.EM_SCALE);
  });

  it('an edge is one strip centred on its line, a box is four, a thin element is itself, a thick one is a box', async () => {
    const m = await load();
    const { seamStrips, SEAM_SRC } = m._lighting;
    const half = SEAM_SRC / 2;
    const r = { left: 10, top: 20, width: 400, height: 60, right: 410, bottom: 80 };
    expect(seamStrips(r, 'bottom')).toEqual([{ left: 10, top: 80 - 0.5 - half, width: 400, height: SEAM_SRC, out: 'bottom' }]);
    expect(seamStrips(r, 'top')).toEqual([{ left: 10, top: 20 + 0.5 - half, width: 400, height: SEAM_SRC, out: 'top' }]);
    expect(seamStrips(r, 'right')).toEqual([{ left: 410 - 0.5 - half, top: 20, width: SEAM_SRC, height: 60, out: 'right' }]);
    expect(seamStrips(r, 'left')).toEqual([{ left: 10 + 0.5 - half, top: 20, width: SEAM_SRC, height: 60, out: 'left' }]);
    expect(seamStrips(r, 'box')).toHaveLength(4);
    expect(seamStrips(r, '')).toHaveLength(4);
    const thin = { left: 0, top: 100, width: 300, height: 1, right: 300, bottom: 101 };
    expect(seamStrips(thin, '')).toEqual([{ left: 0, top: 100 + 0.5 - half, width: 300, height: SEAM_SRC, out: null }]);
    // The value is the edge; anything else is "the element is the line".
    const el = document.createElement('i');
    el.setAttribute('data-seam', 'sideways');
    expect(m._lighting.seamEdge(el)).toBe('');
    expect(m._lighting.seamEdge(document.createElement('i'))).toBeNull();
  });

  it('draws the strip pool at --seam-level and a filament\'s share of a lamp\'s — never the area law', async () => {
    document.body.innerHTML = '<div id="rule"></div><div id="dim"></div>';
    lamp(document.getElementById('rule'), { x: 0, y: 0, w: 900, h: 1, attr: 'data-seam', val: '', curves: false });
    const dim = lamp(document.getElementById('dim'), { x: 0, y: 100, w: 900, h: 1, attr: 'data-seam', val: '', curves: false });
    props.get(dim)['--seam-level'] = '0.5';
    const m = await painted();
    const { SEAM_POOL } = m._lighting;
    expect(SEAM_POOL).toBeGreaterThan(0);
    expect(SEAM_POOL).toBeLessThan(1);
    expect(pools().map((c) => +c[1].toFixed(4))).toEqual([+SEAM_POOL.toFixed(4), +(0.5 * SEAM_POOL).toFixed(4)]);
    expect(m._lighting.seamLevel(dim)).toBe(0.5);
    expect(m._lighting.seamLevel(document.body)).toBe(1);
  });

  it('is fed from its edge: the strip\'s fill attenuates along the run, and the shadow follows the fill', () => {
    // A gradient fill under a shadow: the pool and the haze fall off along the
    // seam the way the stylesheet's core does. The recording context has no
    // gradients, so this one is pinned at the source.
    expect(CODE).toMatch(/createLinearGradient/);
    expect(CODE.match(/fedFill\(/g), 'one definition, used by the pool bake and the haze bake').toHaveLength(3);
    expect(CODE).toMatch(/const SEAM_FAR = 0\.\d+;/);
  });

  it('bakes a seam\'s shadow and never its strip — a 1px line in a quarter buffer strobes when it scrolls', async () => {
    // 2026-10-01, the owner on a phone and an iPad: every horizontal rule
    // strobed under a scroll. The strip is one buffer pixel tall, and a hard
    // pixel drawn at a fractional position changes shape with the fraction —
    // measured in Chromium, the canvas's copy of the line swung 21% in peak
    // every 4 CSS px of travel. The fill now goes out of frame and only its
    // shadow lands in the sprite; the crisp core is the stylesheet's.
    document.body.innerHTML = '<div id="rule"></div><button id="lamp"></button>';
    lamp(document.getElementById('rule'), { x: 0, y: 100, w: 900, h: 1, attr: 'data-seam', val: '', curves: false });
    lamp(document.getElementById('lamp'), { x: 0, y: 300, w: 100, h: 32, curves: false });
    await painted();
    // Each bake is a shape then its fill; pair them up.
    const baked = [];
    calls.forEach((c, i) => {
      if (c[0] !== 'fill' || c[1] !== 'lighter') return;
      const shape = calls.slice(0, i).reverse().find((p) => p[0] === 'roundRect' || p[0] === 'rect');
      baked.push({ y: shape[2], h: shape[4], offset: c[5] });
    });
    expect(baked, 'two tiers for the lamp, two for the seam').toHaveLength(4);
    const seam = baked.filter((b) => b.offset !== 0);
    const lampTiers = baked.filter((b) => b.offset === 0);
    expect(lampTiers, 'a lamp keeps its core').toHaveLength(2);
    expect(seam).toHaveLength(2);
    for (const b of seam) {
      expect(b.y + b.h, 'the strip itself is drawn out of frame').toBeLessThanOrEqual(0);
      expect(b.y + b.offset, 'and its shadow is brought back into it').toBeGreaterThan(0);
    }
  });

  it('a seam keeps its own level, so a bay that is a seam AND hot still heats its fill from dark', async () => {
    document.body.innerHTML = '<div id="bay"></div>';
    const bay = lamp(document.getElementById('bay'), { x: 0, y: 0, w: 900, h: 230, attr: 'data-seam', val: 'box' });
    const m = await painted();
    tick(5000);
    expect(m._lighting.seamLevels().get(bay)).toBe(1);
    expect(m._lighting.levels().has(bay)).toBe(false);
    expect(frames, 'parked once the seam is up').toHaveLength(0);

    calls = [];
    bay.setAttribute('data-heat', 'hot');
    m._lighting.paint();
    // The rim is lit and stays lit; the fill has only just begun.
    expect(m._lighting.seamLevels().get(bay)).toBe(1);
    expect(m._lighting.levels().get(bay)).toBe(0);
    expect(pools(), 'four strips, and no fill yet').toHaveLength(4);
    tick(800);
    const fill = m._lighting.levels().get(bay);
    expect(fill).toBeGreaterThan(0);
    expect(fill).toBeLessThan(1);
    expect(m._lighting.seamLevels().get(bay)).toBe(1);
  });
});

describe('the room has haze — the far field every emitter casts', () => {
  it('draws a haze under every pool at the room\'s dial, squared, and the seam\'s takes its whole level', async () => {
    document.body.innerHTML = '<button id="lamp"></button><div id="seam"></div>';
    lamp(document.getElementById('lamp'), { w: 100, h: 32, curves: false });
    lamp(document.getElementById('seam'), { x: 0, y: 200, w: 900, h: 1, attr: 'data-seam', val: '', curves: false });
    props.get(document.documentElement)['--haze-gain'] = '1.5';
    const m = await painted();
    const q = (1.5 / m._lighting.HAZE_MAX) ** 2;
    // Two lighter draws per emitter: the haze, then the pool.
    expect(pools().map((c) => +c[1].toFixed(4))).toEqual([
      +q.toFixed(4), 1,
      +q.toFixed(4), +m._lighting.SEAM_POOL.toFixed(4),
    ]);
    expect(CODE, 'squared: the low end must be quiet').toMatch(/\(haze \/ HAZE_MAX\) \*\* 2/);
  });

  it('reads --haze-gain at paint time: a missing token is a room, the ceiling is the dial\'s, 0 is the void', async () => {
    document.body.innerHTML = '<button id="lamp"></button>';
    lamp(document.getElementById('lamp'), { curves: false });
    delete props.get(document.documentElement)['--haze-gain'];
    const m = await painted();
    expect(m._lighting.hazeGain()).toBe(1);
    expect(pools()).toHaveLength(2);
    props.get(document.documentElement)['--haze-gain'] = '40';
    expect(m._lighting.hazeGain()).toBe(m._lighting.HAZE_MAX);
    props.get(document.documentElement)['--haze-gain'] = '0';
    calls = [];
    m._lighting.paint();
    expect(pools(), 'the void: the pool alone').toHaveLength(1);
    expect(calls.filter((c) => c[0] === 'fill' && c[1] === 'source-over'), 'and no haze is baked for it').toHaveLength(0);
  });

  it('bakes the haze as a shadow and only a shadow, with a margin that holds its tail', async () => {
    document.body.innerHTML = '<button id="lamp"></button>';
    lamp(document.getElementById('lamp'), { curves: false });
    props.get(document.documentElement)['--haze-gain'] = '1';
    const m = await painted();
    // The source is drawn a canvas-height away and its shadow offset back, so
    // no hard-edged slab the width of the spread lands in the sprite.
    const hazeBakes = calls.filter((c) => c[0] === 'fill' && c[1] === 'source-over');
    expect(hazeBakes).toHaveLength(1);
    const [, , , shadowColor, blur, offY] = hazeBakes[0];
    expect(blur).toBe(m._lighting.HAZE_REACH * m._lighting.EM_SCALE);
    expect(offY).toBeGreaterThan(0);
    expect(shadowColor, 'the far tone, by arithmetic').toBe(`rgba(${m._lighting.farRgb('255, 0, 0')}, ${m._lighting.HAZE_ALPHA})`);
    // Three sigma of the blur, or the field ends in a faint hard edge; and the
    // cull must let a seam past the fold still fill the bottom of the room.
    expect(m._lighting.HAZE_MARGIN).toBeGreaterThanOrEqual(m._lighting.HAZE_SPREAD + 1.5 * m._lighting.HAZE_REACH);
    expect(m._lighting.CULL_MARGIN).toBeGreaterThanOrEqual(m._lighting.HAZE_MARGIN);
    // Baked once: a second frame draws it from the cache.
    calls = [];
    m._lighting.paint();
    expect(calls.filter((c) => c[0] === 'fill')).toHaveLength(0);
    expect(pools()).toHaveLength(2);
  });

  it('is off on paper by the one dial that is already off — no second switch', async () => {
    document.body.innerHTML = '<div id="seam"></div>';
    lamp(document.getElementById('seam'), { w: 900, h: 1, attr: 'data-seam', val: '', curves: false });
    props.set(document.documentElement, { '--bloom-gain': '0', '--haze-gain': '3' });
    await painted();
    expect(pools()).toHaveLength(0);
  });
});

describe('light leaves a panel — an edge seam casts its haze outward, and the primary source says so (K41d)', () => {
  it('names the open side on every edge strip, and none on a rule', async () => {
    const m = await load();
    const r = { left: 10, top: 20, width: 400, height: 60, right: 410, bottom: 80 };
    expect(m._lighting.seamStrips(r, 'right')[0].out).toBe('right');
    expect(m._lighting.seamStrips(r, 'box').map((s) => s.out)).toEqual(['top', 'bottom', 'left', 'right']);
    expect(m._lighting.seamStrips({ left: 0, top: 0, width: 300, height: 1, right: 300, bottom: 1 }, '')[0].out).toBeNull();
  });

  it('shifts the haze source one spread to the open side, and only there', async () => {
    document.body.innerHTML = '<nav id="side"></nav><div id="rule"></div>';
    lamp(document.getElementById('side'), { x: 0, y: 0, w: 220, h: 800, attr: 'data-seam', val: 'right', curves: false });
    lamp(document.getElementById('rule'), { x: 300, y: 100, w: 400, h: 1, attr: 'data-seam', val: '', curves: false });
    props.get(document.documentElement)['--haze-gain'] = '1';
    const m = await painted();
    const { HAZE_SPREAD, HAZE_MARGIN, EM_SCALE } = m._lighting;
    const bakes = calls.filter((c) => c[0] === 'rect');
    expect(bakes).toHaveLength(2);
    // The sidebar's band starts AT the line's margin (shifted right by a spread); the rule's straddles it.
    expect(bakes[0][1]).toBeCloseTo(HAZE_MARGIN * EM_SCALE, 5);
    expect(bakes[1][1]).toBeCloseTo((HAZE_MARGIN - HAZE_SPREAD) * EM_SCALE, 5);
  });

  it('multiplies --haze-boost into the haze alone, clamped, defaulting to 1', async () => {
    document.body.innerHTML = '<nav id="side"></nav><div id="rule"></div>';
    const side = lamp(document.getElementById('side'), { x: 0, y: 0, w: 220, h: 800, attr: 'data-seam', val: 'right', curves: false });
    lamp(document.getElementById('rule'), { x: 300, y: 100, w: 400, h: 1, attr: 'data-seam', val: '', curves: false });
    props.get(side)['--haze-boost'] = '2.4';
    props.get(document.documentElement)['--haze-gain'] = '1.5';
    const m = await painted();
    const q = (1.5 / m._lighting.HAZE_MAX) ** 2;
    const draws = pools().map((c) => +c[1].toFixed(4));
    expect(draws).toEqual([+(2.4 * q).toFixed(4), +m._lighting.SEAM_POOL.toFixed(4), +q.toFixed(4), +m._lighting.SEAM_POOL.toFixed(4)]);
    props.get(side)['--haze-boost'] = '40';
    expect(m._lighting.hazeBoost(side)).toBe(4);
    expect(m._lighting.hazeBoost(document.body)).toBe(1);
  });
});

describe('the ground is a substrate that shows only where light lands (K41e)', () => {
  it('reads --substrate-gain off the root, clamped, and 0 when missing', async () => {
    const m = await load();
    expect(m._lighting.substrateGain()).toBe(0);
    props.get(document.documentElement)['--substrate-gain'] = '0.55';
    expect(m._lighting.substrateGain()).toBe(0.55);
    props.get(document.documentElement)['--substrate-gain'] = '9';
    expect(m._lighting.substrateGain()).toBe(1);
  });

  it('is a mask on the composited light, never a layer over the document: the fixed canvas\'s CSS mask, as the layers\' is', async () => {
    // The mask multiplies the light's alpha by the tile's: pores keep it,
    // threads dim it, the black ground gains nothing. K78: the fixed canvas
    // carries it as a CSS mask, laid by the compositor; it was a pattern
    // filled over the whole canvas on each repaint, which WebKit draws tile
    // by tile on the CPU (every slow frame of Safari's cold start).
    document.body.innerHTML = '<button id="lamp"></button>';
    lamp(document.getElementById('lamp'), { curves: false });
    props.get(document.documentElement)['--substrate-gain'] = '0.55';
    await painted();
    expect(pools()).toHaveLength(1);
    expect(composites()).toHaveLength(1);
    const st = document.getElementById('lighting-canvas').style;
    const mask = st.webkitMaskImage || st.maskImage;
    expect(mask).toContain('data:image/svg+xml');
    expect(mask).toContain(`rgba(0,0,0,${(1 - 0.55 * 0.55).toFixed(3)})`);
    expect(CODE).toMatch(/maskCanvas\(fixedMask, canvas\);/);
    expect(CODE).not.toMatch(/createPattern|ctx\.fillStyle = pat/);
    expect(CODE).not.toMatch(/mixBlendMode|mix-blend-mode/);
  });

  it('is a membrane, not a tint: opaque at gain 0, and never fully open between the pores', async () => {
    const m = await load();
    expect(m._lighting.SUBSTRATE_DEPTH).toBeGreaterThan(0);
    expect(m._lighting.SUBSTRATE_DEPTH).toBeLessThan(1);
    expect(CODE).toMatch(/const floor = \(1 - sub \* SUBSTRATE_DEPTH\)\.toFixed\(3\);/);
    expect(CODE).toMatch(/if \(sub <= 0\) \{ st\.maskImage = st\.webkitMaskImage = ''; return; \}/);
  });
});

describe('the emission ladder — a tier\'s dial moves under a hand (2026-10-02)', () => {
  it('a seam enters lit: a re-rendered grid keeps its light instead of fading it back in', async () => {
    document.body.innerHTML = '<div id="card"></div>';
    const card = lamp(document.getElementById('card'), { x: 0, y: 0, w: 300, h: 80, attr: 'data-seam', val: 'box' });
    const m = await painted();
    expect(m._lighting.seamLevels().get(card), 'on the first frame, no journey').toBe(1);
    // A lamp still heats from cold — that half is unchanged.
    const lit = lamp(document.createElement('div'), { attr: 'data-lit', val: 'accent' });
    document.body.appendChild(lit);
    m._lighting.paint();
    expect(m._lighting.levels().get(lit)).toBe(0);
  });

  it('keeps its frames while a seam\'s --seam-level transitions, and parks when it ends', async () => {
    document.body.innerHTML = '<div id="card"></div>';
    const card = lamp(document.getElementById('card'), { x: 0, y: 0, w: 300, h: 80, attr: 'data-seam', val: 'box' });
    const m = await painted();
    tick(5000);
    expect(frames, 'parked at rest').toHaveLength(0);
    const ev = (type, propertyName = '--seam-level') => Object.assign(new Event(type), { propertyName });
    card.dispatchEvent(ev('transitionrun'));
    m._lighting.onDial({ type: 'transitionrun', propertyName: '--seam-level', target: card });
    expect(m._lighting.dialing()).toBe(true);
    tick(16);
    expect(frames.length, 'a frame per frame while the dial moves').toBeGreaterThan(0);
    m._lighting.onDial({ type: 'transitionend', propertyName: '--seam-level', target: card });
    expect(m._lighting.dialing()).toBe(false);
    tick(16); tick(16);
    expect(frames, 'parked again').toHaveLength(0);
  });

  it('ignores every other transition, and a host that leaves mid-way cannot hold it awake', async () => {
    document.body.innerHTML = '<div id="card"></div>';
    const card = lamp(document.getElementById('card'), { x: 0, y: 0, w: 300, h: 80, attr: 'data-seam', val: 'box' });
    const m = await painted();
    m._lighting.onDial({ type: 'transitionrun', propertyName: 'opacity', target: card });
    expect(m._lighting.dialing()).toBe(false);
    const plain = document.createElement('div');
    m._lighting.onDial({ type: 'transitionrun', propertyName: '--seam-level', target: plain });
    expect(m._lighting.dialing(), 'not a seam: not the engine\'s business').toBe(false);
    m._lighting.onDial({ type: 'transitionrun', propertyName: '--seam-level', target: card });
    card.remove();
    expect(m._lighting.dialing()).toBe(false);
  });

  it('listens for the dial and for the hand, generically', () => {
    for (const t of ['transitionrun', 'transitionend', 'transitioncancel', 'pointerover', 'pointerout', 'focusin', 'focusout']) {
      expect(CODE).toContain(`'${t}'`);
    }
    expect(CODE).toMatch(/closest\?\.\('\[data-seam\], \[data-backlit\]'\)/);
  });
});

describe('the backlight — a light behind the glass, bigger than the panel (K44)', () => {
  const backlit = (el, { w = 600, h = 400, level = '0.47', soft = '58px', overhang = '12px', y = '0.17' } = {}) => {
    el.setAttribute('data-backlit', '');
    rects.set(el, { left: 100, top: 100, width: w, height: h, right: 100 + w, bottom: 100 + h });
    props.set(el, { '--lit-rgb': '255, 0, 0', '--backlight': level, '--backlight-soft': soft, '--backlight-overhang': overhang, '--backlight-y': y });
    return el;
  };

  it('is a fourth licence the engine finds by its attribute', async () => {
    document.body.innerHTML = '<div id="p"></div>';
    backlit(document.getElementById('p'));
    const m = await painted();
    expect(m._lighting.emitters().map((e) => e.id)).toEqual(['p']);
    expect(m._lighting.isBacklit(document.getElementById('p'))).toBe(true);
  });

  it('draws the grown box once, at its level under the EASED area law, and enters lit', async () => {
    document.body.innerHTML = '<div id="p"></div>';
    backlit(document.getElementById('p'));
    const m = await painted();
    const law = Math.max(m._lighting.AREA_FLOOR, Math.min(1, Math.sqrt(m._lighting.AREA_REF / (600 * 400))) ** m._lighting.BACKLIGHT_LAW);
    const drawn = pools();
    expect(drawn, 'one pool; the haze is off in this harness').toHaveLength(1);
    expect(drawn[0][1]).toBeCloseTo(0.47 * law, 5);
    // …at full level on the very first frame: no journey for a backlight.
    expect(frames, 'and parked').toHaveLength(0);
  });

  it('bakes the shadow only, at the host\'s softness, and shares a bake between same-sized hosts', async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    backlit(document.getElementById('a'), { w: 300, h: 80 });
    const b = backlit(document.getElementById('b'), { w: 300, h: 80 });
    rects.set(b, { left: 100, top: 300, width: 300, height: 80, right: 400, bottom: 380 });
    await painted();
    const baked = calls.filter((c) => c[0] === 'fill' && c[4] === 58 * 0.25);
    expect(baked, 'one sprite for two hosts of one shape').toHaveLength(1);
    expect(baked[0][3]).toBe('rgba(255, 0, 0, 0.9)');
    expect(baked[0][5], 'the fill is drawn away; only its shadow lands').toBeGreaterThan(0);
    expect(pools()).toHaveLength(2);
  });

  it('a level of 0 draws nothing, and a host off screen is culled before its style is read', async () => {
    document.body.innerHTML = '<div id="off"></div><div id="far"></div>';
    backlit(document.getElementById('off'), { level: '0' });
    const far = backlit(document.getElementById('far'));
    rects.set(far, { left: 100, top: 5000, width: 600, height: 400, right: 700, bottom: 5400 });
    await painted();
    expect(pools()).toHaveLength(0);
  });

  it('casts its haze at its own share, on the room\'s dial', async () => {
    document.body.innerHTML = '<div id="p"></div>';
    const p = backlit(document.getElementById('p'));
    props.get(p)['--backlight-haze'] = '2';
    props.get(document.documentElement)['--haze-gain'] = '1.5';
    const m = await painted();
    const drawn = pools();
    expect(drawn).toHaveLength(2);
    expect(drawn[0][1], 'the haze first, under the near light').toBeCloseTo(0.47 * 2 * (1.5 / m._lighting.HAZE_MAX) ** 2, 5);
  });

  it('follows a host\'s --backlight transition, and listens for it generically', async () => {
    document.body.innerHTML = '<div id="p"></div>';
    const p = backlit(document.getElementById('p'));
    const m = await painted();
    m._lighting.onDial({ type: 'transitionrun', propertyName: '--backlight', target: p });
    expect(m._lighting.dialing()).toBe(true);
    m._lighting.onDial({ type: 'transitionend', propertyName: '--backlight', target: p });
    expect(m._lighting.dialing()).toBe(false);
    expect(CODE).toContain("attributeFilter: ['data-lit', 'data-heat', 'data-seam', 'data-backlit']");
  });
});

describe('light layers — light that belongs to scrolling content scrolls with it (K45)', () => {
  const seamIn = (host) => {
    host.innerHTML = '<div id="card"></div>';
    return lamp(document.getElementById('card'), { x: 50, y: 50, w: 300, h: 80, attr: 'data-seam', val: 'box' });
  };

  it('builds a canvas INSIDE the host, at the bottom of its content, hidden from assistive tech', async () => {
    document.body.innerHTML = '<main id="m" data-light-layer></main>';
    const host = document.getElementById('m');
    seamIn(host);
    await painted();
    const layer = host.querySelector('canvas.lighting-layer');
    expect(layer, 'one layer per host').toBeTruthy();
    expect(host.querySelectorAll('canvas.lighting-layer')).toHaveLength(1);
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.parentElement).toBe(host);
  });

  it('draws the host\'s emitters into the layer, not into the fixed canvas', async () => {
    document.body.innerHTML = '<main id="m" data-light-layer></main><div id="chrome"></div>';
    seamIn(document.getElementById('m'));
    const m = await painted();
    // The fixed canvas composites its buffer onto the page only when it has
    // light of its own; a lone emitter inside a layer leaves it dark.
    const fixedComposite = calls.filter((c) => c[0] === 'drawImage' && c[2] === 'source-over' && c[3] && c[3].id !== undefined && c[3] === m._lighting.layers().get(document.getElementById('m'))?.canvas);
    expect(fixedComposite, 'the layer is never composited by the fixed path').toHaveLength(0);
    expect(m._lighting.layers().size).toBe(1);
    expect(pools().length, 'but its light was drawn — into the layer').toBeGreaterThan(0);
  });

  it('a scroll of the host costs nothing; a scroll elsewhere repaints the fixed canvas', async () => {
    document.body.innerHTML = '<main id="m" data-light-layer></main><nav id="side"></nav>';
    const host = document.getElementById('m');
    seamIn(host);
    await painted();
    tick(5000);
    expect(frames).toHaveLength(0);
    host.dispatchEvent(new Event('scroll'));
    expect(frames, 'the layer moves with its content on the compositor').toHaveLength(0);
    document.getElementById('side').dispatchEvent(new Event('scroll'));
    expect(frames, 'a fixed emitter may have moved').toHaveLength(1);
  });

  it('textures the layer with a PERIODIC tile of the same membrane, as a CSS mask', async () => {
    document.body.innerHTML = '<main id="m" data-light-layer></main>';
    const host = document.getElementById('m');
    seamIn(host);
    props.get(document.documentElement)['--substrate-gain'] = '0.55';
    const m = await painted();
    const tile = decodeURIComponent(m._lighting.substrateTileURL());
    const cell = m._lighting.SUBSTRATE_CELL;
    expect(tile).toMatch(new RegExp(`width='${cell}' height='${cell}'`));
    const circles = tile.match(/<circle /g) || [];
    expect(circles.length, 'the supercell holds ten pores and ten staggered ones, plus their wraps').toBeGreaterThanOrEqual(20);
    const st = host.querySelector('canvas.lighting-layer').style;
    expect(st.maskImage || st.webkitMaskImage).toContain('data:image/svg+xml');
    // Laid at the device ratio (K50): the tile is drawn in device px, so at
    // 2× (the stub's ratio) a 22px supercell is 11 CSS px.
    expect(st.maskSize || st.webkitMaskSize).toBe(`${cell / 2}px ${cell / 2}px, 100% 100%`);
  });

  it('the stylesheet makes the host the layer\'s stacking context and the markup names .main', () => {
    const CSSF = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
    const HTMLF = readFileSync(join(process.cwd(), 'dev', 'field-console.html'), 'utf8');
    expect(HTMLF).toMatch(/<main class="main" data-light-layer( data-light-spill)?>/);
    expect(CSSF).toMatch(/\n\.main \{[^}]*isolation: isolate;/);
    expect(CSSF).toMatch(/\n\.lighting-layer \{[^}]*position: absolute;[^}]*z-index: -1;[^}]*pointer-events: none;/);
  });
});

describe('the phone pass — light that costs what changed, not what exists (K49)', () => {
  const host = (scrollTop = 0) => {
    // The test DOM has no layout, so an observer would call every marker
    // visible; the window's edges are pinned by source below.
    globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
    document.body.innerHTML = '<main id="m" data-light-layer><div id="card"></div></main><div id="toast"></div>';
    const m = document.getElementById('m');
    for (const [k, v] of Object.entries({ clientWidth: 1000, clientHeight: 800, scrollHeight: 100000, scrollTop, clientLeft: 0, clientTop: 0, scrollLeft: 0 })) {
      Object.defineProperty(m, k, { value: v, configurable: true });
    }
    rects.set(m, { left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 });
    const card = document.getElementById('card');
    card.setAttribute('data-backlit', '');
    rects.set(card, { left: 100, top: 100, width: 300, height: 200, right: 400, bottom: 300 });
    props.set(card, { '--lit-rgb': '255, 0, 0', '--backlight': '0.4' });
    return { m, card };
  };

  it('bakes a sprite at a quantised size, so near-identical boxes share it', async () => {
    const m = await load();
    const q = m._lighting.spriteSize;
    expect([q(3), q(100), q(101), q(302), q(1000)]).toEqual([3, 100, 100, 304, 1008]);
  });

  it('keeps what it uses: a hit moves to the back of the cache', async () => {
    const m = await load();
    const a = m._lighting.backlightSprite(100, 40, 4, 6, '255, 0, 0');
    m._lighting.backlightSprite(120, 40, 4, 6, '255, 0, 0');
    expect(m._lighting.backlightSprite(100, 40, 4, 6, '255, 0, 0')).toBe(a);
    expect([...m._lighting.sprites().keys()].pop()).toMatch(/^back:100x40/);
    expect(m._lighting.SPRITE_CAP).toBeGreaterThan(48);
    expect(m._lighting.SPRITE_PX_BUDGET).toBeGreaterThan(0);
  });

  it('a layer lights a WINDOW around the viewport, however long the content', async () => {
    const { m } = host(30000);
    const mod = await load();
    expect(mod._lighting.layerWindow(m)).toEqual({ top: 29200, bottom: 32400 });
    expect(mod._lighting.LAYER_WINDOW_BEFORE).toBe(1);
    expect(mod._lighting.LAYER_WINDOW_AFTER).toBe(2);
  });

  it('the window never runs past the content: a scroll left there by a longer surface cannot hold it open (K52b)', async () => {
    const mod = await load();
    const h = { clientHeight: 800, scrollTop: 6000, scrollHeight: 6800 };
    // Publish is 1600 tall; the scroll is still where the buffer left it.
    expect(mod._lighting.layerWindow(h, 1600)).toEqual({ top: 0, bottom: 1600 });
    // Inside the content it is the window it always was.
    expect(mod._lighting.layerWindow({ clientHeight: 800, scrollTop: 2000 }, 30000)).toEqual({ top: 1200, bottom: 4400 });
  });

  it('the content\'s height is its lowest child, never the layer\'s own canvas or markers (K52b)', async () => {
    const mod = await load();
    const kid = (offsetTop, offsetHeight) => ({ offsetTop, offsetHeight });
    const canvas = kid(9000, 4), mark = kid(9400, 1);
    const L = { canvas, marks: [mark, kid(0, 0)] };
    const host = { children: [kid(0, 0), kid(0, 1600), canvas, mark, L.marks[1]], scrollHeight: 9401 };
    expect(mod._lighting.contentHeight(host, L)).toBe(1600);
    // With no layout to read, the scroller's own height stands in.
    expect(mod._lighting.contentHeight({ children: [canvas], scrollHeight: 777 }, L)).toBe(777);
  });

  it('a lamp heating in the chrome (a toast) never repaints the content layer', async () => {
    const { m: hostEl } = host();
    const mod = await painted();
    const L = mod._lighting.layers().get(hostEl);
    expect(L && L.items, 'the layer had its full paint').toBeTruthy();
    // The licence arriving is a mutation, and a mutation repaints once.
    lamp(document.getElementById('toast'), { x: 900, y: 700, w: 200, h: 40 });
    await Promise.resolve();
    tick();
    const before = L.items;
    // …and then it heats over its curve, frame after frame.
    expect(tick(16) + tick(16) + tick(16), 'the toast is heating').toBeGreaterThan(0);
    expect(L.items, 'the layer was left alone while the toast heated').toBe(before);
  });

  it('a hand on a card redraws that card\'s region of the layer, not the whole layer', async () => {
    const { m: hostEl, card } = host();
    const mod = await painted();
    const L = mod._lighting.layers().get(hostEl);
    const W = L.canvas.width, H = L.canvas.height;
    // The layer's own arrival in the host is a mutation the engine hears once.
    await Promise.resolve();
    tick();
    calls = [];
    card.dispatchEvent(new Event('pointerover', { bubbles: true }));
    tick();
    const clears = calls.filter((c) => c[0] === 'clearRect');
    expect(clears.length).toBeGreaterThan(0);
    expect(clears.some((c) => c[1] === 0 && c[2] === 0 && c[3] === W && c[4] === H), 'no full clear of the layer').toBe(false);
  });

  it('content coming into range draws its own light as a region, not the whole layer (K58)', async () => {
    // A whole-layer repaint per element entering range made scrolling a list
    // of content-visibility: auto cards cost the light 2.2–2.9×; measured as
    // a region, the light is byte-identical at every scroll position.
    const { m: hostEl, card } = host();
    const mod = await painted();
    const L = mod._lighting.layers().get(hostEl);
    const W = L.canvas.width, H = L.canvas.height;
    await Promise.resolve();
    tick();
    calls = [];
    const enter = (skipped) => {
      const ev = new Event('contentvisibilityautostatechange', { bubbles: true });
      Object.defineProperty(ev, 'skipped', { value: skipped });
      card.dispatchEvent(ev);
    };
    enter(true);
    expect(frames, 'leaving range asks for nothing').toHaveLength(0);
    enter(false);
    tick();
    const clears = calls.filter((c) => c[0] === 'clearRect');
    expect(clears.length, 'its region was redrawn').toBeGreaterThan(0);
    expect(clears.some((c) => c[1] === 0 && c[2] === 0 && c[3] === W && c[4] === H), 'no full clear of the layer').toBe(false);
  });

  it('an emitter held in place over the content (sticky, fixed) belongs to the fixed canvas', async () => {
    document.body.innerHTML = '<main id="m" data-light-layer><header id="hdr"><div id="seam"></div></header></main>';
    const hdr = document.getElementById('hdr');
    const base = window.getComputedStyle;
    window.getComputedStyle = (el) => ({ ...base(el), position: el === hdr ? 'sticky' : 'static' });
    const mod = await load();
    const seam = document.getElementById('seam');
    expect(mod._lighting.heldInPlace(seam, document.getElementById('m'))).toBe(true);
    expect(mod._lighting.heldInPlace(document.getElementById('m'), document.getElementById('m'))).toBe(false);
  });

  it('asks whether a thing is rendered before it measures it, and follows content into view', () => {
    const boxOf = CODE.slice(CODE.indexOf('function boxOf('), CODE.indexOf('function culled('));
    expect(boxOf.indexOf('checkVisibility')).toBeGreaterThan(-1);
    expect(boxOf.indexOf('checkVisibility')).toBeLessThan(boxOf.indexOf('getBoundingClientRect'));
    expect(CODE).toMatch(/addEventListener\('contentvisibilityautostatechange'/);
    // A view entering with an animation: the layer fades with it, and is
    // redrawn when it lands.
    expect(CODE).toMatch(/addEventListener\('animationstart'/);
    expect(CODE).toMatch(/L\.canvas\.animate\(\[\{ opacity: 0 \}, \{ opacity: L\.expo \? L\.expo\.level : 1 \}\]/);
    expect(CODE).toMatch(/\['animationend', 'animationcancel'\]/);
    // The window's edges are watched by the browser, not on the scroll path.
    expect(CODE).toMatch(/new IntersectionObserver\(/);
    // The window and the emitter list are read only when they may have changed.
    expect(CODE).toMatch(/if \(!resizePending && sized\.w\) return false;/);
    expect(CODE).toMatch(/if \(gain > 0 && !liveCache\) \{ liveCache = emitters\(\); rosterGen\+\+; \}/);
  });

  it('reads the content\'s light profile off the root, for the layers only', () => {
    expect(CODE).toMatch(/setting\('content-back', \(\) => rootNum\('--light-content-backlight', 1, 0, 4\)/);
    expect(CODE).toMatch(/haze \* setting\('content-haze', \(\) => rootNum\('--light-content-haze', 1, 0, 4\)/);
  });
});

describe('eye adaptation — a surface arrives at the last one\'s brightness and settles (K50)', () => {
  const seamIn = (host, id = 'card') => {
    host.innerHTML += `<div id="${id}"></div>`;
    return lamp(document.getElementById(id), { x: 50, y: 50, w: 300, h: 80, attr: 'data-seam', val: 'box' });
  };
  const layerOf = (m, host) => m._lighting.layers().get(host);
  // happy-dom's scroll geometry is read-only; the engine only reads it.
  const sized = (host) => { for (const [k, v] of [['scrollTop', 0], ['clientHeight', 800], ['scrollHeight', 2000]]) Object.defineProperty(host, k, { value: v, configurable: true }); };

  it('is off at --light-adapt 0: the layer keeps its own opacity, and nothing is read back', async () => {
    document.body.innerHTML = '<main id="m" data-light-layer></main>';
    const host = document.getElementById('m');
    sized(host);
    seamIn(host);
    imageLuma = 200;
    const m = await painted();
    expect(layerOf(m, host).canvas.style.opacity).toBe('');
    expect(calls.filter((c) => c[0] === 'getImageData')).toHaveLength(0);
    expect(m._lighting.layerExposure(host, layerOf(m, host))).toBe(1);
  });

  it('reads the band on screen as a log-average, and brings a bright surface down toward the reference — never up, never past the floor', async () => {
    document.body.innerHTML = '<main id="m" data-light-layer></main>';
    const host = document.getElementById('m');
    sized(host);
    seamIn(host);
    props.get(document.documentElement)['--light-adapt'] = '0.6';
    const m = await painted();
    const L = layerOf(m, host);
    const { ADAPT_REF, ADAPT_MIN } = m._lighting;
    // A quiet surface (black band): nothing to adapt to, full exposure.
    imageLuma = 0;
    expect(m._lighting.layerMean(host, L)).toBe(0);
    expect(m._lighting.layerExposure(host, L)).toBe(1);
    // Dimmer than the reference: never lifted.
    imageLuma = 1;
    expect(m._lighting.layerMean(host, L)).toBeCloseTo(1, 5);
    expect(m._lighting.layerExposure(host, L)).toBe(1);
    // Brighter: brought down on the dial's power…
    imageLuma = 12;
    expect(m._lighting.layerExposure(host, L)).toBeCloseTo(Math.max(ADAPT_MIN, (ADAPT_REF / 12) ** 0.6), 5);
    // …and never past the floor.
    imageLuma = 250;
    expect(m._lighting.layerExposure(host, L)).toBe(ADAPT_MIN);
    // The band it reads is the viewport's share of the window, at the buffer's scale.
    const read = calls.filter((c) => c[0] === 'getImageData').at(-1);
    expect(read[3]).toBe(L.canvas.width);
    expect(read[4]).toBe(Math.round(800 * m._lighting.EM_SCALE));
  });

  it('the first exposure is where a layer starts; a change glides on --arm-cool, frame by frame, then the engine parks', async () => {
    document.body.innerHTML = '<main id="m" data-light-layer></main>';
    const host = document.getElementById('m');
    sized(host);
    seamIn(host);
    props.get(document.documentElement)['--light-adapt'] = '1';
    props.get(document.documentElement)['--arm-cool'] = COOL;
    imageLuma = 250;
    const m = await painted();
    const L = layerOf(m, host);
    const { ADAPT_MIN } = m._lighting;
    expect(L.canvas.style.opacity, 'no journey for a layer never seen before').toBe(ADAPT_MIN.toFixed(3));
    tick(100);
    expect(frames, 'and nothing moves: the engine is parked').toHaveLength(0);
    // The surface changes to a quiet one: a full repaint, a new target, a glide.
    imageLuma = 0;
    m.lightingRepaint();
    tick(16);
    let n = 0;
    while (frames.length && n < 400) { tick(16); n++; }
    expect(n, 'frames for the length of the cool, then parked').toBeGreaterThan(20);
    expect(n).toBeLessThan(2600 / 16 + 5);
    expect(L.canvas.style.opacity, 'settled at full').toBe('');
    // Mid-glide it was between the two, on the curve, not at either end.
    imageLuma = 250;
    m.lightingRepaint();
    tick(16);
    for (let i = 0; i < 40; i++) tick(16);
    const mid = Number(L.canvas.style.opacity);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(ADAPT_MIN);
  });

  it('a surface that has just arrived never flashes bright: it jumps to a lower target, and glides to a higher one', async () => {
    document.body.innerHTML = '<main id="m" data-light-layer></main>';
    const host = document.getElementById('m');
    sized(host);
    seamIn(host);
    props.get(document.documentElement)['--light-adapt'] = '1';
    props.get(document.documentElement)['--arm-cool'] = COOL;
    imageLuma = 0;
    const m = await painted();
    const L = layerOf(m, host);
    const { ADAPT_MIN } = m._lighting;
    expect(L.canvas.style.opacity).toBe('');
    // A bright surface arrives (its view just entered): straight to its target.
    L.entered = clock;
    imageLuma = 250;
    m.lightingRepaint();
    tick(16);
    expect(L.canvas.style.opacity, 'arrived adapted').toBe(ADAPT_MIN.toFixed(3));
    tick(16);
    expect(frames, 'no glide to carry').toHaveLength(0);
    // The same change WITHOUT an arrival (the surface itself got brighter) glides.
    imageLuma = 0;
    m.lightingRepaint(); tick(16);
    while (frames.length) tick(16);
    expect(L.canvas.style.opacity).toBe('');
    L.entered = clock - 5000;
    imageLuma = 250;
    m.lightingRepaint(); tick(16); tick(16);
    expect(L.expo.target).toBe(ADAPT_MIN);
    expect(L.expo.level, 'still near the top of a 2.6s glide').toBeGreaterThan(ADAPT_MIN);
    expect(frames.length, 'frames to carry it').toBeGreaterThan(0);
  });

  it('a view fading in fades its light to the exposure it sits at, not to 1', () => {
    expect(CODE).toMatch(/L\.canvas\.animate\(\[\{ opacity: 0 \}, \{ opacity: L\.expo \? L\.expo\.level : 1 \}\]/);
    // The dial is one token on the root, read like the content profile.
    expect(CODE).toMatch(/rootNum\('--light-adapt', 0, 0, 1\)/);
    const CSSF = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
    expect(CSSF).toMatch(/--light-adapt:\s*0\.\d+;/);
  });
});

describe("an emitter's facts are read once per roster; only its dials every frame (K56)", () => {
  // Measured on a phone-speed trace: 11–18 thousand style reads in five
  // seconds of a surface arriving, nearly all of them facts (a colour, a
  // corner, a backlight's shape) read again on every frame of a dial moving.
  const counting = () => {
    const n = new Map();
    const base = window.getComputedStyle;
    window.getComputedStyle = (el) => {
      const cs = base(el);
      return { ...cs, getPropertyValue: (name) => { n.set(name, (n.get(name) || 0) + 1); return cs.getPropertyValue(name); } };
    };
    return (name) => n.get(name) || 0;
  };

  it("reads a heating lamp's colour once, and its level on every frame", async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'));
    const reads = counting();
    const m = await painted();
    tick(375);
    expect(reads('--lit-rgb'), 'read on the first frame that draws it').toBe(1);
    const levels = reads('--lit-level');
    tick(375); tick(375);
    expect(reads('--lit-rgb'), 'a dial moving is not a new roster').toBe(1);
    expect(reads('--lit-level') - levels, 'the dial is read every frame').toBe(2);
    // A full repaint — what a mutation, a resize or the theme sends — is a new roster.
    m._lighting.paint();
    expect(reads('--lit-rgb')).toBe(2);
  });

  it('reads the facts again for the emitter under a hand, and only for it', async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const a = lamp(document.getElementById('a'), { attr: 'data-seam', val: 'top', curves: false });
    lamp(document.getElementById('b'), { attr: 'data-seam', val: 'top', y: 200, curves: false });
    const reads = counting();
    const m = await painted();
    expect(reads('--lit-rgb')).toBe(2);
    // A state rule changes a's colour without a mutation the engine hears…
    props.set(a, { '--lit-rgb': '39, 201, 63' });
    m.lightingRepaint(true); tick(16);
    expect(reads('--lit-rgb'), 'no new roster, no new read').toBe(2);
    // …and the hand that caused it is the signal: a's facts, not b's.
    a.dispatchEvent(new Event('pointerover', { bubbles: true }));
    tick(16);
    expect(reads('--lit-rgb')).toBe(3);
    expect(bakes().some((c) => c[2] === 'rgba(39, 201, 63, 0.85)'), 'drawn in its new colour').toBe(true);
  });

  it('forgets an emitter whose transition ended, and splits the licence once per roster', () => {
    expect(CODE).toMatch(/if \(ev\.type !== 'transitionrun'\) forget\(ev\.target\);/);
    expect(CODE).toMatch(/if \(map\.gen === rosterGen && map\.gain === gain\) return advanceAll\(map, t\);/);
    expect(CODE).toMatch(/reconcile\(thermal, roster\.lit, gain, t\)/);
    expect(CODE).not.toMatch(/live\.filter\(isLit\)/);
  });
});

describe("the room's settings are read once per full repaint, never per frame (K56)", () => {
  const counting = () => {
    const n = new Map();
    const base = window.getComputedStyle;
    window.getComputedStyle = (el) => {
      const cs = base(el);
      return { ...cs, getPropertyValue: (name) => { n.set(name, (n.get(name) || 0) + 1); return cs.getPropertyValue(name); } };
    };
    return (name) => n.get(name) || 0;
  };

  it('reads the gain and the haze once while a lamp heats, and again after a full repaint', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'));
    const reads = counting();
    const m = await painted();
    const once = reads('--bloom-gain');
    expect(once).toBe(1);
    tick(375); tick(375); tick(375);
    expect(reads('--bloom-gain'), 'frames of a heat read nothing new').toBe(once);
    expect(reads('--haze-gain')).toBe(1);
    m.lightingRepaint(); tick(16);
    expect(reads('--bloom-gain'), 'a theme, a resize or a mutation reads it again').toBe(once + 1);
  });

  it('comes back on after paper: the cache is the repaint\'s, not the roster\'s', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { curves: false });
    props.set(document.documentElement, { '--bloom-gain': '0', '--haze-gain': '0' });
    const m = await painted();
    expect(pools(), 'paper: no light').toHaveLength(0);
    // DAYLIGHT → STUDIO is an attribute on <html>, which reaches a full repaint.
    props.set(document.documentElement, { '--bloom-gain': '1', '--haze-gain': '0' });
    m.lightingRepaint(); tick(16);
    expect(pools().length, 'the light is back').toBeGreaterThan(0);
  });

  it('reads the spill dial through the cache, off the scroll path', () => {
    expect(CODE).toMatch(/const gain = setting\('spill', \(\) => rootNum\('--spill-gain', 0, 0, 1\)\);/);
    expect(CODE).toMatch(/if \(fixedOnly !== true\) \{ layersDirty = true; liveCache = null; settingsGen\+\+; \}/);
  });
});
