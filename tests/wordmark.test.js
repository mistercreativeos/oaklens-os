// The brand is config, not markup.
//
// Until 2026-08-05 the wordmark and the city were typed into the <title>, nav
// logo and footer of all ten served pages plus the console — so every fork of
// the engine shipped a site named after this instance, which is the one thing
// the engine/instance split exists to prevent. `injectSiteChrome` now fills all
// of it from site.config.js.
//
// HTMLRewriter itself only exists on the Workers runtime, so these tests drive
// the registered handlers through a small stand-in. That is enough to pin the
// two things that regress silently: the chunked <title> rewrite, and the
// ordering that lets a real per-frame og:title still beat the static fallback.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import siteConfig from '../site.config.js';
import { wordmark, wordmarkHtml, locationLabel, siteMetaTags } from '../src/shared/site.js';
import { injectSiteChrome, injectOg } from '../src/edge/chrome.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const PAGES = [
  'index.html', '404.html', 'about/index.html', 'archive/index.html',
  'archive/buffer/index.html', 'field-notes/index.html', 'field-notes/post.html',
  'wall/index.html', 'support/index.html',
];

// ---------------------------------------------------------------------------
// A stand-in for HTMLRewriter: records handlers, then lets a test drive them
// against fake elements/text chunks in registration order (which is the order
// the real rewriter runs them, and the reason injectOg still wins).
// ---------------------------------------------------------------------------

function fakeRewriter() {
  const handlers = [];
  return {
    on(selector, h) { handlers.push({ selector, h }); },
    /** Run every element handler whose selector matches, in registration order. */
    runElement(el, matches) {
      for (const { selector, h } of handlers) {
        if (h.element && matches(selector)) h.element(el);
      }
    },
    /** Feed a text node to the first matching text handler, chunk by chunk. */
    runText(selector, chunks) {
      const entry = handlers.find((x) => x.selector === selector && x.h.text);
      const out = [];
      chunks.forEach((text, i) => {
        const chunk = {
          text,
          lastInTextNode: i === chunks.length - 1,
          remove() { out.push(null); },
          replace(s) { out.push(s); },
        };
        entry.h.text(chunk);
      });
      return out.filter((x) => x !== null).join('');
    },
    element(selector) {
      const entry = handlers.find((x) => x.selector === selector && x.h.element);
      return entry && entry.h.element;
    },
  };
}

function fakeElement(attrs = {}) {
  const map = new Map(Object.entries(attrs));
  return {
    inner: null,
    innerHtml: false,
    getAttribute: (k) => (map.has(k) ? map.get(k) : null),
    setAttribute(k, v) { map.set(k, String(v)); },
    removeAttribute(k) { map.delete(k); },
    setInnerContent(content, opts) { this.inner = content; this.innerHtml = !!(opts && opts.html); },
    has: (k) => map.has(k),
  };
}

const url = new URL('https://example.test/about');

// ---------------------------------------------------------------------------

describe('the wordmark comes from config', () => {
  it('splits into a stem and an accent half', () => {
    const mark = wordmark();
    expect(mark.text).toBe(`${mark.stem}${mark.accent}`);
    expect(mark.stem).toBeTruthy();
  });

  it('falls back to `name` when no wordmark is configured', async () => {
    // The fallback is what makes `wordmark` optional for a fork: a config with
    // only a name still gets a brand on every surface.
    const src = read('src/shared/site.js');
    expect(src).toContain('w.stem || siteConfig.name');
  });

  it('wraps only the accent half in the surface class', () => {
    // A config with no accent half (the starter example) gets plain text, not
    // an empty span — the split is optional, the wordmark is not.
    const { stem, accent, text } = wordmark();
    expect(wordmarkHtml('dot-art'))
      .toBe(accent ? `${stem}<span class="dot-art">${accent}</span>` : text);
  });

  it('renders plain text when the surface has no accent class', () => {
    expect(wordmarkHtml('')).toBe(wordmark().text);
    expect(wordmarkHtml()).toBe(wordmark().text);
  });

  it('joins the city and region for the footer', () => {
    const { name, region } = siteConfig.location;
    expect(locationLabel()).toBe(region ? `${name}, ${region}` : name);
  });

  it('publishes the brand to client JS as meta tags', () => {
    const tags = siteMetaTags('https://example.test');
    expect(tags).toContain(`content="${siteConfig.name}"`);
    expect(tags).toContain(`<meta name="site-wordmark" content="${wordmark().text}">`);
    expect(tags).toContain(`<meta name="site-wordmark-accent" content="${wordmark().accent}">`);
  });
});

describe('<title> is composed at the edge', () => {
  const titleOf = (mode, chunks) => {
    const rw = fakeRewriter();
    injectSiteChrome(rw, url);
    const el = fakeElement(mode === null ? { 'data-site-title': '' } : { 'data-site-title': mode });
    rw.element('title[data-site-title]')(el);
    return rw.runText('title[data-site-title]', chunks);
  };
  const brand = () => wordmark().text;

  it('appends the wordmark to the page name', () => {
    expect(titleOf('', ['About'])).toBe(`About — ${brand()}`);
  });

  it('prefixes it for the console', () => {
    expect(titleOf('prefix', ['FIELD CONSOLE v0.13.0'])).toBe(`${brand()} // FIELD CONSOLE v0.13.0`);
  });

  it('replaces the whole title on the homepage', () => {
    expect(titleOf('brand', ['Photography'])).toBe(brand());
  });

  // The failure this guards against: HTMLRewriter hands text back in arbitrary
  // chunks, and a handler that rewrites per chunk emits the wordmark once per
  // chunk ("Fie — BRANDld Console — BRAND"). Only the last chunk may write.
  it('handles a title split across several text chunks', () => {
    expect(titleOf('', ['The Roll', 'ing ', 'Buffer'])).toBe(`The Rolling Buffer — ${brand()}`);
  });

  it('handles the trailing empty chunk lol-html can emit', () => {
    expect(titleOf('', ['theArchive', ''])).toBe(`theArchive — ${brand()}`);
  });

  it('does not leak the previous page name into the next request', () => {
    // Each request builds its own rewriter, so the accumulator must reset; this
    // asserts the reset rather than trusting it.
    const rw = fakeRewriter();
    injectSiteChrome(rw, url);
    const set = rw.element('title[data-site-title]');
    set(fakeElement({ 'data-site-title': '' }));
    expect(rw.runText('title[data-site-title]', ['First'])).toBe(`First — ${brand()}`);
    set(fakeElement({ 'data-site-title': '' }));
    expect(rw.runText('title[data-site-title]', ['Second'])).toBe(`Second — ${brand()}`);
  });

  it('strips the hook so it never reaches the visitor', () => {
    const el = fakeElement({ 'data-site-title': 'brand' });
    const rw = fakeRewriter();
    injectSiteChrome(rw, url);
    rw.element('title[data-site-title]')(el);
    expect(el.has('data-site-title')).toBe(false);
  });
});

describe('the brand hooks in the body', () => {
  const runHook = (selector, attrs) => {
    const rw = fakeRewriter();
    injectSiteChrome(rw, url);
    const el = fakeElement(attrs);
    rw.element(selector)(el);
    return el;
  };

  it('fills a wordmark hook with styled markup', () => {
    const el = runHook('[data-site-wordmark]', { 'data-site-wordmark': 'accent' });
    expect(el.inner).toBe(wordmarkHtml('accent'));
    expect(el.innerHtml, 'must be injected as HTML, not escaped text').toBe(true);
    expect(el.has('data-site-wordmark')).toBe(false);
  });

  it('fills a location hook with the city and region, as text', () => {
    const el = runHook('[data-site-location]', { 'data-site-location': '' });
    expect(el.inner).toBe(locationLabel());
    expect(el.innerHtml, 'a place name is text, never markup').toBe(false);
  });
});

describe('static og:/twitter: fallbacks', () => {
  const suffix = (attrs) => {
    const rw = fakeRewriter();
    injectSiteChrome(rw, url);
    const el = fakeElement(attrs);
    rw.element('meta[data-site-suffix]')(el);
    return el.getAttribute('content');
  };

  it('appends the wordmark to a title fallback', () => {
    expect(suffix({ 'data-site-suffix': '', content: 'The Rolling Buffer' }))
      .toBe(`The Rolling Buffer — ${wordmark().text}`);
  });

  it('finishes a description with the tagline', () => {
    const out = suffix({ 'data-site-suffix': 'tagline', content: 'Capture first. Process later.' });
    expect(out.startsWith('Capture first. Process later. ')).toBe(true);
    expect(out).toContain(siteConfig.tagline);
    expect(out.endsWith('.'), 'reads as a sentence').toBe(true);
  });

  // The regression that would be invisible: a frame or post page resolves a
  // real per-item og:title, and injectOg registers AFTER injectSiteChrome so
  // its setAttribute lands last. Swap the two calls in worker.js and every
  // shared frame unfurls as the generic page title instead.
  it('a per-frame og:title still wins over the static fallback', () => {
    const rw = fakeRewriter();
    injectSiteChrome(rw, url);
    injectOg(rw, {
      title: 'A Frame — STUDIO', description: 'd', image: 'i', ogUrl: 'u',
    }, true);

    const el = fakeElement({ property: 'og:title', 'data-site-suffix': '', content: 'The Rolling Buffer' });
    rw.runElement(el, (sel) =>
      sel === 'meta[data-site-suffix]' || sel === 'meta[property="og:title"]');
    expect(el.getAttribute('content')).toBe('A Frame — STUDIO');
  });
});

describe('served markup carries no brand of its own', () => {
  it.each(PAGES.map((p) => [p]))('%s ships the hooks, not the name', (page) => {
    const html = read(page);
    expect(html, 'title hook').toMatch(/<title data-site-title/);
    expect(html, 'nav logo hook').toContain('data-site-wordmark');
    expect(html, 'footer location hook').toContain('data-site-location');
  });

  it('the console shell ships them too', () => {
    const html = read('dev/field-console.html');
    expect(html).toMatch(/<title data-site-title="prefix"/);
    expect(html).toContain('data-site-wordmark');
  });
});
