// audio-player.js — the frameless waveform player. Its DOM half is guarded by
// `typeof document`, so importing the classic script in Node installs only the
// pure helpers on globalThis.AudioPlayer. These tests pin the parts that must
// stay deterministic because they cross a boundary:
//
//   · peaks serialization — written by the console at attach time, read by
//     the public player months later out of data/audio.json. A round-trip that
//     drifts silently corrupts every waveform on the site.
//   · resampling — one stored array (PEAK_COUNT) has to serve every variant's
//     bar count, so a stored track never needs re-measuring when a bar count
//     changes.
//   · time/duration formatting and the seek fraction — the visible surface.
import { describe, it, expect } from 'vitest';
import '../js/audio-player.js';

const {
  PEAK_COUNT, BAR_COUNTS, clamp01, normalizePeaks, resamplePeaks,
  peaksToString, peaksFromString, formatTime, durationLabel, seekFraction,
  groupAdjacent,
} = globalThis.AudioPlayer;

describe('clamp01 / normalizePeaks — nothing outside 0–1 reaches the DOM', () => {
  it.each([
    [-1, 0], [0, 0], [0.5, 0.5], [1, 1], [2, 1],
  ])('clamps %p → %p', (input, expected) => {
    expect(clamp01(input)).toBe(expected);
  });

  it('treats junk as silence rather than throwing', () => {
    expect(clamp01('nope')).toBe(0);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
    expect(clamp01(undefined)).toBe(0);
  });

  it('normalizes a whole array and survives a missing one', () => {
    expect(normalizePeaks([-0.5, 0.25, 3])).toEqual([0, 0.25, 1]);
    expect(normalizePeaks(null)).toEqual([]);
    expect(normalizePeaks(undefined)).toEqual([]);
  });
});

describe('peaks round-trip — the console writes it, the site reads it back', () => {
  it('survives a write → read cycle at 2-decimal precision', () => {
    const src = [0, 0.25, 0.5, 0.75, 1];
    expect(peaksFromString(peaksToString(src))).toEqual(src);
  });

  it('rounds to 2 decimals — the storage budget the format assumes', () => {
    expect(peaksToString([0.123456, 0.987654])).toBe('0.12,0.99');
  });

  it('parses an empty or absent string as no peaks, not as [NaN]', () => {
    expect(peaksFromString('')).toEqual([]);
    expect(peaksFromString(null)).toEqual([]);
    expect(peaksFromString(undefined)).toEqual([]);
  });

  it('ignores stray separators rather than emitting NaN bars', () => {
    expect(peaksFromString('0.5,,0.25, ,1')).toEqual([0.5, 0.25, 1]);
  });

  it('keeps a full PEAK_COUNT track under a kilobyte in data/audio.json', () => {
    const peaks = Array.from({ length: PEAK_COUNT }, (_, i) => (i % 100) / 100);
    expect(peaksToString(peaks).length).toBeLessThan(1024);
  });
});

describe('resamplePeaks — one stored array serves every variant', () => {
  it('returns exactly the requested bar count for every variant', () => {
    const stored = Array.from({ length: PEAK_COUNT }, (_, i) => (i % 10) / 10);
    for (const count of Object.values(BAR_COUNTS)) {
      expect(resamplePeaks(stored, count)).toHaveLength(count);
    }
  });

  it('averages each bucket when downsampling', () => {
    // Four samples → two bars: [0,1] averages to 0.5, [0.5,0.5] stays 0.5.
    expect(resamplePeaks([0, 1, 0.5, 0.5], 2)).toEqual([0.5, 0.5]);
  });

  it('upsamples by repeating the nearest source value', () => {
    expect(resamplePeaks([0, 1], 4)).toEqual([0, 0, 1, 1]);
  });

  it('is identity-ish at matching length', () => {
    const src = [0.1, 0.2, 0.3];
    expect(resamplePeaks(src, 3)).toEqual(src);
  });

  it('returns nothing for empty input or a nonsense count', () => {
    expect(resamplePeaks([], 8)).toEqual([]);
    expect(resamplePeaks([0.5], 0)).toEqual([]);
    expect(resamplePeaks([0.5], -3)).toEqual([]);
    expect(resamplePeaks(null, 8)).toEqual([]);
  });

  it('never emits a value outside 0–1, whatever it was handed', () => {
    const out = resamplePeaks([-5, 0.5, 12, NaN], 3);
    out.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });
});

describe('formatTime — m:ss, and h:mm:ss once an episode gets long', () => {
  it.each([
    [0, '0:00'],
    [7, '0:07'],
    [59, '0:59'],
    [60, '1:00'],
    [214, '3:34'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('%i seconds → %s', (sec, expected) => {
    expect(formatTime(sec)).toBe(expected);
  });

  it('floors a negative or junk duration to zero rather than printing NaN', () => {
    expect(formatTime(-10)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(undefined)).toBe('0:00');
    expect(formatTime('abc')).toBe('0:00');
  });
});

describe('durationLabel — the card badge rounds, it does not pretend to precision', () => {
  it.each([
    [0, ''],
    [45, '45 SEC'],
    [59, '59 SEC'],
    [60, '1 MIN'],
    [90, '2 MIN'],
    [1421, '24 MIN'],
  ])('%i seconds → %s', (sec, expected) => {
    expect(durationLabel(sec)).toBe(expected);
  });

  it('never labels a real track "0 MIN"', () => {
    expect(durationLabel(61)).toBe('1 MIN');
    expect(durationLabel(80)).toBe('1 MIN');
  });

  it('says nothing when there is no duration to say', () => {
    expect(durationLabel(0)).toBe('');
    expect(durationLabel(-5)).toBe('');
    expect(durationLabel(NaN)).toBe('');
  });
});

describe('groupAdjacent — consecutive shortcodes become one tracklist', () => {
  // Stand-ins for DOM elements: groupAdjacent only ever reads
  // nextElementSibling, which is the whole point of keeping it pure.
  function chain(n) {
    const els = Array.from({ length: n }, (_, i) => ({ id: i, nextElementSibling: null }));
    els.forEach((e, i) => { e.nextElementSibling = els[i + 1] || null; });
    return els;
  }

  it('groups a run of siblings into one list', () => {
    const els = chain(3);
    const runs = groupAdjacent(els);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3);
  });

  it('keeps a lone shortcode on its own — it stays a standalone player', () => {
    const els = chain(1);
    expect(groupAdjacent(els)).toEqual([[els[0]]]);
  });

  it('splits when prose sits between two shortcodes', () => {
    // Three embeds, with a paragraph between the second and third.
    const a = { nextElementSibling: null };
    const b = { nextElementSibling: null };
    const para = { nextElementSibling: null };
    const c = { nextElementSibling: null };
    a.nextElementSibling = b;
    b.nextElementSibling = para;
    para.nextElementSibling = c;
    const runs = groupAdjacent([a, b, c]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual([a, b]);
    expect(runs[1]).toEqual([c]);
  });

  it('handles two separate tracklists in one post', () => {
    const first = chain(2);
    const second = chain(3);
    const runs = groupAdjacent([...first, ...second]);
    expect(runs.map((r) => r.length)).toEqual([2, 3]);
  });

  it('returns nothing for an empty or absent list', () => {
    expect(groupAdjacent([])).toEqual([]);
    expect(groupAdjacent(null)).toEqual([]);
    expect(groupAdjacent(undefined)).toEqual([]);
  });
});

describe('seekFraction — a press on the waveform becomes a position', () => {
  it('maps across the track', () => {
    expect(seekFraction(0, 200)).toBe(0);
    expect(seekFraction(100, 200)).toBe(0.5);
    expect(seekFraction(200, 200)).toBe(1);
  });

  it('clamps a press that lands outside the element (drag past the edge)', () => {
    expect(seekFraction(-40, 200)).toBe(0);
    expect(seekFraction(999, 200)).toBe(1);
  });

  it('returns 0 for a zero-width element instead of dividing by zero', () => {
    expect(seekFraction(50, 0)).toBe(0);
    expect(seekFraction(50, undefined)).toBe(0);
  });
});
