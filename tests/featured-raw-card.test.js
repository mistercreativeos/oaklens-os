// @vitest-environment happy-dom
//
// Star a frame → it reaches the homepage. End to end, through the real worker
// handler and the real client renderer.
//
// This test exists because of 2026-08-23: the owner starred a buffer frame,
// published, and the RAW card did not appear. Answering "is the data wrong, is
// the card gated out, is it out-ranked, or is it just cache?" took an
// investigation across three subsystems — because the chain was only ever
// covered in disconnected halves. tests/buffer-summary.test.js pins the server
// predicate on its own; tests/card-engine.test.js pins buildCard on its own and
// stubs /api/buffer-summary as an EMPTY featured list. Nothing joined them, and
// nothing stopped a field being renamed on one side of the wire.
//
// So this drives the actual worker (data/buffer.json → handleBufferSummary →
// a real Response) and hands THAT response to the actual renderer's boot path.
// If it passes, a missing RAW card is a deploy/cache question, never a code one.
//
// NOTE for a future session: do NOT "fix" the { featured: [] } stub in
// tests/card-engine.test.js to match this file. That empty stub is load-bearing
// for its byte-identity fixture, which captures the pre-engine renderer's exact
// markup for a payload with no RAW pin. The two files test different things.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import worker from '../worker.js';

// The shape commit fa47159 actually wrote: a new frame carrying BOTH the star
// and the 4:5 card crop, prepended to the manifest.
const STARRED = {
  id: 'j8ly7to', filename: 'OAKLENS_Featured.webp',
  captured_at: '2026-08-23T14:19:42.901Z', published_at: '2026-08-23T14:19:42.901Z',
  added_at: '2026-08-23T14:19:42.901Z', archived: false,
  cardFocus: '39% 57%', featured: true,
};
// A dark frame sits between the starred one and the rest so the positional
// f#NNN numbering is non-trivial — a tombstone still holds its number
// (frame permanence, manual §5.20), so an off-by-one here would show.
const BUFFER = [
  STARRED,
  { id: 'dark01', filename: 'OAKLENS_Retired.webp', captured_at: '2026-08-22T10:00:00Z', dark: true },
  { id: 'plain1', filename: 'OAKLENS_Plain1.webp', captured_at: '2026-08-21T10:00:00Z', archived: false },
  { id: 'plain2', filename: 'OAKLENS_Plain2.webp', captured_at: '2026-08-20T10:00:00Z', archived: false },
];

const ARCHIVE_ENTRY = {
  slug: 'evening-light', filename: 'OAKLENS_Evening.webp', title: 'Evening Light',
  location: 'Sample City, 2025', camera: 'Mirrorless', added_at: '2026-08-01T00:00:00Z',
};
const POST = {
  fn_id: 'fn-011', title: 'The Beginning', location: 'Sample City',
  body: 'Hard watch. Early 2000s energy.', added_at: '2026-07-10T00:00:00Z',
};

const env = {
  SESSION_SECRET: 'test-secret-please-ignore',
  SUBSCRIBERS: { get: async () => null, put: async () => {} },
  ASSETS: {
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === '/data/buffer.json') {
        return new Response(JSON.stringify(BUFFER), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    },
  },
};
const ctx = { waitUntil() {} };

// Cold edge cache, so the handler reads the fixture rather than a neighbour's.
let _savedCaches;
let summaryBody;
let summaryRes;
let host;

beforeAll(async () => {
  _savedCaches = globalThis.caches;
  globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

  // ---- the worker half: the real route, the real handler ----
  summaryRes = await worker.fetch(new Request('https://example.com/api/buffer-summary'), env, ctx);
  summaryBody = await summaryRes.clone().json();

  // ---- the client half: that same payload, the renderer's own boot path ----
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'cdn-base');
  meta.setAttribute('content', 'https://cdn.example/api/cdn');
  document.head.appendChild(meta);

  host = document.createElement('div');
  host.id = 'recent-index';
  const section = document.createElement('section');
  section.className = 'cl-work';
  section.appendChild(host);
  document.body.appendChild(section);

  const payloads = {
    '/data/archive.json': [ARCHIVE_ENTRY],
    '/data/posts.json': [POST],
    '/api/buffer-summary': summaryBody,   // <- what the worker actually said
    '/data/audio.json': [],
    '/api/pulse': { pulse: null },
  };
  globalThis.fetch = async (path) =>
    new Response(JSON.stringify(payloads[path] ?? null), {
      status: 200, headers: { 'content-type': 'application/json' },
    });

  await import('../js/recent-index.js');
  await new Promise((r) => setTimeout(r, 20));
});

afterAll(() => { globalThis.caches = _savedCaches; });

describe('the worker half — a starred frame survives the summary', () => {
  it('returns the starred frame, and only it', () => {
    expect(summaryBody.featured).toHaveLength(1);
    expect(summaryBody.featured[0].id).toBe('j8ly7to');
  });

  it('carries the card crop the owner set before publishing', () => {
    // The 2026-08-23 loss was exactly this field not reaching the commit.
    expect(summaryBody.featured[0].cardFocus).toBe('39% 57%');
  });

  it('numbers the frame positionally, counting the dark tombstone', () => {
    // Oldest is f#001; the retired frame keeps its slot, so the newest is f#004.
    expect(summaryBody.featured[0].num).toBe(4);
  });

  it('a dark or media-less frame is never eligible, however starred', () => {
    expect(summaryBody.featured.some((f) => f.id === 'dark01')).toBe(false);
  });

  it('is cached for a bounded window, and the window is pinned here', () => {
    // Pinned so any change to this endpoint's staleness is a deliberate edit
    // with a test diff behind it, not silent drift. (The edge cache in front
    // of it is scoped by deploy — tests/deploy-version.test.js.)
    expect(summaryRes.headers.get('Cache-Control')).toBe('public, max-age=60, stale-while-revalidate=300');
    expect(summaryBody.frames, 'the dark frame still counts as a frame').toBe(4);
  });
});

describe('the client half — that payload becomes a RAW card', () => {
  const rawCard = () => [...host.querySelectorAll('.wk-card')]
    .find((c) => c.querySelector('.wk-tag')?.textContent === 'RAW');

  it('renders a RAW card at all — the thing that appeared to fail', () => {
    expect(rawCard(), 'a featured frame must reach the grid').toBeTruthy();
  });

  it('deep-links to the buffer frame by id', () => {
    expect(rawCard().getAttribute('href')).toBe('/archive/buffer/?f=j8ly7to');
  });

  it('titles it with the frame number the WORKER computed', () => {
    // The number is server-side and positional; the client only pads it. If
    // these ever disagree, a citation like f#234 points at the wrong frame.
    expect(rawCard().querySelector('.wk-title').textContent).toBe('f#004');
  });

  it('applies the card crop the WORKER passed through', () => {
    expect(rawCard().querySelector('.wk-img').style.backgroundPosition).toBe('39% 57%');
  });

  it('leads the row, not merely lands somewhere — it is the only pin here', () => {
    // Pins compact to the top in rank order (pulse → audio → RAW), so with no
    // pulse and no featured track the RAW daily is card 1. The rank, and the
    // hidden-fourth-card bug that produced it, live in tests/pulse-card.test.js.
    const cards = [...host.querySelectorAll('.wk-card')];
    expect(cards.indexOf(rawCard())).toBe(0);
  });
});

describe('the field-name contract across the wire', () => {
  it('the summary sends exactly the keys the client reads', () => {
    // The renderer reads id → href, filename → frameSrc, num → title,
    // cardFocus/focus → backgroundPosition, captured_at → the meta year.
    // Nothing else stops one side being renamed without the other.
    expect(Object.keys(summaryBody.featured[0]).sort())
      .toEqual(['captured_at', 'cardFocus', 'filename', 'focus', 'id', 'num']);
  });

  it('the meta line reads the year off captured_at', () => {
    const raw = [...host.querySelectorAll('.wk-card')]
      .find((c) => c.querySelector('.wk-tag')?.textContent === 'RAW');
    expect(raw.querySelector('.wk-meta').textContent).toBe('2026');
  });
});
