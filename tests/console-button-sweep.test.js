import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * K90 — the button sweep and the planes (2026-10-07, the owner: FROM LIBRARY
 * and RAW LENS are "the button styles that are new"; the Pulse lanes, the
 * library's pills and a plane's close cap were still the old chrome; the
 * modals "still haven't been updated to a clean, smooth, emissive panel …
 * more rounded glass panel style").
 */
const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'css/field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const esc = (t) => t.replace(/[.#()]/g, (c) => '\\' + c);

// The set, as the stylesheet names it (THE SWEEP). A control that is a key.
export const SWEEP = ['.asset-lib-pill', '.asset-lib-sort', '.audio-lib-pill', '.audio-lib-sort', '.pulse-lane', '.pulse-log-btn',
  '.modal-close', '.rl-nav', '.fn-drawer-tab', '.fn-tool', '.uqp-btn', '.focal-style-btn', '.cards-seg-btn',
  '.cards-pill', '.cards-chip', '.help-bar-btn'];
export const BENCH = ['#view-bench .filter-btn', '#bench-detail .status-btn', '#bench-detail .action-btn', '#bench-detail .back-btn'];
const IS = `:is(${SWEEP.join(', ')})`, BIS = `:is(${BENCH.join(', ')})`;

describe('every key in the room is the floating control (K90)', () => {
  it('the sweep joins the recipe: the key tokens, the slab, the glass behind it, the hand, the press', () => {
    expect(RULES).toMatch(new RegExp(`\\.rl-handoff,\\n${esc(IS)}, ${esc(BIS)} \\{\\n\\s*--key-body:`));
    expect(RULES).toMatch(new RegExp(`\\n\\.btn, \\.publish-btn, \\.buffer-link-fab, \\.fn-btn, \\.fn-chip,\\n${esc(IS)}, ${esc(BIS)} \\{\\n\\s*isolation: isolate;`));
    expect(RULES).toMatch(new RegExp(`\\.fn-chip::before,\\n${esc(IS)}::before, ${esc(BIS)}::before \\{`));
    expect(RULES).toMatch(new RegExp(`${esc(IS)}:hover, ${esc(IS)}:focus-visible, ${esc(BIS)}:hover, ${esc(BIS)}:focus-visible \\{\\n\\s*--float-glow: 1\\.9;`));
    expect(RULES).toMatch(new RegExp(`${esc(IS)}:hover:not\\(:active\\), ${esc(BIS)}:hover:not\\(:active\\) \\{\\n\\s*transition: --float-glow var\\(--float-rise\\)`));
    expect(RULES).toMatch(new RegExp(`\\.btn:active, ${esc(IS)}:active, ${esc(BIS)}:active \\{ text-shadow: var\\(--lit-strike\\); \\}`));
    // On paper the glass behind every key is off.
    expect(RULES).toMatch(new RegExp(`:root\\[data-theme="light"\\] :is\\(\\.btn, \\.publish-btn, \\.buffer-link-fab, \\.fn-btn, \\.fn-chip, ${esc(SWEEP.join(', '))}, ${esc(BENCH.join(', '))}\\)::before \\{ content: none; \\}`));
  });

  it('no sweep member carries an id inside :is() (it would outweigh the selected cap)', () => {
    for (const s of SWEEP) expect(s, s).not.toMatch(/#/);
    // The bench's keys live under ids; their :is() is 1,1,0, under the cap's 1,2,0.
    for (const s of BENCH) expect(s).toMatch(/^#[a-z-]+ \.[a-z-]+$/);
  });

  it('a selected member of every segmented set is the cap, the newly swept ones too', () => {
    const cap = RULES.match(/\n\.fn-drawer-tab\[aria-selected="true"\], \.cards-seg-btn\.is-on,[^{]*\{/)[0];
    for (const s of ['.focal-style-btn.on', '.fn-tool.active', '#bench-detail .status-btn.active', '.pulse-lane.active', '.asset-lib-pill.active']) {
      expect(cap, s).toContain(s);
    }
  });

  it('the segmented housings are gone: each segment is a key of its own', () => {
    expect(RULES).toMatch(/\n\.cards-seg \{\s*display: inline-flex;\s*gap: 6px;\s*\}/);
    expect(RULES).not.toMatch(/\.cards-seg-btn \+ \.cards-seg-btn \{ border-left/);
    expect(RULES).toMatch(/\n\.focal-style \{ display: flex; gap: 6px;/);
    expect(RULES).not.toMatch(/\.focal-style-btn:first-child \{ margin-left: 0; \}/);
    // The help bar's Done (after the recipe in the file) keeps its shape only.
    const help = RULES.match(/\n\.help-bar-btn \{([^}]*)\}/)[1];
    expect(help).not.toMatch(/background|border-radius: 999px|var\(--edge-cold\)/);
    expect(RULES).not.toMatch(/\n\.help-bar-btn:hover \{/);
  });

  it('nothing that is not a key was swept: rows, the tab bar, glyph tiles, swatches, the switch', () => {
    for (const s of ['.nav-btn', '.tab-btn', '.sheet-item', '.pulse-glyph', '.pulse-swatch', '.so-switch', '.rl-seg button']) {
      expect(SWEEP, s).not.toContain(s);
    }
    // A control whose ::before is already spoken for cannot take the glass.
    expect(RULES).toMatch(/\n\.so-switch::before \{/);
    expect(SWEEP).not.toContain('.so-switch');
  });
});

describe('a plane is a rounder pane of glass with a lit rim (K90)', () => {
  it('declares the plane\'s corner and rim as tokens, and uses them', () => {
    expect(CSS).toMatch(/--r-plane: 18px;/);
    expect(CSS).toMatch(/--r-sheet: 20px;/);
    expect(RULES).toMatch(/\.modal-overlay \.modal \{ border-radius: var\(--r-plane\); \}/);
    expect(RULES).toMatch(/\.sheet-overlay \.welcome \{ border-radius: var\(--r-plane\); \}/);
    expect(RULES).toMatch(/:root \{ --plane-rim: rgba\(var\(--lit-rgb\), calc\(var\(--seam-halo-a\) \* 1\.2\)\); \}/);
    expect(RULES).toMatch(/:root\[data-theme="light"\] \{ --plane-rim: var\(--line-2\); \}/);
    const plane = RULES.match(/\n\.modal-overlay \.modal, \.sheet-overlay \.sheet, \.sheet-overlay \.welcome \{\s*border-color: var\(--plane-rim\);([^}]*)\}/);
    expect(plane).toBeTruthy();
    // Every shadow in the near field is the seam's own halo, so paper is dark.
    expect(plane[1].match(/rgba\(var\(--lit-rgb\), calc\(var\(--seam-halo-a\)/g).length).toBe(3);
  });

  it('a toolbar inside a plane is part of the glass, not a band across it', () => {
    expect(RULES).toMatch(/\.modal-overlay :is\(\.asset-lib-toolbar, \.audio-lib-toolbar\) \{ background: transparent; border-bottom-color: transparent; border-image: none; \}/);
    expect(RULES).toMatch(/\.modal-overlay \.sendpick-row \{ background: var\(--glass-body, var\(--bg-elev-2\)\);/);
  });
});

describe('the asset library builds a page at a time (K90; the picker\'s way since K81)', () => {
  const src = readFileSync(join(ROOT, 'js/console/asset-library.js'), 'utf8');
  it('pages the grid and watches the last tile for the next page', () => {
    expect(src).toMatch(/export const ASSET_PAGE = 48;/);
    expect(src).toMatch(/function _assetMore\(\)/);
    expect(src).toMatch(/insertAdjacentHTML\('beforeend'/);
    expect(src).toMatch(/new IntersectionObserver\([^)]*\)[\s\S]*root: gridEl/);
    // The whole-grid build is gone.
    expect(src).not.toMatch(/gridEl\.innerHTML = items\.map/);
    // Closing lets go of the observer and the list.
    const close = src.slice(src.indexOf('export function closeAssetLibrary()'), src.indexOf('export function renderAssetLibrary()'));
    expect(close).toMatch(/_assetSeen\.disconnect\(\)/);
    expect(close).toMatch(/_assetShown = \[\]/);
  });
});

describe('a key that repeats per item is lean (K90)', () => {
  it('a row\'s small key and the Cards\' chips take the tokens and no glass layer: hundreds of them on a long list', () => {
    for (const s of ['.icon-btn', '.reuse-chip', '.layout-chip']) expect(SWEEP, s).not.toContain(s);
    const lean = RULES.match(/\n\.icon-btn, \.reuse-chip, \.layout-chip \{\s*--key-body:([^}]*)\}/);
    expect(lean).toBeTruthy();
    expect(lean[1]).toMatch(/background: var\(--key-body\)/);
    expect(lean[1]).toMatch(/box-shadow: var\(--float-recess\), var\(--key-edge\);/);
    expect(RULES).not.toMatch(/\.icon-btn::before|\.reuse-chip::before|\.layout-chip::before/);
    expect(RULES).toMatch(/\n:is\(\.icon-btn, \.reuse-chip, \.layout-chip\):hover, :is\(\.icon-btn, \.reuse-chip, \.layout-chip\):focus-visible \{ --float-glow: 1\.9;/);
  });
  it('the Cards\' keys are half the mass on a desk, and the HIG size under a finger', () => {
    const m = RULES.match(/@media \(min-width: 1181px\) and \(pointer: fine\) \{\s*#view-cards \.btn, #view-cards \.cards-seg-btn, #view-cards \.cards-pill \{ padding: 5px 11px; font-size: var\(--t-micro\); min-height: 0; \}[^}]*\}[^}]*\}[^}]*\}[^}]*\}\s*\}/);
    expect(m).toBeTruthy();
    expect(m[0]).toMatch(/#view-cards \.btn-full \{ width: auto; \}/);
    expect(m[0]).toMatch(/#view-cards \.action-dock \{ flex-direction: row; flex-wrap: wrap;/);
  });
});
