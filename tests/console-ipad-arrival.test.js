// @vitest-environment happy-dom
// K53 (2026-10-05 — the owner, on the iPad and the phone):
//   • "Specifically the transition from any surface TO the archive is janky.
//     The archive does some stutter animation before a smooth ease up for
//     the lighting." The light's eye adaptation lets a bright surface ARRIVE
//     at its settled exposure, but it stamped the arrival on the entrance
//     animation, which a View Transition starts a crossfade after the light
//     first measures the new surface — so the Archive faded up to the old
//     exposure and then sank for 2.6s. The router now says so at the swap.
//   • "Remove the header found in all areas it's present … The buttons are
//     doing enough work!" — on the iPad, as on the phone.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { showView, registerView } from '../js/console/chrome.js';

const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = readFileSync(join(process.cwd(), 'dev', 'field-console.html'), 'utf8');
const LIGHTING = readFileSync(join(process.cwd(), 'js', 'console', 'lighting.js'), 'utf8');
const IPAD = '@media (min-width: 761px) and (max-width: 1180px), (min-width: 761px) and (pointer: coarse) and (min-height: 501px)';

describe('a surface arriving tells the light at the swap', () => {
  beforeEach(() => {
    document.body.innerHTML = `<main class="main" data-light-layer>
      <section class="view active" id="view-buffer"></section>
      <section class="view" id="view-archive"></section></main>`;
    registerView('archive', { render() {} });
    registerView('buffer', { render() {} });
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('showView sends console-arrive from the new view, bubbling to the layer host, once it is built', () => {
    showView('buffer');
    const seen = [];
    document.querySelector('.main').addEventListener('console-arrive', (e) => {
      seen.push({ id: e.target.id, active: e.target.classList.contains('active') });
    });
    showView('archive');
    expect(seen).toEqual([{ id: 'view-archive', active: true }]);
    // Staying put is not an arrival.
    showView('archive');
    expect(seen.length).toBe(1);
  });

  it('the engine stamps the arrival its exposure rule reads, for a child of a layer host and nothing else', () => {
    const hook = LIGHTING.slice(LIGHTING.indexOf("document.addEventListener('console-arrive'"));
    expect(hook).toMatch(/^document\.addEventListener\('console-arrive', \(ev\) => \{\s*const host = ev\.target\?\.parentElement;\s*if \(!host \|\| !host\.hasAttribute\?\.\(LAYER_ATTR\)\) return;\s*const L = layers\.get\(host\);\s*if \(L\) L\.entered = now\(\);/);
    // …and the rule it feeds is unchanged: arrive brighter than settled → jump, never glide down.
    expect(LIGHTING).toMatch(/if \(target < L\.expo\.level && L\.entered && t - L\.entered < ADAPT_ARRIVE_MS\) \{/);
    // The engine still names no surface.
    expect(hook.slice(0, hook.indexOf('}, { passive'))).not.toMatch(/archive|buffer|publish|view-/i);
  });
});

describe('the iPad has no header (K53)', () => {
  const block = RULES.slice(RULES.indexOf(IPAD), RULES.indexOf('\n}\n', RULES.indexOf(IPAD)));
  it('every header without a control is gone in the band, the phone excepted', () => {
    expect(RULES).toContain(IPAD);
    expect(block).toMatch(/\.view:not\(#view-fn\) \.view-header:not\(:has\(button\)\) \{ display: none; \}/);
  });
  it('a header that holds controls keeps them, as a slim row with no title', () => {
    expect(block).toMatch(/\.view:not\(#view-fn\) \.view-header:has\(button\),\s*body\.hdr-compact \.view:not\(#view-fn\) \.view-header:has\(button\) \{[^}]*position: static;[^}]*padding: 0;[^}]*justify-content: flex-end;/);
    expect(block).toMatch(/\.view-header:has\(button\) \.view-title,\s*\.view:not\(#view-fn\) \.view-header:has\(button\) \.view-sub \{ display: none; \}/);
  });
  it('Bench\'s refresh lives with its other control, not inside the title it would vanish with', () => {
    const bench = HTML.slice(HTML.indexOf('id="view-bench"'), HTML.indexOf('class="filter-bar"', HTML.indexOf('id="view-bench"')));
    expect(bench).toMatch(/<div class="view-title">BENCH<\/div>/);
    const meta = bench.slice(bench.indexOf('<div class="view-meta">'));
    expect(meta).toContain('onclick="refreshBench()"');
    expect(meta).toContain('id="bench-clear-done-btn"');
  });
  it('the desk keeps its header: the media is the band\'s width or a coarse pointer, never a wide desk', () => {
    // Both arms need a coarse pointer or a width the tab bar already owns; a
    // fine pointer over 1180px (the desk, where the sidebar is) matches neither.
    const arms = IPAD.replace('@media ', '').split(', ');
    expect(arms).toEqual(['(min-width: 761px) and (max-width: 1180px)', '(min-width: 761px) and (pointer: coarse) and (min-height: 501px)']);
  });
});
