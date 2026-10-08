// @vitest-environment happy-dom
//
// The split-flap board (js/console/flap.js, K64): a line that turns only the
// characters that changed, the way a departure board does. The owner, on the
// Bridge's headline: the flip from NOTHING WAITING to N … WAITING should have
// "visceral clarity … like an old split-flap departure board".

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'css/field-console.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let F;
beforeAll(async () => { F = await import('../js/console/flap.js'); });

describe('the plan: which words turn', () => {
  it('reads both lines from the end, so a count growing at the front keeps the word after it', () => {
    expect(F.flapPlan('NOTHING WAITING', '7 EDITS WAITING')).toEqual([
      { word: '7', was: '', same: false },
      { word: 'EDITS', was: 'NOTHING', same: false },
      { word: 'WAITING', was: 'WAITING', same: true },
    ]);
    expect(F.flapPlan('7 EDITS WAITING', '8 EDITS WAITING').map((p) => p.same)).toEqual([false, true, true]);
  });
});

describe('the steps: how a cell turns', () => {
  it('runs forward through the alphabet and lands on its letter, never more than a handful of flaps', () => {
    const s = F.flapSteps('A', 'D');
    expect(s).toEqual(['B', 'C', 'D']);
    const far = F.flapSteps('A', 'Z');
    expect(far.at(-1)).toBe('Z');
    expect(far.length).toBeLessThanOrEqual(6);
  });
  it('a letter that stays does not turn; a symbol the board does not carry lands at once', () => {
    expect(F.flapSteps('W', 'W')).toEqual([]);
    expect(F.flapSteps('A', '→')).toEqual(['→']);
  });
});

describe('the line', () => {
  it('keeps one element per word, carrying the reader\'s attributes, and says the line once', () => {
    const el = document.createElement('h1');
    F.flapTo(el, 'NOTHING WAITING', { wordAttrs: 'data-text="live"' });
    const words = [...el.children];
    expect(words.map((w) => w.textContent)).toEqual(['NOTHING', 'WAITING']);
    expect(words.every((w) => w.getAttribute('data-text') === 'live')).toBe(true);
    expect(el.getAttribute('aria-label')).toBe('NOTHING WAITING');
    expect(words.every((w) => w.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('turns only the words that changed, and the line is whole the moment it is set', () => {
    vi.useFakeTimers();
    window.matchMedia = () => ({ matches: false });
    const el = document.createElement('h1');
    document.body.append(el);
    F.flapTo(el, 'NOTHING WAITING', { wordAttrs: 'data-text="live"' });
    const waiting = el.children[1];
    F.flapTo(el, '7 EDITS WAITING', { wordAttrs: 'data-text="live"' });
    expect(el.dataset.text).toBe('7 EDITS WAITING');
    expect(el.children).toHaveLength(3);
    // WAITING was already there: plain, no cells.
    expect(el.children[2].querySelector('.flap')).toBeNull();
    expect(el.children[2].textContent).toBe(waiting.textContent);
    // EDITS turns, in cells.
    expect(el.children[1].querySelectorAll('.flap')).toHaveLength(5);
    vi.advanceTimersByTime(2000);
    expect([...el.children].map((w) => w.textContent).join(' ')).toBe('7 EDITS WAITING');
    expect(el.querySelectorAll('.is-turning')).toHaveLength(0);
    vi.useRealTimers();
  });

  it('under reduced motion the line is simply set', () => {
    window.matchMedia = () => ({ matches: true });
    const el = document.createElement('h1');
    F.flapTo(el, 'NOTHING WAITING');
    F.flapTo(el, '7 EDITS WAITING');
    expect(el.querySelector('.flap')).toBeNull();
    expect(el.textContent).toBe('7 EDITS WAITING');
  });

  // K77: one loop on the frame clock turns the letters; a letter alternates
  // between two identical drops, so nothing is forced to restart one; and a
  // letter in flight is unlit (its glow, scaled each frame, was Safari's cost).
  it('moves only transforms, holds a turning cell at its final width, and is still under reduced motion', () => {
    const SRC = readFileSync(join(ROOT, 'js/console/flap.js'), 'utf8');
    for (const name of ['flap-drop-a', 'flap-drop-b']) {
      const kf = CSS.match(new RegExp(`@keyframes ${name} \\{([^\\n]*)\\}`))[1];
      expect(kf).toMatch(/transform/);
      expect(kf).not.toMatch(/opacity|text-shadow|width|height/);
    }
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.flap\.is-drop-a \{ animation: flap-drop-a 110ms var\(--ease-out\); \}\s*\.flap\.is-drop-b \{ animation: flap-drop-b 110ms var\(--ease-out\); \}/);
    expect(SRC).not.toMatch(/offsetWidth/);          // nothing forced
    expect(SRC).not.toMatch(/setTimeout/);           // one loop, on the frame clock
    expect(SRC).toMatch(/raf = requestAnimationFrame\(tick\);/);
    expect(CSS).toMatch(/\.flap\.is-turning \{[^}]*overflow-x: clip;[^}]*text-shadow: none;/);
    expect(SRC).toMatch(/if \(!animate \|\| !prev \|\| reduced\(\)\) \{/);
  });
});
