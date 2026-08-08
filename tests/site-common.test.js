// site-common.js is the single home for the boilerplate that used to be
// copy-pasted into every public page (mobile-nav toggle, CDN image helpers,
// the graceful CDN fallback, the subscribe flow, the viewport-height var).
// These guards keep it that way: every served page loads the module, and none
// of them re-inline a helper the extraction removed. If a page ever redefines
// one, this fails — that is the duplication creeping back.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPORT_MANIFEST } from '../js/export-manifest.js';
import { CHROME_PAGES } from './helpers/pages.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// The public pages that share site-common.js (everything with the site chrome).
// Derived from what this checkout actually ships — see tests/helpers/pages.js.
const PAGES = CHROME_PAGES;

describe('site-common.js is loaded by every public page', () => {
  it.each(PAGES.map((p) => [p]))('%s loads /js/site-common.js', (p) => {
    // Synchronous (no defer): the page's render script runs at parse time and
    // calls these helpers, so the definitions must land first. A defer here
    // would break every page. (Version-agnostic — the ?v= bumps over time.)
    const html = read(p);
    expect(html).toMatch(/src="\/js\/site-common\.js\?v=\d+"/);
    expect(html).not.toMatch(/site-common\.js\?v=\d+"\s+defer/);
  });
});

describe('no public page re-inlines a shared helper', () => {
  it.each(PAGES.map((p) => [p]))('%s', (p) => {
    const html = read(p);
    expect(html, 'submitGTD redefined').not.toMatch(/function\s+submitGTD\s*\(/);
    expect(html, 'cdnImgError redefined').not.toMatch(/function\s+cdnImgError\s*\(/);
    expect(html, 'CDN_PLACEHOLDER redefined').not.toContain('const CDN_PLACEHOLDER');
    expect(html, 'setVhVar redefined').not.toMatch(/function\s+setVhVar\s*\(/);
    // The inline mobile-nav wiring is gone; the nav element id in markup stays.
    expect(html, 'inline nav-toggle wiring').not.toContain("getElementById('nav-toggle')");
  });
});

describe('site-common.js defines the shared surface', () => {
  const js = read('js/site-common.js');
  it.each([
    'cdnRoot', 'cdnUrl', 'cdnSrcsetFor', 'cdnImgError',
    'submitGTD', 'onViewportSettle', 'initMobileNav',
  ].map((f) => [f]))('exports %s', (fn) => {
    expect(js).toMatch(new RegExp(`function\\s+${fn}\\s*\\(`));
  });

  it('defines the CDN placeholder and auto-inits the nav', () => {
    expect(js).toContain('const CDN_PLACEHOLDER');
    expect(js).toMatch(/^\s*initMobileNav\(\);/m); // auto-init at module tail
  });
});

describe('the export carries the shared module', () => {
  it('js/site-common.js is in the export manifest assets', () => {
    expect(EXPORT_MANIFEST.assets).toContain('js/site-common.js');
  });
});
