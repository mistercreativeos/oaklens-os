// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * K93 — help marks the controls themselves (2026-10-07, the owner: "the stroke
 * system doesn't look good … this is a light emissive interface … this overlay
 * when scrolling, especially on mobile, isn't able to keep up").
 *
 * Browse puts one class on each explained control and the stylesheet lights
 * it in place; nothing is positioned by script and nothing listens to scroll.
 * Card mode keeps one dim with one hole around the picked control.
 */
const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'css/field-console.css'), 'utf8');
const SRC = readFileSync(join(ROOT, 'js/console/help.js'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector) => {
  const at = RULES.indexOf(`\n${selector} {`);
  if (at < 0) return null;
  const open = RULES.indexOf('{', at);
  return RULES.slice(open + 1, RULES.indexOf('}', open));
};

describe('the mark is the control\'s own light', () => {
  it('is one registered number on the target, three tiers of the room\'s light, no colour of its own', () => {
    expect(CSS).toMatch(/@property --help-mark \{\s*syntax: '<number>';/);
    const r = rule('body.help-on .help-target');
    expect(r).toBeTruthy();
    expect(r).toMatch(/--help-mark: 0\.\d+;/);
    expect(r.match(/rgba\(var\(--lit-rgb\), calc\([\d.]+ \* var\(--help-mark\)\)\)/g).length).toBe(3);
    expect(r).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba\(\s*\d/);
    expect(r).toMatch(/transition: --help-mark var\(--tier-fall\)/);
  });
  it('climbs a ladder: marked < under the hand < picked, and steps back behind a card', () => {
    const rest = Number(rule('body.help-on .help-target').match(/--help-mark: ([\d.]+)/)[1]);
    const warm = Number(RULES.match(/body\.help-on \.help-target:is\(:hover, :focus-visible\) \{ --help-mark: ([\d.]+)/)[1]);
    const back = Number(RULES.match(/body\.help-carded \.help-target \{ --help-mark: ([\d.]+)/)[1]);
    const hot = Number(RULES.match(/body\.help-carded \.help-target\.help-picked \{ --help-mark: ([\d.]+)/)[1]);
    expect(back).toBeLessThan(rest);
    expect(rest).toBeLessThan(warm);
    expect(warm).toBeLessThan(hot);
    expect(RULES).toMatch(/\.help-target\.help-picked \{[^}]*transition: --help-mark var\(--arm-heat\)/);
  });
  it('on paper it is a ring, and under reduced motion it simply is its level', () => {
    expect(RULES).toMatch(/:root\[data-theme="light"\] body\.help-on \.help-target \{\s*box-shadow: 0 0 0 1px rgba\(var\(--accent-rgb\)/);
    expect(RULES).toMatch(/prefers-reduced-motion: reduce\) \{\s*body\.help-on \.help-target, body\.help-on \.help-target:is\(:hover, :focus-visible\) \{ transition: none; \}/);
  });
  it('the overlay\'s marks, filaments, per-control holes and the ? bloom are gone', () => {
    for (const gone of ['.help-mark', '.help-filament', '.help-strand', '.help-core', '.help-arm-glow', '.help-marks', '#help-scrim-holes', 'data-dock']) {
      expect(RULES, gone).not.toContain(gone);
      expect(SRC, gone).not.toContain(gone.replace(/^[.#]/, ''));
    }
    // The dim is card mode's alone, with one hole.
    expect(rule('.help-scrim')).toMatch(/display: none/);
    expect(RULES).toMatch(/\.help-layer\.carded \.help-scrim \{ display: block; \}/);
    expect(SRC).toMatch(/<rect id="help-scrim-hole"/);
    expect(SRC).not.toMatch(/help-scrim-holes|help-scrim-fixed/);
  });
  it('listens to no scroll, tracks no finger, and seats nothing', () => {
    expect(SRC).not.toMatch(/addEventListener\('scroll'/);
    expect(SRC).not.toMatch(/_onScroll|_letGo|_seat\b|SETTLE_MS|_touch\b|pointercancel|'wheel'/);
    expect(SRC).not.toMatch(/_placeMarks|_placeMark\b|_dockBar|_placeArmGlow|_armRect/);
    // What it still measures: the one hole when a card opens, on a resize,
    // and when the view's own observers report a late render.
    expect(SRC).toMatch(/window\.addEventListener\('resize', \(\) => _reflow\(true\)\)/);
    expect(SRC).toMatch(/new ResizeObserver\(_queueRelayout\)/);
    expect(SRC).toMatch(/new MutationObserver\(_queueRelayout\)/);
  });
});

describe('the sidebar waveguide — one licensed selection, no chaser', () => {
  it('seats a cold bead on every item and lights only the current view', () => {
    expect(rule('.nav-btn::before')).toContain('var(--lit-cold-1)');
    expect(rule('.nav-btn::before')).not.toContain('--lit-halo');
    expect(rule('.nav-btn.active::before')).toContain('var(--lit-halo)');
    expect(rule('.nav-group::before')).toContain('var(--edge-in)');
  });
  it('runs no idle chaser down the track', () => {
    expect(RULES).not.toMatch(/\.nav-[\w-]*[^{]*\{[^}]*animation/);
  });
  it('keeps the reduced-motion bargain for the bead', () => {
    expect(RULES).toMatch(/prefers-reduced-motion[\s\S]{0,1200}\.nav-btn::before \{ transition: none; \}/);
  });
});

// ---- behaviour, in a stubbed console (happy-dom lays nothing out) ------------
const HELP_MOD = await import('../js/console/help.js');

describe('browse marks the controls in place; a card dims around one', () => {
  const at = (el, top, bottom, left = 100, right = 900) => {
    el.getBoundingClientRect = () => ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top });
    el.getClientRects = () => [el.getBoundingClientRect()];
    return el;
  };
  beforeEach(() => {
    HELP_MOD.helpClose();
    document.body.innerHTML =
      '<header class="topbar"><button id="help-topbar-btn"></button></header>'
      + '<div class="layout"><div class="main">'
      + '<section class="view active" id="view-buffer">'
      + '<div class="dropzone" id="buffer-dropzone"></div>'
      + '<button id="buffer-raw-lens-btn"></button>'
      + '</section></div></div>';
    at(document.querySelector('.topbar'), 0, 52, 0, 1000);
    at(document.getElementById('buffer-dropzone'), 100, 300);
    at(document.getElementById('buffer-raw-lens-btn'), 320, 352, 100, 220);
    window.innerWidth = 1000;
    window.innerHeight = 620;
    window.matchMedia = () => ({ matches: false });
  });
  afterEach(() => HELP_MOD.helpClose());

  it('marks each explained control with the class and its entry, borrows a tab stop, and lights the ?', () => {
    HELP_MOD.helpToggle();
    const zone = document.getElementById('buffer-dropzone');
    const btn = document.getElementById('buffer-raw-lens-btn');
    expect(zone.classList.contains('help-target')).toBe(true);
    expect(zone.dataset.helpFor).toBe('#buffer-dropzone');
    expect(zone.getAttribute('tabindex')).toBe('0');
    expect(btn.classList.contains('help-target')).toBe(true);
    expect(btn.hasAttribute('tabindex')).toBe(false);   // a button has its own
    expect(document.body.classList.contains('help-on')).toBe(true);
    expect(document.getElementById('help-topbar-btn').getAttribute('data-lit')).toBe('accent');
    // Nothing drawn over the page in browse: no marks, the dim's hole closed.
    expect(document.querySelectorAll('#help-layer .help-mark').length).toBe(0);
    expect(document.getElementById('help-scrim-hole').getAttribute('width')).toBe('0');
    expect(document.getElementById('help-bar-count').textContent).toBe('· 2 on this screen');
  });

  it('a pick holds that control hot, cuts one hole for it, and opens its card', () => {
    HELP_MOD.helpToggle();
    const btn = document.getElementById('buffer-raw-lens-btn');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(document.body.classList.contains('help-carded')).toBe(true);
    expect(btn.classList.contains('help-picked')).toBe(true);
    expect(document.getElementById('buffer-dropzone').classList.contains('help-picked')).toBe(false);
    const hole = document.getElementById('help-scrim-hole');
    expect(Number(hole.getAttribute('width'))).toBeGreaterThan(100);
    expect(document.getElementById('help-card-title').textContent).toBe('Straight off the card');
    // Back to browse: the hot one cools, the hole closes.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.body.classList.contains('help-carded')).toBe(false);
    expect(btn.classList.contains('help-picked')).toBe(false);
    expect(hole.getAttribute('width')).toBe('0');
  });

  it('leaves nothing behind on close', () => {
    HELP_MOD.helpToggle();
    HELP_MOD.helpClose();
    expect(document.querySelectorAll('.help-target, .help-picked, [data-help-for]').length).toBe(0);
    expect(document.getElementById('buffer-dropzone').hasAttribute('tabindex')).toBe(false);
    expect(document.body.className).toBe('');
    expect(document.getElementById('help-topbar-btn').hasAttribute('data-lit')).toBe(false);
  });
});
