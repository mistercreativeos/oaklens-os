// @vitest-environment happy-dom
//
// The playlist card, actually BUILT and actually driven — the companion to
// tests/audio-playlist-card.test.js, which scans source text. Source scans
// would pass a card that throws on render or a queue that silently stops, so
// the behaviour that broke gets exercised here instead of asserted about.
//
// The bug this file exists for: auto-advance ran once and stopped. Track 1 →
// track 2 worked (its handler was written inline); track 2 → track 3 did not,
// because the advancing call passed `onended: player.onended` — a property the
// player API never exposed. Dispatching `ended` twice is the whole test.
import { describe, it, expect, beforeAll } from 'vitest';

// recent-index.js renders on import when a document exists, and that render
// fetches the data files. Nothing here needs it — stub it out so the module
// loads without reaching the network or logging failures.
globalThis.fetch = async () =>
  new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });

// happy-dom has no media stack: <audio>.play() is not implemented. The player
// only ever calls play/pause and reads paused/currentTime, so a minimal stub is
// enough to run the real code path rather than a rewritten one.
let PAUSED = true;
const LOADS = [];   // every element that had load() called on it, in order
beforeAll(async () => {
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value() { PAUSED = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); },
  });
  // The warming path calls load(); happy-dom does not implement it either.
  Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value() { LOADS.push(this); },
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value() { PAUSED = true; this.dispatchEvent(new Event('pause')); },
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get() { return PAUSED; },
  });

  await import('../js/audio-player.js');
  await import('../js/recent-index.js');
});

const track = (n) => ({
  slug: `track-${n}`,
  filename: `track-${n}.mp3`,
  title: `Track ${n}`,
  duration: 60 * n,
  peaks: '0.2,0.5,0.9,0.4',
});

const build = (count) =>
  globalThis.RecentIndex.audioPlaylistCard(
    Array.from({ length: count }, (_, i) => track(i + 1)),
  );

const rows = (card) => [...card.querySelectorAll('.wk-pl-item')];
const activeIndex = (card) => rows(card).findIndex((r) => r.classList.contains('is-active'));

describe('the playlist card renders', () => {
  it('builds without throwing for every supported count', () => {
    for (let n = 2; n <= 6; n++) {
      expect(() => build(n), `${n} tracks threw`).not.toThrow();
    }
  });

  it('draws one index row per track', () => {
    expect(rows(build(2))).toHaveLength(2);
    expect(rows(build(6))).toHaveLength(6);
  });

  it('stamps the tier and the raw count the CSS ladder reads', () => {
    expect(build(2).getAttribute('data-tier')).toBe('roomy');
    expect(build(4).getAttribute('data-tier')).toBe('balanced');
    expect(build(6).getAttribute('data-tier')).toBe('dense');
    expect(build(5).getAttribute('data-tracks')).toBe('5');
  });

  it('opens with the first track selected', () => {
    expect(activeIndex(build(4))).toBe(0);
  });

  it('numbers the rows from 01', () => {
    const nums = rows(build(3)).map((r) => r.querySelector('.wk-pl-num').textContent);
    expect(nums).toEqual(['01', '02', '03']);
  });

  it('mounts exactly one player, not one per track', () => {
    // Six transports stacked in a tile was the other reading of "a playlist
    // card"; this one swaps the source under a single waveform.
    expect(build(6).querySelectorAll('audio')).toHaveLength(1);
  });

  it('states the count and running time ONCE, in the foot', () => {
    // It used to print "3 tracks · 6 MIN" under the title and again in the
    // foot — the same six words twice on a tile the size of a postcard.
    const card = build(3);
    expect(card.querySelector('.wk-a-sub')).toBeNull();
    expect(card.querySelector('.wk-a-meta').textContent).toContain('3 tracks');
  });

  it('orders the card head above the index: kicker, title, waveform, rule', () => {
    // The waveform is the header the track list hangs from, so it has to sit
    // between the title and the index in DOM order — the CSS rule that reads
    // as "the line under the head" is the index's own top border.
    const kids = [...build(4).children].map((n) => n.className.split(' ')[0]);
    expect(kids).toEqual(['wk-kicker', 'wk-a-title', 'ap', 'wk-pl-index', 'wk-a-foot']);
  });
});

describe('auto-advance walks the WHOLE queue', () => {
  it('advances past the second track — the regression', () => {
    const card = build(4);
    const audio = card.querySelector('audio');

    expect(activeIndex(card)).toBe(0);

    audio.dispatchEvent(new Event('ended'));
    expect(activeIndex(card), 'did not reach track 2').toBe(1);

    // Everything above here passed before the fix. This is the assertion that
    // failed: the second advance never happened.
    audio.dispatchEvent(new Event('ended'));
    expect(activeIndex(card), 'stopped after track 2 — onended was lost').toBe(2);

    audio.dispatchEvent(new Event('ended'));
    expect(activeIndex(card), 'stopped after track 3').toBe(3);
  });

  it('settles back on the first track when the queue runs out', () => {
    const card = build(2);
    const audio = card.querySelector('audio');
    audio.dispatchEvent(new Event('ended'));   // → track 2
    audio.dispatchEvent(new Event('ended'));   // → past the end
    expect(activeIndex(card)).toBe(0);
  });

  it('loads the right file as it goes', () => {
    const card = build(3);
    const audio = card.querySelector('audio');
    audio.dispatchEvent(new Event('ended'));
    expect(decodeURIComponent(audio.src)).toContain('track-2.mp3');
    audio.dispatchEvent(new Event('ended'));
    expect(decodeURIComponent(audio.src)).toContain('track-3.mp3');
  });
});

describe('clicking a row plays that track', () => {
  it('jumps the selection and keeps advancing from there', () => {
    const card = build(5);
    const audio = card.querySelector('audio');

    rows(card)[3].dispatchEvent(new Event('click', { bubbles: true }));
    expect(activeIndex(card)).toBe(3);
    expect(decodeURIComponent(audio.src)).toContain('track-4.mp3');

    // A track reached by click must carry the same callbacks as one reached by
    // advancing — the two call sites used to build their options separately.
    audio.dispatchEvent(new Event('ended'));
    expect(activeIndex(card), 'a clicked track did not advance').toBe(4);
  });
});

describe('a failed track does not poison the rest', () => {
  it('clears the latched error state when the next track loads', () => {
    const card = build(3);
    const audio = card.querySelector('audio');
    const player = card.querySelector('.ap');

    audio.dispatchEvent(new Event('error'));
    expect(player.classList.contains('is-error')).toBe(true);

    audio.dispatchEvent(new Event('ended'));
    expect(player.classList.contains('is-error'), 'the 404 outlived its track').toBe(false);
    expect(player.hasAttribute('title')).toBe(false);
  });
});

// The lag the owner reported: press play, wait, hear sound — and the same gap
// again on every track change. `preload="none"` is right (a homepage must not
// pull audio nobody asked for) but it puts the whole round trip AFTER the
// click. These pin the head start: the fetch begins on intent, and the queue
// warms the track it already knows is next.
describe('the fetch starts on intent, not on the press', () => {
  it('downloads nothing for a visitor who never reaches for it', () => {
    const card = build(3);
    expect(card.querySelector('audio').preload).toBe('none');
  });

  it('warms the buffer when a pointer reaches the transport', () => {
    PAUSED = true;
    const card = build(3);
    const audio = card.querySelector('audio');
    LOADS.length = 0;

    card.querySelector('.ap-play').dispatchEvent(new Event('pointerenter'));
    expect(audio.preload).toBe('auto');
    expect(LOADS).toContain(audio);
  });

  it('warms from the waveform and from the keyboard too', () => {
    for (const evt of ['pointerdown', 'focus']) {
      PAUSED = true;
      const card = build(3);
      LOADS.length = 0;
      card.querySelector('.ap-wave').dispatchEvent(new Event(evt));
      expect(card.querySelector('audio').preload, `${evt} did not warm`).toBe('auto');
    }
  });

  it('never restarts a fetch that is already running', () => {
    PAUSED = false;   // playing: a load() here would abort what it is playing
    const card = build(3);
    LOADS.length = 0;
    card.querySelector('.ap-play').dispatchEvent(new Event('pointerenter'));
    expect(LOADS, 'warming interrupted playback').toHaveLength(0);
    PAUSED = true;
  });
});

describe('the queue warms what it already knows is coming', () => {
  const spyWarm = (fn) => {
    const AP = globalThis.AudioPlayer;
    const real = AP.warm;
    const seen = [];
    AP.warm = (src) => seen.push(src);
    try { fn(seen); } finally { AP.warm = real; }
  };

  it('warms the NEXT track once one starts playing', () => {
    spyWarm((seen) => {
      const card = build(3);
      card.querySelector('audio').dispatchEvent(new Event('play'));
      expect(seen).toEqual(['track-2.mp3']);
    });
  });

  it('warms nothing before the first press', () => {
    spyWarm((seen) => {
      build(3);
      expect(seen, 'a card nobody touched pulled audio').toEqual([]);
    });
  });

  it('has nothing to warm on the last track', () => {
    spyWarm((seen) => {
      const card = build(2);
      rows(card)[1].dispatchEvent(new Event('click'));
      seen.length = 0;
      card.querySelector('audio').dispatchEvent(new Event('play'));
      expect(seen).toEqual([]);
    });
  });

  it('warms a row the pointer reaches for', () => {
    spyWarm((seen) => {
      const card = build(4);
      rows(card)[2].dispatchEvent(new Event('pointerenter'));
      expect(seen).toEqual(['track-3.mp3']);
    });
  });

  it('warms the ACTIVE row through the player that already holds it', () => {
    // Row 1 is the loaded track — handing its file to the shared warmer would
    // buffer the same bytes twice, on two elements.
    spyWarm((seen) => {
      PAUSED = true;
      const card = build(4);
      rows(card)[0].dispatchEvent(new Event('pointerenter'));
      expect(seen, 'the active row went through the shared warmer').toEqual([]);
      expect(card.querySelector('audio').preload).toBe('auto');
    });
  });
});
