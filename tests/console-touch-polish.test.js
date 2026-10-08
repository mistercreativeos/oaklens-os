// THE TOUCH BAND'S POLISH (K50b, 2026-10-04 — the owner, on the phone, after
// K50 went live). Seven notes, each one mechanism:
//   • no title, no glass header on a phone — the stats as one quiet line;
//   • a surface switch is a crossfade, never a cut (View Transitions);
//   • the FN glyph is a stroked glyph that takes the accent, not an emoji;
//   • the tab bar is tinted, emissive glass, lit from behind by the engine;
//   • the settings LED sits back;
//   • pills and chips draw no cold-iron edge (pinned in the ladder test);
//   • the bay's tint cools instead of snapping (pinned in the emissive test).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = readFileSync(join(process.cwd(), 'dev', 'field-console.html'), 'utf8');
const CHROME = readFileSync(join(process.cwd(), 'js', 'console', 'chrome.js'), 'utf8');
const rule = (sel) => (RULES.match(new RegExp(`\\n${sel} \\{([^}]*)\\}`)) || [])[1];
const PHONE = '@media (max-width: 760px), (pointer: coarse) and (max-height: 500px)';

describe('a phone has no view title and no glass header — the stats, one line, under the top row', () => {
  // The second phone block (the first is the phone's light).
  const blocks = [...RULES.matchAll(new RegExp(PHONE.replace(/[()]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\n\\}', 'g'))].map((m) => m[1]);
  it('lives in the same media as the phone\'s light, and the iPad keeps its large title', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const hdr = blocks.find((b) => b.includes('.view-header'));
    expect(hdr).toBeTruthy();
    expect(hdr).toMatch(/\.view:not\(#view-fn\) \.view-header,\s*body\.hdr-compact \.view:not\(#view-fn\) \.view-header \{[^}]*position: static;[^}]*backdrop-filter: none;[^}]*padding: 0;/);
    expect(hdr).toMatch(/\.view:not\(#view-fn\) \.view-title,\s*\.view:not\(#view-fn\) \.view-sub \{ display: none; \}/);
    expect(hdr).toMatch(/\.view:not\(#view-fn\) \.view-meta \{[^}]*display: flex;[^}]*font-size: var\(--t-micro\)/);
    // The band's sticky rule is untouched (tests/console-viewport.test.js pins its arithmetic).
    expect(RULES).toMatch(/\.view:not\(#view-fn\) \.view-header \{\s*position: sticky;/);
  });
});

describe('a surface switch is a crossfade, never a cut', () => {
  it('showView swaps inside a View Transition where the browser has one, and plainly where it does not', () => {
    expect(CHROME).toMatch(/const swap = \(crossfaded = false\) => \{/);
    expect(CHROME).toMatch(/if \(arriving && _crossfades\(\) && !\(seed && seed\.focus\)\) \{[\s\S]{0,400}?const vt = document\.startViewTransition\(\(\) => swap\(true\)\);[\s\S]{0,300}?\} else swap\(\);/);
    expect(CHROME).toMatch(/typeof document\.startViewTransition !== "function"\) return false;/);
    expect(CHROME).toMatch(/prefers-reduced-motion: reduce\)"\)\.matches/);
    // The bookkeeping stays synchronous: the current view and the outgoing cleanup are settled before the swap.
    const fn = CHROME.slice(CHROME.indexOf('export function showView('), CHROME.indexOf('function _crossfades('));
    expect(fn.indexOf('_currentView = name;')).toBeLessThan(fn.indexOf('const swap = '));
    expect(fn.indexOf('onLeave?.()')).toBeLessThan(fn.indexOf('const swap = '));
  });
  it('the stylesheet gives the crossfade the UI curve and turns it off under reduced motion', () => {
    expect(RULES).toMatch(/::view-transition-old\(console-pane\),\s*::view-transition-new\(console-pane\) \{\s*animation-duration: \d+ms;\s*animation-timing-function: var\(--ease-out\);/);
    expect(RULES).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-group\(\*\), ::view-transition-old\(console-pane\), ::view-transition-new\(console-pane\) \{ animation: none; \}/);
  });

  // K79: the transition captures the pane, not the page: the chrome and the
  // light's masked canvases stay live (Safari drew every switch at 30 fps
  // while it re-rendered a whole-page capture), and the view does not also
  // run its own entrance inside the crossfade.
  it('captures the pane only, and the view\'s entrance does not run inside the crossfade', () => {
    expect(RULES).toMatch(/\n:root \{ view-transition-name: none; \}/);
    expect(RULES).toMatch(/\n\.main \{ view-transition-name: console-pane; \}/);
    expect(RULES).toMatch(/\n\.view\.active\.vt-in \{ animation: none; \}/);
    expect(CHROME).toMatch(/document\.getElementById\("view-" \+ name\)\?\.classList\.toggle\("vt-in", crossfaded\);\s*_markActive\(name\);/);
  });
  it('the Bridge\'s floor light, outside the pane, fades with the crossfade (and not inside the ignition)', () => {
    expect(RULES).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.room-floor \{ transition: opacity 420ms var\(--ease-out\); \}/);
    expect(RULES).toMatch(/:root\[data-ignition\] \.room-floor \{ will-change: opacity; transition: none; \}/);
  });
});

describe('the glyphs and the lamp', () => {
  it('the FN glyph is a stroked glyph that takes the accent, in the sidebar and the tab bar', () => {
    expect(HTML).not.toMatch(/✍/);
    expect(HTML).toMatch(/<span class="nav-icon" data-text="act">✎<\/span>/);
    expect(HTML).toMatch(/<span class="tab-icon">✎<\/span>/);
  });
  it('the settings LED sits back: the die dimmed, a quarter of the glow', () => {
    const led = RULES.match(/\n\.settings-status-dot \{([^}]*--led-rgb: var\(--brand-rgb\)[^}]*)\}/)[1];
    expect(led).toMatch(/background: color-mix\(in srgb, rgb\(var\(--led-rgb\)\) \d+%, black\)/);
    const glow = Number(led.match(/0 0 \d+px rgba\(var\(--led-rgb\), ([\d.]+)\)/)[1]);
    expect(glow).toBeLessThanOrEqual(0.3);
  });
});

describe('the tab bar is the room\'s floor — a solid slab of lit glass (K50b, reworked K51)', () => {
  const bar = rule('\\.tabbar');
  it('is backlit by the engine, sitting high so its light spills up into the content — and carries no seam strip', () => {
    expect(HTML).toMatch(/<nav class="tabbar" aria-label="Primary" data-backlit>/);
    expect(bar).toMatch(/--backlight: var\(--backlight-tabbar\)/);
    expect(Number(bar.match(/--backlight-y: (-?[\d.]+)/)[1])).toBeLessThan(0);
    expect(CSS).toMatch(/--backlight-tabbar: 0\.\d+;/);
  });
  it('is opaque and looks through nothing, so a crossfade behind it cannot change it', () => {
    // The last background layer is the slab itself, and no backdrop is sampled.
    expect(bar).toMatch(/background:[^;]*var\(--floor-base\);/);
    expect(bar).toMatch(/--floor-base: color-mix\(in srgb, rgb\(var\(--lit-rgb\)\) calc\([\d.]+% \* var\(--float-k\)\), var\(--surface-0\)\);/);
    expect(bar).not.toMatch(/backdrop-filter/);
    expect(bar).not.toMatch(/var\(--glass\)/);
    // No top lip: the edge exists only while a pulse runs along it.
    expect(bar).not.toMatch(/box-shadow/);
    expect(CSS).not.toMatch(/--floor-edge:/);
    expect(bar).toMatch(/isolation: isolate/);
    // Lit from its bottom edge, and every light in it scales with --float-k.
    expect(bar).toMatch(/linear-gradient\(0deg, rgba\(var\(--lit-rgb\), calc\(0\.\d+ \* var\(--float-k\)\)\)/);
    expect(bar.match(/var\(--float-k\)/g).length).toBeGreaterThanOrEqual(3);
    const pores = rule('\\.tabbar::before');
    expect(pores).toMatch(/mask-image: var\(--substrate-pores\)/);
    expect(pores).toMatch(/z-index: -1/);
    // On paper, solid paper.
    expect(RULES).toMatch(/:root\[data-theme="light"\] \.tabbar \{ --floor-base: var\(--surface-1\); background: var\(--floor-base\); box-shadow: none; \}/);
    expect(RULES).toMatch(/:root\[data-theme="light"\] \.tabbar::before \{ content: none; \}/);
  });
  it('the content sinks into it through a feather that starts at the slab\'s own colour', () => {
    const f = rule('\\.tabbar::after');
    expect(f).toMatch(/bottom: 100%;/);
    expect(f).toMatch(/pointer-events: none;/);
    expect(f).toMatch(/background: linear-gradient\(0deg, var\(--floor-base\),[^;]*transparent\);/);
    // The feather fits inside the view's bottom padding, so the last row clears it.
    const h = Number(f.match(/height: (\d+)px;/)[1]);
    const pad = Number(RULES.match(/\.view \{ padding-bottom: calc\((\d+)px \+ var\(--tabbar-rsv\)/)[1]);
    expect(h).toBeLessThanOrEqual(pad);
  });
  it('every key is hotter than the floor: a well under each legend, lit for the current surface and warm for pending work', () => {
    const well = rule('\\.tab-btn::before');
    expect(well).toMatch(/radial-gradient\(closest-side, rgba\(var\(--lit-rgb\), calc\(0\.\d+ \* var\(--float-k\)\)\)/);
    // Only opacity and transform move: compositor work.
    expect(well).toMatch(/transition: opacity var\(--key-cool\) var\(--ease-cool\), transform var\(--key-cool\) var\(--ease-cool\);/);
    const rest = Number(well.match(/opacity: var\(--key-well, ([\d.]+)\)/)[1]);
    expect(rest).toBeGreaterThan(0);
    expect(rest).toBeLessThan(0.5);
    expect(RULES).toMatch(/\.tab-btn\.active::before \{ --key-well: 1;/);
    const pending = Number(RULES.match(/\.tab-btn\[data-lit\]:not\(\.active\)::before \{ --key-well: ([\d.]+); \}/)[1]);
    expect(pending).toBeGreaterThan(rest);
    expect(pending).toBeLessThan(1);
    // A pending key draws no box: the generic lit halo is off on a tab cell.
    expect(RULES).toMatch(/\.tab-btn\[data-lit\] \{ background: transparent; box-shadow: none; \}/);
    // Heats fast, lets go slowly.
    const heat = parseInt(RULES.match(/--key-heat: (\d+)ms/)[1], 10);
    const cool = parseInt(RULES.match(/--key-cool: (\d+)ms/)[1], 10);
    expect(heat).toBeLessThan(cool);
  });
});

// ---- K50c: the owner's second read from the phone --------------------------
describe('K50c — no shift, no freeze, no stroke', () => {
  const CHROME2 = readFileSync(join(process.cwd(), 'js', 'console', 'chrome.js'), 'utf8');
  const BUFFER = readFileSync(join(process.cwd(), 'js', 'console', 'buffer.js'), 'utf8');
  const LIGHTING = readFileSync(join(process.cwd(), 'js', 'console', 'lighting.js'), 'utf8');
  const SESSION = readFileSync(join(process.cwd(), 'js', 'console', 'session.js'), 'utf8');

  it('the hot bay paints no stroke: the generic hot rule never reaches a bay (K50d)', () => {
    // K50c only OVERRODE the generic rule's accent border on the bays, and
    // the override lost: `:not(.btn-primary)` carries its argument's weight,
    // so the generic rule was two classes — the same as
    // `.dropzone[data-heat="hot"]` — and later in the file. Every bay but
    // the FN slot (a class heavier) wore a solid accent outline while hot;
    // this test passed the whole time, because it checked that the override
    // was written, not that it won. So the generic rule excludes the bays
    // itself, and the test holds the exclusion.
    const generic = RULES.match(/\n(\[data-heat="hot"\]:not\([^)]*\)) \{([^}]*)\}/);
    expect(generic, 'the generic hot rule').toBeTruthy();
    expect(generic[2]).toMatch(/border-color: var\(--accent\)/);
    for (const bay of ['.dropzone', '.fn-hero']) expect(generic[1], bay).toContain(bay);
    // No other rule may hand a hot thing the accent border without the same exclusion.
    for (const m of RULES.matchAll(/\n([^{}\n]*\[data-heat="hot"\][^{}]*)\{([^}]*)\}/g)) {
      if (!/border-color:\s*var\(--accent\)/.test(m[2])) continue;
      expect(m[1].trim(), 'an accent border on hot').toBe(generic[1]);
    }
    // The bays' own hot rules still say transparent.
    expect(rule('\\.dropzone\\.over, \\.dropzone\\[data-heat="hot"\\]')).toMatch(/border-color: transparent;/);
    expect(rule('\\.fn-hero\\[data-seam\\]\\.over, \\.fn-hero\\[data-seam\\]\\[data-heat="hot"\\]')).toMatch(/border-color: transparent;/);
  });

  it('the cold start redraws no canvas and holds the exposure; the buffer builds on demand, not underneath it', () => {
    // K78: it throttled the layers' repaints (one frame in four, K50c); now
    // it repaints none: the room is the canvases' opacity.
    expect(LIGHTING).not.toMatch(/IGNITE_LAYER_EVERY|IGNITE_FIXED_EVERY|igniteFrame/);
    // (K54b: nor while a lamp in the room is on a journey.)
    expect(LIGHTING).toMatch(/if \(!igniting\(\) && !journeying\(host\)\) setExposure\(L, layerExposure\(host, L\)\);/);
    // No background build: nothing in the buffer schedules a chunk on a timer
    // except the fallback for an environment without IntersectionObserver.
    expect(BUFFER.match(/setTimeout\(next, 0\)/g)).toHaveLength(2);
    expect(BUFFER).not.toMatch(/setTimeout\(more/);
    expect(Number(BUFFER.match(/BUFFER_CHUNK_FRAMES = (\d+)/)[1])).toBeLessThanOrEqual(64);
  });

  it('a top-row key is lit while its surface is up, like the help key (K50c; every such key since K63)', () => {
    expect(CHROME2).toMatch(/document\.querySelectorAll\("\.topbar \[data-key-for\]"\)\.forEach\(\(k\) => \{\s*if \(k\.dataset\.keyFor === name\) k\.setAttribute\("data-lit", "accent"\); else k\.removeAttribute\("data-lit"\);/);
    expect(HTML).toMatch(/id="pulse-topbar-btn" data-backlit data-key-for="pulse"/);
    expect(HTML).toMatch(/id="bridge-topbar-btn" data-backlit data-key-for="bridge"/);
  });

  it('Settings shows the console\'s version and folds the rest; the Display panel is gone', () => {
    expect(HTML).toMatch(/<details class="build-details" id="settings-build-details">\s*<summary class="modal-section-title">Build <span class="accent" id="settings-build-version">/);
    expect(HTML).not.toMatch(/id="settings-display"|modal-section-title">Display</);
    expect(CHROME2).toMatch(/document\.title\.match\(\/\\bv\(\\d\+\(\?:\\\.\\d\+\)\+\)\/\)/);
    expect(SESSION).not.toMatch(/renderViewportStamp/);
    expect(RULES).toMatch(/\.build-details > summary \{[^}]*cursor: pointer/);
  });
});

// ---- K50f: RAW Lens joins the glass; a row of cards wakes on arrival --------
describe('K50f', () => {
  const CHROME3 = readFileSync(join(process.cwd(), 'js', 'console', 'chrome.js'), 'utf8');

  it('RAW Lens is a plane of glass: its keys are the console\'s keys, its selection a lit cap, no slab, no stroke', () => {
    const lens = HTML.slice(HTML.indexOf('id="rawlens-modal"'), HTML.indexOf('id="rl-handoff"'));
    for (const id of ['rl-bursts-toggle']) expect(lens).toMatch(new RegExp(`class="btn btn-sm rl-tool[^"]*" id="${id}"`));
    expect(lens.match(/class="btn btn-sm rl-tool/g).length).toBeGreaterThanOrEqual(4);
    expect(lens).toMatch(/class="btn btn-sm rl-close" onclick="RawLens\.close\(\)"/);
    expect(RULES).toMatch(/\.rl-seg button\.active, \.rl-tool\.active,[^{]*\{[^}]*background: linear-gradient\(175deg, var\(--cap-top\), var\(--cap-bottom\)\)/);
    expect(rule('\\.rl-topbar, \\.rl-toolbar')).toMatch(/background: transparent; border-bottom-color: transparent;/);
    // The overrides are one-liners in the K50f block (the original rules stay where they were).
    for (const sel of ['\\.rl-day \\{ border-bottom-color: transparent; \\}', '\\.rl-tile \\{ border-color: transparent; \\}', '\\.rl-target \\{ border-color: transparent;']) {
      expect(RULES, sel).toMatch(new RegExp(sel));
    }
    expect(rule('\\.rl-overlay::before')).toMatch(/mask-image: var\(--substrate-pores\)/);
    expect(RULES).toMatch(/\n\.rl-handoff \{\s*--float-glow: [\d.]+;\s*border-color: transparent;[^}]*box-shadow: var\(--key-edge\)/);
  });

  it('a row of cards plays its own hover once on arrival — the same dial, the same curves, nothing new lit', () => {
    expect(HTML).toMatch(/<div class="publish-summary" data-wake-row>/);
    // The wake state IS the hover state: the card tier's warm dial and backlight.
    expect(RULES).toMatch(/\[data-tier="card"\]\[data-wake\] \{ --seam-level: var\(--emit-card-warm\); \}/);
    expect(RULES).toMatch(/\[data-backlit\]\[data-tier="card"\]\[data-wake\] \{ --backlight: var\(--backlight-card-warm\); \}/);
    expect(RULES).toMatch(/\[data-tier\]\[data-tier\]\[data-wake\] \{\s*transition: --seam-level var\(--tier-rise\), --backlight var\(--tier-rise\)/);
    // The router wakes on arrival and puts a row out on the way out; bounded and gated.
    expect(CHROME3).toMatch(/wakeBays\(document\.getElementById\("view-" \+ name\)\);\s*wakeRows\(document\.getElementById\("view-" \+ name\)\);/);
    expect(CHROME3).toMatch(/_restRows\(document\.getElementById\("view-" \+ _currentView\)\);/);
    const fn = CHROME3.slice(CHROME3.indexOf('export function wakeRows('), CHROME3.indexOf('function _restRow('));
    expect(fn).toMatch(/prefers-reduced-motion: reduce/);
    expect(fn).toMatch(/hasAttribute\("data-ignition"\)/);
    expect(fn).toMatch(/if \(!card\.matches\(":hover"\)\) card\.setAttribute\("data-wake", ""\)/);
    expect(fn).toMatch(/card\.removeAttribute\("data-wake"\), at \+ WAKE_ROW_HOLD_MS/);
    for (const k of ['WAKE_ROW_AT_MS', 'WAKE_ROW_STEP_MS', 'WAKE_ROW_HOLD_MS']) expect(CHROME3).toMatch(new RegExp(`export const ${k} = \\d+;`));
  });
});
