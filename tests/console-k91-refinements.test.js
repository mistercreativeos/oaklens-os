import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * K91 — the owner's refinement notes after K90 (2026-10-07): the sidebar's
 * rows ignite their letters rather than a red lens; the counts are readouts,
 * not boxes; a calm headline rests cool; a long filename wraps; the OUTGOING
 * unit runs the bay's width in the one-column view.
 */
const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'css/field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');

describe('the sidebar in type (K91)', () => {
  it('every row\'s icon and word are acts, and every count a stat', () => {
    const rows = [...HTML.matchAll(/<button class="nav-btn"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const r of rows) {
      expect(r).toMatch(/<span class="nav-icon" data-text="act">/);
      expect(r).toMatch(/<span class="nav-label" data-text="act">/);
      if (r.includes('nav-count')) expect(r).toMatch(/<span class="nav-count" data-text="stat"/);
    }
  });
  it('the rows\' acts keep the row\'s ink and come after THE TYPE, so they outrank the class', () => {
    const type = RULES.indexOf('[data-text="act"]  {');
    const nav = RULES.indexOf('\n.nav-btn [data-text="act"] {');
    expect(type).toBeGreaterThan(0);
    expect(nav).toBeGreaterThan(type);
    expect(RULES).toMatch(/\n\.nav-btn\.active \[data-text="act"\] \{ --text-emit: var\(--text-act-warm\); --text-core: rgb\(var\(--lit-rgb\)\); \}/);
    // No bed of light under a row's word: a row is a place, not a key.
    expect(RULES).toMatch(/\n\.nav-btn \[data-text="act"\] \{[^}]*--text-pool: 0;/);
  });
  it('no rule paints a ground over a hovered or current row in the studio', () => {
    const navRules = [...RULES.matchAll(/\n(\.nav-btn[^{]*)\{([^}]*)\}/g)].filter((m) => !m[1].includes('::') && !m[1].includes('light'));
    for (const m of navRules) expect(m[2], m[1]).not.toMatch(/background(-image)?: (?!transparent|none)/);
  });
});

describe('the Bridge\'s calm headline and the phone\'s unit (K91)', () => {
  it('NOTHING WAITING rests cool: grey ink, the faintest light, still live text', () => {
    expect(RULES).toMatch(/\n\.br-headline\.is-calm \{ color: var\(--ink-3\); \}/);
    expect(RULES).toMatch(/\n\.br-headline\.is-calm \[data-text\] \{ --text-emit: var\(--text-calm\); \}/);
    expect(CSS).toMatch(/--text-calm: 0\.\d+;/);
    // Still no text-shadow written by a Bridge rule (the TYPE contract).
    const calm = RULES.match(/\n\.br-headline\.is-calm[^{]*\{([^}]*)\}/g).join('');
    expect(calm).not.toMatch(/text-shadow/);
  });
  it('in the one-column view the unit is as wide as the bay', () => {
    const narrow = RULES.match(/@container \(max-width: 560px\) \{([\s\S]*?)\n\}/)[1];
    expect(narrow).toMatch(/\.br-ship \{ width: 100%; \}/);
  });
  it('a long filename wraps instead of running under a card\'s keys', () => {
    expect(RULES).toMatch(/\.archive-card \.info \.title \{[^}]*overflow-wrap: anywhere;/);
  });
});
