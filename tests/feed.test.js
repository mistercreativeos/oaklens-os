import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../worker.js';

// The Atom feed (/feed.xml): rendered from data/posts.json (published posts
// only — drafts live in D1 and never reach this file), edge-cached read,
// XML-escaped output, newest-first, capped. A failed data read answers 503 so
// readers never mistake an outage for "all posts deleted" — but a MISSING
// file (404) is an un-seeded fork's normal state and serves an empty feed.

const POSTS = [
  {
    id: 'a1', fn_id: 'fn-001', title: 'First <Frame> & Light', location: 'Somewhere, 2026',
    date: '2026-05-01', added_at: '2026-05-01T18:00:00.000Z', hero: 'hero-one.webp',
    body: '# Heading\nSome **bold** notes with a [link](https://x.example) and '
      + '<div class="buffer-date" data-date="2026-05-01"></div> a shortcode.',
  },
  {
    id: 'b2', fn_id: 'fn-002', title: 'Second', location: 'Somewhere, 2026',
    date: '2026-06-01', added_at: '2026-06-01T18:00:00.000Z', hero: null,
    body: 'Newer post body.',
  },
];

function makeEnv(postsBody, { assetStatus = 200 } = {}) {
  return {
    SESSION_SECRET: 'test-secret-please-ignore',
    SUBSCRIBERS: { get: async () => null, put: async () => {} },
    ASSETS: {
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === '/data/posts.json') {
          return new Response(postsBody, {
            status: assetStatus,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    },
  };
}

// handleFeed reads posts.json through the caches.default edge cache — give it
// a cold cache that never stores, so every test sees its own fixture.
let _savedCaches;
beforeEach(() => {
  _savedCaches = globalThis.caches;
  globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
});
afterEach(() => { globalThis.caches = _savedCaches; });

const feedReq = () => new Request('https://example.com/feed.xml');
const ctx = { waitUntil() {} };

describe('/feed.xml', () => {
  it('serves a valid Atom envelope with the right content type and caching', async () => {
    const res = await worker.fetch(feedReq(), makeEnv(JSON.stringify(POSTS)), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/atom+xml');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const xml = await res.text();
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://example.com/feed.xml"/>');
  });

  it('renders entries newest-first with post links, escaped titles, and clean summaries', async () => {
    const res = await worker.fetch(feedReq(), makeEnv(JSON.stringify(POSTS)), ctx);
    const xml = await res.text();
    // Newest (fn-002) before fn-001.
    expect(xml.indexOf('fn-002')).toBeLessThan(xml.indexOf('fn-001'));
    // Canonical extensionless post URL (the .html spelling 307s to it).
    expect(xml).toContain('https://example.com/field-notes/post?slug=fn-001');
    expect(xml).not.toContain('post.html?slug=');
    // Title XML-escaped, never raw markup.
    expect(xml).toContain('First &lt;Frame&gt; &amp; Light');
    expect(xml).not.toContain('First <Frame>');
    // Summary: markdown + shortcode stripped, link text kept.
    expect(xml).toContain('Some bold notes with a link');
    expect(xml).not.toContain('buffer-date');
    expect(xml).not.toContain('**');
    // Hero rides as an enclosure only when present.
    expect(xml).toContain('hero-one-1024w.webp');
  });

  it('serves a valid empty feed when there are no posts', async () => {
    const res = await worker.fetch(feedReq(), makeEnv('[]'), ctx);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('</feed>');
    expect(xml).not.toContain('<entry>');
  });

  it('answers 503 (not an empty feed) when the data read fails', async () => {
    const res = await worker.fetch(feedReq(), makeEnv('', { assetStatus: 500 }), ctx);
    expect(res.status).toBe(503);
  });

  it('serves an empty feed (not a 503) when posts.json is MISSING — an un-seeded fork', async () => {
    // The extractor OMITS posts.json so the sample fallback renders (manual
    // §5.21). A missing file is that instance's normal state, not an outage;
    // a permanent 503 would make every fork's advertised feed look broken.
    const res = await worker.fetch(feedReq(), makeEnv('not found', { assetStatus: 404 }), ctx);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('</feed>');
    expect(xml).not.toContain('<entry>');
  });

  it('caps the feed at 20 entries', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `x${i}`, fn_id: `fn-${100 + i}`, title: `Post ${i}`,
      added_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`, body: 'b',
    }));
    const res = await worker.fetch(feedReq(), makeEnv(JSON.stringify(many)), ctx);
    const xml = await res.text();
    expect((xml.match(/<entry>/g) || []).length).toBe(20);
  });
});
