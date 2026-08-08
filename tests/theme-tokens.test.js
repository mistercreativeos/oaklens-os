// Starter-template token system (design-spec §3): main.css must carry all
// six preset×mode blocks, noir/Midnight must equal the pre-template legacy
// literals (the live site's no-regression contract), and the compat shim
// must keep every legacy variable name resolving. These are parsed from the
// stylesheet text — the palette is data, so the test pins it as data.
import { describe, it, expect } from 'vitest';
import { THEMED_PAGES } from './helpers/pages.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dirname, '..', 'css', 'main.css'), 'utf8');

// Grab the declaration body for a selector prelude. Naive brace matching is
// fine here: token blocks contain no nested braces.
function block(selector) {
  const start = css.indexOf(selector);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function tokens(body) {
  const out = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[`--${m[1]}`] = m[2].trim();
  return out;
}

const PRESET_BLOCKS = {
  'aperture · Midnight': ':root {\n  /* aperture · Midnight */',
  'aperture · Daylight': ':root[data-theme="light"] {',
  'passe-partout · Midnight': ':root[data-preset="passe-partout"] {',
  'passe-partout · Daylight': ':root[data-preset="passe-partout"][data-theme="light"] {',
  'noir · Midnight': ':root[data-preset="noir"] {',
  'noir · Daylight': ':root[data-preset="noir"][data-theme="light"] {',
};

describe('preset × mode blocks', () => {
  it.each(Object.entries(PRESET_BLOCKS))('%s exists and sets the core tokens', (_label, selector) => {
    const body = block(selector);
    expect(body, selector).toBeTruthy();
    const t = tokens(body);
    for (const name of ['--bg', '--bg-rgb', '--surface', '--fg', '--muted', '--accent', '--accent-rgb', '--accent-wash', '--on-accent']) {
      expect(t[name], name).toBeTruthy();
    }
  });

  it('every preset block pairs --bg with matching --bg-rgb channels', () => {
    for (const selector of Object.values(PRESET_BLOCKS)) {
      const t = tokens(block(selector));
      const hex = t['--bg'];
      const got = t['--bg-rgb'].split(',').map((n) => parseInt(n, 10));
      const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(got, `${selector} --bg-rgb vs --bg`).toEqual(want);
    }
  });

  it('every preset block pairs --accent with matching --accent-rgb channels', () => {
    for (const selector of Object.values(PRESET_BLOCKS)) {
      const t = tokens(block(selector));
      const hex = t['--accent'];
      const [r, g, b] = t['--accent-rgb'].split(',').map((n) => parseInt(n, 10));
      const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect([r, g, b], `${selector} --accent-rgb vs --accent`).toEqual(want);
    }
  });
});

describe('noir Midnight = the legacy literals (live-site no-regression)', () => {
  // The exact values css/main.css :root carried before the template pass.
  const LEGACY = {
    '--bg': '#000000',        // was --black
    '--surface': '#0A0A0A',   // was --gray-900 (#0a0a0a)
    '--surface-2': '#1A1A1A',
    '--line': '#1A1A1A',      // was --gray-800
    '--line-2': '#333333',    // was --gray-700
    '--fg': '#E0E0E0',        // was --white
    '--fg-strong': '#F0F0F0', // was --white-bright
    '--muted': '#919191',     // was --gray-300
    '--faint': '#555555',     // was --gray-500
    '--accent': '#FF0000',    // was --red
    '--accent-rgb': '255, 0, 0',
    '--font-display': "'Syne', sans-serif",
    '--font-body': "'Syne Mono', monospace",
    '--font-meta': "'Syne Mono', monospace",
  };

  const t = tokens(block(PRESET_BLOCKS['noir · Midnight']));
  it.each(Object.entries(LEGACY))('%s = %s', (name, value) => {
    expect((t[name] || '').toLowerCase()).toBe(value.toLowerCase());
  });
});

describe('compat shim', () => {
  // Every legacy name page-local <style> blocks may still use.
  const LEGACY_NAMES = [
    '--black', '--white', '--white-bright', '--red', '--red-dim', '--red-glow',
    '--gray-300', '--gray-500', '--gray-700', '--gray-800', '--gray-900', '--font-mono',
  ];
  const shimStart = css.indexOf('COMPAT SHIM');
  const shim = tokens(css.slice(shimStart, css.indexOf('}', css.indexOf(':root', shimStart))));

  it.each(LEGACY_NAMES.map((n) => [n]))('%s is shimmed', (name) => {
    expect(shim[name], name).toBeTruthy();
  });

  it('--red-dim/--red-glow keep their legacy alphas via --accent-rgb (noir pixel parity)', () => {
    expect(shim['--red-dim'].replace(/\s/g, '')).toBe('rgba(var(--accent-rgb),0.2)');
    expect(shim['--red-glow'].replace(/\s/g, '')).toBe('rgba(var(--accent-rgb),0.35)');
  });
});

describe('page wiring', () => {
  // Derived from what this checkout ships — see tests/helpers/pages.js.
  const PAGES = THEMED_PAGES;
  it.each(PAGES.map((p) => [p]))('%s: pre-paint script before stylesheet, tagged preload', (page) => {
    const html = readFileSync(join(import.meta.dirname, '..', page), 'utf8');
    const script = html.indexOf('Pre-paint mode resolution');
    const sheet = html.indexOf('main.css?v=');
    expect(script, 'pre-paint script present').toBeGreaterThan(-1);
    expect(script, 'pre-paint script precedes the stylesheet').toBeLessThan(sheet);
    expect(html).toContain('data-font-preload');
    expect(html).toContain('js/mode-toggle.js');
  });
});
