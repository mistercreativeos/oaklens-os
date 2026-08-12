// /listen — the audio permalink + index, on both sides of the wire.
//
// Client half: the routing/sorting helpers in js/page-listen.js (its DOM half
// is guarded by `typeof document`, so importing the classic script in Node
// installs only the pure helpers).
//
// Edge half: the OG resolution a share link depends on, and the sitemap
// listing. Those two are the reason this page exists at all — the body renders
// client-side, so if the edge did not resolve ?a= into real og: tags, every
// shared track would unfurl as the bare site.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../js/page-listen.js';
import worker from '../worker.js';
import { getAudioOgData } from '../src/edge/chrome.js';

// The edge data loader reads through caches.default, which Node has no notion
// of. A FRESH map per test matters: the loader keys by path, so one test's
// registry would otherwise still be warm for the next and the empty-registry
// assertions would read the populated one.
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
      async put(req, res) {
        store.set(typeof req === 'string' ? req : req.url, await res.text());
      },
    },
  };
});
afterEach(() => { globalThis.caches = _savedCaches; });

const { sortTracks, findTrack, slugFromSearch } = globalThis.PageListen;

const TRACKS = [
  { id: '1', slug: 'take-one', filename: 'take-one.mp3', title: 'Take One', sub: 'Demo', duration: 214, added_at: '2026-08-10' },
  { id: '2', slug: 'ep-004', filename: 'ep-004.mp3', title: 'Episode 4', duration: 2400, added_at: '2026-08-12' },
  { id: '3', slug: 'room-tone', filename: 'room-tone.wav', title: 'Room Tone', added_at: '2026-08-01' },
];

// Serves data/audio.json out of ASSETS the way the real edge loader reads it.
const envWith = (tracks) => ({
  ASSETS: {
    async fetch(req) {
      if (new URL(req.url).pathname === '/data/audio.json') {
        return new Response(JSON.stringify(tracks), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
  },
  CDN: { async head() { return null; } },   // no stamped waveform card
});

describe('slugFromSearch — a share link resolves to one track', () => {
  it.each([
    ['?a=take-one', 'take-one'],
    ['?x=1&a=ep-004', 'ep-004'],
    ['?a=ep-004&x=1', 'ep-004'],
    ['?a=with%20space', 'with space'],
  ])('%s → %s', (search, expected) => {
    expect(slugFromSearch(search)).toBe(expected);
  });

  it('returns empty for the bare index view', () => {
    expect(slugFromSearch('')).toBe('');
    expect(slugFromSearch('?')).toBe('');
    expect(slugFromSearch('?other=1')).toBe('');
    expect(slugFromSearch(null)).toBe('');
  });
});

describe('sortTracks — newest first, nothing unplayable', () => {
  it('orders by added_at, newest first', () => {
    expect(sortTracks(TRACKS).map((t) => t.slug)).toEqual(['ep-004', 'take-one', 'room-tone']);
  });

  it('drops entries that could not render a row (no file, or no permalink)', () => {
    const out = sortTracks([...TRACKS, { id: '4', slug: 'x' }, { id: '5', filename: 'y.mp3' }, null]);
    expect(out).toHaveLength(3);
  });

  it('sorts a dateless entry last instead of scrambling the list', () => {
    const out = sortTracks([{ slug: 'none', filename: 'n.mp3' }, ...TRACKS]);
    expect(out[out.length - 1].slug).toBe('none');
  });

  it('survives a missing registry', () => {
    expect(sortTracks(null)).toEqual([]);
    expect(sortTracks(undefined)).toEqual([]);
  });
});

describe('findTrack', () => {
  it('finds by slug', () => {
    expect(findTrack(TRACKS, 'ep-004').title).toBe('Episode 4');
  });
  it('returns null for an unknown or absent slug (page falls back to the index)', () => {
    expect(findTrack(TRACKS, 'nope')).toBeNull();
    expect(findTrack(TRACKS, '')).toBeNull();
    expect(findTrack([], 'take-one')).toBeNull();
  });
});

describe('getAudioOgData — what a shared track unfurls as', () => {
  const url = (search) => new URL(`https://example.com/listen/${search}`);

  it('resolves the track title and its canonical share URL', async () => {
    const og = await getAudioOgData(url('?a=take-one'), envWith(TRACKS));
    expect(og.title).toContain('Take One');
    expect(og.ogUrl).toBe('https://example.com/listen/?a=take-one');
  });

  it('describes the track with its subtitle and rounded length', async () => {
    const og = await getAudioOgData(url('?a=ep-004'), envWith(TRACKS));
    expect(og.description).toContain('40 min');
  });

  it('carries NO image when no waveform card has been stamped', async () => {
    // Better an unfurl with no image than one pointing at a 404 — see
    // injectOg, which omits the tag entirely rather than stamping a null.
    const og = await getAudioOgData(url('?a=take-one'), envWith(TRACKS));
    expect(og.image).toBeNull();
  });

  it('falls back to the index card for the bare page and for an unknown slug', async () => {
    for (const search of ['', '?a=ghost', '?a=../etc/passwd']) {
      const og = await getAudioOgData(url(search), envWith(TRACKS));
      expect(og.type).toBe('website');
      expect(og.ogUrl).toBe('https://example.com/listen');
    }
  });

  it('never returns null — the page always gets exactly one og block', async () => {
    // Two blocks would duplicate og:title, and crawlers take the first.
    const broken = { ASSETS: { async fetch() { throw new Error('down'); } }, CDN: {} };
    expect(await getAudioOgData(url('?a=take-one'), broken)).not.toBeNull();
  });
});

describe('sitemap — /listen earns its listing from the data', () => {
  const sitemap = (env) => worker.fetch(new Request('https://example.com/sitemap.xml'), env, { waitUntil() {} });

  it('lists /listen once the registry has a track', async () => {
    const res = await sitemap(envWith(TRACKS));
    expect(await res.text()).toContain('<loc>https://example.com/listen</loc>');
  });

  it('omits /listen on a site with no audio — no thin page in the index', async () => {
    const res = await sitemap(envWith([]));
    expect(await res.text()).not.toContain('/listen');
  });

  it('omits /listen when the registry is missing entirely (an un-seeded fork)', async () => {
    const env = {
      ASSETS: { async fetch() { return new Response('not found', { status: 404 }); } },
      CDN: {},
    };
    const res = await sitemap(env);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('/listen');
  });
});
