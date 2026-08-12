// @vitest-environment happy-dom
//
// The console's Audio shelf.
//
// Two things here are load-bearing beyond ordinary helper behavior:
//
//  · The SLUG is a track's permanent address — /listen/?a=<slug> is what gets
//    shared, and a post shortcode carries nothing else. So it has to be
//    collision-proof, and renaming a PUBLISHED track must not move it.
//  · Featuring is EXCLUSIVE. The homepage shows one audio card, so promoting a
//    track has to demote the incumbent; two featured entries would make which
//    card appears depend on registry order.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// console-state.js reaches these through the global scope at call time (the
// real console mirrors its renderers onto window) — stub before importing.
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE } = await import('../js/console-state.js');
const {
  audioSlugify, audioUniqueSlug, audioNormalizePeaks, audioPeaksToString,
  _audioPromote, _audioToggleEpisode, _audioToggleDownload, renderAudio,
} = await import('../js/console/audio.js');

beforeEach(() => {
  document.body.innerHTML = `
    <div id="audio-display"></div>
    <span id="audio-count"></span>
    <span id="audio-stats"></span>
    <div id="toast-host"></div>
  `;
  STATE.audio = [];
  STATE.staged = { buffer: 0, archive: 0, posts: 0, wallpapers: 0, barrel: 0, friends: 0, library: 0, audio: 0 };
});

const track = (over) => ({
  id: 'a1', slug: 'take-one', filename: 'take-one.mp3', title: 'Take One',
  sub: '', duration: 214, peaks: '', added_at: '2026-08-12', ...over,
});

describe('audioSlugify — a title becomes a permanent address', () => {
  it.each([
    ['Midnight, Take One', 'midnight-take-one'],
    ['  Spaced  Out  ', 'spaced-out'],
    ['Episode #4: The Ferry', 'episode-4-the-ferry'],
    ["Don't Look Down", 'dont-look-down'],
    ['take-one.mp3', 'take-one'],
    ['Réverie', 'r-verie'],
  ])('%s → %s', (input, expected) => {
    expect(audioSlugify(input)).toBe(expected);
  });

  it('never returns an empty slug — a track with no usable title still gets an address', () => {
    expect(audioSlugify('')).toBe('track');
    expect(audioSlugify('...')).toBe('track');
    expect(audioSlugify(null)).toBe('track');
    expect(audioSlugify('!!!')).toBe('track');
  });

  it('is URL-safe: only lowercase, digits and hyphens survive', () => {
    expect(audioSlugify('A/B?c=d&e #1')).toMatch(/^[a-z0-9-]+$/);
  });

  it('caps length so a rambling title cannot mint an unusable URL', () => {
    expect(audioSlugify('word '.repeat(60)).length).toBeLessThanOrEqual(60);
  });
});

describe('audioUniqueSlug — two tracks never share a permalink', () => {
  const existing = [{ id: 'x', slug: 'take-one' }, { id: 'y', slug: 'take-one-2' }];

  it('passes an unused slug through untouched', () => {
    expect(audioUniqueSlug('Something Else', existing)).toBe('something-else');
  });

  it('suffixes past every taken variant', () => {
    expect(audioUniqueSlug('Take One', existing)).toBe('take-one-3');
  });

  it('lets an entry keep its own slug when it is edited', () => {
    // Without skipId, renaming a track to (almost) its own name would bump it
    // to -2 and silently break every link already pointing at it.
    expect(audioUniqueSlug('Take One', existing, 'x')).toBe('take-one');
  });

  it('handles an empty or absent registry', () => {
    expect(audioUniqueSlug('First', [])).toBe('first');
    expect(audioUniqueSlug('First', null)).toBe('first');
  });
});

describe('audioNormalizePeaks — shape, not loudness', () => {
  it('scales to the loudest peak so a quiet recording still fills the card', () => {
    expect(audioNormalizePeaks([0.1, 0.2, 0.05])).toEqual([0.5, 1, 0.25]);
  });

  it('never exceeds 1', () => {
    audioNormalizePeaks([3, 1, 0.5]).forEach((p) => expect(p).toBeLessThanOrEqual(1));
  });

  it('returns silence for silence instead of dividing by zero', () => {
    expect(audioNormalizePeaks([0, 0, 0])).toEqual([0, 0, 0]);
    expect(audioNormalizePeaks([])).toEqual([]);
  });

  it('treats junk samples as silence', () => {
    expect(audioNormalizePeaks([NaN, 1, undefined])).toEqual([0, 1, 0]);
  });

  it('serializes at the same 2-decimal precision the public player parses', () => {
    expect(audioPeaksToString([0.126, 1])).toBe('0.13,1');
  });
});

describe('featuring is exclusive — one homepage card, always', () => {
  it('promoting a track demotes the incumbent', () => {
    STATE.audio = [track(), track({ id: 'a2', slug: 'two', title: 'Two', featured: true })];
    _audioPromote('a1');
    expect(STATE.audio.filter((a) => a.featured).map((a) => a.id)).toEqual(['a1']);
  });

  it('promoting again un-features it (the toggle is the only way off the card)', () => {
    STATE.audio = [track({ featured: true })];
    _audioPromote('a1');
    expect(STATE.audio[0].featured).toBe(false);
  });

  it('never leaves two tracks featured, whatever order they are promoted in', () => {
    STATE.audio = [track(), track({ id: 'a2', slug: 'two' }), track({ id: 'a3', slug: 'three' })];
    _audioPromote('a1');
    _audioPromote('a3');
    _audioPromote('a2');
    expect(STATE.audio.filter((a) => a.featured)).toHaveLength(1);
    expect(STATE.audio.find((a) => a.featured).id).toBe('a2');
  });

  it('stages the change so it reaches the next publish', () => {
    STATE.audio = [track()];
    _audioPromote('a1');
    expect(STATE.staged.audio).toBeGreaterThan(0);
  });

  it('ignores an unknown id rather than throwing', () => {
    STATE.audio = [track()];
    expect(() => _audioPromote('nope')).not.toThrow();
  });
});

describe('episode and download are independent per-track switches', () => {
  it('marks a track as a podcast episode without touching the card', () => {
    STATE.audio = [track()];
    _audioToggleEpisode('a1');
    expect(STATE.audio[0].episode).toBe(true);
    expect(STATE.audio[0].featured).toBeFalsy();
  });

  it('is a toggle, and does not go exclusive — a show has many episodes', () => {
    STATE.audio = [track(), track({ id: 'a2', slug: 'two' })];
    _audioToggleEpisode('a1');
    _audioToggleEpisode('a2');
    expect(STATE.audio.filter((a) => a.episode)).toHaveLength(2);
    _audioToggleEpisode('a1');
    expect(STATE.audio.filter((a) => a.episode)).toHaveLength(1);
  });

  it('toggles the download offer', () => {
    STATE.audio = [track()];
    _audioToggleDownload('a1');
    expect(STATE.audio[0].download).toBe(true);
  });
});

describe('renderAudio', () => {
  it('says so plainly when the shelf is empty', () => {
    renderAudio();
    expect(document.getElementById('audio-display').textContent).toContain('NO AUDIO YET');
  });

  it('escapes a title rather than injecting it as markup', () => {
    STATE.audio = [track({ title: '<img src=x onerror=alert(1)>' })];
    renderAudio();
    expect(document.getElementById('audio-display').querySelector('img')).toBeNull();
  });

  it('shows an in-flight upload as such, so a half-added track is never mistaken for a live one', () => {
    STATE.audio = [track({ _uploading: true })];
    renderAudio();
    expect(document.getElementById('audio-display').textContent).toContain('UPLOADING');
  });
});

// The console measures peaks and the public player resamples them. If those two
// disagreed about how many were stored, every waveform on the site would be
// subtly wrong in a way nothing else would catch — the count is not derivable
// from the data, so it has to be asserted across the file boundary.
describe('PEAK_COUNT agrees on both sides of the wire', () => {
  const read = (p) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  const countIn = (src) => Number(/PEAK_COUNT\s*=\s*(\d+)/.exec(src)[1]);

  it('js/console/audio.js and js/audio-player.js store the same resolution', () => {
    expect(countIn(read('js/console/audio.js'))).toBe(countIn(read('js/audio-player.js')));
  });
});
