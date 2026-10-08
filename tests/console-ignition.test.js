// @vitest-environment happy-dom
//
// IGNITION — the console armed while a commit is in flight.
//
// Owner's call, 2026-09-15, replacing the canvas bloom that used to wash the
// whole publish panel: the controls go accent and glow hot instead, like the
// spoolr dashboard's hood ornament coming up to heat. It is NOT a fifth
// licensed light — design-spec.md §6.5 already licenses "the publish bar while
// it commits"; this is the same state on a different surface.
//
// The measurements that decided the shape were taken in a browser (a real
// filter ramp, sampled with getComputedStyle: brightness 1.0007 at 60ms through
// 1.30 at 1500ms, decaying 7px → 0.03px of glow over 2.4s). What is pinned here
// is everything that would silently stop being true.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
// ⚠️ `[data-heat="hot"] {` matches TWICE — the ignition itself and the
// reduced-motion override, which comes first in the file. Pick the block that
// actually carries the filter, or every assertion below silently tests
// `transition: none`. (It did, in the first draft of this file.)
const ruleFor = (sel) => {
  // Anchored to a line start: `.dropzone[data-heat] { filter: none }` (K40b)
  // would otherwise be the first filter-carrying match.
  const re = new RegExp(`(?:^|\\n)${sel}\\s*\\{([^}]*)\\}`, 'g');
  const bodies = [...RULES.matchAll(re)].map((m) => m[1]);
  const hit = bodies.find((b) => /filter:/.test(b));
  if (!hit) throw new Error(`no filter-carrying rule for ${sel} (found ${bodies.length})`);
  return hit;
};
const CHROME = readFileSync(join(process.cwd(), 'js', 'console', 'chrome.js'), 'utf8');
const PUBLISH = readFileSync(join(process.cwd(), 'js', 'console', 'publish.js'), 'utf8');
const HTML = readFileSync(join(process.cwd(), 'dev', 'field-console.html'), 'utf8');

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { setCommitArmed } = await import('../js/console-ui.js');

// Every control the owner named, plus the topbar publish button.
const IDS = [
  'gh-publish-btn', 'gh-clear-staged-btn',
  'pulse-topbar-btn', 'bridge-topbar-btn', 'settings-topbar-btn', 'publish-btn',
];

beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = IDS.map((id) => `<button id="${id}"></button>`).join('');
});

const armedNow = () => [...document.querySelectorAll('[data-heat="hot"]')].map((e) => e.id);
const anyArmed = () => [...document.querySelectorAll('[data-heat]')].map((e) => e.id);

describe('the console arms while a commit is in flight', () => {
  it('lights every control the owner named, and the publish button with them', () => {
    setCommitArmed(true);
    expect(armedNow().sort()).toEqual([...IDS].sort());
  });

  it('declares the resting half FIRST, or the control blinks instead of igniting', () => {
    // ⚠️ The bug this prevents. A `filter` interpolates only against a matching
    // function list; from no filter at all the browser swaps discretely. So the
    // resting attribute goes on, its style is computed (K56: a style read of
    // each control, not a layout of the page), and only then does it go hot. Measured in a browser: brightness 1.0007 at 60ms — a real ramp.
    const seen = [];
    const el = document.getElementById('bridge-topbar-btn');
    const realSet = el.setAttribute.bind(el);
    el.setAttribute = (n, v) => { if (n === 'data-heat') seen.push(v); realSet(n, v); };
    setCommitArmed(true);
    expect(seen, 'resting value must be written before the hot one').toEqual(['', 'hot']);
  });

  it('cools down before it lets go of the attribute', async () => {
    setCommitArmed(true);
    setCommitArmed(false);
    // Still attributed (so the filter list still exists to decay through),
    // but no longer hot.
    expect(armedNow()).toEqual([]);
    expect(anyArmed().sort(), 'the cooling half must stay').toEqual([...IDS].sort());
    await new Promise((r) => setTimeout(r, 2800));
    expect(anyArmed(), 'and then be released').toEqual([]);
  }, 8000);

  it('survives markup that trails the module', () => {
    // A fork mid-merge, or the publish view never opened: half a set beats a
    // thrown boot inside a publish.
    document.body.innerHTML = '<button id="bridge-topbar-btn"></button>';
    expect(() => setCommitArmed(true)).not.toThrow();
    expect(armedNow()).toEqual(['bridge-topbar-btn']);
    expect(() => setCommitArmed(false)).not.toThrow();
  });

  it('does not throw when nothing on the page matches', () => {
    document.body.innerHTML = '';
    expect(() => setCommitArmed(true)).not.toThrow();
    expect(() => setCommitArmed(false)).not.toThrow();
  });

  it('re-arming cancels a cool-down in flight', async () => {
    // Publish, fail, publish again inside three seconds: the first cool-down's
    // timer must not strip the attribute off the second ignition.
    setCommitArmed(true);
    setCommitArmed(false);
    setCommitArmed(true);
    await new Promise((r) => setTimeout(r, 2800));
    expect(armedNow().sort(), 'the second arming must survive').toEqual([...IDS].sort());
  }, 8000);
});

describe('the publish flow arms instead of washing the panel', () => {
  it('publish.js asks chrome to arm, and never lights the panel again', () => {
    expect(PUBLISH).toContain('setCommitArmed(true)');
    expect(PUBLISH).toContain('setCommitArmed(false)');
    // The wash is gone: nothing may put the licensed light back on the panel.
    expect(PUBLISH.replace(/\/\/.*$/gm, ''))
      .not.toMatch(/publish-action[^\n]*data-lit|setAttribute\(\s*['"]data-lit/);
  });

  it('disarms in a finally, so a thrown publish cannot leave it lit forever', () => {
    const fin = PUBLISH.slice(PUBLISH.lastIndexOf('} finally {'));
    expect(fin).toContain('setCommitArmed(false)');
  });

  it('the two publish-view controls have the ids chrome reaches for', () => {
    expect(HTML).toContain('id="gh-publish-btn"');
    expect(HTML).toContain('id="gh-clear-staged-btn"');
  });

  it('the cool-down timer outlasts the CSS cool, or the glow snaps off', () => {
    const ms = Number(CHROME.match(/ARM_COOL_MS\s*=\s*(\d+)/)[1]);
    const cool = Number(CSS.match(/--arm-cool:\s*([\d.]+)s/)[1]) * 1000;
    expect(ms).toBeGreaterThan(cool);
  });
});

describe('heat is one word', () => {
  it('nothing still spells it data-armed — the commit and the bay share data-heat', () => {
    // K40: a publish word for a physical quantity was the seam between two
    // glows. One attribute means the rod and the ignition cannot drift apart.
    expect(RULES).not.toMatch(/data-armed/);
    expect(CHROME.replace(/\/\/.*$/gm, '')).not.toMatch(/data-armed/);
    expect(CHROME).toMatch(/export function heat\(/);
  });
});

describe('the ignition is authored the way a coil heats', () => {
  it('both halves declare the same filter functions, in the same order', () => {
    // The whole reason the resting half exists. If these two lists ever differ
    // in shape, the transition stops being a transition.
    const fns = (block) => [...block.matchAll(/(brightness|saturate|drop-shadow)\(/g)].map((m) => m[1]);
    const rest = ruleFor('\\[data-heat\\]');
    const hot = ruleFor('\\[data-heat="hot"\\]');
    expect(fns(rest)).toEqual(fns(hot));
    expect(fns(hot).length).toBeGreaterThan(2);
  });

  it('heats faster than it cools — a coil is not a CSS class toggling', () => {
    const heat = Number(CSS.match(/--arm-heat:\s*([\d.]+)s/)[1]);
    const cool = Number(CSS.match(/--arm-cool:\s*([\d.]+)s/)[1]);
    expect(cool).toBeGreaterThan(heat);
  });

  it('takes its colour from the accent channel, never a literal', () => {
    const hot = ruleFor('\\[data-heat="hot"\\]');
    expect(hot).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
    expect(hot).toContain('var(--accent-rgb)');
  });

  it('leaves the filled primary its readable label', () => {
    // .btn-primary is --on-accent ON the accent. Recolouring its text to accent
    // would erase the word "Publish" at the exact moment it matters most, so
    // brightness alone lifts that one.
    expect(RULES).toMatch(/\[data-heat="hot"\]:not\(\.btn-primary, \.dropzone, \.fn-hero\)/);   // K50d: and never a bay
  });

  it('keeps the state under reduced motion and drops only the journey', () => {
    const rm = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\[data-heat\][^{]*\{[^}]*transition:\s*none/);
  });
});

describe('a floating key in flight heats and cools its glow (K56)', () => {
  // Since K46 the keys' own transition lists outranked [data-heat]'s and none
  // listed `filter`: the commit's glow snapped on and off. Measured in Chrome
  // after the fix: brightness 1.005 at 260ms, 1.082 at 760ms, 1.3 at 1.5s,
  // and 1.191 700ms into the cool — the coil's curves, a hand on PUBLISH or not.
  const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const KEYS = ':is(.btn, .publish-btn, .settings-btn, .sidebar-toggle)';
  const rule = (sel) => {
    const at = CSS.indexOf(`${sel} {`);
    return at < 0 ? '' : CSS.slice(at, CSS.indexOf('}', at));
  };
  it('lists the filter on the coil\'s curves while the attribute is on', () => {
    expect(rule(`${KEYS}[data-heat][data-heat]`)).toMatch(/transition: filter var\(--arm-cool\), color var\(--arm-cool\), border-color var\(--arm-cool\), background var\(--arm-cool\)/);
    expect(rule(`${KEYS}[data-heat="hot"][data-heat]`)).toMatch(/transition: filter var\(--arm-heat\), color var\(--arm-heat\), border-color var\(--arm-heat\), background var\(--arm-heat\)/);
  });
  it('comes after the keys\' hover lists, so a hand on the key does not snap it', () => {
    const coil = CSS.indexOf(`${KEYS}[data-heat][data-heat] {`);
    expect(coil).toBeGreaterThan(CSS.indexOf('.btn:hover:not(:active), .btn:focus-visible:not(:active)'));
    expect(coil).toBeGreaterThan(CSS.indexOf('.topbar :is(.settings-btn, .sidebar-toggle):hover {'));
  });
  it('drops the journey under reduced motion', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*:is\(\.btn, \.publish-btn, \.settings-btn, \.sidebar-toggle\)\[data-heat\]\[data-heat\] \{ transition: none; \}/);
  });
});
