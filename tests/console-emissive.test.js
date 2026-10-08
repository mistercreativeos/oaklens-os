// @vitest-environment happy-dom
//
// THE EMISSIVE LAYER (K40, 2026-09-25) — the console's lighting as a system.
// dev/console-lighting-system.md is the contract; this file pins the parts of
// it that would silently stop being true:
//
//   • heat is ONE word (`data-heat`), and the commit ignition and the ingestion
//     bay's rod go through one helper, so they cannot drift apart in timing or
//     in trap-avoidance;
//   • the STRIKE — the legend's flash on release — is transition asymmetry with
//     both halves declared, buttons only, and off on paper;
//   • the FILAMENT is one primitive, built from the ladder, no literal colour,
//     opacity heating on the console's own curves, and no heartbeat;
//   • the ingestion bay is a recess that carries one, and a drop in flight
//     makes the rod hot — never the bay.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = readFileSync(join(process.cwd(), 'dev', 'field-console.html'), 'utf8');
const CHROME = readFileSync(join(process.cwd(), 'js', 'console', 'chrome.js'), 'utf8');

// The seam's derived tokens are declared on every seam host and, since
// 2026-10-02, on the planes (modals and sheets), which resolve them too.
const SEAM_HOSTS = '\\[data-seam\\], \\[data-tier\\],\\n\\.modal-overlay \\.modal, \\.sheet-overlay \\.sheet, \\.sheet-overlay \\.welcome';
const rule = (sel) => {
  const m = RULES.match(new RegExp(`(?:^|\\n)${sel}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${sel}`);
  return m[1];
};
const studio = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf(':root[data-theme="light"]'));
const daylight = (() => { const l = CSS.slice(CSS.indexOf(':root[data-theme="light"]')); return l.slice(0, l.indexOf('}')); })();

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });
const { heat, wireDropzone } = await import('../js/console-ui.js');

// ------------------------------------------------------------------ the strike

describe('the strike — the release is the acknowledgment', () => {
  it('declares both halves, so the flash interpolates instead of popping', () => {
    expect(studio).toMatch(/--lit-settle:\s*\d+ms/);
    expect(studio).toMatch(/--lit-strike:\s*0 0 \d+px rgba\(var\(--lit-rgb\)/);
    expect(studio).toMatch(/--lit-strike-off:\s*0 0 0 rgba\(var\(--lit-rgb\),\s*0\)/);
  });

  it('rests off and flashes on :active, on the button grammar and nothing wider', () => {
    const rest = RULES.match(/\n(\.btn, \.publish-btn, \.settings-btn, \.nav-btn, \.tab-btn, \.icon-btn, \.frame-action) \{([^}]*)\}/);
    expect(rest, 'the resting strike rule').toBeTruthy();
    expect(rest[2]).toMatch(/text-shadow:\s*var\(--lit-strike-off\)/);
    const hot = RULES.match(/\n\.btn:active, \.publish-btn:active, \.settings-btn:active, \.nav-btn:active,\n\.tab-btn:active, \.icon-btn:active, \.frame-action:active \{([^}]*)\}/);
    expect(hot, 'the active strike rule').toBeTruthy();
    expect(hot[1]).toMatch(/text-shadow:\s*var\(--lit-strike\)/);
    // A card's caption has no phosphor behind it: the strike list must not
    // grow to the press list.
    expect(hot[0]).not.toMatch(/archive-card|buffer-frame|asset-lib-item/);
  });

  it('settles on --lit-settle: every struck control carries the text-shadow transition', () => {
    for (const sel of ['\\.btn', '\\.publish-btn', '\\.settings-btn', '\\.nav-btn', '\\.tab-btn', '\\.icon-btn', '\\.frame-action']) {
      expect(rule(sel), `${sel} must transition text-shadow`).toMatch(/text-shadow var\(--lit-settle\)/);
    }
  });

  it('is off on paper, like the pool — a glow behind ink is a print artefact', () => {
    expect(daylight).toMatch(/--lit-strike:\s*var\(--lit-strike-off\)/);
  });
});

// ---------------------------------------------------------------- one word

describe('heat is one word, and one helper', () => {
  it('the stylesheet, the markup and the chrome no longer spell it data-armed', () => {
    expect(RULES).not.toMatch(/data-armed/);
    expect(HTML).not.toMatch(/data-armed/);
    expect(CHROME.replace(/\/\/.*$/gm, '')).not.toMatch(/data-armed/);
  });

  it('heat() writes the resting half first, then hot, and is idempotent while hot', () => {
    // dragover fires continuously under a drag; a flush per event would be
    // sixty layouts a second for nothing.
    document.body.innerHTML = '<i id="r"></i>';
    const el = document.getElementById('r');
    const seen = [];
    const real = el.setAttribute.bind(el);
    el.setAttribute = (n, v) => { if (n === 'data-heat') seen.push(v); real(n, v); };
    heat(el, true);
    heat(el, true);
    heat(el, true);
    expect(seen).toEqual(['', 'hot']);
  });

  it('settles the resting style with a style read, not a layout of the page (K56)', () => {
    const body = CHROME.slice(CHROME.indexOf('export function heat('), CHROME.indexOf('// ---- THE IGNITION SEQUENCE'));
    expect(body).toMatch(/for \(const el of list\) void getComputedStyle\(el\)\.filter;/);
    expect(body.replace(/\/\/.*$/gm, '')).not.toMatch(/offsetWidth/);
  });

  it('cools through the resting half and lets go only after --arm-cool has run', () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<i id="r"></i>';
      const el = document.getElementById('r');
      heat(el, true);
      const t = heat(el, false);
      expect(el.getAttribute('data-heat')).toBe('');
      vi.advanceTimersByTime(2600);
      expect(el.hasAttribute('data-heat'), 'still resting while the CSS cool runs').toBe(true);
      vi.advanceTimersByTime(200);
      expect(el.hasAttribute('data-heat')).toBe(false);
      expect(t).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it('re-heating cancels a cool in flight', () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<i id="r"></i>';
      const el = document.getElementById('r');
      heat(el, true);
      const t = heat(el, false);
      heat(el, true, t);
      vi.advanceTimersByTime(3000);
      expect(el.getAttribute('data-heat'), 'the second heat must survive the first cool timer').toBe('hot');
    } finally { vi.useRealTimers(); }
  });

  it('tolerates nothing to heat', () => {
    expect(() => heat(null, true)).not.toThrow();
    expect(() => heat([], false)).not.toThrow();
    expect(heat([null], true)).toBe(0);
  });
});

// ------------------------------------------------------------- the filament

describe('the filament is one primitive, built from the ladder', () => {
  it('is a channel on the light ladder with a cold core and a hot core', () => {
    expect(rule('\\.lm-rod'), 'a groove, not a well — on paper the well covered the rod').toMatch(/box-shadow:\s*var\(--edge-groove\)/);
    expect(CSS).toMatch(/--edge-groove:\s*inset 0 calc\(var\(--light-y\)[^;]*var\(--shade-/);
    expect(rule('\\.lm-rod::before')).toMatch(/--lit-cold-1[\s\S]*--lit-cold-2[\s\S]*--lit-cold-1/);
    const hot = rule('\\.lm-rod::after');
    expect(hot).toMatch(/rgb\(var\(--lit-rgb\)\)[\s\S]*var\(--lit-hot\)[\s\S]*rgb\(var\(--lit-rgb\)\)/);
    expect(hot).toMatch(/opacity:\s*0;/);
  });

  it('heats by opacity on the console\'s own asymmetric pair', () => {
    expect(rule('\\.lm-rod::after')).toMatch(/transition:\s*opacity var\(--arm-cool\)/);
    expect(RULES).toMatch(/\.lm-rod\[data-heat="hot"\]::after\s*\{[^}]*opacity:\s*1;[^}]*var\(--arm-heat\)/);
  });

  it('warms under the parent\'s hover only — warm is CSS, and never pools', () => {
    expect(RULES).toMatch(/:hover > \.lm-rod::after\s*\{[^}]*opacity:\s*0\.\d+/);
    // The engine's licence is lit + hot; a warm rod is not an emitter.
    const LIGHTING = readFileSync(join(process.cwd(), 'js', 'console', 'lighting.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(LIGHTING).not.toMatch(/data-heat="warm"/);
  });

  it('names no colour of its own and spends no heartbeat', () => {
    const blocks = [...RULES.matchAll(/[^\n{}]*\.lm-rod[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const b of blocks) {
      expect(b).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
      expect(b).not.toMatch(/animation/);
    }
  });

  it('keeps the reduced-motion bargain — the state, not the journey', () => {
    const rm = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\[data-heat\], \[data-heat="hot"\] \{ transition: none; \}/);
    expect(rm).toMatch(/\.lm-rod::after \{ transition: none; \}/);
  });
});

// ------------------------------------------------------------ the ingestion bay

describe('the ingestion bay is an event — the bay itself is the emitter', () => {
  it('is frosted glass over the light, with both halves of its rim declared', () => {
    const dz = rule('\\.dropzone');
    expect(dz).toMatch(/background:[^;]*var\(--frost-0\)/);
    expect(dz).toMatch(/var\(--edge-in\)/);
    expect(dz).not.toMatch(/dashed/);
    // The resting wash is the hot wash at zero, so it heats instead of blinking.
    expect(dz).toMatch(/inset 0 0 48px rgba\(var\(--lit-rgb\), 0\)/);
    // …and the resting TINT is the hot tint at zero, as a shadow fill (K50b):
    // a gradient layer in `background` did not interpolate in Chromium, so
    // the tint snapped off at the first frame of the cool. Both bays.
    expect(dz).toMatch(/inset 0 0 0 100vmax rgba\(var\(--lit-rgb\), 0\)/);
    // K55: at rest the body is the backlit panel's glass (static: the same in
    // every state, so nothing in `background` ever has to interpolate); the
    // tint stays a shadow.
    expect(dz).toMatch(/background: var\(--glass-body, var\(--frost-0\)\);/);
    expect(dz).not.toMatch(/background: linear-gradient/);
    const hero = rule('\\.fn-hero\\[data-seam\\]');
    expect(hero).toMatch(/inset 0 0 0 100vmax rgba\(var\(--lit-rgb\), 0\)/);
    expect(hero).not.toMatch(/background: linear-gradient/);
    expect(dz).toMatch(/box-shadow var\(--arm-cool\)/);
    // K50: no stroke — the border is layout only — and the bay's heat is its
    // own seam dial, on the cool curve with everything else.
    expect(dz).toMatch(/border:\s*1px solid transparent/);
    // K50d: a bay rests at a panel's level with a panel's halation.
    expect(dz).toMatch(/--seam-level: var\(--emit-panel\);\s*--seam-halo-k: calc\(var\(--seam-level\) \/ 0\.7\);/);
    expect(dz).toMatch(/--seam-level var\(--arm-cool\)/);
    expect(dz).toMatch(/var\(--glass-edge\)/);
    // …and the resting rule outranks the generic [data-heat] transition list,
    // which used to win the cascade while the bay cooled and drop box-shadow
    // from it — the wash snapped off while the rim faded (measured 2026-10-04).
    // …and ONLY the transition (K50c): the first cut restated the whole base
    // rule under the doubled selector, and its padding outranked every size
    // variant while the bay was hot — a 28–44px layout shift on every surface
    // at the wake, measured on the emulated phone.
    for (const sel of ['\\.dropzone\\[data-heat\\]', '\\.fn-hero\\[data-seam\\]\\[data-heat\\]']) {
      const r = rule(sel);
      expect(r, sel).toMatch(/transition:[^;]*--seam-level var\(--arm-cool\)[^;]*box-shadow var\(--arm-cool\)/);
      expect(r.replace(/transition:[^;]*;/, '').trim(), `${sel} declares nothing but its transition`).toBe('');
    }
  });

  it('warms under a pointer and ignites on the coil\'s pair while a drop is in flight', () => {
    // K50: warm lifts the bay's own dial part way, on the heat curve — no
    // quick spring, so the rim never jumps ahead of the pool.
    const warm = rule('\\.dropzone:hover');
    expect(warm).toMatch(/--seam-level:\s*0\.\d+;/);
    expect(warm).toMatch(/--seam-level var\(--arm-heat\)/);
    expect(warm).not.toMatch(/--dur-3|border-color/);
    const hot = RULES.match(/\.dropzone\.over, \.dropzone\[data-heat="hot"\] \{([^}]*)\}/);
    expect(hot).toBeTruthy();
    expect(hot[1]).toMatch(/--seam-level:\s*1;/);
    expect(hot[1]).toMatch(/inset 0 0 0 100vmax rgba\(var\(--lit-rgb\), 0\.\d+\)/);
    expect(hot[1]).not.toMatch(/background: linear-gradient/);
    expect(hot[1]).toMatch(/box-shadow var\(--arm-heat\)/);
    expect(hot[1]).toMatch(/border-color: transparent/);   // K50c: the generic hot rule's accent stroke, overridden
    expect(hot[1]).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
  });

  it('the glyph and the legend are the phosphor', () => {
    expect(RULES).toMatch(/\.dz-icon, \.dz-prompt \{ text-shadow: var\(--lit-strike-off\)/);
    expect(RULES).toMatch(/\.dropzone\[data-heat="hot"\] \.dz-prompt \{[^}]*text-shadow:\s*var\(--lit-strike\)/);
  });

  it('carries no rod any more — the light bar was crow-barred in', () => {
    expect(HTML).not.toMatch(/<i class="lm-rod"/);
    expect(RULES).not.toMatch(/\.dropzone[^{]*\.lm-rod/);
    // The primitive itself stays, as the migration target for the two
    // hand-built rods; a primitive with a written purpose is not dead code.
    expect(RULES).toMatch(/\n\.lm-rod \{/);
  });

  it('a drop in flight heats the BAY, and cools it when the drag leaves', () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <div class="dropzone" id="dz"></div>
        <input type="file" id="dz-in">`;
      const dz = document.getElementById('dz');
      wireDropzone('dz', 'dz-in', () => {});
      dz.dispatchEvent(new Event('dragenter', { bubbles: true, cancelable: true }));
      dz.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
      dz.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
      expect(dz.classList.contains('over')).toBe(true);
      expect(dz.getAttribute('data-heat')).toBe('hot');
      dz.dispatchEvent(new Event('dragleave', { bubbles: true, cancelable: true }));
      expect(dz.classList.contains('over')).toBe(false);
      expect(dz.getAttribute('data-heat'), 'cooling through the resting half').toBe('');
      vi.advanceTimersByTime(2800);
      expect(dz.hasAttribute('data-heat')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

// ------------------------------------------------------------- selection is lit

describe('selection is lit — where you are carries a low steady legend light', () => {
  it('declares the legend token and lights the current view, tab and filter with it', () => {
    expect(studio).toMatch(/--lit-legend:\s*0 0 \d+px rgba\(var\(--lit-rgb\)/);
    const sel = RULES.match(/\n\.nav-btn\.active, \.tab-btn\.active,[^{]*\{([^}]*)\}/);
    expect(sel).toBeTruthy();
    expect(sel[1]).toMatch(/text-shadow:\s*var\(--lit-legend\)/);
    expect(sel[0]).toMatch(/#view-bench \.filter-btn\.active/);
    // Lit, never hot: no halo, no data-lit, nothing the canvas would see.
    expect(sel[1]).not.toMatch(/box-shadow|data-lit|filter:/);
  });

  it('is off on paper', () => {
    expect(daylight).toMatch(/--lit-legend:\s*var\(--lit-strike-off\)/);
  });

  it('is declared before the strike, so a press on a lit control still strikes', () => {
    const sel = RULES.indexOf('\n.nav-btn.active, .tab-btn.active,');
    const strike = RULES.indexOf('\n.btn:active, .publish-btn:active, .settings-btn:active, .nav-btn:active,\n.tab-btn:active');
    expect(sel).toBeGreaterThan(-1);
    expect(strike).toBeGreaterThan(sel);
  });
});

// ------------------------------------------------------------ notifications

describe('a notification is light rising under the frosted corner', () => {
  const TEL = readFileSync(join(process.cwd(), 'js', 'console-telemetry.js'), 'utf8');
  it('toasts emit in their severity\'s tone, info carries no light, and the light comes off as the toast fades', () => {
    expect(TEL).toMatch(/\{ success: 'ok', warn: 'warn', error: 'accent' \}\[kind\]/);
    expect(TEL).toMatch(/t\.el\.removeAttribute\('data-lit'\);[^\n]*\n\s*t\.el\.style\.opacity = '0'/);
    expect(rule('\\.toast')).toMatch(/background:\s*var\(--frost-2\)/);
  });
});

// --------------------------------------------------------------- the lines

describe('lines are cold iron — a hairline is a faint seam of light', () => {
  it('derives every line tier from the emitter hue through one dial', () => {
    for (const t of ['--line-1', '--line-2', '--line-3']) {
      expect(studio).toMatch(new RegExp(`${t}:\\s*color-mix\\(in srgb, rgb\\(var\\(--accent-rgb\\)\\) var\\(--ember\\), #[0-9a-f]{6}\\)`));
    }
    expect(studio).toMatch(/--ember:\s*\d+%/);
    // The Desk keeps the seam as a trace of ink, not a light: less ember.
    const s = Number(studio.match(/--ember:\s*(\d+)%/)[1]);
    const d = Number(daylight.match(/--ember:\s*(\d+)%/)[1]);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(s);
  });

  it('the compat borders still ride the line ladder, so nothing writes its own grey', () => {
    expect(RULES).toMatch(/--border:\s*var\(--line-1\)/);
    expect(RULES).toMatch(/--border-strong:\s*var\(--line-2\)/);
  });
});

// --------------------------------------------------------------- toast curves

describe('a toast is not a coil', () => {
  it('declares its own heat and cool, in the form the engine can read, shorter than its lifetime', () => {
    const toast = rule('\\.toast');
    // K50: the pair is written with the named curve (var(--ease-out)); the
    // engine reads the substituted value, which is the literal bezier.
    const heat = toast.match(/--arm-heat:\s*(\d+)ms var\(--ease-out\)/);
    const cool = toast.match(/--arm-cool:\s*(\d+)ms var\(--ease-out\)/);
    expect(heat, 'a toast heats on its own curve').toBeTruthy();
    expect(cool, 'a toast cools on its own curve').toBeTruthy();
    const TEL = readFileSync(join(process.cwd(), 'js', 'console-telemetry.js'), 'utf8');
    const fade = Number(TEL.match(/TOAST_FADE_MS\s*=\s*(\d+)/)[1]);
    // The light must be gone by the time the element is: the ghost was a
    // 2.6s cool on a 300ms exit, painted from the last box.
    expect(Number(cool[1])).toBeLessThanOrEqual(fade);
    expect(toast).toMatch(/transition:\s*opacity \d+ms[^,]*, transform \d+ms/);
  });
});

// ---------------------------------------------------------------- the seams

describe('the long rules are seams of light, fed from the left edge — and the seams are emitters (K41)', () => {
  it('K50: no line runs along the interface — the seam is its light, never a stroke', () => {
    const host = rule(SEAM_HOSTS);
    // The 1px gradient lines and the bay's solid rim went with the strokes.
    for (const tok of ['--seam:', '--seam-v:', '--seam-solid:', '--seam-glow:', '--seam-glow-b:', '--seam-glow-t:', '--seam-glow-r:', '--seam-glow-box:']) {
      expect(host, tok).not.toContain(tok);
      expect(RULES, tok).not.toContain(tok);
    }
    expect(RULES).not.toMatch(/var\(--seam\)|var\(--seam-v\)|var\(--seam-solid\)|var\(--seam-glow/);
    // The rim is transparent on every host that keeps a border for layout.
    expect(host).toMatch(/--seam-rim:\s*transparent;/);
    // The glass's thickness, in the halation's own units: the lip along the
    // bottom (the hue run toward white) and a cold specular hairline on top
    // — two insets, nothing outside the box.
    const edge = host.match(/--glass-edge:\s*([^;]*);/);
    expect(edge).toBeTruthy();
    expect(edge[1].match(/inset /g)).toHaveLength(2);   // K50d: the lip and the top; no side hairlines (they read as an outline on a bay)
    expect(edge[1]).toMatch(/^\s*inset 0 -1px 0 0 var\(--glass-lip\)/);
    expect(host).toMatch(/--glass-lip:\s*color-mix\(in srgb, rgba\(var\(--lit-rgb\), calc\(var\(--seam-halo\) \* [\d.]+\)\) \d+%, rgba\(255, 255, 255,/);
    expect(edge[1]).toMatch(/inset 0 1px 0 0 rgba\(255, 255, 255, calc\(var\(--seam-halo\)[^)]*\)\)\s*$/);
  });

  it('has one dial for the seam and one for the room, in the ranges the engine reads', () => {
    const level = Number(studio.match(/--seam-level:\s*([\d.]+);/)[1]);
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThanOrEqual(1);
    const haze = Number(studio.match(/--haze-gain:\s*([\d.]+);/)[1]);
    expect(haze).toBeGreaterThan(0);
    expect(haze).toBeLessThanOrEqual(3);
  });

  it('the halation derives from two primitives, squared by the ignition', () => {
    expect(studio).toMatch(/--seam-halo-a:\s*0\.\d+;/);
    expect(studio).toMatch(/--seam-halo-r:\s*\d+px;/);
    expect(rule(SEAM_HOSTS)).toMatch(/--seam-halo:\s*calc\(var\(--seam-halo-a\) \* var\(--seam-halo-k, 1\)\);/);   // no --ignite since K50c: the flare is the canvas's
  });

  it('the view rules, the dividers and the leaders draw nothing (K50)', () => {
    expect(RULES).not.toMatch(/\.view-header::after|\.stage-section::after/);
    expect(rule('\\.view-header')).not.toMatch(/border-bottom: 1px solid var\(--border\)/);
    expect(rule('\\.stage-section')).not.toMatch(/border-top: 1px solid var\(--border\)/);
    const divider = rule('\\.nav-divider');
    expect(divider).toMatch(/height:\s*1px/);
    expect(divider).not.toMatch(/background|box-shadow|border/);
    expect(rule('\\.sidebar-foot')).not.toMatch(/border-image|box-shadow/);
    expect(rule('\\.tabbar')).not.toMatch(/border-image|--seam-glow/);
    const dots = rule('\\.buffer-day-hdr \\.dots');
    expect(dots).toMatch(/flex:\s*1/);
    expect(dots).not.toMatch(/background|box-shadow|mask-image/);
    // The sidebar is a slab: a transparent rim and the glass's thickness.
    expect(rule('\\.topbar')).not.toMatch(/border-image|--seam-glow-b/);
    expect(rule('\\.sidebar')).toMatch(/border-color:\s*var\(--seam-rim\)/);
    expect(rule('\\.sidebar')).toMatch(/box-shadow:\s*var\(--glass-edge\)/);
  });

  it('the bay is glass with no stroke: the thickness in every state, the wash and the dial when hot', () => {
    for (const sel of ['\\.dropzone', '\\.dropzone:hover', '\\.dropzone\\.over, \\.dropzone\\[data-heat="hot"\\]']) {
      expect(rule(sel), sel).toMatch(/var\(--glass-edge\)/);
      expect(rule(sel), sel).not.toMatch(/inset 0 0 0 1px/);
    }
  });

  it('only a BOX is a seam host now: the sidebar and the bays; no line carries data-seam', () => {
    expect(HTML).toMatch(/<header class="topbar">/);
    expect(HTML).toMatch(/<nav class="sidebar" data-seam="box" data-backlit>/);
    // The tab bar's top seam went in K51: its strip was the "stroke" the
    // owner saw. The floor is backlit only (tests/console-touch-polish.test.js).
    expect(HTML).toMatch(/<nav class="tabbar" aria-label="Primary" data-backlit>/);
    expect(HTML).toMatch(/<div class="nav-divider">/);
    expect(HTML).toMatch(/<div class="sidebar-foot">/);
    // Derived, never counted: every bay asks the canvas; no header, stage or leader does.
    const bays = HTML.match(/<div class="dropzone[^"]*"[^>]*>/g);
    expect(bays.length).toBeGreaterThan(0);
    for (const b of bays) expect(b).toContain('data-seam="box"');
    const heads = HTML.match(/<div class="view-header[^"]*"[^>]*>/g);
    expect(heads.length).toBeGreaterThan(0);
    for (const h of heads) expect(h).not.toContain('data-seam');
    const stages = HTML.match(/<div class="stage-section"[^>]*>/g);
    expect(stages.length).toBeGreaterThan(0);
    for (const st of stages) expect(st).not.toContain('data-seam');
    const BUFFER = readFileSync(join(process.cwd(), 'js', 'console', 'buffer.js'), 'utf8');
    expect(BUFFER).toMatch(/<span class="dots"><\/span>/);
    expect(BUFFER).not.toMatch(/class="dots" data-seam/);
    // Every data-seam left in the markup names a box or the tab bar's top,
    // and one lip: the ship station's mail slot (K81, the owner: "a slit of
    // light radiating from the slot"), whose light leaves its lower edge.
    for (const m of HTML.matchAll(/data-seam(?:="([^"]*)")?/g)) expect(['box', 'top', 'bottom']).toContain(m[1]);
    expect([...HTML.matchAll(/data-seam="bottom"/g)]).toHaveLength(1);
    expect(HTML).toMatch(/<span class="br-mailslot-mouth" id="br-mailslot-mouth" data-seam="bottom"/);
  });

  it('boxes stay cold — the ember is a whisper, and a stroke is not a seam', () => {
    const s = Number(studio.match(/--ember:\s*(\d+)%/)[1]);
    expect(s).toBeLessThanOrEqual(8);
  });

  it('is a printed card on paper: the rim is ink, the halation zero — and no twin token', () => {
    const paper = rule(':root\\[data-theme="light"\\] \\[data-seam\\], :root\\[data-theme="light"\\] \\[data-tier\\]');
    expect(paper).toMatch(/--seam-rim:\s*var\(--line-2\)/);
    expect(paper).not.toMatch(/--seam:|--seam-v:|--seam-solid:/);
    expect(daylight).toMatch(/--seam-halo-a:\s*0;/);
    // Every --seam-glow-* derives from the alpha, so the Desk declares none of them.
    expect(daylight).not.toMatch(/--seam-glow[-a-z]*:/);
    expect(paper).not.toMatch(/--seam-glow[-a-z]*:/);
  });
});

// -------------------------------------------------------------- where you are

describe('where you are is a resting light', () => {
  it('the router lights the current view\'s nav row, and only nav rows', () => {
    expect(CHROME).toMatch(/\.nav-btn\[data-view="\$\{name\}"\]`\)\?\.setAttribute\("data-lit", "accent"\)/);
    expect(CHROME).toMatch(/querySelectorAll\("\.nav-btn\[data-lit\]"\)\.forEach\(b => b\.removeAttribute\("data-lit"\)\)/);
    expect(CHROME).not.toMatch(/tab-btn\[data-view="\$\{name\}"\]`\)\?\.setAttribute\("data-lit"/);
  });

  it('is seated at boot too — the first view is seated, not routed', () => {
    // init() seats the start view (chrome.js, START VIEW) through the same
    // marking the router uses, lamp included; tests/console-start-view.test.js
    // boots it and checks the row comes up lit.
    const INIT = readFileSync(join(process.cwd(), 'js', 'console', 'init.js'), 'utf8');
    const CHROME = readFileSync(join(process.cwd(), 'js', 'console', 'chrome.js'), 'utf8');
    expect(INIT).toMatch(/seatView\(start\);/);
    expect(CHROME).toMatch(/export function seatView\(name\) \{[\s\S]*?_markActive\(name\);/);
    expect(CHROME).toMatch(/function _markActive\(name\) \{[\s\S]*?setAttribute\("data-lit", "accent"\)/);
  });

  it('the row keeps its own clothes and turns its lamp down', () => {
    const r = rule('\\.nav-btn\\[data-lit\\]');
    expect(r).toMatch(/--lit-level:\s*0\.\d+/);
    expect(r).toMatch(/box-shadow:\s*none/);
    expect(r).toMatch(/border-color:\s*transparent/);
  });
});
