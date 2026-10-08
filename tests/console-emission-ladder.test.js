// THE EMISSION LADDER (2026-10-02, K43) — every line in the console is one
// class of light: structure, bay, panel, card, field, control, rule or
// signal. dev/console-emission-catalog.md is the inventory; this file holds
// the parts that would quietly stop being true:
//
//   • the levels are ordered (metadata never outshines a thumb, a thumb never
//     outshines a panel, nothing outshines the structure);
//   • every tiered surface has a catalog row, and a surface in a pop-up never
//     asks the canvas to light it;
//   • a tiered surface's own hover/focus rule no longer paints a grey or flat
//     accent stroke over its rim;
//   • the dial is registered, so a hover transitions it instead of snapping.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = readFileSync(join(ROOT, 'dev', 'field-console.html'), 'utf8');
const CATALOG = readFileSync(join(ROOT, 'dev', 'console-emission-catalog.md'), 'utf8');
const MODULES = Object.fromEntries(readdirSync(join(ROOT, 'js', 'console'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => [f, readFileSync(join(ROOT, 'js', 'console', f), 'utf8')]));
const studio = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')));
const daylight = (() => { const l = CSS.slice(CSS.indexOf(':root[data-theme="light"] {')); return l.slice(0, l.indexOf('}')); })();

const num = (name) => {
  const m = studio.match(new RegExp(`${name}:\\s*([\\d.]+);`));
  if (!m) throw new Error(`no ${name}`);
  return Number(m[1]);
};

/** Every element that carries data-tier: its first class, its tier, and whether it asks the canvas. */
function tiered(src) {
  const out = [];
  for (const m of src.matchAll(/<\w+ class="([\w-]+)[^"]*"([^>]*)>/g)) {
    const tier = m[2].match(/data-tier="(\w+)"/);
    if (tier) out.push({ cls: m[1], tier: tier[1], seam: /data-seam="box"/.test(m[2]), at: m.index });
  }
  return out;
}

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
const firstOverlay = HTML.search(/class="(sheet-overlay|modal-overlay|rl-overlay)/);

describe('the ladder is ordered', () => {
  it('field < card < panel < the structure, and a hand only ever lifts', () => {
    const structure = Number(CSS.match(/@property --seam-level \{[^}]*initial-value:\s*([\d.]+)/)[1]);
    expect(num('--seam-level')).toBe(structure);
    expect(num('--emit-field')).toBeLessThan(num('--emit-card'));
    expect(num('--emit-card')).toBeLessThan(num('--emit-panel'));
    expect(num('--emit-panel')).toBeLessThan(structure);
    expect(num('--emit-card-warm')).toBeGreaterThan(num('--emit-card'));
    expect(num('--emit-field-warm')).toBeGreaterThan(num('--emit-field'));
    expect(num('--emit-field-hot')).toBeGreaterThan(num('--emit-field-warm'));
    // A hovered card is still quieter than the structure.
    expect(num('--emit-card-warm')).toBeLessThan(structure);
    // …and a grid of them adds up to a glow, not a wash.
    expect(num('--haze-card')).toBeLessThan(num('--haze-panel'));
    // A field is a well, not a lamp (K46): it has no haze share at all.
    expect(studio).not.toMatch(/--haze-field:/);
    // Its panel's focus lift stays under the structure.
    expect(num('--emit-panel-warm')).toBeGreaterThan(num('--emit-panel'));
    expect(num('--emit-panel-warm')).toBeLessThan(structure);
  });

  it('the dial is a registered number, so a hover transitions it', () => {
    expect(CSS).toMatch(/@property --seam-level \{\s*syntax: '<number>';\s*inherits: true;/);
    expect(RULES).toMatch(/\[data-tier\]\[data-tier\] \{\s*transition: --seam-level var\(--tier-fall\)/);
    expect(RULES).toMatch(/\[data-tier\]\[data-tier\]:is\(:hover, :focus, :focus-visible, :focus-within, :has\(\[data-tier="field"\]:focus\)\) \{\s*transition: --seam-level var\(--tier-rise\)/);
    expect(RULES).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-tier\]\[data-tier\]/);
  });

  it('each tier sets its own dial and haze share, and the rim is the glass\'s thickness, not a stroke (K50)', () => {
    for (const t of ['panel', 'card', 'field']) {
      const r = RULES.match(new RegExp(`\\[data-tier="${t}"\\]\\s*\\{([^}]*)\\}`));
      expect(r, t).toBeTruthy();
      expect(r[1]).toMatch(new RegExp(`--seam-level: var\\(--emit-${t}\\)`));
      // A field is never an engine emitter (K46), so it has no haze share.
      if (t !== 'field') expect(r[1]).toMatch(new RegExp(`--haze-boost: var\\(--haze-${t}\\)`));
    }
    // K50: the rim is transparent; the edge is the lip along the bottom (the
    // hue run toward white) and a cold hairline on top, scaled by the tier's
    // halation — so a field's edge is a field's and a panel's a panel's.
    expect(RULES.match(/--seam-rim:\s*([^;]*);/)[1]).toBe('transparent');
    expect(RULES).toMatch(/--glass-lip:\s*color-mix\(in srgb, rgba\(var\(--lit-rgb\), calc\(var\(--seam-halo\) \* [\d.]+\)\) \d+%, rgba\(255, 255, 255,/);
    expect(RULES).toMatch(/\[data-tier\] \{\s*--seam-halo-k: calc\(var\(--seam-level\) \/ 0\.7\);\s*border-color: var\(--seam-rim\);\s*box-shadow: var\(--glass-edge\), var\(--tier-lift\);/);
  });

  it('on paper every class is ink: the rim, the controls and the rules', () => {
    expect(RULES).toMatch(/:root\[data-theme="light"\] \[data-seam\], :root\[data-theme="light"\] \[data-tier\] \{[^}]*--seam-rim: var\(--line-2\)/);
    expect(daylight).toMatch(/--edge-cold:\s*var\(--line-3\)/);
    expect(daylight).toMatch(/--edge-warm:\s*var\(--ink-3\)/);
    expect(daylight).toMatch(/--rule:\s*linear-gradient\(var\(--line-2\), var\(--line-2\)\)/);
    expect(daylight).toMatch(/--tier-lift:\s*var\(--shadow-1\)/);
  });
});

describe('every tiered surface is catalogued, and the canvas only lights what it can reach', () => {
  const sources = [['dev/field-console.html', HTML], ...Object.entries(MODULES).map(([f, s]) => [`js/console/${f}`, s])];
  const all = sources.flatMap(([file, src]) => tiered(src).map((t) => ({ ...t, file })));

  it('finds the surfaces at all (a guard on the scan itself)', () => {
    expect(all.length).toBeGreaterThan(40);
    expect(new Set(all.map((t) => t.tier))).toEqual(new Set(['panel', 'card', 'field']));
  });

  it('has a catalog row for every tiered class, under its own tier', () => {
    for (const { cls, tier, file } of all) {
      const section = CATALOG.slice(CATALOG.indexOf(`## ${tier[0].toUpperCase()}${tier.slice(1)}s`));
      const body = section.slice(0, section.indexOf('\n## ', 4));
      expect(body, `${cls} (${file}) is data-tier="${tier}" but has no row under ## ${tier}s`).toContain(`\`${cls}\``);
    }
  });

  it('nothing inside a pop-up carries data-seam — a plane is above the canvas', () => {
    const inPlanes = tiered(HTML).filter((t) => t.at > firstOverlay);
    expect(inPlanes.length).toBeGreaterThan(0);
    for (const t of inPlanes) expect(t.seam, `${t.cls} sits in an overlay`).toBe(false);
    // The pickers and the drawer render into planes from their modules.
    for (const [file, cls] of [['asset-library.js', 'asset-lib-item'], ['asset-library.js', 'asset-lib-search'],
      ['audio.js', 'audio-lib-item'], ['audio.js', 'audio-lib-search'], ['fn-editor.js', 'fb-thumb']]) {
      const t = tiered(MODULES[file]).find((x) => x.cls === cls);
      expect(t, `${cls} in ${file}`).toBeTruthy();
      expect(t.seam, `${cls} renders into a plane`).toBe(false);
    }
  });

  it('every panel and card in a view asks the canvas to light it; a field never does (K46)', () => {
    for (const t of tiered(HTML).filter((x) => x.at < firstOverlay)) {
      expect(t.seam, `${t.cls} (${t.tier}) in a view`).toBe(t.tier !== 'field');
    }
    // Nowhere — markup or module — is a field its own light source: it is a
    // well in its panel's glass, and the panel is the one source.
    for (const src of [HTML, ...Object.values(MODULES)]) {
      for (const t of tiered(src).filter((x) => x.tier === 'field')) expect(t.seam, t.cls).toBe(false);
      expect(src).not.toMatch(/data-backlit[^>]*data-tier="field"|data-tier="field"[^>]*data-backlit/);
    }
  });

  it('the archive metadata is one lit panel with its fields inside it (K46)', () => {
    const open = HTML.indexOf('<div class="compose-fields" data-seam="box" data-backlit data-tier="panel">');
    expect(open).toBeGreaterThan(0);
    const close = HTML.indexOf('id="arch-tag-preview"');
    for (const id of ['arch-title', 'arch-sub', 'arch-loc', 'arch-cam', 'arch-lens', 'arch-med', 'arch-hash']) {
      const at = HTML.indexOf(`id="${id}"`);
      expect(at > open && at < close, id).toBe(true);
    }
    // A field taking focus lifts its panel, which is the one source.
    expect(RULES).toMatch(/\[data-backlit\]\[data-tier="panel"\]:has\(\[data-tier="field"\]:focus\) \{ --backlight: var\(--backlight-panel-warm\); \}/);
    // The well: darker than the glass it is cut into, recessed, no halo.
    const well = RULES.match(/\n\[data-tier="field"\] \{\s*--glass-body:([^}]*)\}/);
    expect(well).toBeTruthy();
    expect(well[1]).toMatch(/var\(--edge-in\)/);
    expect(num('--well-top')).toBeGreaterThan(num('--glass-far'));
  });
});

describe('a tiered surface no longer paints a stroke over its rim', () => {
  const classes = [...new Set([...tiered(HTML), ...Object.values(MODULES).flatMap(tiered)].map((t) => t.cls))];

  it('its own hover and focus rules leave the border to the tier', () => {
    for (const cls of classes) {
      for (const m of RULES.matchAll(new RegExp(`(?:^|\\n|\\})\\s*([^{}]*\\.${cls}(?![\\w-])[^{},]*:(?:hover|focus|focus-visible)\\b[^{}]*)\\{([^}]*)\\}`, 'g'))) {
        expect(m[2], `${m[1].trim()} still sets a border colour`).not.toMatch(/border-color:/);
      }
    }
  });

  it('its own base rule resolves to the rim, with the old colour only as a fallback', () => {
    for (const cls of ['field-input', 'archive-card', 'aud-row', 'grid-cell', 'pulse-tile', 'control-block', 'studio-stage']) {
      const m = RULES.match(new RegExp(`\\n\\.${cls} \\{([^}]*border:[^}]*)\\}`));
      expect(m, cls).toBeTruthy();
      expect(m[1], cls).toMatch(/border-color: var\(--seam-rim, var\(--[\w-]+\)\)/);
    }
    // The ID-weighted ones too, or the tier never reaches them.
    expect(RULES).toMatch(/#view-bench \.bench-card \{[^}]*border-color: var\(--seam-rim, var\(--border\)\)/);
    expect(RULES).toMatch(/#view-publish\.active > \.danger-zone \{[^}]*border-color: var\(--seam-rim, var\(--border\)\)/);
  });

  it('a signal still wins: error lights in the warning tone, and a ruled signal drops its image', () => {
    expect(RULES).toMatch(/\[data-tier\]\.err, \[data-tier\]\.is-error \{ --lit-rgb: var\(--warn-rgb\); \}/);
    expect(RULES).toMatch(/\.fn-studio\.is-draft \.fn-bar, \.list-row\.drag-over \{ border-image: none; \}/);
    expect(RULES).toMatch(/\.summary-card\.has-changes\s*\{[^}]*border-color: var\(--accent-dim\)/);
  });
});

describe('controls are cold iron and rules are the seam unbloomed', () => {
  it('a control\'s edge rests cold and warms under a hand, with its legend', () => {
    for (const sel of ['\\.btn', '\\.fn-btn', '\\.icon-btn', '\\.settings-btn', '\\.cards-pill', '\\.layout-chip']) {
      const rest = [...RULES.matchAll(new RegExp(`\\n${sel} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]).find((b) => /border:/.test(b));
      expect(rest, sel).toMatch(/border: 1px solid var\(--edge-cold\)/);
    }
    expect(RULES).toMatch(/\n\.btn:hover \{[^}]*border-color: var\(--edge-warm\)[^}]*text-shadow: var\(--lit-legend\)/);
    // K50b (the owner: "pills and chips, let's lose the cold iron edge"): in
    // the Darkroom a control draws no stroke at rest or under a hand; the
    // Desk keeps its ink (pinned above).
    expect(studio).toMatch(/--edge-cold:\s*transparent;/);
    expect(studio).toMatch(/--edge-warm:\s*transparent;/);
  });

  it('a divider is a light guide fed from the left', () => {
    expect(studio).toMatch(/--rule: linear-gradient\(90deg,\s*rgba\(var\(--lit-rgb\), 0\.\d+\) 0%/);
    expect(studio).toMatch(/rgba\(var\(--lit-rgb\), 0\) 100%\);\n\s*--rule-v:/);
    for (const sel of ['\\.list-row', '\\.uqp-row', '\\.sheet-item', '\\.cards-head']) {
      const body = [...RULES.matchAll(new RegExp(`\\n${sel} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]).find((b) => /border-(top|bottom)/.test(b));
      expect(body, sel).toMatch(/border-image: var\(--rule\) 1/);
    }
    expect(RULES).toMatch(/\n\.fn-preview \{[^}]*border-image: var\(--rule-v\) 1/);
  });
});
