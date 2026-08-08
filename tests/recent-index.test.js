// recent-index.js — the homepage recent-work grid. The DOM rendering runs only
// in a browser (guarded by `typeof document`), so importing the classic script
// in Node just installs the pure helpers on globalThis.RecentIndex. These tests
// pin the two pieces of craft that must stay deterministic: the excerpt
// stripper (mirrors worker.js feedSummary so the card summary matches the feed)
// and the char-count → tier classifier. Corpus tests run every published post
// body through the stripper and assert the invariants.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import '../js/recent-index.js';
import { hasData } from './helpers/instance-content.js';

const {
  recentStrip, recentTruncate, recentExcerpt, recentTier, recentInitial,
  cardFocus, rawPick, pinRaw, pickRecent, sampleFrames, sampleNote, withSampleFallback,
} = globalThis.RecentIndex;

// Corpus checks need this instance's posts; the engine tree ships none.
const HAS_POSTS = hasData('posts.json');
const posts = HAS_POSTS
  ? JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'posts.json'), 'utf8'))
  : [];

describe('recentTier — tease length → tier', () => {
  it.each([
    [0, 'statement'],
    [55, 'statement'],
    [56, 'feature'],
    [105, 'feature'],
    [106, 'standard'],
    [150, 'standard'],
  ])('length %i → %s', (len, tier) => {
    expect(recentTier(len)).toBe(tier);
  });
});

describe('recentInitial — drop-cap opener (Latin letter only)', () => {
  it('returns the first letter of a normal opener', () => {
    expect(recentInitial('Hello there')).toBe('H');
    expect(recentInitial('the market')).toBe('t');
  });
  it('returns empty for a non-letter opener (never a broken cap)', () => {
    expect(recentInitial('"A quote')).toBe(''); // leading quote
    expect(recentInitial('42 frames')).toBe(''); // leading number
    expect(recentInitial('🎵 music link')).toBe(''); // leading emoji
    expect(recentInitial('Émile')).toBe(''); // accented / non-ASCII-Latin
    expect(recentInitial('')).toBe('');
    expect(recentInitial(null)).toBe('');
  });
});

describe('recentExcerpt — mirrors feedSummary stripping', () => {
  it('empty in, empty out', () => {
    expect(recentExcerpt('')).toBe('');
    expect(recentExcerpt(null)).toBe('');
    expect(recentExcerpt(undefined)).toBe('');
  });
  it('drops HTML tags and shortcode divs', () => {
    expect(recentExcerpt('<div class="x">hi</div> there')).toBe('hi there');
    expect(recentExcerpt('<iframe src="…"></iframe>after')).toBe('after');
  });
  it('drops markdown images, keeps link text', () => {
    expect(recentExcerpt('![alt](/x.jpg) caption')).toBe('caption');
    expect(recentExcerpt('see [the wall](/wall) now')).toBe('see the wall now');
  });
  it('strips headings, emphasis, code, quote chars', () => {
    expect(recentExcerpt('# Title\n\nbody text')).toBe('Title body text');
    expect(recentExcerpt('**bold** _it_ `code` ~s~ > q')).toBe('bold it code s q');
  });
  it('drops a bare embed URL on its own line (Apple Music)', () => {
    const out = recentExcerpt('https://embed.music.apple.com/us/album/x\n\nReal opening line.');
    expect(out).toBe('Real opening line.');
  });
  it('collapses whitespace to single spaces, trimmed', () => {
    expect(recentExcerpt('a\n\n  b\t c   d')).toBe('a b c d');
  });
  it('truncates a long unbroken run to a short tease with an ellipsis', () => {
    const long = 'word '.repeat(200).trim(); // ~999 chars, no sentence ends
    const out = recentExcerpt(long);
    expect(out.length).toBeLessThanOrEqual(151); // ≤ 150 (TEASE_MAX) + ellipsis
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/); // cut on a boundary, no dangling space
  });
  it('prefers a clean sentence end (no ellipsis) over a mid-word cut', () => {
    // a sentence terminator sits in the back half of the tease window
    const body = 'x '.repeat(50) + 'End of the thought. ' + 'y '.repeat(100);
    const out = recentExcerpt(body);
    expect(out.endsWith('thought.')).toBe(true);
    expect(out.endsWith('…')).toBe(false);
  });
  it('short text is returned whole, no ellipsis', () => {
    expect(recentExcerpt('Just a short note.')).toBe('Just a short note.');
  });
});

describe('recentStrip / recentTruncate', () => {
  it('recentStrip cleans but never truncates', () => {
    const long = 'word '.repeat(300).trim();
    expect(recentStrip(long)).toBe(long); // 1500 chars, untouched length
    expect(recentStrip('<b>hi</b>  there')).toBe('hi there');
  });
  it('recentTruncate honours an explicit max', () => {
    expect(recentTruncate('one two three four five', 12)).toBe('one two…');
    expect(recentTruncate('short', 100)).toBe('short');
  });
});

describe('cardFocus — tall 4:5 card crop, with fallback', () => {
  it('prefers the card-specific point when set', () => {
    expect(cardFocus({ cardFocus: '30% 20%', focus: '50% 80%' })).toBe('30% 20%');
  });
  it('falls back to the shared thumbnail focus when cardFocus is unset', () => {
    expect(cardFocus({ focus: '50% 80%' })).toBe('50% 80%');
  });
  it('returns empty (CSS center) when neither is set', () => {
    expect(cardFocus({})).toBe('');
    expect(cardFocus(null)).toBe('');
    expect(cardFocus(undefined)).toBe('');
  });
});

describe('rawPick — featured RAW frames, capped for the grid', () => {
  const feat = [
    { id: 'a', filename: 'a.webp', num: 3 },
    { id: 'b', filename: 'b.webp', num: 5 },
  ];
  it('caps to one card by default (newest is already first from the server)', () => {
    expect(rawPick(feat).map((r) => r.id)).toEqual(['a']);
  });
  it('honors an explicit max (for when we open it up to more slots)', () => {
    expect(rawPick(feat, 2).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('drops entries with no media, and handles empty input', () => {
    expect(rawPick([{ id: 'x' }], 2)).toEqual([]);
    expect(rawPick([])).toEqual([]);
    expect(rawPick(null)).toEqual([]);
  });
});

describe('pinRaw — featured RAW frame pinned to the third slot', () => {
  const raw = { id: 'R', raw: true };
  const many = [{ id: 'n0' }, { id: 'n1' }, { id: 'n2' }, { id: 'n3' }, { id: 'n4' }];
  it('pins RAW to index 2 (3rd card) and fills the rest newest-first', () => {
    const out = pinRaw(many, raw, 4);
    expect(out.map((x) => x.id)).toEqual(['n0', 'n1', 'R', 'n2']); // n3/n4 drop off
  });
  it('always includes the RAW frame even from an old period (it is pinned, not date-ranked)', () => {
    expect(pinRaw(many, raw, 4).some((x) => x.id === 'R')).toBe(true);
  });
  it('places RAW at the end when there are fewer items than the slot', () => {
    expect(pinRaw([{ id: 'n0' }], raw, 4).map((x) => x.id)).toEqual(['n0', 'R']);
    expect(pinRaw([], raw, 4).map((x) => x.id)).toEqual(['R']);
  });
});

describe('sample fallback — an un-seeded fork still gets a mixed grid', () => {
  it('withSampleFallback: null (missing file) → samples, [] (cleared) → empty', () => {
    const s = [{ id: 'x' }];
    expect(withSampleFallback(null, s)).toBe(s);
    expect(withSampleFallback([], s)).toEqual([]);
    expect(withSampleFallback([{ id: 'real' }], s)).toEqual([{ id: 'real' }]);
    expect(withSampleFallback({ nonsense: true }, s)).toEqual([]); // malformed JSON → empty, never samples over data
  });

  it('renders as photo · photo · text in the visible 3-up row', () => {
    const picks = pickRecent(sampleFrames(), [sampleNote()], []);
    expect(picks.map((p) => p.kind)).toEqual(['photo', 'photo', 'text', 'photo']);
  });

  it('every sample frame exists in assets/samples in all three widths', () => {
    for (const f of sampleFrames()) {
      expect(f.slug, 'archive deep-link must hit page-archive.js getSampleData naming').toMatch(/^sample-\d\d$/);
      for (const w of [480, 1024, 2048]) {
        const file = join(import.meta.dirname, '..', 'assets', 'samples', `${f.filename}-${w}w.webp`);
        expect(existsSync(file), `${f.filename}-${w}w.webp missing from assets/samples`).toBe(true);
      }
    }
  });

  it('the sample note mirrors posts/fn-sample.md exactly (the card and the post must be the same note)', () => {
    const raw = readFileSync(join(import.meta.dirname, '..', 'posts', 'fn-sample.md'), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
    expect(m, 'fn-sample.md must carry frontmatter').toBeTruthy();
    const front = Object.fromEntries(m[1].split('\n').map((l) => l.split(/:\s(.*)/).slice(0, 2)));
    const note = sampleNote();
    expect(note.fn_id).toBe(front.id);
    expect(note.title).toBe(front.title);
    expect(note.location).toBe(front.location);
    expect(note.body).toBe(m[2].trim());
  });

  it('the sample note lands the feature tier — the drop-cap pull-quote, not the plain wall', () => {
    const excerpt = recentExcerpt(sampleNote().body);
    expect(excerpt.endsWith('.'), 'tease should end on a clean sentence, no ellipsis').toBe(true);
    expect(recentTier(excerpt.length)).toBe('feature');
    expect(recentInitial(excerpt), 'a Latin opener so the drop cap renders').toBe('T');
  });

  it('js/page-fn-list.js lists the same note (its own copy of the metadata)', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'js', 'page-fn-list.js'), 'utf8');
    const note = sampleNote();
    expect(src).toContain(`fn_id: '${note.fn_id}'`);
    expect(src).toContain(`title: '${note.title}'`);
  });
});

describe.skipIf(!HAS_POSTS)('recentExcerpt — real corpus invariants', () => {
  const excerpts = posts
    .filter((p) => p && p.fn_id)
    .map((p) => ({ id: p.fn_id, text: recentExcerpt(p.body) }));

  it('produced an excerpt for every published post', () => {
    expect(excerpts.length).toBeGreaterThan(0);
  });

  it.each(excerpts.map((e) => [e.id, e.text]))('%s: clean + bounded', (_id, text) => {
    expect(text.length).toBeLessThanOrEqual(151);
    expect(text).not.toMatch(/<[^>]+>/); // no HTML tags survived
    expect(text).not.toMatch(/!\[[^\]]*\]\([^)]*\)/); // no markdown images
    expect(text).not.toMatch(/[*_`~]/); // no emphasis/code markers
    expect(text).not.toMatch(/\s{2,}|[\n\t]/); // whitespace collapsed
    expect(text).not.toContain('embed.music.apple.com'); // embeds stripped
    expect(text).not.toMatch(/^https?:\/\//); // never opens on a bare URL
  });
});
