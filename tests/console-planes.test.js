// @vitest-environment happy-dom
//
// THE BAYS, THE CAPS AND THE PLANES (2026-10-02) — the owner's craft pass on
// three things that were still paint rather than light:
//
//   • the ingestion bay's drag-over fade-up is now a HOVER too (a mouse never
//     saw it), and on a touch screen every bay WAKES each time its view comes
//     up — the same fade-up, crest, cool; bounded, one per arrival;
//   • the FN cover slot, empty, is a bay (it was a dashed stroke);
//   • the buffer's frame actions are backlit caps, not chips that fill red;
//   • a modal or a sheet is a PLANE: its rim is fed from above, its rules are
//     seams, and its light falls through the air onto the same substrate the
//     room uses — above the scrim, where the canvas cannot reach.
//
// dev/console-lighting-system.md §5.0, §5.8 and §5.9 are the contract.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = readFileSync(join(process.cwd(), 'dev', 'field-console.html'), 'utf8');
const FN = readFileSync(join(process.cwd(), 'js', 'console', 'fn-editor.js'), 'utf8');
const LIGHTING = readFileSync(join(process.cwd(), 'js', 'console', 'lighting.js'), 'utf8');

const rule = (sel) => {
  const m = RULES.match(new RegExp(`(?:^|\\n)${sel}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${sel}`);
  return m[1];
};

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });
const { wireDropzone, wakeBays, showView, BAY_WAKE_AT_MS, BAY_WAKE_HOLD_MS } = await import('../js/console-ui.js');

/** The four edge weights of a rim value (top, right, bottom, left): the
 *  first `calc(N * var(--seam-level)` in each top-level colour. */
function rimEdges(value) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map((p) => Number(p.match(/calc\(([\d.]+) \* var\(--seam-level\)/)[1]));
}
const ARM_COOL_MS = 2700;   // chrome.js: past --arm-cool, then the attribute comes off
const realMatchMedia = globalThis.matchMedia;

/** A touch screen (or not), with reduced motion on (or not). */
function media({ hover = false, reduced = false } = {}) {
  globalThis.matchMedia = (q) => ({
    matches: q === '(hover: none)' ? !hover : q === '(prefers-reduced-motion: reduce)' ? reduced : false,
    addEventListener() {}, removeEventListener() {},
  });
}

/** A bay with a box — happy-dom lays nothing out, and the wake skips a bay it cannot see. */
function sized(el) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 200, width: 600, height: 200, x: 0, y: 0 });
  return el;
}

function pointer(el, type, pointerType) {
  const e = new Event(type, { bubbles: false });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  el.dispatchEvent(e);
}

let n = 0;
function bay({ seam = true, view = null } = {}) {
  const id = `dz${++n}`;
  const host = view ? document.getElementById(view) : document.body;
  host.insertAdjacentHTML('beforeend', `
    <div class="dropzone" ${seam ? 'data-seam="box"' : ''} id="${id}"></div>
    <input type="file" id="${id}-in">`);
  const dz = sized(document.getElementById(id));
  wireDropzone(id, `${id}-in`, () => {});
  return dz;
}

afterEach(() => {
  vi.useRealTimers();
  globalThis.matchMedia = realMatchMedia;
  document.documentElement.removeAttribute('data-ignition');
  document.body.innerHTML = '';
});

// ------------------------------------------------------------- hover heats

describe('a pointer over a bay is the drag-over fade-up', () => {
  it('heats on enter and cools through the resting half on leave', () => {
    vi.useFakeTimers();
    const dz = bay();
    pointer(dz, 'pointerenter', 'mouse');
    expect(dz.getAttribute('data-heat')).toBe('hot');
    pointer(dz, 'pointerleave', 'mouse');
    expect(dz.getAttribute('data-heat'), 'cooling, not snapped off').toBe('');
    vi.advanceTimersByTime(ARM_COOL_MS + 100);
    expect(dz.hasAttribute('data-heat')).toBe(false);
  });

  it('a touch does not heat it — a tap opens the picker, and touch has the wake', () => {
    const dz = bay();
    pointer(dz, 'pointerenter', 'touch');
    expect(dz.hasAttribute('data-heat')).toBe(false);
  });

  it('a bay that is not a seam (the cover once it holds a picture) stays dark', () => {
    const dz = bay({ seam: false });
    pointer(dz, 'pointerenter', 'mouse');
    expect(dz.hasAttribute('data-heat')).toBe(false);
  });

  it('a drag that arrives over a hovered bay keeps it hot when the pointer leaves', () => {
    const dz = bay();
    pointer(dz, 'pointerenter', 'mouse');
    dz.dispatchEvent(new Event('dragenter', { bubbles: true, cancelable: true }));
    pointer(dz, 'pointerleave', 'mouse');
    expect(dz.getAttribute('data-heat')).toBe('hot');
  });
});

// ---------------------------------------------------------------- the wake

describe('on a touch screen the bays wake every time their view comes up', () => {
  function views() {
    document.body.innerHTML = `
      <div class="view active" id="view-wa"></div>
      <div class="view" id="view-wb"></div>`;
    return bay({ view: 'view-wa' });
  }

  it('fades up, crests, cools, and is still again', () => {
    vi.useFakeTimers();
    media();
    const dz = views();
    wakeBays(document.getElementById('view-wa'));
    expect(dz.hasAttribute('data-heat'), 'not before the swap has painted').toBe(false);
    vi.advanceTimersByTime(BAY_WAKE_AT_MS);
    expect(dz.getAttribute('data-heat')).toBe('hot');
    vi.advanceTimersByTime(BAY_WAKE_HOLD_MS);
    expect(dz.getAttribute('data-heat'), 'cooling on the slow curve').toBe('');
    vi.advanceTimersByTime(ARM_COOL_MS + 100);
    expect(dz.hasAttribute('data-heat'), 'bounded: nothing moves once it has cooled').toBe(false);
  });

  it('holds exactly one heat curve — a crest, no plateau', () => {
    const chrome = readFileSync(join(process.cwd(), 'js', 'console', 'chrome.js'), 'utf8');
    const heat = CSS.match(/--arm-heat:\s*([\d.]+)s/);
    expect(heat).toBeTruthy();
    expect(BAY_WAKE_HOLD_MS).toBe(Math.round(Number(heat[1]) * 1000));
    expect(chrome).toMatch(/BAY_WAKE_HOLD_MS = \d+;/);
  });

  it('the router wakes them on every arrival, and puts them out on the way out', () => {
    vi.useFakeTimers();
    media();
    const dz = views();
    showView('wb');
    showView('wa');
    vi.advanceTimersByTime(BAY_WAKE_AT_MS);
    expect(dz.getAttribute('data-heat')).toBe('hot');
    // Leaving mid-wake rests it at once (it is display:none by then) …
    showView('wb');
    expect(dz.hasAttribute('data-heat')).toBe(false);
    vi.advanceTimersByTime(BAY_WAKE_HOLD_MS + ARM_COOL_MS);
    expect(dz.hasAttribute('data-heat'), 'no stale timer relit it').toBe(false);
    // … and coming back lights it from dark again.
    showView('wa');
    vi.advanceTimersByTime(BAY_WAKE_AT_MS);
    expect(dz.getAttribute('data-heat')).toBe('hot');
  });

  it('re-showing the view you are already on is not an arrival', () => {
    vi.useFakeTimers();
    media();
    const dz = views();
    showView('wb');
    showView('wa');
    vi.advanceTimersByTime(BAY_WAKE_AT_MS + BAY_WAKE_HOLD_MS + ARM_COOL_MS + 100);
    expect(dz.hasAttribute('data-heat')).toBe(false);
    showView('wa');
    vi.advanceTimersByTime(BAY_WAKE_AT_MS);
    expect(dz.hasAttribute('data-heat')).toBe(false);
  });

  for (const [why, setup] of [
    ['a pointer that can hover (it heats the bay itself)', () => media({ hover: true })],
    ['reduced motion (the engine would jump — a blink)', () => media({ reduced: true })],
    ['the cold start running (it already lights the bays)', () => { media(); document.documentElement.setAttribute('data-ignition', ''); }],
  ]) {
    it(`does not run with ${why}`, () => {
      vi.useFakeTimers();
      setup();
      const dz = views();
      wakeBays(document.getElementById('view-wa'));
      vi.advanceTimersByTime(BAY_WAKE_AT_MS + 10);
      expect(dz.hasAttribute('data-heat')).toBe(false);
    });
  }

  it('skips a bay with no box and a bay that is not a seam', () => {
    vi.useFakeTimers();
    media();
    const dz = views();
    const flat = bay({ view: 'view-wa', seam: false });
    const hidden = bay({ view: 'view-wa' });
    hidden.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
    wakeBays(document.getElementById('view-wa'));
    vi.advanceTimersByTime(BAY_WAKE_AT_MS + 1000);
    expect(dz.getAttribute('data-heat')).toBe('hot');
    expect(flat.hasAttribute('data-heat')).toBe(false);
    expect(hidden.hasAttribute('data-heat')).toBe(false);
  });

  it('boot wakes the first view when the cold start did not run', () => {
    const INIT = readFileSync(join(process.cwd(), 'js', 'console', 'init.js'), 'utf8');
    expect(INIT).toMatch(/const coldStart = igniteConsole\(\);/);
    expect(INIT).toMatch(/if \(!coldStart\) wakeBays\(document\.querySelector\("\.view\.active"\)\);/);
    // …and after the bays are wired, or there is nothing to wake.
    expect(INIT.indexOf('wakeBays(document')).toBeGreaterThan(INIT.lastIndexOf('wireDropzone('));
  });
});

// --------------------------------------------------------- the cover slot

describe('the FN cover slot, empty, is a bay', () => {
  it('ships as a seam host and trades the dashed stroke for the bay\'s glass', () => {
    expect(HTML).toMatch(/<div class="fn-hero" data-seam="box" id="fn-hero-slot"/);
    const rest = rule('\\.fn-hero\\[data-seam\\]');
    expect(rest).toMatch(/border:\s*1px solid transparent/);   // K50: no stroke
    expect(rest).toMatch(/background:[^;]*var\(--frost-0\)/);
    expect(rest).toMatch(/var\(--glass-edge\)/);
    expect(rest).not.toMatch(/dashed/);
    const hot = rule('\\.fn-hero\\[data-seam\\]\\.over, \\.fn-hero\\[data-seam\\]\\[data-heat="hot"\\]');
    expect(hot).toMatch(/--seam-level:\s*1;/);   // K50: hot is the bay's own dial, not a border colour
    expect(hot).toMatch(/border-color: transparent/);   // K50c: no stroke while hot either
    expect(hot).toMatch(/box-shadow var\(--arm-heat\)/);
    expect(RULES).toMatch(/\.fn-hero\[data-heat\], \.fn-hero\[data-heat="hot"\] \{ filter: none; \}/);
  });

  it('a picture is not glass: the seam comes off with the cover and back when it clears', () => {
    const set = FN.slice(FN.indexOf('export function fnHeroSet'), FN.indexOf('export function fnHeroClear'));
    const clear = FN.slice(FN.indexOf('export function fnHeroClear'));
    expect(set).toMatch(/slot\.removeAttribute\("data-seam"\)/);
    expect(clear.slice(0, 1200)).toMatch(/slot\.setAttribute\("data-seam", "box"\)/);
  });
});

// ---------------------------------------------------------------- the caps

describe('the frame actions are backlit caps, not chips that fill red', () => {
  it('never fill solid: hover lights the cap from inside, both halves declared', () => {
    const rest = rule('\\.frame-action');
    const hot = rule('\\.frame-action:hover, \\.frame-action:focus-visible, \\.frame-action\\.featured:hover');
    expect(hot).not.toMatch(/background:\s*var\(--(accent|green)\)/);
    expect(hot).toMatch(/color:\s*var\(--lit-hot\)/);
    // Every shadow list is three entries at both ends, so it heats.
    const count = (s) => (s.match(/box-shadow:([^;]*);/)[1].match(/rgba\(/g) || []).length;
    expect(count(rest)).toBe(3);
    expect(count(hot)).toBe(3);
    expect(rest).toMatch(/inset 0 0 8px rgba\(var\(--lit-rgb\), 0\)/);
    expect(hot).toMatch(/inset 0 0 8px rgba\(var\(--lit-rgb\), 0\.\d+\)/);
    expect(hot).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('the tone is the action\'s: promote lights in ok, a featured cap rests lit', () => {
    expect(RULES).toMatch(/\.frame-action\.promote \{ --lit-rgb: var\(--ok-rgb\); \}/);
    expect(RULES).not.toMatch(/\.frame-action\.promote:hover\s*\{[^}]*background:\s*var\(--green\)/);
    expect(rule('\\.frame-action\\.featured')).toMatch(/text-shadow:\s*var\(--lit-legend\)/);
  });

  it('the cluster comes up left to right on the way in, opacity only', () => {
    expect(RULES).toMatch(/\.buffer-frame:hover \.frame-action:nth-child\(2\) \{ transition-delay: \d+ms; \}/);
    // Always visible where there is no hover.
    expect(RULES).toMatch(/@media \(hover: none\) \{\s*\.buffer-frame \.frame-actions, \.buffer-frame \.frame-action \{ opacity: 1; \}/);
  });
});

// -------------------------------------------------------------- the planes

describe('a modal or a sheet is a plane: its light is above the scrim', () => {
  const PLANES = '\\.modal-overlay \\.modal, \\.sheet-overlay \\.sheet, \\.sheet-overlay \\.welcome';

  it('carries no data-seam — the canvas is under the scrim by design and must not try', () => {
    for (const tag of HTML.match(/<div class="(?:modal|sheet|welcome)\b[^"]*"[^>]*>/g) || []) {
      expect(tag).not.toMatch(/data-seam/);
    }
  });

  it('resolves the seam\'s derived tokens, and its rules are gaps (K50: no line runs along the interface)', () => {
    expect(RULES).toMatch(/\n\[data-seam\], \[data-tier\],\n\.modal-overlay \.modal, \.sheet-overlay \.sheet, \.sheet-overlay \.welcome \{/);
    for (const sel of ['\\.modal-overlay \\.modal-header, \\.sheet-overlay \\.fn-drawer-hdr', '\\.modal-overlay \\.modal-footer', '\\.modal-overlay \\.modal-section-title']) {
      expect(rule(sel), sel).toMatch(/1px solid transparent/);
      expect(rule(sel), sel).toMatch(/border-image:\s*none/);
    }
  });

  it('is a slab of glass held over the room: no stroke, its thickness, its near field (K50)', () => {
    // The selector also closes the seam-token list, so take the rule that
    // stands on its own line: the rim, not the tokens.
    const p = RULES.match(new RegExp(`\\}\\s*\\n${PLANES}\\s*\\{([^}]*)\\}`))[1];
    // K90: the plane's rim is its own lit token (the one stroke in the room),
    // off the seam's halo so paper (0) prints an edge of its own.
    expect(p).toMatch(/border-color:\s*var\(--plane-rim\);/);
    expect(RULES).toMatch(/--plane-rim: rgba\(var\(--lit-rgb\), calc\(var\(--seam-halo-a\) \* [\d.]+\)\);/);
    expect(RULES).toMatch(/:root\[data-theme="light"\] \{ --plane-rim: var\(--line-2\); \}/);
    // The light entering the glass enters at the bottom edge: the wash, and the edge's lip.
    expect(p).toMatch(/inset 0 -\d+px \d+px -\d+px rgba\(var\(--lit-rgb\)/);
    expect(p).toMatch(/var\(--glass-edge\)/);
    // The near field derives from the seam's own primitive, so on paper
    // (--seam-halo-a: 0) it is nothing and the lift returns.
    expect(p).toMatch(/var\(--seam-halo-a\)/);
    expect(p).toMatch(/var\(--plane-shadow\)/);
    expect(p).not.toMatch(/#[0-9a-fA-F]{3,8}\b|--seam-glow/);
  });

  it('the air is between the scrim and the plane, through the membrane, rising on open', () => {
    const air = rule('\\.modal-overlay::before, \\.sheet-overlay::before');
    expect(air).toMatch(/z-index:\s*-1/);
    expect(air).toMatch(/pointer-events:\s*none/);
    expect(air).toMatch(/mask-image:\s*var\(--substrate-pores\)/);
    expect(air).toMatch(/var\(--substrate-gain\) \* 0\.55/);
    // Laid as a tile at the engine's size (K50), not stretched over the plane.
    expect(air).toMatch(/mask-size:\s*var\(--substrate-size\) var\(--substrate-size\), 100% 100%/);
    expect(air).toMatch(/mask-repeat:\s*repeat, no-repeat/);
    expect(air).toMatch(/opacity:\s*var\(--plane-rest\)/);
    expect(air).toMatch(/animation:\s*plane-air/);
    expect(RULES).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.modal-overlay::before, \.sheet-overlay::before \{ animation: none; \}/);
    // Opacity only: the compositor carries it, and nothing inside the plane repaints.
    const kf = RULES.match(/@keyframes plane-air \{([\s\S]*?)\n\}/)[1];
    expect(kf.replace(/animation-timing-function:[^;]*;/g, '')).not.toMatch(/(?<![-\w])(?!opacity)[a-z-]+:\s/);
  });

  it('follows the room\'s dials: the haze squared, and dark wherever the pool is off', () => {
    expect(RULES).toMatch(/--plane-haze:\s*calc\(var\(--haze-gain\) \* var\(--haze-gain\) \/ 9 \* min\(1, var\(--bloom-gain\)\)\)/);
    const light = CSS.slice(CSS.indexOf(':root[data-theme="light"] {'));
    expect(light.slice(0, light.indexOf('}'))).toMatch(/--plane-shadow:\s*var\(--shadow-3\)/);
  });

  it('its membrane is the engine\'s: the stylesheet carries the engine\'s tile at 1× as the fallback, and the engine writes it at boot (K50)', async () => {
    const m = await import('../js/console/lighting.js');
    const css = CSS.match(/--substrate-pores:\s*(url\("data:image\/svg\+xml,[^"]*"\));/)[1];
    expect(css).toBe(m._lighting.substrateTileURL());
    expect(CSS).toMatch(new RegExp(`--substrate-size:\\s*${m._lighting.SUBSTRATE_CELL}px;`));
    const depth = Number(LIGHTING.match(/const SUBSTRATE_DEPTH = ([\d.]+);/)[1]);
    expect(rule('\\.modal-overlay::before, \\.sheet-overlay::before')).toMatch(new RegExp(`var\\(--substrate-gain\\) \\* ${depth}`));
    // The engine publishes both onto the root at init and again on resize.
    expect(LIGHTING).toMatch(/st\.setProperty\('--substrate-pores', substrateTileURL\(\)\)/);
    expect(LIGHTING).toMatch(/st\.setProperty\('--substrate-size', `\$\{\+substrateCell\(\)\.toFixed\(3\)\}px`\)/);
    expect(LIGHTING.match(/writeMembrane\(\);/g).length).toBeGreaterThanOrEqual(2);
  });
});
