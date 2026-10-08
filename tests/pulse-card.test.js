// The pulse card on the homepage grid — selection, tiering, and the pin budget.
//
// The rule this file exists to protect: the recent-work grid shows 3 tiles on
// desktop, and TWO of them were already spoken for (featured audio, the
// featured RAW daily). A third pin would leave a homepage where nothing is
// actually recent — three owner-chosen tiles and no work. So a live pulse takes
// the first card and the older content pin yields.
//
// It also protects the RANK the pins sit in, which is the half that broke: the
// pins used to carry fixed card NUMBERS and were spliced in one after another,
// so a live pulse pushed the RAW daily from card 3 to card 4 — the tablet-only
// card. A starred frame reached the homepage and no desktop or phone visitor
// could see it. Pins now compact to the top in rank order, and the last
// describe below is the regression that says so.
// (2026-08-27 — docs/maintenance/2026-08-27-starred-frame-hidden-fourth-slot.md)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../js/recent-index.js';
import { PULSE_LABEL } from '../src/shared/pulse.js';

const R = globalThis.RecentIndex;

const frame = (slug, d) => ({ slug, filename: slug, title: slug, added_at: d });
const post = (id, d) => ({ fn_id: id, title: id, body: 'A note.', added_at: d });
const audio = (d) => [{ slug: 'a1', filename: 'a1.mp3', title: 'Track', featured: true, added_at: d }];
const raw = (d) => [{ id: 'r1', filename: 'r1.dng', num: 12, captured_at: d }];
const pulse = (over = {}) => ({ pulse: { id: 'm1', text: 'Eight bar loop. Send help.', glyphs: '🎧', state: 'flow', footLeft: '', footRight: '', localTime: '02:40', ...over } });

describe('pulsePick — what counts as a pulse worth showing', () => {
  it('takes a pulse carrying a line', () => {
    expect(R.pulsePick(pulse())).toBeTruthy();
  });

  it('takes a pulse carrying only a glyph — that is a legitimate post', () => {
    expect(R.pulsePick(pulse({ text: '', glyphs: '🕯️' }))).toBeTruthy();
  });

  it('refuses one carrying neither — an empty tile is a bug that looks like a decision', () => {
    expect(R.pulsePick(pulse({ text: '   ', glyphs: '' }))).toBeNull();
  });

  it('handles every shape the endpoint can answer with', () => {
    for (const v of [null, undefined, {}, { pulse: null }]) expect(R.pulsePick(v)).toBeNull();
  });
});

describe('the pin budget — at most two pinned tiles are visible', () => {
  const archive = [frame('f1', '2026-08-01'), frame('f2', '2026-07-01'), frame('f3', '2026-06-01')];
  const posts = [post('fn-1', '2026-08-02')];

  it('a live pulse takes the FIRST slot', () => {
    const picks = R.pickRecent(archive, posts, [], [], pulse());
    expect(picks[0].kind).toBe('pulse');
  });

  it('pulse + audio + RAW: the older content pin yields, so real work still shows', () => {
    // Audio is newer than the RAW frame, so RAW is the one that gives up its pin.
    const picks = R.pickRecent(archive, posts, raw('2026-01-01'), audio('2026-08-10'), pulse());
    const visible = picks.slice(0, 3).map((p) => p.kind);
    // Both the budget AND the positions, now that pins compact: two pinned
    // cards at the top in rank order, and the third desktop tile is genuine
    // recent work. (This asserted only the COUNT until 2026-08-27, because the
    // old fixed indexes moved a pin whenever another one was inserted above it
    // — the very thing that hid the starred frame.)
    expect(visible[0]).toBe('pulse');
    expect(visible[1]).toBe('audio');
    expect(['photo', 'text']).toContain(visible[2]);
    // …and the RAW daily is the pin that gave way.
    expect(picks.some((p) => p.raw)).toBe(false);
  });

  it('…and the other way round: a newer RAW keeps its pin, audio yields', () => {
    const picks = R.pickRecent(archive, posts, raw('2026-08-11'), audio('2026-02-02'), pulse());
    const kinds = picks.slice(0, 3).map((p) => p.kind);
    expect(kinds[0]).toBe('pulse');
    expect(kinds).not.toContain('audio');
    expect(picks.some((p) => p.raw)).toBe(true);
  });

  it('with only ONE content pin, nothing yields — there is room for both', () => {
    const picks = R.pickRecent(archive, posts, [], audio('2026-08-10'), pulse());
    const kinds = picks.slice(0, 3).map((p) => p.kind);
    expect(kinds[0]).toBe('pulse');
    expect(kinds[1]).toBe('audio');
  });

  it('no pulse: the grid behaves exactly as it did before this feature', () => {
    const before = R.pickRecent(archive, posts, raw('2026-01-01'), audio('2026-08-10'));
    const withNull = R.pickRecent(archive, posts, raw('2026-01-01'), audio('2026-08-10'), { pulse: null });
    expect(withNull.map((p) => p.kind)).toEqual(before.map((p) => p.kind));
    // Both pins are seated when no pulse is competing for the row.
    expect(before.map((p) => p.kind)).toContain('audio');
    expect(before.some((p) => p.raw)).toBe(true);
  });

  it('an EXPIRED pulse is simply absent — the grid heals with no cleanup', () => {
    // The endpoint drops an expired pulse, so the client sees { pulse: null }.
    const picks = R.pickRecent(archive, posts, [], [], { pulse: null });
    expect(picks.some((p) => p.kind === 'pulse')).toBe(false);
    expect(picks.length).toBeGreaterThan(0);
  });

  it('a pulse alone on a brand-new site still renders a grid', () => {
    const picks = R.pickRecent([], [], [], [], pulse());
    expect(picks).toHaveLength(1);
    expect(picks[0].kind).toBe('pulse');
  });
});

// ---------------------------------------------------------------------------
// THE REGRESSION. Reported 2026-08-27: the owner starred a buffer frame, kept
// refreshing the live homepage, and never saw it. It had published fine — it
// was rendering into card 4, which only a tablet held upright shows. The pins
// carried fixed card numbers (pulse 0, audio 1, RAW 2) and were spliced in one
// after another with the pulse LAST, so the pulse's insertion at the front slid
// the RAW pin one card down and off the visible row.
//
// The rule these assert, in the owner's words: the pulse is card 1, the pin is
// card 2, the most recent work is card 3, and card 4 is tablet-only spillover
// that is never a pin. With no pulse the pin moves up to card 1 — pins compact,
// so the most recent always lands in card 2 or card 3 depending on how many
// pins are live.
describe('the pin rank — a pin never lands in the card only a tablet shows', () => {
  const archive = [frame('f1', '2026-08-01'), frame('f2', '2026-07-01'), frame('f3', '2026-06-01')];
  const posts = [post('fn-1', '2026-08-02')];
  const VISIBLE = 3;   // desktop and phone render 3 of the 4 cards
  const kinds = (picks) => picks.map((p) => (p.raw ? 'raw' : p.kind));

  it('pulse + starred frame: pulse card 1, frame card 2 — the reported bug', () => {
    const picks = R.pickRecent(archive, posts, raw('2026-08-28'), [], pulse());
    expect(kinds(picks)).toEqual(['pulse', 'raw', 'text', 'photo']);
    // The assertion that would have caught it: the pin is inside the row a
    // desktop or a phone actually renders.
    expect(kinds(picks).slice(0, VISIBLE)).toContain('raw');
  });

  it('pulse + featured track: same shape, whichever content pin it is', () => {
    const picks = R.pickRecent(archive, posts, [], audio('2026-08-28'), pulse());
    expect(kinds(picks).slice(0, 2)).toEqual(['pulse', 'audio']);
  });

  it('no pulse: the pin compacts up to card 1, recent work behind it', () => {
    // fn-1 (08-02) is the newest thing in the pool, so it is what moves up.
    expect(kinds(R.pickRecent(archive, posts, raw('2026-08-28'), [], null)).slice(0, 2))
      .toEqual(['raw', 'text']);
    expect(kinds(R.pickRecent(archive, posts, [], audio('2026-08-28'), null)).slice(0, 2))
      .toEqual(['audio', 'text']);
  });

  it('pulse alone: the most recent work moves up into card 2', () => {
    expect(kinds(R.pickRecent(archive, posts, [], [], pulse())).slice(0, 2))
      .toEqual(['pulse', 'text']);   // fn-1 (08-02) is newer than f1 (08-01)
  });

  it('no pins at all: the row is pure recent work', () => {
    expect(R.pickRecent(archive, posts, [], [], null).every((p) => !p.raw)).toBe(true);
  });

  // The invariant under all of it, stated once: card 3 is never a pin, so a
  // desktop visitor always sees at least one genuinely recent thing.
  it('card 3 is never a pin, in every combination of pins', () => {
    for (const r of [[], raw('2026-08-28')]) {
      for (const a of [[], audio('2026-08-28')]) {
        for (const p of [null, pulse()]) {
          const row = kinds(R.pickRecent(archive, posts, r, a, p));
          expect(['photo', 'text'], JSON.stringify(row)).toContain(row[2]);
        }
      }
    }
  });
});

describe('yieldOlderPin', () => {
  it('keeps the newer of the two and names the loser', () => {
    const a = { kind: 'audio', d: '2026-08-10' };
    const r = { kind: 'photo', raw: true, d: '2026-01-01' };
    expect(R.yieldOlderPin(a, r)).toEqual({ audio: a, raw: null, yielded: 'raw' });
    expect(R.yieldOlderPin({ ...a, d: '2025-01-01' }, r).yielded).toBe('audio');
  });

  it('does nothing when there is only one pin to keep', () => {
    const a = { kind: 'audio', d: '2026-08-10' };
    expect(R.yieldOlderPin(a, null)).toEqual({ audio: a, raw: null, yielded: null });
    expect(R.yieldOlderPin(null, null).yielded).toBeNull();
  });
});

describe('pulseTier — the SAME ladder the text cards use', () => {
  it('a wordless pulse gets the whole tile for its mark', () => {
    expect(R.pulseTier({ text: '', glyphs: '🕯️' })).toBe('glyph');
    expect(R.pulseTier({ text: '   ' })).toBe('glyph');
  });

  it('steps down as the line gets longer, on the text card thresholds', () => {
    expect(R.pulseTier({ text: 'x'.repeat(40) })).toBe('statement');
    expect(R.pulseTier({ text: 'x'.repeat(80) })).toBe('feature');
    expect(R.pulseTier({ text: 'x'.repeat(140) })).toBe('standard');
  });

  // The owner's six-discipline starter pack (docs/pulse-card-vision.md appendix)
  // runs 23–45 graphemes. Every line must land in `statement` — the display
  // type and the hero glyph — or the pack does not look like the thing it was
  // written to look like.
  it('every line in the starter pack lands in statement', () => {
    const pack = [
      'Chasing light. Losing my mind.',
      'Pushing pixels. Tones are singing.',
      '500 frames. Zero open eyes.',
      'Lens cap on. Best shot.',
      'Client approved. Zero revisions needed.',
      'Final edit done. Looks incredible.',
      'Blinking cursor. It is winning.',
      'Coffee in. Yesterday’s draft deleted.',
      'Flow state activated. Words pouring.',
      'Eight bar loop. Send help.',
      'Vocals muted. Track sounds better.',
      'Groove locked. Found the pocket.',
      'Timeline rendering. Afraid to breathe.',
      'Soft B-roll. Calling it art.',
      'Render finished. Colors are popping.',
      'Explaining logic. Duck is confused.',
      'Installing dependencies. See you tomorrow.',
      'All tests passed. Deploying now.',
      'Editing breaths. Sounding like Vader.',
      'Amazing guest. Conversation flowed perfectly.',
      'Audio is crisp. Sounding flawless.',
    ];
    for (const text of pack) {
      expect(R.pulseTier({ text }), text).toBe('statement');
    }
  });
});

describe('tierLen counts what a reader would call a character', () => {
  it('a ZWJ emoji is one, not two', () => {
    expect(R.tierLen('\u{1F635}‍\u{1F4AB}')).toBe(1);
  });

  it('a variation-selector emoji is one, not three code units', () => {
    expect(R.tierLen('\u{1F39B}\u{FE0F}')).toBe(1);
    expect('\u{1F39B}\u{FE0F}'.length).toBe(3);
  });

  it('leaves plain Latin identical, so existing text cards do not move', () => {
    const s = 'The first walk with a new camera is never about the pictures.';
    expect(R.tierLen(s)).toBe(s.length);
    expect(R.recentTier(R.tierLen(s))).toBe(R.recentTier(s.length));
  });

  it('is safe when Intl.Segmenter is missing', () => {
    const real = Intl.Segmenter;
    try {
      // eslint-disable-next-line no-global-assign
      delete Intl.Segmenter;
      expect(R.tierLen('abc')).toBe(3);
    } finally {
      Intl.Segmenter = real;
    }
  });
});

describe('the card names itself, and the two spellings cannot drift', () => {
  // The card's title is a CONSTANT, not a field. It used to default to the
  // starter pack's discipline, so the same feature introduced itself as
  // PHOTOGRAPHY on one post and TECH / DEV on the next and a cold reader could
  // not tell what the tile was.
  //
  // The word therefore lives in TWO places and can only live in two places:
  // src/shared/pulse.js for the Worker and the console, and a literal inside
  // js/recent-index.js — which is a classic script on public pages and cannot
  // import from src/. (Same constraint that forces tierLen to be duplicated.)
  // So this asserts they agree rather than trusting whoever edits one of them.
  const renderer = readFileSync(join(import.meta.dirname, '..', 'js', 'recent-index.js'), 'utf8');

  it('src/shared/pulse.js and js/recent-index.js spell it the same', () => {
    const m = renderer.match(/var PULSE_LABEL = '([^']+)';/);
    expect(m, 'js/recent-index.js no longer declares PULSE_LABEL').toBeTruthy();
    expect(m[1]).toBe(PULSE_LABEL);
  });

  it('the renderer prints the constant and never reads a per-card value', () => {
    // The guard with teeth. A stored row from before the rename still carries a
    // discipline in its `kicker`; if this renderer ever reads one again, a
    // category title is back on the homepage.
    expect(renderer).toContain('document.createTextNode(PULSE_LABEL)');
    expect(renderer, 'the renderer is reading a title off the record again').not.toMatch(/pulse\.kicker|\.kicker\s*\|\|/);
  });

  it('is a single word — it is a type label, not a sentence', () => {
    expect(PULSE_LABEL.trim()).toBe(PULSE_LABEL);
    expect(PULSE_LABEL.split(/\s+/)).toHaveLength(1);
  });
});
