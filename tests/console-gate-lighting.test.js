import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../worker.js';

// The console gate wears the console's own login card (2026-10-06; it wore the
// console's lighting from 2026-09-21, a filament that warmed as you typed). It
// cannot LOAD css/field-console.css — the login page is deliberately
// self-contained (no shared CSS/JS, so it works on a fork before any branding
// exists and tells an unauthenticated visitor nothing) — so its tokens are a
// copy.
//
// A copy is the price of that. A SILENT copy is not: these tests fail when the
// two files disagree, which is the whole reason the duplication is allowed.

// Tokens the gate deliberately RE-SPELLS rather than copies. The console
// resolves these through the --brand-* hex family, which exists per preset and
// per face; the gate carries raw channels only (it loads no fonts and needs no
// hex tier), so the same semantic token is reached by a different route. The
// list is short on purpose — anything not on it must match exactly.
const RESPELLED = new Set(['--accent-text']);

const css = readFileSync(new URL('../css/field-console.css', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../dev/console-gate.html', import.meta.url), 'utf8');

/** Every `--token: value;` inside the first block matching `selector {`. */
function tokensIn(source, selector) {
  const start = source.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no block for ${selector}`);
  // The block closes at the first `}` alone on a line, at ANY indentation —
  // the gate's tokens live inside an indented <style>, so `\n}` would run
  // straight past them into the preset blocks below.
  const end = source.slice(start).search(/\n\s*\}/);
  // Comments out first: both files EXPLAIN their tokens, and a sentence that
  // mentions `--bloom-gain:` is not a declaration of it.
  const body = source.slice(start, start + end).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim().replace(/\s+/g, ' ');
  }
  return out;
}

describe('the gate copies the console ladder without drifting from it', () => {
  it('shares every token it redeclares from :root', () => {
    const src = tokensIn(css, ':root');
    const copy = tokensIn(gate, ':root');
    const shared = Object.keys(copy).filter((k) => k in src && !RESPELLED.has(k));
    // Guard the guard: if the gate stops naming these, the comparison below
    // silently passes on an empty set.
    expect(shared.length).toBeGreaterThanOrEqual(8);
    for (const name of shared) {
      expect(copy[name], `${name} drifted from css/field-console.css`).toBe(src[name]);
    }
  });

  it('shares every token it redeclares from DAYLIGHT', () => {
    const src = tokensIn(css, ':root[data-theme="light"]');
    const copy = tokensIn(gate, ':root[data-theme="light"]');
    const shared = Object.keys(copy).filter((k) => k in src && !RESPELLED.has(k));
    expect(shared.length).toBeGreaterThanOrEqual(6);
    for (const name of shared) {
      expect(copy[name], `${name} drifted from DAYLIGHT`).toBe(src[name]);
    }
  });

  it('carries every preset the console does, in the console’s channels', () => {
    for (const preset of ['aperture', 'passe-partout', 'selenium', 'cyanotype']) {
      const src = tokensIn(css, `:root[data-preset="${preset}"]`);
      const line = gate.match(new RegExp(`:root\\[data-preset="${preset}"\\][^}]+}`));
      expect(line, `the gate has no ${preset} block`).toBeTruthy();
      expect(line[0], `${preset} channels`).toContain(`--brand-rgb: ${src['--brand-rgb']}`);
      const ink = tokensIn(css, `:root[data-preset="${preset}"][data-theme="light"]`);
      expect(line[0], `${preset} ink channels`).toContain(`--brand-ink-rgb: ${ink['--brand-ink-rgb']}`);
    }
  });
});

describe('the gate is the console\'s login card, and nothing more', () => {
  const modal = readFileSync(new URL('../dev/field-console.html', import.meta.url), 'utf8')
    .match(/<div class="modal-overlay" id="login-modal">[\s\S]*?\n<\/div>/)[0];

  it('has the card\'s parts in the card\'s order: title, PASSWORD, the well, the error, → ENTER', () => {
    const order = ['class="card-header"', '<h1>FIELD CONSOLE</h1>', '>Password</label>', 'type="password"', 'id="gate-error"', '→ ENTER</button>'];
    const body = gate.slice(gate.indexOf('<body>'));
    const at = order.map((needle) => body.indexOf(needle));
    expect(at.every((i) => i > -1), `missing: ${order.filter((n, k) => at[k] === -1)}`).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    // …and the modal it copies still has them, so the two read alike.
    for (const part of ['Password', 'type="password"', '→ ENTER']) expect(modal).toContain(part);
    expect(modal).toMatch(/border-bottom: 2px solid var\(--accent\)/);
    expect(gate).toMatch(/\.card-header \{[^}]*border-bottom: 2px solid rgb\(var\(--accent-rgb\)\)/);
  });

  it('no longer lights up as you type: no filament, no wash, no ignition', () => {
    expect(gate).not.toMatch(/gate-filament|gate-strand|gate-core|gate-wash|data-state/);
    expect(gate).not.toMatch(/:placeholder-shown/);
  });

  it('names no site: the title is the console\'s, never the wordmark', () => {
    expect(gate).not.toMatch(/data-site-wordmark|SITE<span/);
  });

  it('every glow derives from --lit-rgb, so a fork in cyanotype gets a blue card', () => {
    const card = gate.slice(gate.indexOf('  .card {'), gate.indexOf('  .card-header {'));
    expect(card.length).toBeGreaterThan(200);
    expect(card).not.toMatch(/rgba\((255|204|180)\s*,\s*0\s*,\s*0/);
  });
});

describe('the edge stamps the palette on the gate, and nothing else', () => {
  const ctx = { waitUntil() {} };
  const assets = {
    async fetch() {
      return new Response('<!DOCTYPE html><html><body>gate</body></html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  };

  it('runs a one-attribute rewriter over the 401, never the site-chrome one', async () => {
    // Identity must not reach an unauthenticated visitor: this asserts the
    // shape of the handler, because a pass-through HTMLRewriter stub is the
    // only one Node has.
    const branch = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')   // the CODE, not the comment about it
      .match(/const gate = await env\.ASSETS\.fetch[\s\S]{0,900}?return new Response\(lit\.body/);
    expect(branch, 'the gate branch no longer transforms the response').toBeTruthy();
    expect(branch[0]).toContain("setAttribute('data-preset'");
    expect(branch[0]).not.toContain('injectSiteChrome');
    expect(branch[0]).not.toMatch(/siteMetaTags|wordmark|tagline/);
  });

  it('still answers 401 + no-store with the gate document', async () => {
    const seen = [];
    globalThis.HTMLRewriter = class {
      on(sel, handler) { seen.push([sel, handler]); return this; }
      transform(res) { return new Response(res.body, res); }
    };
    const res = await worker.fetch(
      new Request('https://example.com/dev/field-console'),
      { SESSION_SECRET: 's', AUTH_PASSWORD_HASH: 'h', ASSETS: assets },
      ctx
    );
    delete globalThis.HTMLRewriter;
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('gate');
    expect(seen.map(([sel]) => sel)).toEqual(['html']);
  });
});

describe('one card, over the console', () => {
  // A password box is a habit, so there is one card to learn: the console's
  // modal and the gate wear the same one. Log out raises it over the console
  // in place (the owner, 2026-10-06) and still retires the shell cookie, so a
  // reload or a new browser meets the gate. Asserted against the source:
  // importing session.js pulls the console's whole dependency graph for a
  // contract that is a few lines long.
  const src = readFileSync(new URL('../js/console/session.js', import.meta.url), 'utf8');
  const logout = src.match(/export function logout\(\) \{[\s\S]*?\n\}/)[0];
  const checkAuth = src.match(/export function checkAuth\(\) \{[\s\S]*?\n\}/)[0];

  it('clears the local token first', () => {
    expect(logout.indexOf('clearToken()')).toBe(logout.search(/\S/) + logout.slice(logout.search(/\S/)).indexOf('clearToken()'));
    expect(logout.indexOf('clearToken()')).toBeLessThan(logout.indexOf('checkAuth()'));
  });

  it('retires the shell cookie, and survives that request failing', () => {
    expect(logout).toMatch(/logoutServer\(\)\.catch\(/);
  });

  it('stays on the console: no reload, the card comes up over it', () => {
    expect(logout).not.toMatch(/location\.reload/);
    expect(logout).toContain('checkAuth()');
    expect(checkAuth).toMatch(/loginModal\.classList\.remove\('hidden'\)/);
    expect(src).not.toMatch(/_bounceToGate|GATE_BOUNCE_KEY/);
  });
});
