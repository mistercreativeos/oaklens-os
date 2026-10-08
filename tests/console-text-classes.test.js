// @vitest-environment happy-dom
//
// THE TEXT CLASSES (2026-10-06) — what a piece of type IS decides whether it
// gives light. css/field-console.css (TYPE) holds the rules and
// js/console/text-light.js the one moving part; this file holds the parts
// that would quietly stop being true:
//
//   • the vocabulary is closed: four classes, and every data-text in the
//     console's markup and modules is one of them;
//   • the levels are ordered: a stat outshines an act at rest, an act a live
//     readout, info never emits, and a hand lifts an act to a stat;
//   • one recipe draws them all, and no rule in the Bridge writes its own
//     text-shadow — a surface classifies its text, it never lights it by hand;
//   • on the Desk nothing emits, and reduced motion stops the flare;
//   • the update flares readouts in reading order and leaves acts and info
//     dark;
//   • every piece of text the Bridge paints carries a class.
//
// The contract: dev/console-lighting-system.md §5.17.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'css/field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
const MODULES = Object.fromEntries(readdirSync(join(ROOT, 'js/console'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => [f, readFileSync(join(ROOT, 'js/console', f), 'utf8')]));

/** A banner-delimited section of the stylesheet, comments stripped. */
function section(title) {
  const at = CSS.indexOf(title);
  expect(at, `no section "${title}"`).toBeGreaterThan(-1);
  const from = CSS.lastIndexOf('/* =====', at);
  const next = CSS.indexOf('\n/* =====', CSS.indexOf('===== */', at));
  return CSS.slice(from, next < 0 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
}
const TYPE = section('TYPE — THE ROLES, AND THE TEXT CLASSES');
const BRIDGE = section("THE BRIDGE — the console's front page");

/** The first `:root {` block in TYPE, and its Desk override. */
const typeRoot = TYPE.slice(TYPE.indexOf(':root {'), TYPE.indexOf('\n}', TYPE.indexOf(':root {')));
const typeDesk = (() => { const l = TYPE.slice(TYPE.indexOf(':root[data-theme="light"] {')); return l.slice(0, l.indexOf('}')); })();
const MOTION_RE = /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}/;
const motion = (TYPE.match(MOTION_RE) || [''])[0];
const level = (name) => {
  const m = typeRoot.match(new RegExp(`${name}:\\s*([\\d.]+);`));
  if (!m) throw new Error(`no ${name}`);
  return Number(m[1]);
};

let TL;
beforeAll(async () => { TL = await import('../js/console/text-light.js'); });

describe('the vocabulary is closed', () => {
  it('names four classes, two of them readouts', () => {
    expect(TL.TEXT_CLASSES).toEqual(['stat', 'act', 'live', 'info']);
    expect(TL.READOUTS).toEqual(['stat', 'live']);
  });

  it('every class has its rule, and the stylesheet styles no class outside the four', () => {
    for (const c of TL.TEXT_CLASSES) expect(TYPE, c).toMatch(new RegExp(`\\[data-text="${c}"\\]\\s*\\{`));
    const styled = new Set([...RULES.matchAll(/\[data-text="(\w+)"\]/g)].map((m) => m[1]));
    expect([...styled].filter((c) => !TL.TEXT_CLASSES.includes(c))).toEqual([]);
  });

  it('every data-text the console writes is one of the four', () => {
    const found = [];
    for (const [name, src] of [['dev/field-console.html', HTML], ...Object.entries(MODULES)]) {
      for (const m of src.matchAll(/data-text="([^"$]*)"/g)) found.push([name, m[1]]);
    }
    expect(found.length).toBeGreaterThan(10);
    expect(found.filter(([, c]) => !TL.TEXT_CLASSES.includes(c))).toEqual([]);
  });
});

describe('the levels: one dial, ordered', () => {
  it('a stat outshines an act at rest, an act a live readout, and a live readout is still lit', () => {
    expect(level('--text-stat')).toBe(1);
    expect(level('--text-act')).toBeLessThan(level('--text-stat'));
    expect(level('--text-live')).toBeLessThan(level('--text-act'));
    expect(level('--text-live')).toBeGreaterThan(0);
  });

  it('under a hand an act is as lit as a stat; hot is above both, briefly', () => {
    expect(level('--text-act-warm')).toBe(level('--text-stat'));
    expect(level('--text-hot')).toBeGreaterThan(level('--text-stat'));
    // The flare's crest is the hot level, to the digit.
    const crest = TYPE.match(/@keyframes text-flare\s*\{[\s\S]*?--text-flare:\s*([\d.]+);\s*animation-timing-function: cubic-bezier\(0\.4/);
    expect(Number(crest[1])).toBe(level('--text-hot'));
  });

  it('a stat and a live readout set their level and nothing else', () => {
    for (const [c, token] of [['stat', '--text-stat'], ['live', '--text-live']]) {
      const body = TYPE.match(new RegExp(`\\[data-text="${c}"\\]\\s*\\{([^}]*)\\}`))[1].trim();
      expect(body, c).toBe(`--text-emit: var(${token});`);
    }
  });

  it('an act is a level and a colour: the accent, burning in the room\'s light, on a bed of it (pass six)', () => {
    const body = TYPE.match(/\[data-text="act"\]\s*\{([^}]*)\}/)[1];
    expect(body).toMatch(/--text-emit: var\(--text-act\);/);
    expect(body).toMatch(/--text-core: rgb\(var\(--lit-rgb\)\);/);
    expect(body).toMatch(/--text-pool: var\(--text-act-pool\);/);
    expect(body).toMatch(/color: var\(--accent-text\);/);
    // Nothing else has a bed: the recipe's default is none, and white-hot.
    expect(typeRoot).toMatch(/--text-pool:\s*0;/);
    expect(typeRoot).toMatch(/--text-core:\s*var\(--lit-hot\);/);
    expect(level('--text-act-pool')).toBeGreaterThan(0);
  });

  it('info never emits: no level, and no shadow for a flare to raise', () => {
    const body = TYPE.match(/\[data-text="info"\]\s*\{([^}]*)\}/)[1];
    expect(body).toMatch(/--text-emit:\s*0;/);
    expect(body).toMatch(/text-shadow:\s*none;/);
  });

  it('the dial and the flare are registered numbers that do not inherit', () => {
    for (const p of ['--text-emit', '--text-flare']) {
      const reg = CSS.match(new RegExp(`@property ${p}\\s*\\{([^}]*)\\}`));
      expect(reg, p).toBeTruthy();
      expect(reg[1]).toMatch(/syntax:\s*'<number>'/);
      expect(reg[1]).toMatch(/inherits:\s*false/);
    }
  });
});

describe('one recipe draws every class', () => {
  it('is scaled by one number, and a flare reads only above the text\'s own level', () => {
    const recipe = TYPE.match(/\[data-text\]\s*\{([^}]*)\}/)[1];
    expect(recipe).toMatch(/--text-k:\s*calc\(max\(var\(--text-emit\), var\(--text-flare\)\) \* var\(--text-gain\)\)/);
    const shadows = recipe.match(/text-shadow:([\s\S]*?);\s*$/)[1].split(/,\s*\n/);
    expect(shadows).toHaveLength(5);
    for (const s of shadows.slice(0, 4)) expect(s).toContain('var(--text-k)');
    // The last is the update's bloom: the flare alone draws it, so no text
    // carries it at rest.
    expect(shadows[4]).toMatch(/0 0 72px rgba\(var\(--lit-rgb\), calc\(var\(--text-flare\) \* var\(--text-gain\) \* [\d.]+\)\)/);
    expect(shadows[4]).not.toContain('--text-emit');
  });

  it('a flaring text is lit in the room\'s colour, so white light is not lost on white letters (pass six)', () => {
    const recipe = TYPE.match(/text-shadow:([\s\S]*?);/)[1];
    expect(recipe).toMatch(/0 0 var\(--text-pool-r\) rgba\(var\(--lit-rgb\), calc\(var\(--text-k\) \* max\(var\(--text-pool\), var\(--text-flare\) \* [\d.]+\)\)\)/);
  });

  it('at 1 it is the lit figure pass two shipped (core 55%, near 20%, far 0.32)', () => {
    const recipe = TYPE.match(/text-shadow:([\s\S]*?);/)[1];
    expect(recipe).toMatch(/0 0 1px color-mix\(in srgb, var\(--text-core\) calc\(clamp\(0, var\(--text-k\) \* 2 - 1, 1\) \* 55%\)/);
    expect(recipe).toMatch(/0 0 14px color-mix\(in srgb, var\(--text-core\) calc\(var\(--text-k\) \* 20%\)/);
    expect(recipe).toMatch(/0 0 36px rgba\(var\(--lit-rgb\), calc\(var\(--text-k\) \* 0\.32\)\)/);
  });

  it('a hand lifts an act on its own hover or its control\'s, on the ladder\'s pair', () => {
    expect(TYPE).toMatch(/\[data-text="act"\]:is\(:hover, :focus-visible\),\s*:is\(button, a, \[role="button"\]\):is\(:hover, :focus-visible\) \[data-text="act"\]\s*\{\s*--text-emit: var\(--text-act-warm\);\s*\}/);
    expect(motion).toMatch(/\[data-text\]\[data-text\]\s*\{\s*transition: --text-emit var\(--tier-fall\)/);
    expect(motion).toMatch(/\[data-text="act"\]\s*\{\s*transition: --text-emit var\(--tier-rise\)/);
    expect(TYPE).toMatch(/\[data-text="act"\]:active,[\s\S]*?--text-emit: var\(--text-hot\);/);
  });

  it('the flare rides the thermal pair', () => {
    const studio = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')));
    const named = (n) => studio.match(new RegExp(`${n}:\\s*(cubic-bezier\\([^)]*\\));`))[1];
    const kf = RULES.match(/@keyframes text-flare\s*\{([\s\S]*?)\n\}/)[1];
    const fns = [...kf.matchAll(/animation-timing-function:\s*(cubic-bezier\([^)]*\))/g)].map((m) => m[1]);
    expect(fns).toEqual([named('--ease-heat'), named('--ease-cool')]);
  });

  it('on the Desk nothing emits, and a hand inks an act in the accent instead', () => {
    expect(level('--text-gain')).toBe(1);
    expect(typeDesk).toMatch(/--text-gain:\s*0;/);
    expect(TYPE).toMatch(/:root\[data-theme="light"\] :is\([\s\S]*?\)\s*\{\s*color: var\(--accent-text\);\s*\}/);
  });

  it('moves only where motion is welcome: the flare and the dial\'s travel are all inside no-preference', () => {
    expect(motion).toMatch(/\[data-text\]\[data-flare\]\s*\{\s*animation: text-flare var\(--text-flare-dur\) linear var\(--flare-at\) both;/);
    const outside = TYPE.replace(MOTION_RE, '');
    expect(outside).not.toMatch(/transition|animation:/);
    expect(typeRoot).toMatch(/--flare-at:\s*0ms;/);
  });
});

describe('a surface classifies its text; it never lights it by hand', () => {
  it('no rule in the Bridge writes a text-shadow', () => {
    expect(BRIDGE).not.toMatch(/text-shadow/);
    expect(CSS).not.toMatch(/--br-glow|\.br-glow/);
  });

  it('a Bridge rule may move a text between the levels, and only to a named one', () => {
    const moves = [...BRIDGE.matchAll(/--text-emit:\s*([^;]+);/g)].map((m) => m[1]);
    for (const v of moves) expect(v).toMatch(/^var\(--text-(stat|act|act-warm|live|hot|calm)\)$/);
  });

  it('the Bridge writes its type through one kit, and the kit fixes the class to the role', () => {
    const src = MODULES['bridge.js'];
    expect(src).toMatch(/figure: \(html\) => `<div class="br-figure" data-text="stat">/);
    expect(src).toMatch(/label: \(html\) => `<div class="br-label" data-text="info">/);
    expect(src).toMatch(/line: \(html, handler, mod = ''\) => `<button type="button" class="br-line\$\{mod\}" data-text="act" \$\{handler\}>/);
    // …and nothing paints a figure, a label or a line around it.
    const outside = src.replace(/const say = \{[\s\S]*?\n\};/, '');
    expect(outside).not.toMatch(/class="br-(figure|label|line)/);
  });

  it('every header, line and whisper in the Bridge\'s markup is classified', () => {
    const view = HTML.slice(HTML.indexOf('id="view-bridge"'), HTML.indexOf('id="view-buffer"'));
    const tags = [...view.matchAll(/<\w+[^>]*?\sclass="(br-h|br-line|br-meta|br-works)[\s"][^>]*>/g)].map((m) => m[0]);
    expect(tags).toHaveLength(8);   // five headers, the spark's EXPAND and its readout, the pulse's whisper (the ship station's next line went with the owner's K82 notes)
    expect(tags.filter((t) => !/data-text="/.test(t))).toEqual([]);
  });
});

describe('the update — text-light.js', () => {
  const text = (cls, label = cls) => `<span data-text="${cls}">${label}</span>`;

  it('flares readouts in reading order, a step apart, and leaves acts and info dark', () => {
    document.body.innerHTML = `<div id="root">${text('info', 'LABEL')}${text('live', 'NOTHING')}${text('live', 'WAITING')}${text('act', 'Resume')}${text('stat', '1')}${text('stat', '1.2 GB')}</div>`;
    const n = TL.sweep(document.getElementById('root'));
    expect(n).toBe(4);
    const lit = [...document.querySelectorAll('[data-flare]')];
    expect(lit.map((el) => el.textContent)).toEqual(['NOTHING', 'WAITING', '1', '1.2 GB']);
    expect(lit.map((el) => el.style.getPropertyValue('--flare-at'))).toEqual(['0ms', '90ms', '180ms', '270ms']);
    expect(document.querySelector('[data-text="info"]').hasAttribute('data-flare')).toBe(false);
    expect(document.querySelector('[data-text="act"]').hasAttribute('data-flare')).toBe(false);
  });

  it('a long wave is compressed into its span rather than dragging on', () => {
    document.body.innerHTML = `<div id="root">${Array.from({ length: 21 }, () => text('live')).join('')}</div>`;
    TL.sweep(document.getElementById('root'));
    const last = [...document.querySelectorAll('[data-flare]')].pop();
    expect(last.style.getPropertyValue('--flare-at')).toBe('600ms');
  });

  it('skips what is hidden, and answers 0 with nothing to light', () => {
    document.body.innerHTML = `<div id="root"><div hidden>${text('stat')}</div>${text('info')}</div>`;
    expect(TL.sweep(document.getElementById('root'))).toBe(0);
    expect(TL.sweep(null)).toBe(0);
  });

  it('a single flare refuses info and anything unclassified', () => {
    document.body.innerHTML = `${text('info')}<span id="bare">x</span>${text('act')}`;
    expect(TL.flare(document.querySelector('[data-text="info"]'))).toBe(false);
    expect(TL.flare(document.getElementById('bare'))).toBe(false);
    expect(TL.flare(document.querySelector('[data-text="act"]'))).toBe(true);
  });

  it('lets go of the attribute when its own flare ends, not a nested one', () => {
    document.body.innerHTML = `<div data-text="live" id="outer">${text('live', 'inner')}</div>`;
    const outer = document.getElementById('outer');
    const inner = outer.firstElementChild;
    TL.flare(outer); TL.flare(inner);
    const end = (el) => { const e = new Event('animationend', { bubbles: true }); e.animationName = 'text-flare'; el.dispatchEvent(e); };
    end(inner);
    expect(inner.hasAttribute('data-flare')).toBe(false);
    expect(outer.hasAttribute('data-flare')).toBe(true);
    end(outer);
    expect(outer.hasAttribute('data-flare')).toBe(false);
  });

  it('names no surface', () => {
    const code = MODULES['text-light.js'].replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/br-|bridge|#view-|getElementById/);
    expect(code).not.toMatch(/^import /m);
  });
});
