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
  cardFocus, rawPick, pinRaw, audioPick, pinAudio, pickRecent,
  sampleFrames, sampleNote, withSampleFallback,
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

describe('audioPick — only an explicitly featured registry entry gets a card', () => {
  const reg = [
    { id: 'a', slug: 'one', filename: 'one.mp3', featured: true },
    { id: 'b', slug: 'two', filename: 'two.mp3', featured: true },
    { id: 'c', slug: 'three', filename: 'three.mp3' },
  ];
  it('caps to one card by default — a card is a single statement', () => {
    expect(audioPick(reg).map((a) => a.id)).toEqual(['a']);
  });
  it('honors an explicit max (for when we open it up to more slots)', () => {
    expect(audioPick(reg, 2).map((a) => a.id)).toEqual(['a', 'b']);
  });
  it('ignores unfeatured entries — the registry holds far more than the grid shows', () => {
    expect(audioPick([{ id: 'c', slug: 'three', filename: 'three.mp3' }])).toEqual([]);
  });
  it('drops entries that could not render a working card', () => {
    // No file to play, and no slug to link the permalink at.
    expect(audioPick([{ id: 'x', featured: true, slug: 'x' }], 2)).toEqual([]);
    expect(audioPick([{ id: 'y', featured: true, filename: 'y.mp3' }], 2)).toEqual([]);
    expect(audioPick([])).toEqual([]);
    expect(audioPick(null)).toEqual([]);
  });
});

describe('pinAudio — featured audio pinned to the second slot', () => {
  const aud = { id: 'A', kind: 'audio' };
  const many = [{ id: 'n0' }, { id: 'n1' }, { id: 'n2' }, { id: 'n3' }, { id: 'n4' }];
  it('pins audio to index 1 (2nd card) and fills the rest newest-first', () => {
    expect(pinAudio(many, aud, 4).map((x) => x.id)).toEqual(['n0', 'A', 'n1', 'n2']);
  });
  it('places audio at the end when there are fewer items than the slot', () => {
    expect(pinAudio([], aud, 4).map((x) => x.id)).toEqual(['A']);
  });

  // The ORDER of the two pins is load-bearing, not incidental: audio is pinned
  // before the RAW daily so the running order lands photo · audio · RAW, all
  // three inside the 3-up desktop row. Pinning audio afterwards would displace
  // RAW to the fourth slot, which desktop CSS hides — the featured frame would
  // silently vanish from the homepage.
  it('composes with pinRaw so BOTH pins survive the 3-up desktop row', () => {
    const out = pinRaw(pinAudio(many, aud, 4), { id: 'R', raw: true }, 4);
    expect(out.map((x) => x.id)).toEqual(['n0', 'A', 'R', 'n1']);
    expect(out.slice(0, 3).map((x) => x.id)).toEqual(['n0', 'A', 'R']);
  });
});

describe('pickRecent — featured audio joins the grid', () => {
  const archive = [
    { filename: 'f1.webp', slug: 's1', added_at: '2026-08-10' },
    { filename: 'f2.webp', slug: 's2', added_at: '2026-08-09' },
    { filename: 'f3.webp', slug: 's3', added_at: '2026-08-08' },
  ];
  const posts = [{ fn_id: 'fn-1', title: 'A note', added_at: '2026-08-07' }];
  const audio = [{ id: 'A', slug: 'take-one', filename: 'take-one.mp3', featured: true }];

  it('surfaces a featured track as an audio card in the second slot', () => {
    const picks = pickRecent(archive, posts, [], audio);
    expect(picks[1].kind).toBe('audio');
    expect(picks[1].data.slug).toBe('take-one');
  });

  it('surfaces multiple featured tracks as a single playlist card', () => {
    const multi = [
      { id: 'A1', slug: 'one', filename: 'one.mp3', featured: true, featured_order: 1 },
      { id: 'A2', slug: 'two', filename: 'two.mp3', featured: true, featured_order: 2 },
    ];
    const picks = pickRecent(archive, posts, [], multi);
    expect(picks[1].kind).toBe('audio');
    expect(picks[1].data.isPlaylist).toBe(true);
    expect(picks[1].data.tracks).toHaveLength(2);
  });

  it('shows the audio card regardless of date — it is pinned, not date-ranked', () => {
    const old = [{ id: 'A', slug: 'old', filename: 'old.mp3', featured: true, added_at: '2019-01-01' }];
    expect(pickRecent(archive, posts, [], old).some((p) => p.kind === 'audio')).toBe(true);
  });

  it('changes nothing when no track is featured (no regression for a site without audio)', () => {
    const before = pickRecent(archive, posts, []);
    const after = pickRecent(archive, posts, [], [{ id: 'A', slug: 'x', filename: 'x.mp3' }]);
    expect(after).toEqual(before);
    expect(after.some((p) => p.kind === 'audio')).toBe(false);
  });

  it('carries an absent registry without throwing (a fork with no audio.json)', () => {
    expect(() => pickRecent(archive, posts, [], null)).not.toThrow();
    expect(() => pickRecent(archive, posts, [], undefined)).not.toThrow();
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
