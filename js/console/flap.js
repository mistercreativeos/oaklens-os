// OAKLENS Field Console — the split-flap board.
//
// A line of type that changes the way a departure board does: only the
// characters that differ turn, each running through the board's alphabet to
// its new letter, left to right, and a word that has landed lights up. The
// owner, 2026-10-06, on the Bridge's headline: the flip from "NOTHING
// WAITING" to "N … WAITING" should have "visceral clarity … like an old
// split-flap departure board." So "NOTHING WAITING" → "7 EDITS WAITING"
// turns the first word only: WAITING was already there.
//
// A part, like the dot matrix (matrix.js): it knows nothing of the Bridge.
// It keeps the reader's structure (each word one element, so a word can
// carry a text class and be flared), sets each changing character in a cell
// as wide as its final letter (so the line never reflows mid-turn), and moves
// only transforms. Under reduced motion it sets the text and is done.
//
// The words are the reader's to classify: `wordAttrs` is written onto every
// word element. The flare when a word lands is text-light.js's.

import { escapeHTML, uiZoom } from './chrome.js';
import { flare } from './text-light.js';

export const FLAP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const MAX_STEPS = 6;       // the most letters a cell shows before its own
const STEP_MS = 55;        // one turn of a flap
const CHAR_LAG_MS = 38;    // the next cell starts this much later

/**
 * The letters a cell shows on its way from `from` to `to`, ending on `to`.
 * Forward through the alphabet, as a board's drum turns, and never more than
 * MAX_STEPS of them; a character the board does not carry (an arrow, a
 * space) lands at once.
 */
export function flapSteps(from, to) {
  if (from === to) return [];
  const t = FLAP_ALPHABET.indexOf(to);
  if (t < 0) return [to];
  const f = FLAP_ALPHABET.indexOf(from);
  const n = FLAP_ALPHABET.length;
  const dist = f < 0 ? MAX_STEPS : ((t - f + n) % n);
  const steps = Math.min(MAX_STEPS, Math.max(1, dist));
  const out = [];
  for (let k = steps - 1; k >= 0; k--) out.push(FLAP_ALPHABET[(t - k + n) % n]);
  return out;
}

/**
 * Which words of `to` change, read from the END of both lines (a count grows
 * at the front: "NOTHING WAITING" → "12 EDITS WAITING" keeps WAITING), and
 * for each changing word the word it replaces, if any.
 */
export function flapPlan(from, to) {
  const a = String(from || '').split(' ').filter(Boolean);
  const b = String(to || '').split(' ').filter(Boolean);
  return b.map((word, i) => {
    const j = a.length - (b.length - i);
    const was = j >= 0 ? a[j] : '';
    return { word, was, same: was === word };
  });
}

const _runs = new WeakMap();
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; } };

/**
 * Set `el`'s words to `text`, turning what changed. `wordAttrs` is the
 * attribute string every word element carries (e.g. `data-text="live"`).
 * The final text is the element's from the first call (its `dataset.text`
 * and its `aria-label`), so a screen reader never hears the turning letters.
 */
export function flapTo(el, text, { wordAttrs = '', animate = true } = {}) {
  if (!el) return;
  const prev = el.dataset.text || '';
  if (prev === text) return;
  _runs.get(el)?.();   // a turn in flight stops where it is
  _runs.delete(el);
  el.dataset.text = text;
  el.setAttribute('aria-label', text);
  const attrs = wordAttrs ? ' ' + wordAttrs : '';
  const plain = (w) => `<span${attrs} aria-hidden="true">${escapeHTML(w)}</span>`;
  if (!animate || !prev || reduced()) {
    el.innerHTML = text.split(' ').filter(Boolean).map(plain).join(' ');
    return;
  }
  // The final line first, in cells, so each cell can be held at its final
  // width while it turns (one read of the layout for all of them).
  const plan = flapPlan(prev, text);
  el.innerHTML = plan.map(({ word, same }) => same
    ? plain(word)
    : `<span${attrs} aria-hidden="true">${[...word].map((c) => `<span class="flap">${escapeHTML(c)}</span>`).join('')}</span>`).join(' ');
  const words = [...el.children];
  const cells = [];
  plan.forEach(({ word, was, same }, i) => {
    if (same) return;
    [...words[i].children].forEach((cell, k) => {
      const steps = flapSteps([...was][k] || ' ', [...word][k]);
      if (steps.length > 1) cells.push({ cell, steps, word: words[i] });
    });
  });
  const z = uiZoom();   // a rect is zoomed on a large screen (K74); a style is not
  const widths = cells.map(({ cell }) => cell.getBoundingClientRect().width / z);
  // THE TURN, ONCE A FRAME (K77). Each letter's steps used to be timers of
  // their own (a flip of two words, ninety of them), and each restarted its
  // drop by forcing a layout of the page. Safari stepped them unevenly: "still
  // choppy for the flip letters". Now one loop, on the frame clock, turns
  // every letter that is due, and restarts its drop without forcing a layout.
  // A hidden tab's loop sleeps and wakes at the end.
  const jobs = cells.map(({ cell, steps, word }, n) => {
    cell.style.width = `${widths[n]}px`;
    cell.classList.add('is-turning');
    // Held at its width, its letters move nothing around it: the light engine
    // need not repaint for each one (K74, Safari).
    cell.setAttribute('data-light-still', '');
    cell.textContent = steps[0];   // it starts on its first letter, not its last
    const start = n * CHAR_LAG_MS;
    return { cell, steps, word, start, end: start + (steps.length - 1) * STEP_MS, k: 0, done: false };
  });
  // A word lights up the moment its last letter lands.
  const lands = new Map();
  for (const j of jobs) lands.set(j.word, Math.max(lands.get(j.word) || 0, j.end));
  // Words that changed but needed no turning (one letter, a symbol) light now.
  plan.forEach(({ same }, i) => { if (!same && !lands.has(words[i])) flare(words[i]); });
  // The drop is the stylesheet's (flap-drop-a/-b, the same flap twice): a
  // letter alternates between them, which restarts it with nothing forced.
  // (A Web Animation per letter, tried first, cost WebKit a frame in three.)
  const drop = (cell) => {
    const a = cell.classList.contains('is-drop-a');
    cell.classList.toggle('is-drop-a', !a);
    cell.classList.toggle('is-drop-b', a);
  };
  const lit = new Set();
  let t0 = 0, raf = 0, stopped = false;
  const tick = (now) => {
    if (stopped) return;
    if (!t0) t0 = now;
    const t = now - t0;
    let more = false;
    for (const j of jobs) {
      if (j.done) continue;
      const last = j.steps.length - 1;
      const due = Math.min(last, Math.floor((t - j.start) / STEP_MS));
      if (due > j.k) { j.k = due; j.cell.textContent = j.steps[due]; drop(j.cell); }
      if (j.k === last && t >= j.end + 2 * STEP_MS) {
        j.done = true;
        j.cell.classList.remove('is-turning', 'is-drop-a', 'is-drop-b');
        j.cell.style.width = '';
        j.cell.removeAttribute('data-light-still');
      } else more = true;
    }
    for (const [word, at] of lands) {
      if (!lit.has(word) && t >= at + STEP_MS) { lit.add(word); flare(word); }
      if (!lit.has(word)) more = true;
    }
    if (more) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  _runs.set(el, () => { stopped = true; cancelAnimationFrame(raf); });
}
