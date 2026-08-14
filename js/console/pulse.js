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
import { PACKS, pulseFrom, trayGlyphs } from '../pulse-packs.js';

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
  syncDockState();
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
  const tray = $('pulse-tray');
  if (tray) tray.innerHTML = trayHtml();
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
  if (tray) tray.classList.toggle('open');
}

function closeTray() {
  const tray = $('pulse-tray');
  if (tray) tray.classList.remove('open');
}

export function _pulseSetGlyph(glyph) {
  const g = String(glyph || '');
  // Glyphs are a small set on one line, so appending is the whole interaction.
  draft.glyphs = draft.glyphs ? `${draft.glyphs} ${g}` : g;
  paintCard();
  closeTray();
}

export function _pulseClearGlyphs() {
  draft.glyphs = '';
  paintCard();
  closeTray();
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
    <button type="button" class="pulse-tile" onclick="_pulseApplyStarter('${escapeAttrJS(pack.key)}', ${i})">
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

// The tray follows the ACTIVE LANE rather than a config list: pick the Music
// lane and you get music glyphs. One less config key that nothing reads, and it
// makes the lane do more than seed six lines. The author can still paste any
// emoji into the line itself — the tray is a shortcut, not the vocabulary.
//
// TWELVE, from the lane's own `tray` list. The first cut derived six by mapping
// the lane's starter lines, which is tidy and was not enough to write with
// (owner, 2026-08-13). The list leads with those same six, so the tray still
// reads as belonging to the lane you tapped.
//
// Its clear button says NO GLYPH, not CLEAR: the dock below has a RESET CARD
// button, and two controls a thumb apart both saying "clear" while meaning very
// different things is how a mis-tap becomes a lost draft.
function trayHtml() {
  const glyphs = trayGlyphs(activePack);
  if (!glyphs.length) return '';
  return glyphs.map((g) => `
    <button type="button" class="pulse-glyph" onclick="_pulseSetGlyph('${escapeAttrJS(g)}')">${escapeHTML(g)}</button>`).join('')
    + '<button type="button" class="pulse-glyph pulse-glyph--clear" onclick="_pulseClearGlyphs()">NO GLYPH</button>';
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
    <button type="button" class="pulse-tile${r.live ? ' is-live' : ''}"
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
        <aside class="pulse-rail">
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

          <div class="pulse-tray" id="pulse-tray">${trayHtml()}</div>
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
              <input class="pulse-input" id="pulse-foot-left" value="${escapeHTML(draft.footLeft)}"
                     oninput="_pulseSetField('footLeft', this.value)" placeholder="Footer left">
              <input class="pulse-input" id="pulse-foot-right" value="${escapeHTML(draft.footRight)}"
                     oninput="_pulseSetField('footRight', this.value)" placeholder="Footer right">
            </div>
          </details>
        </section>

        <aside class="pulse-rail">
          <div class="pulse-rail-head">
            <span id="pulse-starters-head">${escapeHTML(pack ? `${pack.label} starters` : 'Starters')}</span>
            <span class="pulse-rail-hint">Tap to fill</span>
          </div>
          <div class="pulse-rail-body" id="pulse-starters">${starterTilesHtml()}</div>
        </aside>
      </div>
    </div>`;
  paintCard();
}

registerView('pulse', {
  render() {
    renderPulse();
    _pulseLoadLog().then(renderPulseLog);
  },
});
