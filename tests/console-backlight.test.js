// BACKLIT GLASS (K44, 2026-10-03) — the owner's bench take ("1st pass",
// docs/ideas/backlit-glass-study.md §7) ported into the console:
//
//   • a light BEHIND every panel, card and field in a view (`data-backlit`),
//     at the take's levels calibrated for the console's room;
//   • the bodies in front of it are glass, darkest away from the source;
//   • the light comes from below (Q1): the box rim is hottest at the bottom
//     edge, and that edge runs toward white;
//   • a selected member of a segmented set is a lit cap (Q2);
//   • surfaces are 8px, controls 4px (Q3), and nothing that was already round
//     is squared.
//
// The engine half is in tests/console-lighting.test.js ("the backlight").
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = readFileSync(join(ROOT, 'dev', 'field-console.html'), 'utf8');
const MODULES = Object.fromEntries(readdirSync(join(ROOT, 'js', 'console'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => [f, readFileSync(join(ROOT, 'js', 'console', f), 'utf8')]));
const studio = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')));
const daylight = (() => { const l = CSS.slice(CSS.indexOf(':root[data-theme="light"] {')); return l.slice(0, l.indexOf('}')); })();
const num = (name) => Number(studio.match(new RegExp(`${name}:\\s*([\\d.]+)`))[1]);

/** Every opening tag that carries data-seam="box", with its tier and whether it is backlit. */
function hosts(src) {
  return [...src.matchAll(/<\w+ class="([\w-]+)[^"]*"([^>]*?data-seam="box"[^>]*)>/g)].map((m) => ({
    cls: m[1], backlit: /data-backlit/.test(m[2]), tier: (m[2].match(/data-tier="(\w+)"/) || [])[1],
  }));
}

describe('the take, calibrated', () => {
  it('carries the bench\'s light ×1.475 (its 2.95 against the room\'s 2) and its haze as a share', () => {
    // The take: panel 0.32, card 0.17 → 0.5 (docs/ideas/backlit-glass-study.md §7).
    expect(num('--backlight-panel')).toBeCloseTo(0.32 * 1.475, 2);
    expect(num('--backlight-card')).toBeCloseTo(0.17 * 1.475, 2);
    expect(num('--backlight-card-warm')).toBeCloseTo(0.5 * 1.475, 2);
    expect(studio).toMatch(/--backlight-overhang:\s*12px/);
    expect(studio).toMatch(/--backlight-soft:\s*58px/);
    expect(num('--backlight-y')).toBeGreaterThan(0);   // from below
    // The glass: transmission 0.69, falloff 0.36.
    expect(num('--glass-near')).toBeCloseTo(1 - 0.69, 2);
    expect(num('--glass-far')).toBeCloseTo(1 - 0.69 + 0.36, 2);
    // A grid must not flood the room: a card's haze share is well under a
    // panel's.
    expect(num('--backlight-haze-card')).toBeLessThan(num('--backlight-haze'));
  });

  it('the dial is registered, belongs to its host, and rises and falls with the tier\'s', () => {
    expect(CSS).toMatch(/@property --backlight \{\s*syntax: '<number>';\s*inherits: false;\s*initial-value: 0;/);
    expect(RULES).toMatch(/\[data-tier\]\[data-tier\] \{\s*transition: --seam-level var\(--tier-fall\), --backlight var\(--tier-fall\)/);
    expect(RULES).toMatch(/:is\(:hover, :focus, :focus-visible, :focus-within, :has\(\[data-tier="field"\]:focus\)\) \{\s*transition: --seam-level var\(--tier-rise\), --backlight var\(--tier-rise\)/);
    expect(RULES).toMatch(/\[data-backlit\]\[data-tier="card"\]:hover, \[data-backlit\]\[data-tier="card"\]:focus-within \{ --backlight: var\(--backlight-card-warm\); \}/);
    // K46: a field has no light of its own; its panel lifts when it takes focus.
    expect(RULES).not.toMatch(/\[data-backlit\]\[data-tier="field"\]/);
    expect(studio).not.toMatch(/--backlight-field/);
    expect(num('--backlight-panel-warm')).toBeGreaterThan(num('--backlight-panel'));
  });
});

describe('every surface in a view that has a rim also has a light behind it', () => {
  const all = [hosts(HTML), ...Object.values(MODULES).map(hosts)].flat();

  it('tags panels and cards, except the one well that sits inside another panel', () => {
    // K95: the publish log is a lit panel now (the owner: "carry our light
    // panel stylings"); the studio stage stays a well.
    const tiered = all.filter((h) => ['panel', 'card'].includes(h.tier));
    expect(tiered.length).toBeGreaterThan(35);
    for (const h of tiered) {
      const well = h.cls === 'studio-stage';
      expect(h.backlit, `${h.cls} (${h.tier})`).toBe(!well);
    }
  });

  it('their bodies are glass, falling back to the old tier where no backlight is set', () => {
    for (const [sel, old] of [['\\.archive-card', 'var\\(--bg-elev-1\\)'], ['\\.field-input', 'var\\(--bg-input\\)'],
      ['\\.grid-cell', 'var\\(--surface-1\\)'], ['\\.aud-row', 'var\\(--bg-elev-1\\)']]) {
      expect(RULES, sel).toMatch(new RegExp(`\\n${sel} \\{[^}]*background: var\\(--glass-body, ${old}\\)`));
    }
    expect(RULES).toMatch(/\[data-backlit\] \{\s*--glass-body: linear-gradient\(0deg, rgba\(4, 4, 5, var\(--glass-near\)\), rgba\(4, 4, 5, var\(--glass-far\)\)\);/);
    // On paper the glass is the paper.
    expect(RULES).toMatch(/:root\[data-theme="light"\] \[data-backlit\] \{ --glass-body: var\(--surface-1\); \}/);
  });
});

describe('the selected cap and the corners', () => {
  const capRule = RULES.match(/\.fn-drawer-tab\[aria-selected="true"\], \.cards-seg-btn\.is-on, \.layout-chip\.is-on,\s*\.cards-pill\.is-active, \.asset-lib-pill\.active, \.audio-lib-pill\.active,\s*#view-bench \.filter-btn\.active, \.pulse-lane\.active,\s*\.rl-seg button\.active, \.rl-tool\.active,\s*\.focal-style-btn\.on, \.fn-tool\.active, #bench-detail \.status-btn\.active \{([^}]*)\}/);

  it('lights the selected member of a segmented set as a cap, and is off on paper', () => {
    expect(capRule).toBeTruthy();
    expect(capRule[1]).toMatch(/background: linear-gradient\(175deg, var\(--cap-top\), var\(--cap-bottom\)\)/);
    expect(capRule[1]).toMatch(/box-shadow: inset 0 1px 0 var\(--cap-chamfer\), var\(--cap-bloom\)/);
    expect(daylight).toMatch(/--cap-chamfer:\s*transparent/);
    expect(daylight).toMatch(/--cap-bloom:\s*0 0 0 transparent/);
  });

  it('comes after every set\'s own selected rule, so it wins at equal weight', () => {
    const after = RULES.slice(RULES.indexOf(capRule[0]) + capRule[0].length);
    for (const own of ['.cards-pill.is-active', '.layout-chip.is-on', '.fn-drawer-tab[aria-selected="true"]', '.cards-seg-btn.is-on']) {
      expect(after, `${own} is restyled after the cap`).not.toContain(own);
    }
  });

  it('rounds surfaces and controls without squaring anything that was round', () => {
    expect(studio).toMatch(/--r-surface:\s*8px/);
    expect(studio).toMatch(/--r-control:\s*4px/);
    expect(RULES).toMatch(/\[data-tier="panel"\]:not\(\.pulse-rail, \.pulse-tray\), \[data-tier="card"\]:not\(\.pulse-tile\),[^{]*\{\s*border-radius: var\(--r-surface\);/);
    expect(RULES).toMatch(/\[data-tier="field"\]:not\(\.pulse-input, \.composer-input\), \.btn,/);
    expect(RULES).not.toMatch(/revert-layer/);
    // Pills and circles keep their shape.
    const controls = RULES.match(/\[data-tier="field"\]:not\(\.pulse-input, \.composer-input\), \.btn,[^{]*\{/)[0];
    // (K90: the pills among them are keys now, rounded by the sweep's own
    // rule at --r-control; the circles keep their shape.)
    for (const round of ['.cards-pill', '.help-bar-btn', '.aud-lib-play-btn', '.pulse-lane', '.pulse-log-btn']) {
      expect(controls, round).not.toContain(round);
    }
  });
});

describe('no bar up top, and the sidebar is a panel of its own (K44b)', () => {
  it('the topbar is not glass and has no edge; its controls float over their own small lights', () => {
    const bar = RULES.match(/\n\.topbar \{([^}]*)\}/)[1];
    expect(bar).toMatch(/background: transparent/);
    expect(bar).not.toMatch(/border|box-shadow/);
    expect(HTML).toMatch(/<header class="topbar">/);
    const row = HTML.slice(HTML.indexOf('<header class="topbar">'), HTML.indexOf('</header>', HTML.indexOf('<header class="topbar">')));
    for (const id of ['sidebar-toggle', 'bridge-topbar-btn', 'pulse-topbar-btn', 'help-topbar-btn', 'settings-topbar-btn', 'publish-btn']) {
      expect(row, id).toMatch(new RegExp(`id="${id}" data-backlit`));
    }
    // The SYS lamp owns the heartbeat and is not given a light of its own.
    expect(row).not.toMatch(/class="sys-lamp"[^>]*data-backlit/);
    expect(RULES).toMatch(/\.topbar \[data-backlit\] \{\s*--backlight: var\(--backlight-float\);/);
  });

  it('the sidebar floats, rounded, lit from behind, and is still the primary source', () => {
    expect(HTML).toMatch(/<nav class="sidebar" data-seam="box" data-backlit>/);
    const side = RULES.match(/\n\.sidebar \{([^}]*)\}/)[1];
    expect(side).toMatch(/margin: \d+px 0 \d+px \d+px/);
    expect(side).toMatch(/border-radius: var\(--r-surface\)/);
    expect(side).toMatch(/--backlight: var\(--backlight-sidebar\)/);
    // Brightest rim in the room, and the largest haze share of any surface.
    expect(side).toMatch(/--seam-level: 1;/);
    const boost = Number(side.match(/--haze-boost: ([\d.]+);/)[1]);
    expect(boost).toBeGreaterThan(1);
  });
});

describe('every button floats like the top row, and the sidebar hover is a soft light (K46)', () => {
  // K90: every key in the room joins each list (THE SWEEP in the stylesheet).
  const SWEEP = '.asset-lib-pill, .asset-lib-sort, .audio-lib-pill, .audio-lib-sort, .pulse-lane, .pulse-log-btn, .modal-close, .rl-nav, .fn-drawer-tab, .fn-tool, .uqp-btn, .focal-style-btn, .cards-seg-btn, .cards-pill, .cards-chip, .help-bar-btn';
  const BENCH = '#view-bench .filter-btn, #bench-detail .status-btn, #bench-detail .action-btn, #bench-detail .back-btn';
  const IS = `:is(${SWEEP})`.replace(/[.#()]/g, (c) => '\\' + c);
  const BIS = `:is(${BENCH})`.replace(/[.#()]/g, (c) => '\\' + c);
  const block = RULES.slice(RULES.indexOf(`\n.btn, .publish-btn, .fn-btn, .fn-chip, :is(${SWEEP}), :is(${BENCH}) { position: relative; }`));
  const rule = (sel) => (block.match(new RegExp(`\\n${sel} \\{([^}]*)\\}`)) || [])[1];

  it('a .btn is the floating control: a lit edge, a bright legend, light behind its glass', () => {
    const btn = rule(`\\.btn, \\.publish-btn, \\.buffer-link-fab, \\.fn-btn, \\.fn-chip,\\n${IS}, ${BIS}`);
    // K50: no stroke — the border paints nothing and the edge is the slab's
    // thickness, riding the glow; a faint body so it reads as a key.
    expect(btn).toMatch(/border-color: var\(--key-border\)/);
    expect(btn).toMatch(/background: var\(--key-body\)/);
    expect(btn).toMatch(/var\(--key-edge\)/);
    expect(btn).not.toMatch(/inset 0 0 0 1px|0 0 2px rgba/);
    expect(studio).toMatch(/--key-border: transparent;/);
    // K50f: the key's light is declared ON the keys, so each key substitutes
    // its own --float-glow (on :root it was computed once, at 1, and a hover
    // never reached the lip).
    expect(studio).not.toMatch(/--key-edge:|--key-body:/);
    expect(CSS).toMatch(new RegExp(`\\n\\.btn, \\.publish-btn, \\.buffer-link-fab, \\.fn-btn, \\.fn-chip,\\n\\.topbar :is\\(\\.settings-btn, \\.sidebar-toggle\\), \\.rl-seg, \\.rl-stack-act, \\.rl-handoff,\\n${IS}, ${BIS} \\{\\n\\s*--key-body:[^;]*var\\(--float-glow\\)[^;]*;\\n\\s*--key-edge:\\s*\\n?\\s*inset 0 -1px 0 0 color-mix\\(in srgb, rgba\\(var\\(--lit-rgb\\), calc\\([\\d.]+ \\* var\\(--float-glow\\) \\* var\\(--float-k\\)\\)\\)`));
    expect(btn).toMatch(/color: var\(--float-ink\)/);
    expect(btn).toMatch(/--float-glow/);
    expect(btn).toMatch(/--float-k/);
    // The glass behind it comes up through the membrane's pores, as a plane's air does.
    expect(rule(`\\.btn::before, \\.publish-btn::before, \\.buffer-link-fab::before, \\.fn-btn::before, \\.fn-chip::before,\\n${IS}::before, ${BIS}::before`)).toMatch(/mask-image: var\(--substrate-pores\)/);
    // Concave, not convex (K47): the recess shade falls in from the top, and
    // no light pools inside the bottom edge.
    expect(btn).toMatch(/var\(--float-recess\)/);
    expect(btn).not.toMatch(/inset 0 -\d+px \d+px/);
    expect(studio).toMatch(/--float-recess: var\(--edge-in\)/);
    // The markup does not license a button; chrome.js does, at runtime, for
    // the content (K48, tests/console-float-keys.test.js). This CSS light is
    // what a key in a plane, or held in place, keeps.
    expect(HTML).not.toMatch(/class="btn[^"]*"[^>]*data-backlit/);
  });

  it('the glow is a registered number that rises fast and lets go slowly', () => {
    expect(CSS).toMatch(/@property --float-glow \{\s*syntax: '<number>';\s*inherits: true;/);
    expect(num('--float-rise')).toBeLessThan(num('--float-fall'));
    expect(block).toMatch(new RegExp(`\\.btn:hover:not\\(:active\\), \\.btn:focus-visible:not\\(:active\\),\\s*\\.publish-btn:hover:not\\(:active\\), \\.buffer-link-fab:hover:not\\(:active\\),\\s*\\.fn-btn:hover:not\\(:active\\), \\.fn-chip:hover:not\\(:active\\),\\s*${IS}:hover:not\\(:active\\), ${BIS}:hover:not\\(:active\\) \\{\\s*transition: --float-glow var\\(--float-rise\\)`));
  });

  it('the primary action runs hotter and its fill rides the glow (no snapping gradient)', () => {
    const stage = rule('\\.btn-stage, \\.publish-btn, \\.fn-btn--stage');
    expect(stage).toMatch(/--float-glow: 1\.\d/);
    expect(stage).toMatch(/--stage-fill: linear-gradient\(175deg,[\s\S]*var\(--float-glow\)/);
    expect(stage).toMatch(/background: var\(--stage-fill\)/);
    expect(rule('\\.btn-stage:hover, \\.btn-stage:focus-visible, \\.publish-btn:hover, \\.publish-btn:focus-visible,\\s*\\.fn-btn--stage:hover, \\.fn-btn--stage:focus-visible')).not.toMatch(/background/);
    expect(rule('\\.btn-primary, \\.btn\\.burst-active, \\.buffer-link-fab\\.burst-active')).toMatch(/var\(--float-glow\)/);
  });

  it('on paper the recipe is off and the keys stay printed', () => {
    expect(daylight).toMatch(/--float-k:\s*0/);
    expect(RULES).toMatch(new RegExp(`:root\\[data-theme="light"\\] :is\\(\\.btn, \\.publish-btn, \\.buffer-link-fab, \\.fn-btn, \\.fn-chip, ${SWEEP.replace(/[.#()]/g, (c) => '\\' + c)}, ${BENCH.replace(/[.#()]/g, (c) => '\\' + c)}\\)::before \\{ content: none; \\}`));
    expect(daylight).toMatch(/--float-recess: 0 0 0 transparent/);
  });

  it('the collapse button wears its neighbours\' housing', () => {
    const t = RULES.match(/\n\.sidebar-toggle \{([^}]*)\}/)[1];
    expect(t).toMatch(/background: transparent/);
    const s = RULES.match(/\n\.settings-btn \{([^}]*)\}/)[1];
    for (const prop of ['padding', 'font-size']) {
      expect(t.match(new RegExp(`${prop}: ([^;]*);`))[1], prop).toBe(s.match(new RegExp(`${prop}: ([^;]*);`))[1]);
    }
  });

  it('a sidebar row ignites its letters, not its ground (K91; the K46 lens is gone)', () => {
    expect(CSS).not.toMatch(/@property --row-warm/);
    expect(RULES).not.toMatch(/--row-lens|--row-warm/);
    expect(RULES).not.toMatch(/\n\.nav-btn:hover \{[^}]*background: var\(--warm-fill\)/);
    expect(RULES).toMatch(/\n\.nav-btn \[data-text="act"\] \{ color: inherit; --text-pool: 0; --text-emit: 0\.\d+; \}/);
    expect(RULES).toMatch(/\n\.nav-btn:is\(:hover, :focus-visible\) \[data-text="act"\] \{ --text-emit: var\(--text-act-warm\); \}/);
  });
});

describe('the holdouts, the counts and the settings LED (K47)', () => {
  it('Publish and the floating Link wear the floating control, Publish unlit when idle', () => {
    expect(RULES).toMatch(/\n\.btn--unlit, \.publish-btn--idle \{\s*--float-glow: 0\.\d+;/);
    expect(RULES).toMatch(/\n\.publish-btn--idle \{ opacity: 1; \}/);
    // The old solid hovers no longer win.
    expect(RULES).toMatch(/\n\.publish-btn:hover, \.fn-btn--stage:hover \{ background: var\(--stage-fill\); filter: none; \}/);
    expect(RULES).toMatch(/\n\.buffer-link-fab:hover \{ background: var\(--frost-1\); \}/);
  });

  it('a sidebar count is a lit readout, hot on the current surface', () => {
    // K91: a readout in TYPE (data-text="stat"), no window; its light is the recipe's.
    const count = RULES.match(/\n\.nav-btn \.nav-count \{([^}]*)\}/g).pop();
    expect(count).toMatch(/--text-emit: 0\.\d+;/);
    expect(count).toMatch(/background: none; box-shadow: none; padding: 0;/);
    expect(count).not.toMatch(/--bg-elev-2|text-shadow/);
    expect(RULES).toMatch(/\n\.nav-btn\.active \.nav-count \{[^}]*color: var\(--lit-hot\)/);
  });

  it('the settings light is the SMD part, coloured by its state', () => {
    const dot = RULES.match(/\n\.settings-status-dot \{([^}]*)\}/g).pop();
    for (const p of [/border-radius: 1px/, /border: 1px solid var\(--led-bezel\)/, /inset 0 0 2px var\(--led-spec\)/, /rgba\(var\(--led-rgb\), 0\.28\)/, /background: color-mix\(in srgb, rgb\(var\(--led-rgb\)\) 74%, black\)/]) {
      expect(dot).toMatch(p);
    }
    expect(RULES).toMatch(/\.settings-status-dot\[data-state="ok"\] \{ --led-rgb: var\(--ok-rgb\); \}/);
    const session = readFileSync(join(ROOT, 'js', 'console', 'session.js'), 'utf8');
    expect(session).toMatch(/el\.dataset\.state = state/);
    expect(session).not.toMatch(/el\.style\.background = color/);
  });
});
