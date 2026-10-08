// OAKLENS Field Console — pulse.
//
// The composer for the homepage's immediate card. Everything here is shaped
// around one property: **posting a pulse costs no publish and no deploy.** It is
// a single POST to D1 and the card is live within a cache TTL. That is why this
// surface stages nothing, bumps no counters, and never routes through the
// publish view — and why the UI says so out loud, since every other write in
// this console means "staged, waiting for you to publish."
//
// A DIRECT CANVAS, NOT A FORM. This shipped on 2026-08-12 as a two-column form
// with the card as a preview beside it, and it was rebuilt on 2026-08-13 because
// the form was three screens tall on a phone: you typed with the card scrolled
// off the top, and the sticky action bar covered the inputs it was added to keep
// reachable. So now **you type into the card itself** and the whole surface is
// bounded to the viewport. The full report and what was rejected:
// docs/maintenance/2026-08-13-pulse-rename-and-studio.md.
//
// THE CARD NAMES ITSELF. There is no label field — every pulse on every fork
// says PULSE (src/shared/pulse.js `PULSE_LABEL`). An earlier cut let the starter
// pack stamp its discipline on the card, so the same feature introduced itself
// as PHOTOGRAPHY on one post and TECH / DEV on the next.
//
// The six starter packs (js/pulse-packs.js) are shown in full to everyone. Not
// one lane per fork, not a photography default with the rest as an upgrade:
// photographers write, musicians ship code, and a lane is a starting point
// rather than a category the software puts someone in.
//
// THE GLYPHS FOLLOW THE SAME RULE since 2026-08-24. They used to be a per-lane
// tray, so choosing a lane silently narrowed the vocabulary; now every
// discipline's twelve are in one scrolling menu under its own heading, plus a
// field that hands over the platform's ENTIRE emoji keyboard for zero bytes
// (see `_pulseSetGlyphAny`). Curated for speed, everything for the specific
// thing you meant.
//
// WRITE MODE. On a phone the keyboard used to take ~350px out of a bounded
// column whose only elastic row was the card, so the card collapsed and clipped
// away the textarea being typed into. `body.kb-open` now folds the rows that
// are not typing — lanes, starter strip, palette, RECENT, the closed footer —
// and the card takes the height back. That choreography is entirely CSS
// (css/field-console.css, "WRITE MODE"); this module renders the same markup
// either way, which is what keeps the surgical-update discipline intact.
// Report: docs/maintenance/2026-08-24-pulse-mobile-keyboard-and-glyph-menu.md.
//
// Every remaining field is FREE TEXT. There is deliberately no named slot for
// gear, a batch or a take number — that is a camera field wearing a different
// hat, and it would quietly tell five of the six disciplines that this is not
// for them.
//
// The handlers below are called from inline on*= attributes in the rendered
// markup, which run in global scope, so each must stay an exported function
// (see the asset-library header for what happens otherwise).

import { logEvent } from '../console-telemetry.js';
import { postPulse, retirePulse, fetchPulseLog, isNotConfigured } from '../console-api.js';
import { toast, escapeHTML, escapeAttrJS, registerView, openSheet, closeSheet } from './chrome.js';
import { PACKS, pulseFrom, glyphGroups } from '../pulse-packs.js';

const $ = (id) => document.getElementById(id);

// The card's one fixed word. Mirrors PULSE_LABEL in src/shared/pulse.js — the
// console cannot import from src/, so tests/pulse-console.test.js asserts the
// spellings agree rather than trusting whoever edits one of them.
const PULSE_LABEL = 'PULSE';

// The composer's working copy. Not in STATE: STATE is the publish bundle, and a
// pulse never enters it.
let draft = { text: '', glyphs: '', state: 'signal', footLeft: '', footRight: '' };
let logRows = [];
let activePack = 'photography';

// The palettes, in the order they are offered. `signal` leads because it is the
// absence of a choice — it follows the instance's own accent, so an author who
// never touches the palette still gets a card that looks like their site. The
// other five are the deep grounds.
const STATES = [
  { key: 'signal', label: 'Signal', note: 'your accent' },
  { key: 'ember', label: 'Ember', note: 'safelight red' },
  { key: 'dawn', label: 'Dawn', note: 'first light' },
  { key: 'flow', label: 'Flow', note: 'deep green' },
  { key: 'velvet', label: 'Velvet', note: 'late violet' },
  { key: 'tide', label: 'Tide', note: 'cold blue' },
];
const STATE_KEYS = STATES.map((s) => s.key);

function packs() { return PACKS; }
function activePackDef() { return packs().find((p) => p.key === activePack) || null; }

// ---- the tier ladder ----
//
// The same ladder the public card uses (js/recent-index.js `pulseTier`) and the
// same thresholds the field-note text cards use, measured in graphemes. It is
// duplicated here rather than imported for one reason: recent-index.js is a
// classic script that ships to public pages, and the console loads no classic
// scripts at all — the first cut reached for `globalThis.RecentIndex`, which is
// never defined in this surface, so every preview silently fell back to
// `statement`. Twelve lines of duplication beats a card that quietly lies about
// what the homepage will render.
let _seg = null;
function tierLen(text) {
  const s = String(text || '');
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    if (!_seg) _seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    let n = 0;
    for (const _ of _seg.segment(s)) n += 1;
    return n;
  }
  return Array.from(s).length;
}
function currentTier() {
  const text = draft.text.trim();
  if (!text) return 'glyph';
  const n = tierLen(text);
  if (n <= 55) return 'statement';
  if (n <= 105) return 'feature';
  return 'standard';
}

// One definition of "there is nothing here", used by the post guard and by the
// dock's disabled state, so the two can never disagree about whether the card
// is empty.
function draftIsEmpty() {
  return !draft.text.trim() && !draft.glyphs.trim()
    && !draft.footLeft.trim() && !draft.footRight.trim();
}

function nowLocalTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---- surgical updates ----
//
// The full render happens EXACTLY ONCE, when the view is opened
// (tests/pulse-console.test.js pins the single call site). Everything below
// touches only what changed, and on this surface that is not an optimisation —
// the line you are typing lives inside the card, so rebuilding the card would
// destroy the textarea you are typing into: focus, caret position, selection and
// the soft keyboard, mid-sentence.
//
// So: `paintCard` never writes the textarea's value. It moves attributes and the
// glyph, and the browser keeps the field exactly as the author left it. The
// value is written only when something OTHER than typing changes it — a preset,
// a reuse, a reset — through `syncFields`.
function paintCard() {
  const card = $('pulse-card');
  if (card) {
    card.setAttribute('data-state', draft.state);
    card.setAttribute('data-tier', currentTier());
  }
  const glyph = $('pulse-glyph-slot');
  if (glyph) glyph.textContent = draft.glyphs.trim();

  const tier = $('pulse-tier');
  if (tier) tier.textContent = currentTier().toUpperCase();

  // The footer renders only when the author has filled a cell — same rule as
  // the public card, so an empty footer is not a rule the preview breaks.
  const foot = $('pulse-foot');
  if (foot) {
    const left = draft.footLeft.trim();
    const right = draft.footRight.trim();
    foot.hidden = !left && !right;
    const l = $('pulse-foot-out-left');
    const r = $('pulse-foot-out-right');
    if (l) l.textContent = left;
    if (r) r.textContent = right;
  }

  syncSwatches();
  syncGlyphs();
  syncDockState();
}

// The menu shows the card's glyphs in two places — a removable chip per glyph,
// and a lit tile for each one that came from the curated set — and both have to
// follow every path that can change them: a tile, a chip, the keyboard doorway,
// a starter, a reuse, a reset.
//
// MEMOISED ON THE STRING, because this is called from paintCard(), which runs on
// every keystroke of the LINE. Rebuilding the chips there would be free of
// visible consequence and still wrong: it would throw away the chip a thumb is
// mid-tap on. The glyphs did not change, so nothing is touched.
let _paintedGlyphs = null;
function syncGlyphs() {
  if (draft.glyphs === _paintedGlyphs) return;
  _paintedGlyphs = draft.glyphs;
  const list = glyphList();

  const picked = $('pulse-tray-picked');
  if (picked) {
    picked.hidden = !list.length;
    picked.innerHTML = list.map((g, i) => `
      <button type="button" class="pulse-picked" onclick="_pulseRemoveGlyph(${i})"
              aria-label="${escapeHTML(`Take ${g} off the card`)}"
              title="${escapeHTML(`Take ${g} off the card`)}">
        <span class="pulse-picked-g">${escapeHTML(g)}</span>
        <span class="pulse-picked-x" aria-hidden="true">\u00d7</span>
      </button>`).join('');
  }

  const body = $('pulse-tray-body');
  if (body) {
    body.querySelectorAll('[data-glyph]').forEach((b) => {
      const on = list.includes(b.dataset.glyph);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
}

// RESET CARD is disabled when there is nothing to reset.
//
// It was reported as a dead button, and it was not — it emptied the card, said
// nothing, and on an already-empty card there was nothing to see. Both halves
// are fixed: it toasts when it does something (see _pulseReset), and it looks
// unavailable when it does not. A control that greys out is telling you the
// truth; one that silently no-ops is indistinguishable from broken.
function syncDockState() {
  const btn = $('pulse-reset-btn');
  if (btn) btn.disabled = draftIsEmpty();
}

function syncFields() {
  const set = (id, value) => { const el = $(id); if (el && el.value !== value) el.value = value; };
  set('pulse-line', draft.text);
  set('pulse-foot-left', draft.footLeft);
  set('pulse-foot-right', draft.footRight);
}

function syncSwatches() {
  const row = $('pulse-palette');
  if (!row) return;
  row.querySelectorAll('[data-value]').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === draft.state);
    b.setAttribute('aria-pressed', b.dataset.value === draft.state ? 'true' : 'false');
  });
}

function syncLanes() {
  const row = $('pulse-lanes');
  if (!row) return;
  row.querySelectorAll('[data-value]').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === activePack);
  });
}

// ---- handlers (called from inline on*= — must stay exported) ----

export function _pulseSetField(field, value) {
  if (!(field in draft)) return;
  draft[field] = value;
  paintCard();
}

export function _pulseSetState(state) {
  draft.state = STATE_KEYS.includes(state) ? state : 'signal';
  paintCard();
}

export function _pulseSetPack(key) {
  if (!packs().some((p) => p.key === key)) return;
  activePack = key;
  syncLanes();
  // Only the three things a lane actually changes — not the whole view.
  const rail = $('pulse-starters');
  if (rail) rail.innerHTML = starterTilesHtml();
  const strip = $('pulse-strip');
  if (strip) strip.innerHTML = starterChipsHtml();
  syncTrayLane();
  const head = $('pulse-starters-head');
  const pack = activePackDef();
  if (head && pack) head.textContent = `${pack.label} starters`;
}

// Tapping a starter FILLS the card rather than posting it — the line is a
// starting point the author edits, which is the difference between a preset and
// a canned message.
export function _pulseApplyStarter(packKey, index) {
  const preset = pulseFrom(packKey, Number(index));
  if (!preset) return;
  draft = { ...draft, ...preset };
  syncFields();
  paintCard();
  closeTray();
}

export function _pulseToggleTray() {
  const tray = $('pulse-tray');
  if (!tray) return;
  const open = tray.classList.toggle('open');
  const slot = $('pulse-glyph-slot');
  if (slot) slot.setAttribute('aria-expanded', open ? 'true' : 'false');
  // Open ON the lane you have been reading. The menu's ORDER never changes
  // (js/pulse-packs.js `glyphGroups`) — what changes is where it starts, which
  // keeps the lane meaningful to the picker without reshuffling it under the
  // thumb. `block: 'start'` and not scrollIntoView's default: the default
  // centres, which on a six-section menu can open mid-Filmmaking with a
  // heading half off the top.
  if (open) syncTrayLane({ scroll: true });
}

export function _pulseCloseTray() {
  const tray = $('pulse-tray');
  if (tray) tray.classList.remove('open');
  const slot = $('pulse-glyph-slot');
  if (slot) slot.setAttribute('aria-expanded', 'false');
}

// Kept as the module's own private name for the same call — every handler below
// closes the menu after acting, and they did so before this was exported.
const closeTray = _pulseCloseTray;

// Mark (and optionally scroll to) the section belonging to the open lane. The
// menu itself is rendered ONCE — it no longer depends on the lane — so a lane
// change moves a class, not markup.
function syncTrayLane({ scroll = false } = {}) {
  const body = $('pulse-tray-body');
  if (!body) return;
  let target = null;
  body.querySelectorAll('[data-lane]').forEach((sec) => {
    const on = sec.dataset.lane === activePack;
    sec.classList.toggle('is-lane', on);
    if (on) target = sec;
  });
  if (scroll && target) body.scrollTop = Math.max(0, target.offsetTop - body.offsetTop);
  _pulseTrayCue();
}

// WHICH EDGE HAS MORE BEHIND IT. Six sections do not fit, so the menu has to
// say so — and say nothing at the ends, because a cue that is always on is
// decoration and at the bottom of the list it dims a real row for no reason.
//
// It is JS rather than the CSS-only `background-attachment: local` trick, and
// that is not a preference: background layers paint BEHIND an element's
// content, and every tile here carries an opaque `--surface-2`, so the fixed
// shadow strip was covered by whatever row sat at the edge. See the stylesheet.
//
// Exported because it is called from an inline onscroll= (global scope).
export function _pulseTrayCue() {
  const body = $('pulse-tray-body');
  const host = $('pulse-tray-scroll');
  if (!body || !host) return;
  // A closed panel is display:none, so clientHeight is 0 and `max` goes
  // negative — which correctly yields no cue at all. It is recomputed on open.
  const max = body.scrollHeight - body.clientHeight;
  host.toggleAttribute('data-up', body.scrollTop > 2);
  host.toggleAttribute('data-down', body.scrollTop < max - 2);
}

// ---- the glyphs on the card, as a list ----
//
// `draft.glyphs` is stored as one space-joined string because that is what the
// D1 column and the public card take (docs/pulse-card-vision.md §4). Everything
// in this module works on the LIST, because the interaction the owner asked for
// on 2026-08-24 is set-shaped, not string-shaped: "try out different glyphs with
// their messages and just remove and add them quickly without losing context."
// Appending to a string can only ever grow.
function glyphList() {
  const s = draft.glyphs.trim();
  return s ? s.split(/\s+/) : [];
}

function setGlyphList(list) {
  draft.glyphs = list.join(' ');
  paintCard();
}

// A curated tile TOGGLES. Tap to put it on the card, tap again to take it off —
// which is the whole ask, and the reason this no longer closes the menu: closing
// on every tap made trying three glyphs cost three reopens. The feedback that
// used to come from seeing the card is now in the panel itself: the tile lights
// up and a removable chip appears above the grid.
//
// There is no way to put the same glyph on twice, deliberately. Two identical
// glyphs on one card is not a thing anyone wants, and allowing it would make
// "tap again to remove" ambiguous about which one it removed.
export function _pulseSetGlyph(glyph) {
  const g = String(glyph || '').trim();
  if (!g) return;
  const list = glyphList();
  const at = list.indexOf(g);
  if (at >= 0) list.splice(at, 1);
  else list.push(g);
  setGlyphList(list);
}

// Drop ONE glyph, by position. The chips above the grid are the only way to
// remove a glyph that came from the platform's emoji keyboard rather than the
// curated set — there is no tile to un-toggle for those, and before this the
// only way back was RESET CARD, which also throws away the line you wrote.
export function _pulseRemoveGlyph(index) {
  const list = glyphList();
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= list.length) return;
  list.splice(i, 1);
  setGlyphList(list);
}

// THE WHOLE EMOJI SET, FOR ZERO BYTES.
//
// The curated twelve-per-discipline are the quick path and stay exactly that.
// This is the other half the owner asked for (2026-08-24): "the whole emoji set
// is nice when you have a specific message you're trying to get across."
//
// It is one <input>, not a bundled emoji table, and that is the entire design.
// Shipping a full set in the engine would cost every fork ~1,900 emoji of
// payload, ~1,900 colour-font nodes to paint on open, tofu wherever the
// platform's font is older than the revision we ship, and a list that goes
// stale every Unicode release. The DEVICE already has all of that solved, with
// search, in the picker its owner already knows — the only thing missing was
// somewhere to type into, because the card's glyph slot is a <button>.
//
// It APPENDS AND CLEARS ITSELF rather than holding what you typed: the field is
// a doorway to the OS keyboard, not a second place the glyph lives. Holding it
// would mean two elements both claiming to be the glyph and a stale one left
// behind after RESET CARD.
export function _pulseSetGlyphAny(value) {
  const box = $('pulse-glyph-any');
  const raw = String(value || '').trim();
  if (box) box.value = '';
  if (!raw) return;
  // Split, because a paste can carry several at once. Each one is added only if
  // it is not already on the card — same single-membership rule the tiles keep.
  const list = glyphList();
  let added = 0;
  for (const g of raw.split(/\s+/)) {
    if (!g || list.includes(g)) continue;
    list.push(g);
    added += 1;
  }
  if (!added) {
    // Saying nothing here is the RESET CARD mistake again: a control that
    // silently does nothing is indistinguishable from a broken one.
    toast(`${raw} is already on the card`, 'info');
    return;
  }
  setGlyphList(list);
}

// Clear ALL of them. It no longer closes the menu either: every control in this
// panel now leaves it open, and one that closed would read as "that was the last
// thing you get to do here."
export function _pulseClearGlyphs() {
  draft.glyphs = '';
  paintCard();
}

export function _pulseReset() {
  // Nothing to do, and the button is disabled anyway — but a keyboard or a
  // stale click can still land here, and silence is what made this read broken.
  if (draftIsEmpty()) {
    toast('The card is already empty', 'info');
    return;
  }
  draft = { text: '', glyphs: '', state: 'signal', footLeft: '', footRight: '' };
  syncFields();
  paintCard();
  closeTray();
  // The second clause answers the question the button actually raised: "it does
  // not affect the live site." Said here, at the moment of the doubt, rather
  // than in a doc nobody is reading while their thumb is on the screen.
  toast('Card reset — nothing was taken off your site', 'info');
}

// Re-post something from the log. The commonest real use of the log is "that
// one again", which is also why there is no separate saved-states table.
export function _pulseReuse(id) {
  const row = logRows.find((r) => r.id === id);
  if (!row) return;
  draft = {
    text: row.text || '', glyphs: row.glyphs || '', state: row.state || 'signal',
    footLeft: row.footLeft || '', footRight: row.footRight || '',
  };
  syncFields();
  paintCard();
  // Tapped from the phone sheet, this is the last thing you wanted from it —
  // leaving it open would hide the card you just loaded.
  _pulseCloseLog();
  toast('Loaded onto the card — edit it or send it', 'info');
}

export async function _pulsePost() {
  if (!draft.text.trim() && !draft.glyphs.trim()) {
    toast('A pulse needs a line or a glyph', 'warn');
    return;
  }
  const btn = $('pulse-post-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'SENDING…'; }
  try {
    // The clock is stamped HERE, from the author's own device, and frozen for
    // the life of the pulse. Rendering it in the visitor's browser would show a
    // reader in another time zone a time the author never experienced.
    await postPulse({ ...draft, localTime: nowLocalTime() });
    toast('Pulse is live — no publish needed', 'success');
    logEvent('pulse', 'posted');
    await _pulseLoadLog();
    renderPulseLog();
  } catch (err) {
    // An unmigrated D1 is a deliberate "feature off", not a fault — say what to
    // run rather than lighting the system lamp.
    if (isNotConfigured(err)) toast('Pulse needs its database table — run the migrations (see setup.md)', 'warn');
    else toast(`Could not post: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'POST PULSE ▲'; }
  }
}

// The Bridge's one-line pulse (js/console/bridge.js): the same POST and the
// same author's clock as the composer, with only a line — no glyphs, the
// default state, no feet. Resolves true when it went live; the composer's own
// card is untouched, so a half-made card waits where it was left.
export async function pulsePostLine(text) {
  const line = String(text || '').trim();
  if (!line) { toast('A pulse needs a line', 'warn'); return false; }
  try {
    await postPulse({ text: line, glyphs: '', state: 'signal', footLeft: '', footRight: '', localTime: nowLocalTime() });
    toast('Pulse is live — no publish needed', 'success');
    logEvent('pulse', 'posted');
    return true;
  } catch (err) {
    if (isNotConfigured(err)) toast('Pulse needs its database table — run the migrations (see setup.md)', 'warn');
    else toast(`Could not post: ${err.message}`, 'error');
    return false;
  }
}

export async function _pulseRetire() {
  try {
    const res = await retirePulse();
    const n = (res && res.retired) || 0;
    toast(n ? 'Taken down — your homepage goes back to your work' : 'Nothing live to take down', 'info');
    await _pulseLoadLog();
    renderPulseLog();
  } catch (err) {
    if (isNotConfigured(err)) toast('Pulse needs its database table — run the migrations (see setup.md)', 'warn');
    else toast(`Could not retire: ${err.message}`, 'error');
  }
}

// ---- the recent list on a phone ----
//
// The desktop rail is display:none under 900px, so this sheet is where the log
// lives there. Both are fed by renderPulseLog(); only one is ever visible, the
// same display-gated twin already used for the starter strip vs. the starter
// rail, so there is no duplicate tab order.
export function _pulseOpenLog() {
  openSheet('pulse-log-sheet');
}

export function _pulseCloseLog() {
  closeSheet('pulse-log-sheet');
}

export async function _pulseLoadLog() {
  try {
    const res = await fetchPulseLog(30);
    logRows = (res && res.pulses) || [];
  } catch {
    // Silent: the composer is the feature, the log is a convenience.
    logRows = [];
  }
}

// ---- rendering ----

function laneChipsHtml() {
  return packs().map((p) => `
    <button type="button" class="pulse-lane${p.key === activePack ? ' active' : ''}"
            data-value="${escapeHTML(p.key)}"
            onclick="_pulseSetPack('${escapeAttrJS(p.key)}')">${escapeHTML(p.label)}</button>`).join('');
}

function starterTilesHtml() {
  const pack = activePackDef();
  if (!pack) return '';
  return pack.pulses.map((m, i) => `
    <button type="button" class="pulse-tile" data-seam="box" data-backlit data-tier="card" onclick="_pulseApplyStarter('${escapeAttrJS(pack.key)}', ${i})">
      <span class="pulse-tile-glyph" aria-hidden="true">${escapeHTML(m.glyphs)}</span>
      <span class="pulse-tile-text">${escapeHTML(m.text)}</span>
    </button>`).join('');
}

// The mobile twin of the starter rail. Same data, same handler — one row that
// snaps sideways instead of a column that pushes the card off the screen.
function starterChipsHtml() {
  const pack = activePackDef();
  if (!pack) return '';
  return pack.pulses.map((m, i) => `
    <button type="button" class="pulse-chip" onclick="_pulseApplyStarter('${escapeAttrJS(pack.key)}', ${i})">
      <span class="pulse-chip-glyph" aria-hidden="true">${escapeHTML(m.glyphs)}</span>
      <span class="pulse-chip-text">${escapeHTML(m.text)}</span>
    </button>`).join('');
}

// ---- the glyph menu ----
//
// EVERY DISCIPLINE AT ONCE, under its own heading. Until 2026-08-24 this tray
// showed only the open lane's twelve, which meant a photographer writing about a
// late edit had to leave the lane seeding their line to reach ☕. Owner: "there
// are infinite creative combinations." So the lane seeds LINES, and the glyphs
// are universal; the disciplines survive as headings, because the curation was
// the part that worked and 72 unlabelled emoji in one grid is not a curated set.
//
// It is RENDERED ONCE, with the rest of the view. Nothing in it depends on the
// open lane any more — `syncTrayLane()` moves a class when the lane changes —
// so a lane tap can never rebuild the panel under a scrolled thumb.
//
// The clear button says NO GLYPH, not CLEAR: the dock below has a RESET CARD
// button, and two controls a thumb apart both saying "clear" while meaning very
// different things is how a mis-tap becomes a lost draft.
function trayHtml() {
  const groups = glyphGroups().map((g) => `
    <section class="pulse-glyph-group" data-lane="${escapeHTML(g.key)}">
      <h3 class="pulse-glyph-head">${escapeHTML(g.label)}</h3>
      <div class="pulse-glyph-grid">
        ${g.glyphs.map((ch) => `
        <button type="button" class="pulse-glyph" data-glyph="${escapeHTML(ch)}" aria-pressed="false"
                aria-label="${escapeHTML(`${g.label} glyph ${ch}`)}"
                onclick="_pulseSetGlyph('${escapeAttrJS(ch)}')">${escapeHTML(ch)}</button>`).join('')}
      </div>
    </section>`).join('');

  return `
    <div class="pulse-tray-head">
      <span class="pulse-tray-title">Glyphs</span>
      <span class="pulse-tray-hint">Tap to add or remove</span>
      <button type="button" class="pulse-tray-x" aria-label="Close the glyph menu"
              onclick="_pulseCloseTray()">✕</button>
    </div>
    <!-- What is on the card right now, each one removable. This row and the
         input above the grid are the two parts that survive when the platform's
         emoji keyboard is up and the grid has nowhere to be — so an emoji picked
         from that keyboard can still be taken straight back off. -->
    <div class="pulse-tray-picked" id="pulse-tray-picked" hidden></div>
    <label class="pulse-sr" for="pulse-glyph-any">Any emoji from your keyboard</label>
    <input class="pulse-input pulse-tray-any" data-tier="field" id="pulse-glyph-any" type="text"
           inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false"
           placeholder="…or any emoji from your keyboard"
           oninput="_pulseSetGlyphAny(this.value)">
    <div class="pulse-tray-scroll" id="pulse-tray-scroll">
      <div class="pulse-tray-body" id="pulse-tray-body"
           onscroll="_pulseTrayCue()">${groups}</div>
    </div>
    <div class="pulse-tray-foot">
      <button type="button" class="pulse-glyph--clear" onclick="_pulseClearGlyphs()">NO GLYPH</button>
    </div>`;
}

function paletteHtml() {
  return STATES.map((o) => `
    <button type="button" class="pulse-swatch${o.key === draft.state ? ' active' : ''}"
            data-value="${o.key}" aria-pressed="${o.key === draft.state ? 'true' : 'false'}"
            title="${escapeHTML(`${o.label} — ${o.note}`)}"
            aria-label="${escapeHTML(`${o.label}, ${o.note}`)}"
            onclick="_pulseSetState('${o.key}')"></button>`).join('');
}

function logHtml() {
  if (!logRows.length) {
    return '<div class="pulse-rail-empty">No pulses yet. The first one you post lands here.</div>';
  }
  return logRows.map((r) => `
    <button type="button" class="pulse-tile${r.live ? ' is-live' : ''}" data-seam="box" data-backlit data-tier="card"
            onclick="_pulseReuse('${escapeAttrJS(r.id)}')">
      <span class="pulse-tile-glyph" aria-hidden="true">${escapeHTML(r.glyphs || '·')}</span>
      <span class="pulse-tile-text">${escapeHTML(r.text || '')}</span>
      <span class="pulse-tile-meta">${r.live ? 'LIVE' : escapeHTML(r.localTime || '')}</span>
    </button>`).join('');
}

// The log is the only thing a post or a retire actually changes on screen, so it
// is the only thing they redraw — into BOTH hosts, the desktop rail and the
// phone sheet, since which one is showing is a media query's business and not
// this function's.
export function renderPulseLog() {
  const html = logHtml();
  for (const id of ['pulse-log', 'pulse-log-mobile']) {
    const host = $(id);
    if (host) host.innerHTML = html;
  }
  const btn = $('pulse-log-btn');
  if (btn) btn.textContent = logRows.length ? `RECENT ${logRows.length}` : 'RECENT';
}

export function renderPulse() {
  const host = $('pulse-body');
  if (!host) return;
  const pack = activePackDef();
  host.innerHTML = `
    <div class="pulse-studio">
      <nav class="pulse-lanes" id="pulse-lanes" aria-label="Starter lanes">
        <span class="pulse-lanes-label">Lanes</span>${laneChipsHtml()}
      </nav>

      <div class="pulse-canvas">
        <aside class="pulse-rail" data-seam="box" data-backlit data-tier="panel">
          <div class="pulse-rail-head">
            <span>Recent</span><span class="pulse-rail-hint">Tap to reuse</span>
          </div>
          <div class="pulse-rail-body" id="pulse-log">${logHtml()}</div>
        </aside>

        <section class="pulse-stage">
          <div class="pulse-card-slot">
            <div class="wk-card wk-pulse" id="pulse-card"
                 data-state="${escapeHTML(draft.state)}" data-tier="${currentTier()}">
              <div class="wk-p-kicker">
                <span class="wk-p-label"><span class="wk-p-led" aria-hidden="true"></span>${PULSE_LABEL}</span>
                <span class="wk-p-time">${nowLocalTime()}</span>
              </div>
              <div class="wk-p-center">
                <button type="button" class="wk-p-glyph" id="pulse-glyph-slot"
                        title="Choose a glyph" aria-label="Choose a glyph"
                        aria-expanded="false" aria-controls="pulse-tray"
                        onclick="_pulseToggleTray()">${escapeHTML(draft.glyphs.trim())}</button>
                <label class="pulse-sr" for="pulse-line">What is happening right now?</label>
                <textarea class="wk-p-text" id="pulse-line" rows="3"
                          placeholder="What is happening right now?"
                          oninput="_pulseSetField('text', this.value)">${escapeHTML(draft.text)}</textarea>
              </div>
              <div class="wk-p-foot" id="pulse-foot" hidden>
                <span class="wk-p-foot-left" id="pulse-foot-out-left"></span>
                <span class="wk-p-foot-right" id="pulse-foot-out-right"></span>
              </div>
            </div>
          </div>

          <!-- The menu, then its scrim. Tapping outside is the dismiss
               gesture a panel this size needs, and the ORDER is what turns it
               on: the stylesheet shows the scrim with an adjacent-sibling rule
               off the panel's own .open class, so it costs no class-toggling in
               the handler and cannot get out of step with the panel. It sits a
               z-index BELOW the menu, so it darkens the stage without covering
               what it is there to dismiss. -->
          <div class="pulse-tray" data-tier="panel" id="pulse-tray" role="dialog"
               aria-label="Choose a glyph">${trayHtml()}</div>
          <div class="pulse-tray-scrim" id="pulse-tray-scrim" onclick="_pulseCloseTray()"></div>
          <div class="pulse-strip" id="pulse-strip">${starterChipsHtml()}</div>

          <div class="pulse-stage-status">
            <span>Tier</span><span class="pulse-tier" id="pulse-tier">${currentTier().toUpperCase()}</span>
            <button type="button" class="pulse-log-btn" id="pulse-log-btn"
                    onclick="_pulseOpenLog()">RECENT</button>
          </div>

          <div class="pulse-palette" id="pulse-palette" role="group" aria-label="Card colour">
            ${paletteHtml()}
          </div>

          <div class="pulse-dock">
            <button class="btn btn-primary" id="pulse-post-btn" onclick="_pulsePost()">POST PULSE ▲</button>
            <button class="btn" id="pulse-retire-btn" onclick="_pulseRetire()"
                    title="Remove the pulse that is live on your site">TAKE DOWN</button>
            <button class="btn" id="pulse-reset-btn" onclick="_pulseReset()"
                    title="Empty the card you are writing — your site is untouched">RESET CARD</button>
          </div>

          <details class="pulse-more">
            <summary>Footer — free text, both optional</summary>
            <div class="pulse-foot-row">
              <input class="pulse-input" data-tier="field" id="pulse-foot-left" value="${escapeHTML(draft.footLeft)}"
                     oninput="_pulseSetField('footLeft', this.value)" placeholder="Footer left">
              <input class="pulse-input" data-tier="field" id="pulse-foot-right" value="${escapeHTML(draft.footRight)}"
                     oninput="_pulseSetField('footRight', this.value)" placeholder="Footer right">
            </div>
          </details>
        </section>

        <aside class="pulse-rail" data-seam="box" data-backlit data-tier="panel">
          <div class="pulse-rail-head">
            <span id="pulse-starters-head">${escapeHTML(pack ? `${pack.label} starters` : 'Starters')}</span>
            <span class="pulse-rail-hint">Tap to fill</span>
          </div>
          <div class="pulse-rail-body" id="pulse-starters">${starterTilesHtml()}</div>
        </aside>
      </div>
    </div>`;
  syncTrayLane();
  paintCard();
}

registerView('pulse', {
  render() {
    renderPulse();
    _pulseLoadLog().then(renderPulseLog);
  },
});
