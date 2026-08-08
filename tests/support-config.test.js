// The support page's tiers are config, not markup.
//
// Until 2026-08-05 `support/index.html` carried four live Stripe checkout links
// and the copy around them ("one very necessary espresso") typed straight into
// the page — so a fork of the engine shipped a support page that paid THIS
// instance's owner. Same class of leak as the wordmark, and the last one the
// extraction audit found. `injectSupport` (src/edge/chrome.js) now fills the
// whole grid from `site.config.js` -> `support`.
//
// HTMLRewriter only exists on the Workers runtime, so the injection is driven
// through the same stand-in tests/wordmark.test.js uses. What is pinned here is
// what regresses silently: the generated markup, the states where there is no
// config to inject, and the page shipping hooks instead of a name.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import siteConfig from '../site.config.js';
import { escapeHtml } from '../src/shared/text.js';
import { injectSiteChrome, injectSupport, _supportTiersHtml } from '../src/edge/chrome.js';
import { IS_INSTANCE } from './helpers/instance.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SUPPORT = siteConfig.support;

// Minimal HTMLRewriter stand-in: record handlers, run the matching one.
function fakeRewriter() {
  const handlers = [];
  return {
    on(selector, h) { handlers.push({ selector, h }); },
    element(selector) {
      const entry = handlers.find((x) => x.selector === selector && x.h.element);
      return entry && entry.h.element;
    },
    has(selector) { return handlers.some((x) => x.selector === selector); },
  };
}

function fakeElement(attrs = {}) {
  const map = new Map(Object.entries(attrs));
  return {
    inner: null, innerHtml: false, removed: false,
    getAttribute: (k) => (map.has(k) ? map.get(k) : null),
    setAttribute(k, v) { map.set(k, String(v)); },
    removeAttribute(k) { map.delete(k); },
    setInnerContent(content, opts) { this.inner = content; this.innerHtml = !!(opts && opts.html); },
    remove() { this.removed = true; },
    has: (k) => map.has(k),
  };
}

/** Register the handlers (via `register`), then run the one matching `selector`. */
function runHook(selector, register) {
  const rw = fakeRewriter();
  register(rw);
  const handler = rw.element(selector);
  if (!handler) return null;
  // An `[attr]` selector matches an element carrying that attribute.
  const attr = selector.startsWith('[') ? { [selector.slice(1, -1)]: '' } : {};
  const el = fakeElement(attr);
  handler(el);
  return el;
}

/** The real, whole-chrome path: what a request to /support actually registers. */
const wholeChrome = (rw) => injectSiteChrome(rw, new URL('https://example.test/support'));

// ---------------------------------------------------------------------------

describe('the support config shape', () => {
  it('every tier has a name, a description and somewhere to pay', () => {
    expect(Array.isArray(SUPPORT.tiers), 'support.tiers').toBe(true);
    for (const t of SUPPORT.tiers) {
      expect(t.name, 'tier.name').toBeTruthy();
      expect(t.desc, 'tier.desc').toBeTruthy();
      expect(t.url, `${t.name}.url`).toMatch(/^https:\/\//);
    }
  });

  it("the example config ships editable tiers, not this instance's", () => {
    // A fork copies the example. If it inherited real URLs the whole exercise
    // would have moved the leak rather than closed it. Every example tier must
    // point at example.com — obviously a placeholder, and unreachable if the
    // fork forgets to change it.
    const example = read('site.config.example.js');
    expect(example, 'support block').toContain('support: {');
    const urls = [...example.matchAll(/url:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(urls.length, 'example tier urls').toBeGreaterThan(0);
    for (const u of urls) expect(new URL(u).hostname).toBe('example.com');
    // ...and on a configured instance the two files must not have converged.
    // Gated on IS_INSTANCE, not on "the files differ": in a fork they start
    // identical and diverge the moment the owner fills in their own name,
    // which used to turn this into a failure on somebody else's config.
    if (IS_INSTANCE) {
      for (const t of SUPPORT.tiers) expect(example).not.toContain(t.url);
    }
  });
});

describe('the tier grid is generated from config', () => {
  const html = _supportTiersHtml();

  it('renders one card per configured tier', () => {
    expect((html.match(/class="tier-card"/g) || []).length).toBe(SUPPORT.tiers.length);
  });

  it("carries each tier's link, name, price and copy", () => {
    for (const t of SUPPORT.tiers) {
      expect(html, t.name).toContain(`href="${escapeHtml(t.url)}"`);
      expect(html).toContain(`<div class="tier-name">${escapeHtml(t.name)}</div>`);
      expect(html).toContain(`<div class="tier-desc">${escapeHtml(t.desc)}</div>`);
      expect(html).toContain(escapeHtml(t.price));
      if (t.per) expect(html).toContain(`<span class="sub">${escapeHtml(t.per)}</span>`);
    }
  });

  it('opens checkout in a new tab, with rel="noopener"', () => {
    const links = html.match(/<a [^>]*class="tier-card"/g) || [];
    expect(links.length).toBe(SUPPORT.tiers.length);
    for (const a of links) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener"');
    }
  });

  it('escapes config values instead of trusting them as markup', () => {
    // Config is owner-authored, but it is still data going into an href and a
    // text node — a stray quote must not be able to close the attribute.
    const out = _supportTiersHtml({ tiers: [{
      name: 'A"B', desc: '<script>x</script>', price: '1', url: 'https://e.test/?a=1&b=2',
    }] });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('A&quot;B');
    expect(out).toContain('href="https://e.test/?a=1&amp;b=2"');
  });

  it('renders a tier with no url as a card, not a dead link', () => {
    const html2 = _supportTiersHtml({ tiers: [{ name: 'Thanks', desc: 'No link yet.' }] });
    expect(html2).toContain('<div class="tier-card">');
    expect(html2).not.toContain('<a ');
  });
});

// Fixture-driven, not read off whichever config is installed: these assert the
// rendering rules, and an extracted tree ships a different (example) config.
describe('the blurb and footer copy', () => {
  const bare = (support) => (rw) => injectSupport(rw, support);

  it('joins a list of blurb lines with a line break', () => {
    const el = runHook('[data-support-blurb]', bare({ blurb: ['One line.', 'And another.'] }));
    expect(el.inner).toBe('One line.<br>And another.');
    expect(el.innerHtml, 'a <br> must be markup, not text').toBe(true);
    expect(el.has('data-support-blurb'), 'the hook is stripped').toBe(false);
  });

  it('takes a plain string as readily as a list', () => {
    expect(runHook('[data-support-blurb]', bare({ blurb: 'Just the one line.' })).inner)
      .toBe('Just the one line.');
  });

  it('drops blank lines rather than emitting an empty <br>', () => {
    expect(runHook('[data-support-blurb]', bare({ blurb: ['One', '', '  ', 'Two'] })).inner)
      .toBe('One<br>Two');
  });

  it('escapes the copy — it is text, not a licence to inject markup', () => {
    expect(runHook('[data-support-blurb]', bare({ blurb: 'Tom & Jerry <b>' })).inner)
      .toBe('Tom &amp; Jerry &lt;b&gt;');
  });

  it('wraps the footer note in its // marks', () => {
    const el = runHook('[data-support-note]', bare({ note: 'Secure payment' }));
    expect(el.inner).toBe(
      '<span class="accent">//</span> Secure payment <span class="accent">//</span>');
    expect(el.removed).toBe(false);
    expect(el.has('data-support-note')).toBe(false);
  });

  it('fills the disclaimer', () => {
    expect(runHook('[data-support-disclaimer]', bare({ disclaimer: ['A.', 'B.'] })).inner)
      .toBe('A.<br>B.');
  });
});

describe('injectSiteChrome wires the real config in', () => {
  // The rules above are fixture-driven; this is the one that proves the page a
  // visitor gets is filled from site.config.js and not from an empty default.
  it('fills .tier-grid from the installed config', () => {
    expect(runHook('.tier-grid', wholeChrome).inner).toBe(_supportTiersHtml());
    expect(runHook('.tier-grid', wholeChrome).innerHtml, 'injected as HTML').toBe(true);
  });

  it("carries this instance's checkout links, and only from config", () => {
    const rendered = runHook('.tier-grid', wholeChrome).inner;
    for (const t of SUPPORT.tiers) expect(rendered, t.name).toContain(escapeHtml(t.url));
  });
});

describe('a fork that has not configured any of it', () => {
  const bare = (support) => (rw) => injectSupport(rw, support);

  it('shows the empty state rather than leaving placeholder tiers on screen', () => {
    // The placeholders in the markup exist to give the page shape in the repo.
    // A visitor must never see them read as somebody's real donation options.
    // `null` stands in for a config with no `support` block: the parameter
    // default only fires on `undefined`, so production's missing-block case
    // lands on the same `(support || {})` guard these do.
    for (const support of [null, {}, { tiers: [] }, { tiers: null }]) {
      const html = _supportTiersHtml(support);
      expect(html, JSON.stringify(support)).toContain('class="page-empty"');
      expect(html).toContain('NO SUPPORT TIERS YET');
      expect(html).not.toContain('tier-card');
    }
  });

  it('removes the footer note and disclaimer instead of leaving stray // marks', () => {
    for (const hook of ['[data-support-note]', '[data-support-disclaimer]']) {
      expect(runHook(hook, bare({})).removed, `${hook} removed`).toBe(true);
    }
  });

  it("leaves the markup's own blurb alone when none is configured", () => {
    const rw = fakeRewriter();
    injectSupport(rw, {});
    expect(rw.has('[data-support-blurb]'), 'no blurb handler registered').toBe(false);
  });
});

describe('the served page carries hooks, not tiers', () => {
  const support = read('support/index.html');

  it('the placeholder cards have no href', () => {
    // A placeholder that linked anywhere would be a live link on a real site
    // for as long as the config was missing.
    const cards = support.match(/<a[^>]*class="tier-card"[^>]*>/g) || [];
    expect(cards.length, 'placeholder cards').toBeGreaterThan(0);
    for (const c of cards) expect(c, c).not.toContain('href');
  });

  it("none of this instance's tier copy is in the markup", () => {
    for (const t of SUPPORT.tiers) {
      expect(support, t.name).not.toContain(t.desc);
      expect(support).not.toContain(t.url);
    }
    expect(support).not.toContain('espresso');
    expect(support).not.toContain(SUPPORT.note);
  });

  it('the QR zones are gone, markup and CSS both', () => {
    // The dead-CSS half is how the Prints & Editions block survived a cosmetic
    // removal for a month: the styles still "looked" supported.
    expect(support).not.toContain('qr-zone');
    expect(support).not.toMatch(/qrserver/i);
  });

  it('styles the empty state it can now render', () => {
    // The grid is up to four columns; an empty state in cell one would be a
    // caption in the corner. main.css only spans it for the archive and wall.
    expect(support).toMatch(/\.tier-grid \.page-empty/);
  });
});

describe('injection survives the page being switched off', () => {
  it('registers the handlers unconditionally, so a 404 body is untouched', () => {
    // pages.support === false serves 404.html through this same rewriter. The
    // selectors simply do not match there — but a path-gated registration, or
    // one that assumed the config block exists, could break that.
    const rw = fakeRewriter();
    injectSiteChrome(rw, new URL('https://example.test/'));
    expect(rw.has('.tier-grid')).toBe(true);
    const notFound = read('404.html');
    for (const hook of ['tier-grid', 'data-support-']) expect(notFound).not.toContain(hook);
  });
});
