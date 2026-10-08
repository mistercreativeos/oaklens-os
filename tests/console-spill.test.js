// @vitest-environment happy-dom
// THE SPILL (K54, 2026-10-05 — the owner, on the phone and the iPad): the top
// row "shouldn't just be a hard edge. Light coming up from the interface
// beneath it should organically emit/bleed/seep into this bar … I wouldn't
// expect the very top edge of that bar to be lit, rather an organic soft
// roll off to black." The content's light is clipped by its scroller; the
// engine now lets a host's light out of its top edge into the row above it.
// Measured (headless Chrome, CPU ×4, the real data): 0.02–0.04ms an update,
// no layout, no style recalc, scroll frames unchanged.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _lighting } from '../js/console/lighting.js';

const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = readFileSync(join(process.cwd(), 'dev', 'field-console.html'), 'utf8');
const L = readFileSync(join(process.cwd(), 'js', 'console', 'lighting.js'), 'utf8');
const fn = (name) => L.slice(L.indexOf(`function ${name}(`), L.indexOf('\n}\n', L.indexOf(`function ${name}(`)));

describe('the content\'s light rises out of its top edge into the top row', () => {
  it('the scroller opts in; the engine names no surface', () => {
    expect(HTML).toMatch(/<main class="main" data-light-layer data-light-spill>/);
    expect(_lighting.SPILL_ATTR).toBe('data-light-spill');
    expect(fn('drawSpill')).not.toMatch(/topbar|publish|archive|buffer/i);
  });

  it('each column rises from the ROW of light at the edge, stretched to the top of the screen', () => {
    const d = fn('drawSpill');
    expect(d).toMatch(/const row = Math\.floor\(\(\(host\.scrollTop \|\| 0\) - L\.win\.top\) \* EM_SCALE\);/);
    expect(d).toMatch(/g\.drawImage\(L\.canvas, 0, row, L\.canvas\.width, 1, 0, 0, bw, bh\);/);
    expect(d).toMatch(/top: '0px', width: `\$\{width\}px`, height: `\$\{top\}px`/);
  });

  it('it rolls off to black toward the top, on an eased curve that is the light itself at the edge', () => {
    const f = _lighting.SPILL_FADE;
    expect(f[0]).toEqual([0, 0]);
    expect(f.at(-1)).toEqual([1, 1]);
    for (let i = 1; i < f.length; i++) { expect(f[i][0]).toBeGreaterThan(f[i - 1][0]); expect(f[i][1]).toBeGreaterThan(f[i - 1][1]); }
    // Eased: dark for most of the climb, the light gathering near the edge.
    const mid = f.find(([at]) => at >= 0.5);
    expect(mid[1]).toBeLessThan(0.25);
    expect(fn('drawSpill')).toMatch(/g\.globalCompositeOperation = 'destination-in';\s*g\.fillStyle = S\.fade;/);
  });

  it('cheap by construction: an eighth of CSS pixels, geometry read once, one update a frame on a scroll', () => {
    expect(_lighting.SPILL_SCALE).toBe(0.125);
    const d = fn('drawSpill');
    // The only layout read sits behind the cached rect, which a resize clears.
    expect(d.match(/getBoundingClientRect/g)).toHaveLength(1);
    expect(d).toMatch(/if \(!S\.rect\) \{/);
    expect(L).toMatch(/for \(const \[, L\] of layers\) if \(L\.spill\) L\.spill\.rect = null;/);
    expect(fn('spillOnScroll')).toMatch(/requestAnimationFrame/);
    expect(L).toMatch(/spillOnScroll\(t\);/);
  });

  it('one light: it wears the layer\'s exposure and fades in with it', () => {
    expect(fn('applyExposure')).toMatch(/if \(L\.spill\) L\.spill\.canvas\.style\.opacity = o;/);
    expect(L).toMatch(/L\.spill\?\.canvas\.animate\(\[\{ opacity: 0 \}, \{ opacity: L\.expo \? L\.expo\.level : 1 \}\]/);
    expect(fn('drawSpill')).toMatch(/st\.opacity = L\.canvas\.style\.opacity;/);
  });

  // K73: the desk too (the owner: "technically everything on that top strip
  // should be 'floating'"), so the clock's light rolls off under the row
  // instead of stopping on a hard line at the pane's top.
  it('every dark screen\'s, the desk included: 0 on paper, which removes the canvas', () => {
    expect(RULES).toMatch(/:root \{[^}]*--spill-gain: 0;/);
    expect(RULES).toMatch(/\n:root:not\(\[data-theme="light"\]\) \{ --spill-gain: 1; \}/);
    expect(RULES).not.toMatch(/@media[^{]*\{\s*:root:not\(\[data-theme="light"\]\) \{ --spill-gain: 1; \}/);
    expect(fn('drawSpill')).toMatch(/if \(gain <= 0 \|\| !L\.win \|\| !host\.isConnected\) \{ if \(st\.display !== 'none'\) st\.display = 'none'; return; \}/);
    const c = (RULES.match(/\n\.lighting-spill \{([^}]*)\}/) || [])[1];
    expect(c).toMatch(/position: fixed;/);
    expect(c).toMatch(/display: none;/);
    expect(c).toMatch(/pointer-events: none;/);
  });
});

// K54b — the eye adapts to the room, not to a lamp being lit in it; and it
// measures without demoting the light canvas.
describe('the eye adaptation measures the room at rest, and never reads the light canvas', () => {
  it('no exposure is taken while a bay heats or cools, or a row of cards wakes', () => {
    expect(L).toMatch(/if \(!igniting\(\) && !journeying\(host\)\) setExposure\(L, layerExposure\(host, L\)\);/);
    expect(fn('journeying')).toMatch(/host\.querySelector\?\.\('\[data-heat\], \[data-wake\]'\)/);
    // The attribute coming off is a repaint, which is when the room is measured again.
    expect(L).toMatch(/attributeFilter: \['data-lit', 'data-heat', 'data-seam', 'data-backlit'\]/);
  });
  it('the band is copied into a probe made for reading, and the probe is read', () => {
    const rb = fn('readBand');
    expect(rb).toMatch(/getContext\('2d', \{ willReadFrequently: true \}\)/);
    expect(rb).toMatch(/probe\.g\.drawImage\(L\.canvas, 0, top, w, h, 0, 0, w, h\);/);
    expect(rb).toMatch(/return probe\.g\.getImageData\(0, 0, w, h\)\.data;/);
    // The only read of the layer's own context is the fallback where no probe can exist.
    expect(L.match(/L\.g\.getImageData\(/g)).toHaveLength(1);
    expect(rb).toMatch(/if \(!probe\) return L\.g\.getImageData\(0, top, w, h\)\.data;/);
    expect(fn('layerMean')).toMatch(/d = readBand\(L, top, h\);/);
  });
});
