// GET /podcast.xml — the RSS 2.0 feed podcast apps subscribe to.
//
// This is a SEPARATE document from /feed.xml, and the separation is the
// feature: Apple Podcasts and friends require RSS 2.0 (the blog feed is Atom,
// which they cannot read), and only tracks the author marked `episode` belong
// in a subscriber's queue. A demo or a voice memo leaking into someone's
// podcast app is the failure this guards against.
//
// The enclosure is what actually plays, so its three attributes are asserted
// directly: a wrong `length` makes clients mis-scrub, and a wrong `type` makes
// them refuse the file outright.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../worker.js';
import { cdnBase } from '../src/shared/site.js';

const ORIGIN = 'https://example.com';
// Derived, never hardcoded: an instance with a custom CDN domain and a
// zero-config fork (which serves through /api/cdn) must both read the same
// here — and a real domain does not belong in a test file either way.
const CDN = cdnBase(ORIGIN);

const TRACKS = [
  {
    id: '1', slug: 'ep-004', filename: 'ep-004.mp3', title: 'Episode 4',
    sub: 'The ferry at dawn', duration: 2400, size: 38_400_000,
    mime: 'audio/mpeg', added_at: '2026-08-12', episode: true,
  },
  {
    id: '2', slug: 'ep-003', filename: 'ep-003.m4a', title: 'Episode 3',
    duration: 1800, size: 28_000_000, mime: 'audio/mp4',
    added_at: '2026-08-05', episode: true,
  },
  // Marked featured but NOT an episode: a loose demo that belongs on the
  // homepage card and nowhere near a podcast app.
  {
    id: '3', slug: 'take-one', filename: 'take-one.mp3', title: 'Take One',
    duration: 214, size: 3_400_000, added_at: '2026-08-14', featured: true,
  },
];

const envWith = (tracks) => ({
  ASSETS: {
    async fetch(req) {
      if (new URL(req.url).pathname === '/data/audio.json') {
        return new Response(JSON.stringify(tracks), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
  },
  CDN: {},
});

let _savedCaches;
beforeEach(() => {
  _savedCaches = globalThis.caches;
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const hit = store.get(typeof req === 'string' ? req : req.url);
        return hit ? new Response(hit) : undefined;
      },
      async put(req, res) { store.set(typeof req === 'string' ? req : req.url, await res.text()); },
    },
  };
});
afterEach(() => { globalThis.caches = _savedCaches; });

const feed = (env) => worker.fetch(new Request(`${ORIGIN}/podcast.xml`), env, { waitUntil() {} });
const body = async (env) => (await feed(env)).text();

describe('/podcast.xml — the document podcast apps expect', () => {
  it('serves RSS 2.0 with the iTunes namespace, not Atom', async () => {
    const res = await feed(envWith(TRACKS));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8');
    const xml = await res.text();
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('http://www.itunes.com/dtds/podcast-1.0.dtd');
  });

  it('carries only tracks marked as episodes', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('Episode 4');
    expect(xml).toContain('Episode 3');
    // The whole point of the per-track switch.
    expect(xml).not.toContain('Take One');
  });

  it('orders newest first', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml.indexOf('Episode 4')).toBeLessThan(xml.indexOf('Episode 3'));
  });
});

describe('the enclosure — what actually plays', () => {
  it('names the file, its exact byte length, and its MIME type', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain(
      `<enclosure url="${CDN}/audio/ep-004.mp3" length="38400000" type="audio/mpeg"/>`
    );
  });

  it('uses each track\'s own recorded type rather than assuming mp3', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('type="audio/mp4"');
  });

  it('falls back to a type derived from the extension when none was recorded', async () => {
    const xml = await body(envWith([
      { slug: 'x', filename: 'x.flac', title: 'X', size: 10, added_at: '2026-01-01', episode: true },
    ]));
    expect(xml).toContain('type="audio/flac"');
  });

  it('emits a zero length rather than an empty attribute when size is unknown', async () => {
    // An absent length attribute is invalid; "0" is a value clients handle.
    const xml = await body(envWith([
      { slug: 'x', filename: 'x.mp3', title: 'X', added_at: '2026-01-01', episode: true },
    ]));
    expect(xml).toContain('length="0"');
  });
});

describe('per-item metadata', () => {
  it('gives every item a permalink guid pointing at its /listen page', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('<guid isPermaLink="true">https://example.com/listen/?a=ep-004</guid>');
  });

  it('emits pubDate in RFC-822, not ISO', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('<pubDate>Wed, 12 Aug 2026 00:00:00 GMT</pubDate>');
    expect(xml).not.toContain('<pubDate>2026-08-12T');
  });

  it('survives an unparseable date instead of emitting Invalid Date', async () => {
    const xml = await body(envWith([
      { slug: 'x', filename: 'x.mp3', title: 'X', size: 1, added_at: 'whenever', episode: true },
    ]));
    expect(xml).not.toContain('Invalid Date');
    expect(xml).toContain('<pubDate>');
  });

  it('reports duration in seconds', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('<itunes:duration>2400</itunes:duration>');
  });

  it('escapes a title rather than breaking the document', async () => {
    const xml = await body(envWith([
      { slug: 'x', filename: 'x.mp3', title: 'Bits & <Pieces>', size: 1, added_at: '2026-01-01', episode: true },
    ]));
    expect(xml).toContain('Bits &amp; &lt;Pieces&gt;');
    expect(xml).not.toContain('<Pieces>');
  });
});

describe('a site with no show', () => {
  it('serves a valid, empty channel when nothing is marked an episode', async () => {
    const xml = await body(envWith([TRACKS[2]]));
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('</channel>');
    expect(xml).not.toContain('<item>');
  });

  it('serves an empty channel when the registry is missing (an un-seeded fork)', async () => {
    const res = await feed({
      ASSETS: { async fetch() { return new Response('nope', { status: 404 }); } },
      CDN: {},
    });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('<item>');
  });

  it('503s on a transient read failure instead of serving an empty show', async () => {
    // A client that sees zero items can drop the subscription — so "I could
    // not read it" must never look like "there are no episodes".
    const res = await feed({
      ASSETS: { async fetch() { throw new Error('upstream down'); } },
      CDN: {},
    });
    expect(res.status).toBe(503);
  });

  it('omits itunes:image when the instance has configured no artwork', async () => {
    // Apple needs it before a submission; emitting a broken or non-square URL
    // to satisfy a validator would be worse than leaving it out.
    const xml = await body(envWith(TRACKS));
    expect(xml).not.toContain('<itunes:image');
  });
});
