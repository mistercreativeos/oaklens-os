// Pulse — the shared rules for the homepage's immediate card.
//
// Pure functions only: no D1, no fetch, no Request. src/api/pulse.js does the
// storage; this file owns the parts that must behave identically wherever they
// run and that the test suite can exercise without a Worker.
//
// NAMED PULSE, EVERYWHERE. This shipped on 2026-08-12 as "Mood" and was renamed
// whole — code, route, table, docs — on 2026-08-13, while `oaklens-os` had not
// yet received the feature and therefore no fork on earth had a `moods` table.
// A rename that stops at the visible label is cheap once and a tax on every
// reader afterwards. See docs/maintenance/2026-08-13-pulse-rename-and-studio.md.
//
// The palettes are named for FEELING, not for discipline. "darkroom" would have
// been a photographer's word on a card that also has to serve writers,
// musicians, filmmakers, podcasters and people who ship code — and a name is a
// quiet claim about who the software is for.

import siteConfig from './config.js';

// THE CARD CALLS ITSELF ONE THING, ON EVERY CARD, ON EVERY FORK.
//
// The first cut let the label be free text that defaulted to the starter pack's
// discipline — so the same feature introduced itself as PHOTOGRAPHY on one post
// and TECH / DEV on the next, and a reader landing cold could not tell what the
// tile even was. Two jobs were sharing one field: "a word the author curates"
// and "the only word identifying this card type to a stranger". The second job
// wins and the first is gone — the `kicker` column, its cap and its input were
// deleted rather than defaulted, because a default a fork can change is a
// default two forks will disagree about.
//
// ⚠️ Duplicated as a literal in js/recent-index.js, which is a classic script on
// public pages and cannot import from src/. tests/pulse-card.test.js asserts the
// two spellings agree.
export const PULSE_LABEL = 'PULSE';

// Six palettes. Each is a hue the card tints ITSELF with — the background stays
// the theme's own surface token, so the same palette reads correctly on midnight
// ink and on daylight paper. See the .wk-pulse block in css/main.css.
export const PULSE_STATES = Object.freeze(['ember', 'dawn', 'flow', 'velvet', 'tide', 'signal']);
export const DEFAULT_STATE = 'signal';   // follows the instance's accent

// Field caps. Generous enough that nobody meets them by accident, tight enough
// that a compromised console token cannot write a novel into the homepage.
// Measured in code units deliberately: this is a storage guard, not the tier
// ladder (which counts graphemes — see pulseTierLen).
export const LIMITS = Object.freeze({
  text: 280,
  glyphs: 40,
  foot_left: 40,
  foot_right: 40,
  local_time: 5,
  ambient: 400,
});

// TTL bounds. The default lives in config so an instance can run hotter or
// cooler; the clamp exists so neither a typo nor a hostile payload can pin a
// pulse to the homepage for a year. One hour to one week.
export const TTL_MIN_HOURS = 1;
export const TTL_MAX_HOURS = 168;

export function defaultTtlHours() {
  const n = Number(siteConfig.pulse && siteConfig.pulse.ttlHours);
  return Number.isFinite(n) ? clampTtlHours(n) : 18;
}

export function clampTtlHours(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return defaultTtlHours();
  return Math.min(TTL_MAX_HOURS, Math.max(TTL_MIN_HOURS, v));
}

// ---- text hygiene ----
// Control characters and newlines are stripped rather than rejected: a pulse is
// one line, and a paste from a notes app should quietly become one rather than
// bouncing with an error the author has to decode.
function oneLine(v, max) {
  return String(v == null ? '' : v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// The author's wall clock, frozen. Anything that is not HH:MM is dropped rather
// than corrected — a wrong time is worse than no time, and the card renders
// fine without one.
export function normalizeLocalTime(v) {
  const s = String(v == null ? '' : v).trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : '';
}

export function normalizeState(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return PULSE_STATES.includes(s) ? s : DEFAULT_STATE;
}

// A pulse must carry SOMETHING — a line, or a glyph, or both. An empty tile on
// the homepage is not a statement, it is a bug that looks like a decision.
export function isEmptyPulse(m) {
  return !(m && ((m.text && m.text.trim()) || (m.glyphs && m.glyphs.trim())));
}

// Body → a row ready for insert. Returns { ok, pulse } or { ok:false, error }.
// `now` is injected so the tests do not race a clock.
//
// Note what is NOT read here: `kicker`. A body carrying one is not an error, it
// is simply ignored — an old client, a replayed request or a hand-rolled curl
// cannot put a title back on the card (see PULSE_LABEL).
export function normalizePulseInput(body, now = Date.now()) {
  const b = body && typeof body === 'object' ? body : {};
  const pulse = {
    text: oneLine(b.text, LIMITS.text),
    glyphs: oneLine(b.glyphs, LIMITS.glyphs),
    state: normalizeState(b.state),
    foot_left: oneLine(b.footLeft != null ? b.footLeft : b.foot_left, LIMITS.foot_left),
    foot_right: oneLine(b.footRight != null ? b.footRight : b.foot_right, LIMITS.foot_right),
    local_time: normalizeLocalTime(b.localTime != null ? b.localTime : b.local_time),
  };
  if (isEmptyPulse(pulse)) return { ok: false, error: 'a pulse needs a line or a glyph' };

  const hours = b.ttlHours == null ? defaultTtlHours() : clampTtlHours(b.ttlHours);
  pulse.posted_at = now;
  pulse.expires_at = now + Math.round(hours * 3600 * 1000);

  // Ambient (weather at post time) is optional and opaque — stored for the log,
  // never rendered. Anything unserializable is dropped rather than failing the
  // post: the pulse is the point, the stamp is a nicety.
  pulse.ambient = null;
  if (b.ambient && typeof b.ambient === 'object') {
    try {
      const s = JSON.stringify(b.ambient);
      if (s.length <= LIMITS.ambient) pulse.ambient = s;
    } catch { /* not serializable — drop it */ }
  }
  return { ok: true, pulse };
}

// A D1 row → the shape the browser reads. camelCase out, snake_case in the
// database, and `ambient` deliberately NOT exposed on the public read.
export function pulseToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    text: row.text || '',
    glyphs: row.glyphs || '',
    state: normalizeState(row.state),
    footLeft: row.foot_left || '',
    footRight: row.foot_right || '',
    localTime: row.local_time || '',
    postedAt: Number(row.posted_at) || 0,
    expiresAt: Number(row.expires_at) || 0,
  };
}

// ---- the tier ladder ----
//
// Pulses reuse the TEXT CARD's three tiers (statement / feature / standard) —
// see recentTier() in js/recent-index.js. One ladder, one vocabulary, both card
// types: a second four-name ladder for pulses would have meant two systems to
// keep in sync on a single grid.
//
// The one difference is the unit. String.length counts UTF-16 code units, so
// "シルエット 日暮れ" and an emoji-heavy line both over-count and tier too small.
// Intl.Segmenter counts what a reader would call a character. Exported here so
// the browser and the tests agree; recent-index.js uses the same rule.
export function pulseTierLen(text) {
  const s = String(text == null ? '' : text);
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    let n = 0;
    for (const _ of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)) n += 1;
    return n;
  }
  return Array.from(s).length;   // still better than .length on astral planes
}
