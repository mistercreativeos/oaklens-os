// The homepage heroes are config-driven + edge-injected: index.html ships
// neutral markup, and the worker fills the split hero (noir) and the folio hero
// image from site.config.js. (The HTMLRewriter injection itself runs only on
// the Workers runtime, so these guards cover the config shape, the stripped
// identity, and the injection hooks — the parts that regress silently.)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import siteConfig from '../site.config.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('hero config shape', () => {
  // splitHero is OPTIONAL by design: a noir fork that omits it falls back to
  // the folio hero (that fallback is the point of the 2026-07-24 generalisation).
  // The example config omits it, so this asserts the shape only when present.
  it.skipIf(!siteConfig.splitHero)('splitHero has both panels with image, headline and a CTA', () => {
    const sh = siteConfig.splitHero;
    expect(sh, 'splitHero').toBeTruthy();
    for (const panel of ['code', 'photo']) {
      expect(sh[panel].image, `${panel}.image`).toBeTruthy();
      expect(sh[panel].headline, `${panel}.headline`).toBeTruthy();
      expect(sh[panel].cta.href, `${panel}.cta.href`).toBeTruthy();
      expect(sh[panel].cta.label, `${panel}.cta.label`).toBeTruthy();
    }
  });

  it('folioHero has an image', () => {
    expect(siteConfig.folioHero.image).toBeTruthy();
  });
});

describe('index.html ships neutral hero markup', () => {
  const html = read('index.html');
  // Drop HTML comments so the inert (commented-out) DROPS block doesn't count.
  const active = html.replace(/<!--[\s\S]*?-->/g, '');

  it.each([
    'console-phone', 'tangents-in-the-void', 'CODE THE TOOL', 'SHOOT THE WORLD', 'Oaklens OS',
  ].map((n) => [n]))('no hardcoded instance identity: %s', (needle) => {
    expect(active).not.toContain(needle);
  });

  it('keeps the injection hooks the worker fills', () => {
    for (const hook of [
      'hero-panel--code', 'hero-panel--photo', 'hero-headline--labeled',
      'hero-headline--open', 'os-cta-badge', 'hero-cta--gallery', 'folio-hero-media',
    ]) {
      expect(html, hook).toContain(hook);
    }
  });
});

describe('worker injects the heroes on the homepage', () => {
  // injectSplitHero + injectSiteChrome live in src/edge/chrome.js now
  // (decomposition, manual §6.7).
  const w = read('src/edge/chrome.js');
  it('wires injectSplitHero + the folio image, gated by config', () => {
    expect(w).toContain('function injectSplitHero');
    expect(w).toContain('injectSplitHero(rewriter)');
    expect(w).toContain('.hero-panel--code .hero-panel-bg');
    expect(w).toContain('.hero-headline--open');
    expect(w).toContain('.folio-hero-media img');
    expect(w).toContain("setAttribute('data-split-hero'");
    expect(w).toContain('siteConfig.splitHero');
    expect(w).toContain('siteConfig.folioHero');
  });
});
