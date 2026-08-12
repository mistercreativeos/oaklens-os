// injectOg — the tags a shared link unfurls with.
//
// Two paths, and the difference is deliberate: a page that already ships a
// static og: block gets its tags OVERWRITTEN in place (buffer), and a page with
// none gets a fresh block APPENDED (archive, posts, /listen).
//
// The append path used to stamp every field unconditionally. That was fine
// while every og source had a picture — but a field note with no hero resolves
// image: null (_frameImg returns null for a missing filename), and a track has
// no image at all until a waveform card has been stamped. Those unfurled as
// `<meta property="og:image" content="null">`: a broken-image preview, which
// reads worse than a text-only one and is exactly the "text-only posts unfurl
// with nothing" gap docs/audio-card-vision.md names.
import { describe, it, expect } from 'vitest';
import { injectOg } from '../src/edge/chrome.js';

// Minimal HTMLRewriter stand-in. Records what the append path would insert,
// and what the override path would set on each selector.
function fakeRewriter() {
  const appended = [];
  const set = {};
  return {
    appended,
    set,
    on(selector, handlers) {
      if (selector === 'head') {
        handlers.element({ append: (html) => appended.push(html) });
      } else {
        handlers.element({
          setAttribute: (attr, val) => { set[selector] = val; },
        });
      }
      return this;
    },
    html() { return appended.join('\n'); },
  };
}

const WITH_IMAGE = {
  title: 'A Frame — STUDIO',
  description: 'Somewhere, 2026',
  image: 'https://cdn.example.com/archive/frame-1024w.webp',
  ogUrl: 'https://example.com/archive/?f=frame',
};

describe('append path — a page with no static og: block', () => {
  it('emits the full set when everything resolved', () => {
    const r = fakeRewriter();
    injectOg(r, WITH_IMAGE, false);
    const html = r.html();
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain(`property="og:image" content="${WITH_IMAGE.image}"`);
    expect(html).toContain('property="og:url"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it('OMITS og:image entirely when there is no picture — never content="null"', () => {
    const r = fakeRewriter();
    injectOg(r, { ...WITH_IMAGE, image: null }, false);
    const html = r.html();
    expect(html).not.toContain('null');
    expect(html).not.toContain('og:image');
    expect(html).not.toContain('twitter:image');
    // The title and description still unfurl — a text preview, not a blank one.
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
  });

  it('downgrades twitter:card to summary when there is no image', () => {
    // summary_large_image with no image renders as an empty banner.
    const r = fakeRewriter();
    injectOg(r, { ...WITH_IMAGE, image: null }, false);
    expect(r.html()).toContain('name="twitter:card" content="summary"');
  });

  it('treats an empty string like an absent image', () => {
    const r = fakeRewriter();
    injectOg(r, { ...WITH_IMAGE, image: '' }, false);
    expect(r.html()).not.toContain('og:image');
  });

  it('defaults og:type to article, and lets an index page say website', () => {
    const article = fakeRewriter();
    injectOg(article, WITH_IMAGE, false);
    expect(article.html()).toContain('content="article"');

    const site = fakeRewriter();
    injectOg(site, { ...WITH_IMAGE, type: 'website' }, false);
    expect(site.html()).toContain('content="website"');
  });

  it('escapes a title with markup in it rather than breaking out of the tag', () => {
    const r = fakeRewriter();
    injectOg(r, { ...WITH_IMAGE, title: 'Bits & <Pieces>' }, false);
    const html = r.html();
    expect(html).toContain('&amp;');
    expect(html).not.toContain('<Pieces>');
  });
});

describe('override path — a page that already ships static tags', () => {
  it('sets each tag from the resolved data', () => {
    const r = fakeRewriter();
    injectOg(r, WITH_IMAGE, true);
    expect(r.set['meta[property="og:title"]']).toBe(WITH_IMAGE.title);
    expect(r.set['meta[property="og:image"]']).toBe(WITH_IMAGE.image);
    expect(r.set['meta[name="twitter:image"]']).toBe(WITH_IMAGE.image);
  });

  it('leaves a static value standing when the resolver had nothing to say', () => {
    const r = fakeRewriter();
    injectOg(r, { ...WITH_IMAGE, image: null }, true);
    expect(r.set['meta[property="og:image"]']).toBeUndefined();
    expect(r.set['meta[property="og:title"]']).toBe(WITH_IMAGE.title);
  });
});
