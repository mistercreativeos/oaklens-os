// OAKLENS Field Console — the Bridge.
//
// The console's front page: what is waiting on you, what your site says right
// now, and where you were. It is not the sidebar again — a total ("842
// frames") does not change from one day to the next, so it is not something
// to glance at. Big type here is reserved for STATE and CHANGE: what is live,
// what is waiting, what just happened. (docs/ideas/bridge.md)
//
// Two rules hold it together:
//
//   · TYPE, NOT PANELS. No boxes, no cards. Five type roles, each with one
//     fixed meaning, so a stat's shape says what kind of thing it is before
//     it is read: HEADLINE (one per screen, the state right now), FIGURE (a
//     number that is live or just moved), LINE (something you can do — a
//     verb, tappable), LABEL (what a figure is), WHISPER (context and age,
//     never an instruction). The accent means "needs you" and nothing else.
//     The roles are tokens on :root (`--type-*`), and every preset sets them
//     in its own faces. Every piece of text also has a TEXT CLASS —
//     `data-text` = stat | act | live | info — and the class alone decides
//     whether it gives light (css/field-console.css, TYPE). Nothing here
//     lights text by hand: the regions write through the type kit below,
//     and the one moment of light that is the page's own (the update, when
//     something goes live) is `_announce()`.
//
//   · NO OPINIONS. No streaks, no goals, no "you have not posted in 4 days"
//     (docs/ideas/pulse-graph.md §7). The Bridge says what happened; it never
//     grades it. "Nothing waiting" is the best thing it can say, and it says
//     it plainly.
//
// Everything here is read from what the console already holds or already
// asks for: STATE, the stage ledger, the upload queue, the cloud drafts, the
// homepage's own selection logic (cards.js), the pulse log, /api/version. It
// renders at once from local state and lets the live reads fill in.
//
// INTAKE: the console's standard bay, a strip under the pulse (tap it for the picker), and
// the whole page takes a drop too. While files are over the page the bay
// lights, the headline says where they are going ("3 PHOTOS → BUFFER · 1 WAV
// → AUDIO") and the destinations' sidebar rows light; on the drop each file
// goes to the surface that owns its kind (routeOf). A pasted image goes to the
// Buffer, pasted text to the pulse line.

import { STATE, STORAGE_KEY, totalStaged } from '../console-state.js';
import { isLoggedIn, fetchVersion, fetchPulseLog, fetchBench, fetchStorage, remeasureStorage } from '../console-api.js';
import { toast, escapeHTML, escapeAttrJS, registerView, showView, wireDropzone, bayHeat, ignitionTime, ignitionLevel, bezier, easeToken } from './chrome.js';
import { paintHTML, ymd, uid } from './utils.js';
import { logEvent } from '../console-telemetry.js';
import { _failedUploads, _requeueNetFailedUploads } from './upload.js';
import { bufferIngest } from './buffer.js';
import { libraryIngest } from './more-views.js';
import { audioAddFiles, podcastBlockersOpen } from './audio.js';
import { fnUpsertDraft } from './fn-editor.js';
import { cardsLiveInputs, _cardSlots, _stagedInputs, _diffSlots, cardsSelectSlot } from './cards.js';
import { lastPublish } from './publish.js';
import { pulsePostLine, _pulseRetire } from './pulse.js';
import { checkAuth } from './session.js';
import { matrixSVG } from './matrix.js';
import { sweep } from './text-light.js';
import { flapTo } from './flap.js';
import { latestAddressable } from './send-out.js';

const $ = (id) => document.getElementById(id);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const MAX_LINES = 5;
// How often the live facts are read with nothing in flight (K69). Each read
// is eleven Worker requests (run_worker_first: the data files too); at 45 s
// that was ~900 an hour for a page left open, and nothing on it moves that
// fast unless this device just published or pulsed, which read at once
// anyway. A build in flight reads every 8 s (_buildPoll); coming back to the
// page, or the signal returning, reads at once when this is past.
const LIVE_TTL = 5 * 60_000;
// The Bridge's reads are readouts: a short deadline, one retry, and the last
// value stays on the page meanwhile. Not 20 s × 3 behind an amber lamp.
const READ_OPTS = { timeoutMs: 8_000, retries: 1 };
const BUILD_WINDOW = 15 * MIN;      // past this, "building" is a stale claim
const RESUME_KEY = 'oaklens_bridge_resume';

// STATE's surface keys are not always view names.
const VIEW_OF = { wallpapers: 'wall', posts: 'fn', friends: 'friends' };
const viewOf = (surface) => VIEW_OF[surface] || surface;

// ---- small readers ----

function navLabel(view) {
  const src = document.querySelector(`.nav-btn[data-view="${view}"], .sheet-item[data-view="${view}"], .tab-btn[data-view="${view}"]`);
  if (!src) return view;
  const c = src.cloneNode(true);
  c.querySelectorAll('.nav-icon, .nav-count, .nav-stage-pip, .sheet-icon, .sheet-count, .tab-icon, .tab-count, .tab-badge, .settings-status-dot')
    .forEach((n) => n.remove());
  return c.textContent.replace(/\s+/g, ' ').trim() || view;
}

/** "just now" · "14 min ago" · "3 h ago" · "yesterday" · "4 days ago" · "12 Sep". */
export function ago(ms, now = Date.now()) {
  const d = now - ms;
  if (!Number.isFinite(d) || d < 0) return '';
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  if (d < 2 * DAY) return 'yesterday';
  if (d < 7 * DAY) return `${Math.floor(d / DAY)} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Time left, for a figure: "6h 12m", "42m", "<1m". */
export function left(ms) {
  if (!(ms > 0)) return '0m';
  const h = Math.floor(ms / HOUR), m = Math.floor((ms % HOUR) / MIN);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return m ? `${m}m` : '<1m';
}

const words = (text) => (String(text || '').match(/\S+/g) || []).length;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const dateOf = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; };

// ---- the type kit ----
//
// The one place the Bridge writes type. A region says WHAT it has (a figure,
// a label, a line you can tap, a whisper of context) and the kit gives it its
// role (the CSS class: size and ink) and its text class (`data-text`: whether
// it gives light). A region that paints through these cannot forget to
// classify its text, and a new instrument is these calls and nothing else.
// Arguments are HTML: the caller escapes what it did not write.
//
//   stat  a measured number set as a figure            lit
//   act   its job is to be tapped                      a legend; lit under a hand
//   live  it reports the state of the site right now   low
//   info  it names, explains or gives context          flat
const say = {
  /** A measured number: always a stat. */
  figure: (html) => `<div class="br-figure" data-text="stat">${html}</div>`,
  /** What a figure is: always info. */
  label: (html) => `<div class="br-label" data-text="info">${html}</div>`,
  /** Context or age (info), or a readout of the site's state (live). */
  meta: (html, cls = 'info', mod = '') => `<div class="br-meta${mod}" data-text="${cls}">${html}</div>`,
  /** A verb you can tap: always an act. `handler` is the whole attribute,
   *  `onclick="…"`, written out at the call so the handler guard can read it
   *  (tests/inline-handlers.test.js). */
  line: (html, handler, mod = '') => `<button type="button" class="br-line${mod}" data-text="act" ${handler}>${html}</button>`,
};
const ARROW = ' <span aria-hidden="true">→</span>';
/** The kit, for a region painted from its own module (registerBridgeRegion). */
export const bridgeKit = Object.freeze({ say, ARROW });

// ---- regions from other modules (K65) ----
//
// A part of the Bridge that lives in its own module (the spark, the frame
// shelf) registers here and is painted with the rest: after the built-in
// painters, in registration order, on every paint, and fitted with the lists
// when it names one (`fit`: the id of an <ol> that shows what fits, as
// `_bridgeFit` does). Its markup is the Bridge's, and its type goes through
// the kit, so every word it paints has a text class like the rest. A region
// that throws is logged and skipped, never allowed to blank the page.
const _regions = [];
export function registerBridgeRegion({ id, paint, fit = '' }) {
  if (!id || typeof paint !== 'function' || _regions.some((r) => r.id === id)) return;
  _regions.push({ id, paint, fit });
}

// ---- where files go ----
//
// One table for the drop, the paste and the ADD FILES picker. The surfaces own
// their own ingest (RAW through the RAW LENS, the duplicate guard, the upload
// queue); this only decides which one a file belongs to.
const RAW_EXT = /\.(dng|cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|srw|x3f|3fr|iiq)$/i;
export function routeOf(file) {
  const name = (file && file.name) || '';
  const type = (file && file.type) || '';
  if (/\.(md|markdown)$/i.test(name) || type === 'text/markdown') return 'fn';
  if (type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|oga|aif|aiff)$/i.test(name)) return 'audio';
  if (type === 'video/mp4' || type === 'video/webm' || /\.(mp4|webm)$/i.test(name)) return 'library';
  if (type.startsWith('image/') || RAW_EXT.test(name)) return 'buffer';
  return null;
}

// While a drag is in flight only MIME types are visible, never names — so the
// preview names what it can ("1 WAV") and admits what it cannot ("2 FILES").
const NOUN = { buffer: ['PHOTO', 'PHOTOS'], audio: ['TRACK', 'TRACKS'], library: ['VIDEO', 'VIDEOS'], fn: ['NOTE', 'NOTES'] };
const AUDIO_KIND = {
  'audio/wav': 'WAV', 'audio/x-wav': 'WAV', 'audio/wave': 'WAV', 'audio/mpeg': 'MP3', 'audio/mp3': 'MP3',
  'audio/mp4': 'M4A', 'audio/x-m4a': 'M4A', 'audio/aac': 'AAC', 'audio/flac': 'FLAC', 'audio/x-flac': 'FLAC',
  'audio/ogg': 'OGG', 'audio/aiff': 'AIFF', 'audio/x-aiff': 'AIFF',
};
export function routePreview(items) {
  const groups = new Map();
  let unknown = 0;
  for (const it of items) {
    if (it.kind && it.kind !== 'file') continue;
    const type = it.type || '';
    const dest = routeOf({ name: '', type });
    if (!dest) { unknown++; continue; }
    const sub = dest === 'audio' ? (AUDIO_KIND[type] || '') : '';
    const key = dest + '|' + sub;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const parts = [];
  for (const [key, n] of groups) {
    const [dest, sub] = key.split('|');
    const noun = sub && n === 1 ? sub : NOUN[dest][n === 1 ? 0 : 1];
    parts.push(`${n} ${noun} → ${navLabel(dest).toUpperCase()}`);
  }
  if (unknown) parts.push(`${unknown} FILE${unknown === 1 ? '' : 'S'} → SORTED ON DROP`);
  return { text: parts.join(' · '), dests: [...new Set([...groups.keys()].map((k) => k.split('|')[0]))] };
}

// A dropped .md becomes a draft through the draft store (K65), without
// touching the editor: it used to go through fnNewPost() and the editor's
// fields, which silently swapped out whatever note was open there.
async function _mdToDraft(file) {
  const text = await file.text();
  const heading = text.match(/^#\s+(.+)$/m);
  const title = (heading ? heading[1] : file.name.replace(/\.(md|markdown)$/i, '')).trim();
  const body = heading ? text.replace(heading[0], '').replace(/^\s*\n/, '') : text;
  fnUpsertDraft(uid(), { title: title || 'Untitled', body });
  return title;
}

export async function routeFiles(files) {
  const by = { buffer: [], audio: [], library: [], fn: [] };
  const stray = [];
  for (const f of files) (by[routeOf(f)] || stray).push(f);
  if (by.buffer.length) await bufferIngest(by.buffer);
  if (by.audio.length) await audioAddFiles(by.audio);
  if (by.library.length) await libraryIngest(by.library);
  for (const f of by.fn) {
    const title = await _mdToDraft(f);
    toast(`✓ “${title}” is a draft in ${navLabel('fn')}`, 'success');
  }
  if (stray.length) {
    toast(`${plural(stray.length, 'file')} not placed — ${stray.map((f) => f.name).slice(0, 3).join(', ')}. Drop it on the surface it belongs to.`, 'warn');
  }
  renderBridge();
}

// ---- the live facts ----
//
// INSTANT, THEN TRUE. The page paints at once from what this device already
// knows (STATE, and the last live facts it saw, kept per device under
// LIVE_KEY), and then each live read lands on the page the moment it answers.
// No fact waits for another: the storage figure does not sit behind a slow
// pulse log. Each is allowed to fail. A missing fact leaves its line out, or
// keeps the last one seen with its own age showing, and never reads as a
// false all-clear.
//
// FAILING LOUDLY (K68). Each fact records whether its last read answered
// (`<fact>Read`: 'ok' | 'failed') and when it last did (`seen`). A fact whose
// read failed is still shown, as the last thing seen, and says so: "LAST SEEN
// LIVE 12:04", "as of 12:04 · couldn't reach the live site", "unconfirmed".
// Before this, an offline Bridge listed the engine's sample frames as the
// front page and "Nothing live" over a live pulse (the field probe,
// docs/maintenance/2026-10-06-bridge-field-probe.md).
//
// When to read: on arrival (and on coming back to a hidden page) when the
// last read is older than LIVE_TTL, while a build is in flight, when the
// signal returns, and at once when signing in or out has changed what can
// be read. A hidden page reads nothing and keeps no timers. That last one is not a nicety: the signed-out read at boot used to
// hold storage back for a whole TTL after the owner signed in (47 s, measured
// 2026-10-06). Returns the read, so a caller that needs the fresh facts on
// the page (the update after a SEND) can wait for them; a forced read during
// another waits for it, then reads again.
const LIVE_KEY = 'oaklens_bridge_live';
const _live = {
  at: 0, signedIn: null,
  slots: null, frontPulse: null, frontRead: '',          // the homepage, as slots
  pulse: undefined, pulseFromLog: false, lastPulseAt: 0, pulseRead: '',
  version: null, versionRead: '', benchQueued: 0, benchRead: '', storage: null, storageRead: '',
  seen: {},   // when each fact last read good: { front, pulse, version, bench, storage }
};
let _reading = null;

function _readLive(force = false) {
  if (_reading) return force ? _reading.then(() => _readLive(true)) : _reading;
  const session = _live.signedIn !== isLoggedIn();
  if (!force && !session && Date.now() - _live.at < LIVE_TTL) return Promise.resolve();
  _reading = _read().finally(() => { _reading = null; });
  return _reading;
}

// A slot, as much of it as the page draws and the diff compares: small enough
// to keep on the device, which the full slot (it carries its record) is not.
const _slim = (s) => s && { key: s.key, kind: s.kind || '', kicker: s.kicker || '', title: s.title || '', thumb: s.thumb || '' };

function _read() {
  const signedIn = isLoggedIn();
  _live.signedIn = signedIn;
  _live.at = Date.now();
  _live.pulseFromLog = false;
  let pulseOk = false;
  const good = (fact) => { _live[fact + 'Read'] = 'ok'; _live.seen[fact] = Date.now(); };
  // Each fact lands on its own: take it, keep it, paint on the next frame. A
  // read that throws marks its fact failed; the last value seen stays.
  const land = (read, take, fact) => read
    .then(take)
    .catch(() => { _live[fact + 'Read'] = 'failed'; })
    .then(() => { _remember(); _soon(); });
  const reads = [
    land(cardsLiveInputs(), (front) => {
      const failed = (front && front.failed) || [];
      // The public pulse, when its own read answered. Signed out it is the
      // best pulse there is; the authed log, when it lands, is uncached and
      // says which row is live.
      if (front && !failed.includes('/api/pulse')) {
        _live.frontPulse = front.pulse || null;
        if (!_live.pulseFromLog) _live.pulse = _recallPulse(front.pulse);
        pulseOk = true;
        _live.seen.pulse = Date.now();
      }
      // A source that could not be read is filled with the engine's samples
      // (withSampleFallback): drawn as the front page, that is an invention.
      // Any failure keeps the last good slots and says so instead.
      if (!front || failed.length) { _live.frontRead = 'failed'; return; }
      _live.slots = _cardSlots(front).map(_slim);
      good('front');
    }, 'front'),
    land(fetchVersion(READ_OPTS), (v) => {
      if (!v || !v.version) throw new Error('no version');
      _live.version = v;
      good('version');
    }, 'version'),
  ];
  if (signedIn) {
    reads.push(land(fetchPulseLog(3, READ_OPTS), (log) => {
      // A fork whose D1 has no log yet answers without one: the public read decides.
      if (!log || !Array.isArray(log.pulses)) return;
      _live.pulse = log.pulses.find((p) => p.live) || null;
      _live.pulseFromLog = true;
      pulseOk = true;
      _live.seen.pulse = Date.now();
      _live.lastPulseAt = Math.max(0, ...log.pulses.map((p) => Number(p.postedAt) || 0));
    }, 'pulseLog'));
    reads.push(land(fetchStorage(READ_OPTS), (st) => {
      if (!st || !st.ok) throw new Error('no storage');
      _live.storage = st;
      good('storage');
    }, 'storage'));
    if ($('view-bench')) {
      reads.push(land(fetchBench(READ_OPTS), (b) => {
        if (!Array.isArray(b)) throw new Error('no bench');
        _live.benchQueued = b.filter((e) => e && e.status === 'queued').length;
        good('bench');
      }, 'bench'));
    }
  }
  // The pulse is known when either read of it answered this round.
  return Promise.all(reads).then(() => { _live.pulseRead = pulseOk ? 'ok' : 'failed'; _remember(); _soon(); });
}

// The last facts seen, so the next open paints whole at once. Per device,
// like the start view; what only a session can read is painted only with one.
function _remember() {
  try {
    localStorage.setItem(LIVE_KEY, JSON.stringify({
      slots: _live.slots, frontPulse: _live.frontPulse, pulse: _live.pulse ?? null,
      lastPulseAt: _live.lastPulseAt, version: _live.version,
      benchQueued: _live.benchQueued, storage: _live.storage, seen: _live.seen,
    }));
  } catch {}
}
// What was kept is read as untrusted: one malformed value (a hand edit, an
// older shape) used to throw inside a painter and take the rest of the page
// with it. Anything that is not the shape it should be is dropped.
const _str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
export function _recallSlot(s) {
  return _obj(s) && { key: _str(s.key), kind: _str(s.kind), kicker: _str(s.kicker), title: _str(s.title), thumb: _str(s.thumb) };
}
function _recallPulse(p) {
  p = _obj(p);
  return p && Number.isFinite(Number(p.expiresAt)) ? { ...p, text: _str(p.text), glyphs: _str(p.glyphs), expiresAt: Number(p.expiresAt) } : null;
}
function _recall() {
  try {
    const v = _obj(JSON.parse(localStorage.getItem(LIVE_KEY) || 'null'));
    if (!v) return;
    if (Array.isArray(v.slots)) _live.slots = v.slots.map(_recallSlot);
    _live.frontPulse = _recallPulse(v.frontPulse);
    _live.pulse = _recallPulse(v.pulse);
    _live.lastPulseAt = Number(v.lastPulseAt) || 0;
    const ver = _obj(v.version);
    _live.version = ver && typeof ver.version === 'string' && dateOf(ver.deployed) ? ver : null;
    _live.benchQueued = Math.max(0, Number(v.benchQueued) || 0);
    const st = _obj(v.storage);
    _live.storage = st && st.ok && _obj(st.r2) && Number.isFinite(st.r2.bytes) ? st : null;
    const seen = _obj(v.seen) || {};
    _live.seen = Object.fromEntries(Object.entries(seen).filter(([, t]) => Number.isFinite(t)));
  } catch {}
}
_recall();

// One repaint per frame, however many facts or saves land in it.
let _frame = 0;
function _soon() {
  if (_frame) return;
  const paint = () => { _frame = 0; if (_isUp()) renderBridge(); };
  _frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(paint) : setTimeout(paint, 16);
}

function _deploy(now = Date.now()) {
  const pub = lastPublish();
  const deployed = _live.version ? dateOf(_live.version.deployed) : 0;
  const building = !!(pub && pub.connected && now - pub.at < BUILD_WINDOW && deployed < pub.at);
  return { pub, deployed, building };
}

// ---- the update ----
//
// When something reaches the live site from here (a pulse goes out, or a
// publish from this device finishes deploying) the light runs through the
// header's readouts in reading order, word by word and figure by figure
// (text-light.js sweep()). The owner, on the iPad: hitting SEND "should
// 'pulse' light through the header text". It is the page's one moment of
// its own light, and it is always an answer to something, never ambient.
function _announce() { sweep($('br-top')); }
let _wasBuilding = false, _landed = false;

// ---- what is waiting ----

function _drafts() {
  // A spark (K66) is the capture row's, not a draft waiting to be finished.
  return (STATE.posts || [])
    .filter((p) => p && p.status === 'draft' && p.kind !== 'spark' && String(p.body || '').trim())
    .map((p) => ({ p, at: Math.max(Number(p._cloud_updated) || 0, dateOf(p.added_at)) }))
    .sort((a, b) => b.at - a.at);
}

function _newestRoll(now = Date.now()) {
  // Only a frame from the last few days can make the roll, so only those
  // are dated (K69: every frame's day, every paint, was the page's hottest
  // code at rest). An undated frame is no roll's: as "NaN-NaN-NaN" it used to
  // sort newest and hide the line.
  const since = now - 4 * DAY;
  const days = new Map();
  for (const f of STATE.buffer || []) {
    if (!f || f.dark) continue;
    const t = dateOf(f.captured_at || f.published_at);
    if (!t || t < since) continue;
    const day = ymd(t);
    days.set(day, (days.get(day) || 0) + 1);
  }
  const newest = [...days.keys()].sort().pop();
  if (!newest) return null;
  const at = dateOf(newest + 'T12:00:00');
  if (now - at > 3 * DAY) return null;
  return { day: newest, n: days.get(newest), at };
}

/** Ranked by what it costs to ignore. Each row: { verb, whisper, act, needs }. */
export function waitingLines(now = Date.now()) {
  const lines = [];
  if (!isLoggedIn()) {
    lines.push({ verb: 'Sign in', whisper: 'publishing, drafts and pulses need it', act: 'signin', needs: true });
  }
  const failed = _failedUploads();
  if (failed.length) {
    const where = [...new Set(failed.map((f) => navLabel(viewOf(f.surface))))].join(', ');
    lines.push({ verb: `Retry ${plural(failed.length, 'upload')}`, whisper: where, act: 'retry', needs: true });
  }
  const staged = totalStaged();
  if (staged) {
    const log = STATE.stagedLog || [];
    const oldest = log.length ? Math.min(...log.map((r) => r.ts || now)) : 0;
    const where = [...new Set(log.map((r) => navLabel(viewOf(r.surface))))].slice(0, 3).join(', ');
    lines.push({ verb: `Review ${plural(staged, 'edit')}`, whisper: [oldest ? `oldest ${ago(oldest, now)}` : '', where].filter(Boolean).join(' · '), act: 'publish', needs: true });
  }
  for (const { p, at } of _drafts().slice(0, 2)) {
    const title = (p.title || 'Untitled').trim();
    lines.push({ verb: `Finish “${title}”`, whisper: `${words(p.body).toLocaleString()} word${words(p.body) === 1 ? '' : 's'}${at ? ' · edited ' + ago(at, now) : ''}`, act: 'draft:' + p.id });
  }
  const blockers = podcastBlockersOpen();
  if (blockers) lines.push({ verb: 'Finish the podcast feed', whisper: `${plural(blockers, 'thing')} a listing needs`, act: 'podcast' });
  const queued = isLoggedIn() ? _live.benchQueued : 0;
  if (queued) {
    const stale = _live.benchRead === 'failed' && _live.seen.bench ? ` · as of ${asOf(_live.seen.bench, now)}` : '';
    lines.push({ verb: 'Work the bench', whisper: `${plural(queued, 'RAW')} queued${stale}`, act: 'bench' });
  }
  const roll = _newestRoll(now);
  if (roll) {
    const when = roll.day === ymd(new Date(now)) ? 'today' : new Date(roll.at).toLocaleDateString(undefined, { weekday: 'long' });
    lines.push({ verb: 'Open the latest roll', whisper: `${when} · ${plural(roll.n, 'frame')}`, act: 'buffer' });
  }
  return lines.slice(0, MAX_LINES);
}

// What the edits waiting are, under the headline's count: "5 frames ·
// 2 notes" (K64 — the owner: the flip to the staged state should keep
// "that same visceral clarity"). The count is the headline's; this says
// what it counts. The Library never publishes, so it is never here.
const STAGED_NOUN = {
  buffer: ['frame', 'frames'], archive: ['archive photo', 'archive photos'], posts: ['note', 'notes'],
  audio: ['track', 'tracks'], audioSets: ['set', 'sets'], wallpapers: ['wallpaper', 'wallpapers'],
  friends: ['link', 'links'], cards: ['card', 'cards'],
};
export function stagedBreakdown(staged = STATE.staged) {
  const parts = Object.entries(staged || {})
    .filter(([s, n]) => STAGED_NOUN[s] && n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${n} ${STAGED_NOUN[s][n === 1 ? 0 : 1]}`);
  return parts.length > 3 ? [...parts.slice(0, 3), `${parts.length - 3} more`].join(' · ') : parts.join(' · ');
}

/** The one state that leads the page. */
export function headlineOf({ loggedIn, failed, building, staged }) {
  if (!loggedIn) return { text: 'SIGNED OUT', needs: true };
  if (failed) return { text: `${failed} UPLOAD${failed === 1 ? '' : 'S'} FAILED`, needs: true };
  if (building) return { text: 'GOING LIVE' };
  if (staged) return { text: `${staged} EDIT${staged === 1 ? '' : 'S'} WAITING`, needs: true };
  return { text: 'NOTHING WAITING', calm: true };
}

// ---- resume ----
//
// The last surface you worked on and when you left it — per device, like the
// start view. Kept here rather than in the router: the router remembers the
// last view for "open to last used"; this remembers the last WORK, which is
// never the Bridge itself.
function _readResume() {
  try { return JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); } catch { return null; }
}
function _writeResume(v) {
  try { localStorage.setItem(RESUME_KEY, JSON.stringify(v)); } catch {}
}
let _wired = false;
export function bridgeWire() {
  if (_wired) return;
  _wired = true;
  document.addEventListener('console-arrive', (e) => {
    const view = e.target && e.target.id ? e.target.id.replace(/^view-/, '') : '';
    if (!view) return;
    if (view === 'bridge') {
      const r = _readResume();
      if (r && !r.left) _writeResume({ ...r, left: Date.now() });
    } else {
      _writeResume({ view, at: Date.now(), left: 0 });
    }
  });
  const away = () => {
    const r = _readResume();
    if (r && !_isUp() && document.querySelector(`#view-${r.view}.active`)) _writeResume({ ...r, left: Date.now() });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { away(); _rest(); }
    else if (_isUp()) renderBridge();   // the clock catches up; a stale read goes out
  });
  window.addEventListener('online', () => { if (_isUp() && !document.hidden) _readLive(true); });
  // Losing the signal re-asks at once too: the reads fail without touching
  // the radio, and every fact says so now rather than at the next read, up
  // to five minutes away (K70 — found by the probe's offline check).
  window.addEventListener('offline', () => { if (_isUp() && !document.hidden) _readLive(true); });
  window.addEventListener('pagehide', away);
  // Whatever the console saves (a sync landing, a draft, a staged edit, an
  // upload settling) is something the Bridge may say, so it repaints on the
  // next frame, not at its next tick. It used to wait for the tick: a synced
  // draft reached the page 15.5 s after it arrived (measured 2026-10-06).
  document.addEventListener('console-saved', _soon);
  // The surface re-fits its lists when the pane changes size (a rotation, a
  // window drag, the sidebar folding).
  if (typeof ResizeObserver === 'function') {
    let pending = 0;
    const ro = new ResizeObserver(() => {
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = 0; if (_isUp()) _fitLists(); });
    });
    for (const id of _fitIds()) { const el = $(id); if (el) ro.observe(el); }
  }

  const view = $('view-bridge');
  if (!view) return;
  // The bay: the console's own wiring (the picker, its light, a drop on it).
  // A key opens the picker too, since the bay is the page's one control for
  // adding.
  wireDropzone('br-dropzone', 'br-add-input', routeFiles);
  $('br-dropzone')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('br-add-input')?.click(); }
  });
  // The page is the drop target as well, and the bay stays lit for as long
  // as files are anywhere over it (its own wiring lets go when they leave
  // the bay, so the page heats it again; heating a hot bay does nothing).
  let depth = 0;
  view.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || ![...(e.dataTransfer.types || [])].includes('Files')) return;
    e.preventDefault();
    if (depth++ === 0) _dragStart(e.dataTransfer.items || []);
  });
  view.addEventListener('dragover', (e) => {
    if (!depth) return;
    e.preventDefault();
    const bay = $('br-dropzone');
    if (bay) bayHeat(bay, true);
  });
  view.addEventListener('dragleave', () => { if (depth && --depth === 0) _dragEnd(); });
  view.addEventListener('drop', (e) => {
    if (!depth) return;
    e.preventDefault();
    depth = 0;
    _dragEnd();
    // A drop on the bay is the bay's (wireDropzone): routing it here too
    // would add every file twice.
    if (e.target?.closest?.('#br-dropzone')) return;
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) routeFiles(files);
  });
  document.addEventListener('paste', (e) => {
    if (!_isUp()) return;
    const t = e.target;
    if (t && (t.closest?.('input, textarea, [contenteditable="true"]'))) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); routeFiles(files); return; }
    // Pasted words go to the spark, which is private (K66), not to the pulse
    // line, which is public the moment it is sent.
    const text = e.clipboardData?.getData('text/plain');
    const spark = $('br-spark');
    if (text && spark) {
      e.preventDefault();
      spark.value = spark.value ? `${spark.value.replace(/\s*$/, '')}\n${text.trim()}` : text.trim();
      spark.focus();
      spark.setSelectionRange(spark.value.length, spark.value.length);
      spark.dispatchEvent(new Event('input'));
    }
  });
}

let _drag = null, _litRows = [];
function _dragStart(items) {
  _drag = routePreview([...items]);
  for (const dest of _drag.dests) {
    const row = document.querySelector(`.nav-btn[data-view="${dest}"]:not([data-lit])`);
    if (row) { row.setAttribute('data-lit', 'accent'); _litRows.push(row); }
  }
  _paintHead();
}
function _dragEnd() {
  _drag = null;
  const bay = $('br-dropzone');
  if (bay) bayHeat(bay, false);
  _litRows.forEach((r) => { if (!r.classList.contains('active')) r.removeAttribute('data-lit'); });
  _litRows = [];
  _paintHead();
}

// ---- actions (inline handlers; the window bridge carries them) ----

export function bridgeAct(act) {
  if (act === 'signin') return checkAuth();
  if (act === 'publish') return showView('publish');
  if (act === 'retry') {
    if (_requeueNetFailedUploads()) return;
    const first = _failedUploads()[0];
    return first ? showView(viewOf(first.surface)) : undefined;
  }
  if (act === 'podcast') {
    showView('audio');
    return $('audio-feed-card')?.scrollIntoView({ block: 'center' });
  }
  if (act === 'bench' || act === 'buffer') return showView(act);
  if (act.startsWith('draft:')) return showView('fn', { load: act.slice(6) });
}

export function bridgeResume() {
  const r = _readResume();
  if (r && $('view-' + r.view)) showView(r.view);
}

export function bridgeOpenSlot(i) {
  showView('cards');
  cardsSelectSlot(i);
}

export async function bridgeSay(event) {
  event?.preventDefault?.();
  const input = $('br-say-input');
  if (!input) return;
  const ok = await pulsePostLine(input.value);
  if (!ok) return;
  input.value = '';
  // The new pulse and "0 days" paint first, then the light runs through them.
  await _readLive(true);
  renderBridge();
  _announce();
}

export async function bridgeTakeDown() {
  await _pulseRetire();
  _readLive(true);
}

// ---- the clock: a dot-matrix readout ----
//
// The one element on the page in its own colour (a vacuum-fluorescent teal,
// the colour instrument clocks have always been), and the one drawn rather
// than set: js/console/matrix.js, a part any surface can use.
const DAYS3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const two = (n) => String(n).padStart(2, '0');
/** When a fact was last seen: "12:04" today, else "yesterday", "3 days ago". */
export function asOf(t, now = Date.now()) {
  if (!t) return '';
  const d = new Date(t);
  return new Date(now).toDateString() === d.toDateString() ? `${two(d.getHours())}:${two(d.getMinutes())}` : ago(t, now);
}

// ---- days since the last thing went live ----
//
// The factory board's number ("days since…"), and nothing more: no target,
// no colour change as it grows. "Live" means on main — the synced copies
// (`_imported`) — plus the pulse log, which never touches main.
const KIND = { buffer: 'Frames', archive: 'Archive', posts: 'Field note', audio: 'Track', wallpapers: 'Wallpaper' };
export function lastLive(state = STATE, pulseAt = 0) {
  const at = (s, e) => {
    if (s === 'buffer') return dateOf(e.published_at || e.added_at);
    if (s === 'posts') return dateOf(e.added_at || e.date);
    return dateOf(e.added_at);
  };
  let best = null;
  for (const s of Object.keys(KIND)) {
    const all = (state[s] || []).filter((e) => e && !e.dark && !e.retired && (s !== 'posts' || e.status !== 'draft'));
    const live = all.some((e) => e._imported) ? all.filter((e) => e._imported) : all;
    for (const e of live) {
      const t = at(s, e);
      if (t && (!best || t > best.at)) best = { at: t, what: KIND[s], title: e.title || e.name || '' };
    }
  }
  if (pulseAt && (!best || pulseAt > best.at)) best = { at: pulseAt, what: 'Pulse', title: '' };
  return best;
}
export function daysSince(at, now = Date.now()) {
  const d0 = new Date(at); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(now); d1.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((d1 - d0) / DAY));
}

// ---- painting ----

function _isUp() { return !!document.querySelector('#view-bridge.active'); }

function _paintClock(now) {
  const d = new Date(now);
  const text = `${DAYS3[d.getDay()]} ${two(d.getDate())} ${MONTHS3[d.getMonth()]} · ${two(d.getHours())}:${two(d.getMinutes())}`;
  const el = $('br-clock');
  if (el && el.dataset.text !== text) {
    el.dataset.text = text;
    el.innerHTML = matrixSVG(text, d.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }));
  }
}

function _paintHead() {
  const el = $('br-headline');
  if (!el) return;
  const failed = _failedUploads().length;
  const h = _drag
    ? { text: _drag.text || 'DROP TO ADD', hot: true }
    : headlineOf({ loggedIn: isLoggedIn(), failed, building: _deploy().building, staged: totalStaged() });
  // Word by word, each a live readout, so the update's light travels through
  // the headline instead of flashing it whole. A change of state turns like a
  // split-flap board, only the letters that changed (K64, js/console/flap.js);
  // the drag's route preview comes and goes with a hand, so it is set, not
  // turned. Rewritten only when the words change, because a rewrite would put
  // out a flare in flight.
  const animate = !h.hot && !el.classList.contains('is-hot');
  flapTo(el, h.text, { wordAttrs: 'data-text="live"', animate });
  const said = $('br-said');
  if (said && said.textContent !== h.text) said.textContent = h.text;
  el.classList.toggle('is-needs', !!h.needs);
  el.classList.toggle('is-hot', !!h.hot);
  el.classList.toggle('is-calm', !!h.calm);
}

// The status: is the site live (under storage, K85: the owner, "let's move
// this neatly underneath the storage section … remove the smd chip"), and
// how full is this browser (the mast).
function _paintStatus(now) {
  const { pub, deployed, building } = _deploy(now);
  let live = '';
  if (building) {
    const s = Math.max(0, Math.round((now - pub.at) / 1000));
    live = `<span class="br-stat is-live" data-text="live">BUILDING · ${s < 60 ? s + 's' : escapeHTML(left(now - pub.at))}</span>`;
  } else if (_live.versionRead === 'failed') {
    // The site did not answer: no green, no claim it is live now.
    // One line, like the readout it stands in for (a wrap moves the row).
    const seen = _live.seen.version && deployed ? ` · SEEN LIVE ${escapeHTML(asOf(_live.seen.version, now).toUpperCase())}` : ' FROM THE SITE';
    live = `<span class="br-stat is-stale" data-text="info">NO ANSWER${seen}</span>`;
  } else if (deployed) {
    live = `<span class="br-stat" data-text="live">LIVE · DEPLOYED ${escapeHTML(ago(deployed, now).toUpperCase())}</span>`;
  }
  // A publish from this device has just gone live: the update, once the
  // whole page has painted (renderBridge).
  if (_wasBuilding && !building && pub && deployed >= pub.at) _landed = true;
  _wasBuilding = building;
  // (How full this browser is left the Bridge in K95: it lives in Settings.)
  paintHTML($('br-status'), live);
  if (building && _isUp() && !document.hidden) {
    clearTimeout(_buildPoll);
    _buildPoll = setTimeout(() => _readLive(true), 8000);
  }
}
let _buildPoll = 0;

function _paintSince(now) {
  const last = lastLive(STATE, _live.lastPulseAt);
  if (!last) { paintHTML($('br-since'), ''); return; }
  const n = daysSince(last.at, now);
  const what = last.title ? `${last.what} “${last.title}”` : last.what;
  // One line under the figure (K84, the owner: "make that two line stat into
  // one"): the label, then when and what went live; the what gives way first.
  paintHTML($('br-since'), say.figure(n) + '<div class="br-since-row">' +
    say.label(`DAY${n === 1 ? '' : 'S'} SINCE LAST PUBLISH`) +
    say.meta(`${escapeHTML(new Date(last.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))} · ${escapeHTML(what)}`) + '</div>');
}

// THE SHIP STATION (K81; the owner, 2026-10-07: "it's a ship station within
// the console … where you can stamp and prepare content to send out"). Under
// days since, a mail slot with light coming out of it (a slit, the room's
// own light leaving under its lip) and the three things that go through it.
// The slot sends the newest piece; its keys open the picker on a bucket
// (send-out.js). The station is static markup (field-console.html): it is a
// light source, and a repaint is a mutation that starts the light's roster
// over (K56). Its one moving part, what goes next, is the slot's name on
// the control itself (the owner, K82 notes: "remove the recent send option
// from here"), set only when it changes.
function _paintShip() {
  // The module is always in its slot (K84): it is hardware, lit with the
  // room from the first frame. It used to wait for something to send, and on
  // a device that keeps nothing (THIS DEVICE 0%, the owner's) that is the
  // sync, a second or more into the cold start: the whole unit appeared
  // late, already lit, the "pop" K82 and K83 chased in its lamps.
  const out = latestAddressable();
  const slot = $('br-mailslot');
  const label = out ? `Send “${out.title}” out` : 'Send the newest piece out';
  if (slot && slot.getAttribute('aria-label') !== label) slot.setAttribute('aria-label', label);
}

function _lineHTML(l) {
  return `<li class="br-item">${say.line(escapeHTML(l.verb) + ARROW, `onclick="bridgeAct('${escapeAttrJS(l.act)}')"`, l.needs ? ' is-needs' : '')}${say.meta(escapeHTML(l.whisper))}</li>`;
}

function _paintWaiting(now) {
  const lines = waitingLines(now);
  paintHTML($('br-waiting'), lines.length
    ? lines.map(_lineHTML).join('')
    : `<li class="br-item">${say.meta('Nothing to finish. Everything here is live.', 'live')}</li>`);
  const r = _readResume();
  const ok = r && r.view && r.view !== 'bridge' && $('view-' + r.view) && now - (r.left || r.at) < 7 * DAY;
  const staged = totalStaged() ? stagedBreakdown() : '';
  paintHTML($('br-resume'), (staged ? say.meta(escapeHTML(staged), 'live', ' br-staged') : '') + (ok
    ? say.line(`<span aria-hidden="true">▸</span> Resume ${escapeHTML(navLabel(r.view))}`, 'onclick="bridgeResume()"', ' br-line--quiet') +
      say.meta(`you were here ${escapeHTML(ago(r.left || r.at, now))}`)
    : ''));
}

function _paintPulse(now) {
  // A figure while one is live (the composer would replace it, so it waits);
  // the composer while nothing is. When no read of the pulse answered, the
  // last one seen stays with "unconfirmed", and the composer stays away: an
  // unread pulse is not "Nothing live", and a second one sent blind is not
  // what anyone meant.
  const pulse = _live.pulse;
  const unsure = _live.pulseRead === 'failed';
  const seen = _live.seen.pulse ? ` · last seen ${escapeHTML(asOf(_live.seen.pulse, now))}` : '';
  const composer = $('br-say');
  const showComposer = !unsure && !(pulse && pulse.expiresAt > now);
  if (composer && composer.hidden === showComposer) composer.hidden = !showComposer;
  if (pulse && pulse.expiresAt > now) {
    paintHTML($('br-pulse'), say.figure(escapeHTML(left(pulse.expiresAt - now))) +
      say.label('LEFT ON YOUR HOMEPAGE') +
      `<p class="br-quote" data-text="live">“${escapeHTML((pulse.glyphs ? pulse.glyphs + ' ' : '') + (pulse.text || ''))}”</p>` +
      (unsure ? say.meta(`unconfirmed: no answer from the site${seen}`, 'live') : '') +
      say.line('Take it down' + ARROW, 'onclick="bridgeTakeDown()"', ' br-line--quiet'));
  } else if (unsure) {
    paintHTML($('br-pulse'), `<div class="br-state" data-text="live">Can't see the pulse</div>` +
      say.meta(`no answer from the site${seen}`, 'info'));
  } else {
    paintHTML($('br-pulse'), `<div class="br-state" data-text="live">Nothing live</div>`);
  }
}

function _paintFront() {
  const RI = window.RecentIndex;
  const stale = _live.frontRead === 'failed';
  if (!_live.slots || !RI) {
    paintHTML($('br-front'), `<li class="br-item">${say.meta(stale ? 'The live site did not answer.' : 'Reading the live site…', 'live')}</li>`);
    return;
  }
  const live = _live.slots;
  const staged = _cardSlots({ ..._stagedInputs(), pulse: _live.frontPulse });
  const marks = _diffSlots(live, staged);
  const rows = [];
  live.forEach((slot, i) => {
    const shown = slot || (marks[i] === 'NEW' ? staged[i] : null);
    if (!shown) return;
    const mark = marks[i] === 'NEW' ? 'NEW' : marks[i] === 'REPLACED' ? 'CHANGES' : marks[i] === 'GONE' ? 'GOES' : '';
    const thumb = shown.thumb
      ? `<img class="br-thumb" src="${escapeHTML(smallThumb(shown.thumb))}" alt="" loading="lazy" decoding="async" data-full="${escapeHTML(shown.thumb)}" data-kind="${escapeHTML((shown.kind || '·').slice(0, 1).toUpperCase())}" onload="bridgeThumbIn(this)" onerror="bridgeThumbFailed(this)">`
      // No picture: a small lit panel in its place (the owner: "emissive
      // light panel"), the console's backlit glass, with the kind's letter
      // as its legend.
      : `<span class="br-thumb br-thumb--type" data-seam="box" data-backlit aria-hidden="true">${escapeHTML((shown.kind || '·').slice(0, 1).toUpperCase())}</span>`;
    const kind = String(shown.kicker || shown.kind || '').split('·')[0].trim();
    rows.push(`<li><button type="button" class="br-slot" onclick="bridgeOpenSlot(${i})">${thumb}
      <span class="br-slot-text"><span class="br-slot-title" data-text="act">${escapeHTML(shown.title || '—')}</span>
      <span class="br-meta" data-text="info">${escapeHTML(kind.toLowerCase())}${mark ? ` · <span class="is-needs" data-text="live">next publish: ${mark.toLowerCase()}</span>` : ''}</span></span></button></li>`);
  });
  // Kept, not current: the age goes first, where the fit pass never hides it.
  const age = stale
    ? `<li class="br-item br-stale">${say.meta(`as of ${escapeHTML(asOf(_live.seen.front) || 'earlier')} · no answer`, 'live')}</li>`
    : '';
  paintHTML($('br-front'), age + (rows.join('') || `<li class="br-item">${say.meta('Nothing on the grid.', 'live')}</li>`));
  settleThumbs($('br-front'));
}

/**
 * A slot's picture at the size it is drawn (K69): 42 px wants the 480w
 * variant, not the 1024w a grid cell takes (~4× the bytes, for a thumb).
 * Anything without a 1024w name is left as it is.
 */
export function smallThumb(url) {
  return String(url || '').replace(/-1024w\.(webp|avif|jpe?g)(?=$|\?)/, '-480w.$1');
}

/**
 * A picture that would not load becomes the lit panel a slot with no
 * picture already has (K68): a broken-image glyph says nothing true. A small
 * variant that is missing tries the full picture once first (K69).
 */
// A picture fades up as it arrives (K76: on a cold start the thumbnails
// popped in half way through the ignition's heat). One already in hand when
// its list is painted shows at once, so a repaint never blinks it.
export function bridgeThumbIn(img) {
  img?.classList?.add('is-in');
}
export function settleThumbs(root) {
  for (const img of root?.querySelectorAll?.('img.br-thumb:not(.is-in)') || []) {
    if (img.complete && img.naturalWidth) img.classList.add('is-in');
  }
}

export function bridgeThumbFailed(img) {
  if (!img || !img.isConnected) return;
  const full = img.dataset.full;
  if (full && img.getAttribute('src') !== full) {
    delete img.dataset.full;
    img.src = full;
    return;
  }
  const panel = document.createElement('span');
  panel.className = 'br-thumb br-thumb--type';
  panel.setAttribute('data-seam', 'box');
  panel.setAttribute('data-backlit', '');
  panel.setAttribute('aria-hidden', 'true');
  panel.textContent = img.dataset.kind || '';
  img.replaceWith(panel);
}

// ---- the storage gauge ----
//
// THE RULE IS THE GAUGE: the figure sits over a line whose lit length is the
// share of the free 10 GB used, with a tick where the free tier ends. And the
// room left is said in WORK, not bytes — from this site's own averages (what a
// photo here costs with its variants, what an hour of audio here costs),
// falling back to the setup page's rule of thumb (10 GB ≈ 25,000 photos or 170
// hours of audio) until there is enough of either to average.
const FALLBACK_PHOTO = 10e9 / 25_000;
const FALLBACK_AUDIO_HOUR = 10e9 / 170;
const R2_PER_GB_MONTH = 0.015;   // Cloudflare R2 storage past the free tier

export function bytesLabel(n) {
  if (!(n >= 0)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

/** Room left, in photos and hours of audio, from this site's own averages. */
export function roomLeft(storage, state = STATE) {
  const r2 = storage && storage.r2;
  if (!r2) return null;
  const free = storage.r2FreeBytes || 10e9;
  const left = Math.max(0, free - r2.bytes);
  const folders = r2.folders || {};
  const photos = (state.buffer || []).filter((f) => f && !f.dark).length + (state.archive || []).length;
  const photoBytes = (folders.archive && folders.archive.bytes) || 0;
  const perPhoto = photos >= 10 && photoBytes ? photoBytes / photos : FALLBACK_PHOTO;
  const seconds = (state.audio || []).reduce((s, a) => s + (a && !a.retired ? Number(a.duration) || 0 : 0), 0);
  const audioBytes = (folders.audio && folders.audio.bytes) || 0;
  const perHour = seconds >= 60 && audioBytes ? (audioBytes / seconds) * 3600 : FALLBACK_AUDIO_HOUR;
  return {
    used: r2.bytes, free, share: Math.min(1, r2.bytes / free),
    photos: Math.floor(left / perPhoto), hours: Math.floor(left / perHour),
    over: Math.max(0, r2.bytes - free),
  };
}

// THE GAUGE IS A ROW OF TUBES (2026-10-06, the owner's reference: a bank of
// glass tubes, "leaning a little on 3d wireframe elements, a design that can
// heat up with our ignition sequence"; bars of light since K75, the lit run a
// gradient of values the stylesheet reads off --gauge-lit, and a tachometer's
// sweep on a cold load). The row is the free tier; a tube
// lights for each twentieth of it in use, any use at all lights the first,
// and past the tier every tube is lit (and the gauge says so in the accent).
// Each tube carries its place (--i), which is how it reads its light off the
// sweep. The lit run has a light behind it (data-backlit; a lit pool until
// K77), so the engine grows a soft halo from it (K73, the owner: "a small
// glanceable glowing 3d wire frame companion object … emissive through the
// engine"). Decoration for the eye:
// the meter's numbers and words are on its element, for a screen reader.
export const GAUGE_TUBES = 20;
export function gaugeLit(share, n = GAUGE_TUBES) {
  if (!(share > 0)) return 0;
  return Math.min(n, Math.max(1, Math.ceil(share * n - 1e-9)));
}
// THE SWEEP (K75; on the cold start's clock since K77). On a cold load the
// light runs up to redline as the room heats, holds through the crest and
// settles to the reading: spoolr's tachometer. It was a CSS animation of
// --gauge-n, and two things broke it. WebKit does not repaint what an
// animated custom property feeds (the bars' light, a layer down): in Safari
// the run climbed in two or three jumps, short of redline, and settled. And a
// CSS animation starts when its element does: a live reading that changed the
// gauge mid-ignition started the sweep over, late, and the ignition's end cut
// it off at redline (Brave: it "just runs to the limit"). Now it is a level
// written each frame, on the ignition's own clock (chrome.js ignitionTime()),
// onto the gauge's container (--gauge-sweep, with data-sweep), which no
// repaint replaces: whatever gauge is there reads it. Its curves are the console's named easings, read off the
// root.
export const SWEEP = { at: 880, up: 560, hold: 750, down: 990 };
const SWEEP_END = SWEEP.at + SWEEP.up + SWEEP.hold + SWEEP.down;
export { bezier };
// A named easing off the root, as a function (chrome.js easeToken).
const _ease = easeToken;
/** How many bars the sweep lights at `t` ms into the cold start, for a reading of `lit`. */
export function sweepLevel(t, lit, pop = (x) => x, settle = (x) => x, n = GAUGE_TUBES) {
  const { at, up, hold, down } = SWEEP;
  if (t < at) return 0;
  if (t < at + up) return n * pop((t - at) / up);
  if (t < at + up + hold) return n;
  if (t < SWEEP_END) return n + (lit - n) * settle((t - at - up - hold) / down);
  return lit;
}
let _sweeping = 0;
function _sweepGauge() {
  if (_sweeping || !document.documentElement.hasAttribute('data-ignition')) return;
  let pop = null, settle = null;
  const box = $('br-storage');
  const tick = () => {
    const t = Math.max(0, ignitionTime());
    if (!pop) { pop = _ease('--ease-pop'); settle = _ease('--ease-settle'); }
    // It lets go of the gauge only when the room does: past its end it holds
    // the reading, so the gauge never shows the held dark in between.
    if (!document.documentElement.hasAttribute('data-ignition')) {
      box?.removeAttribute('data-sweep');
      box?.style.removeProperty('--gauge-sweep');
      _sweeping = 0;
      return;
    }
    const lit = gaugeLit(_live.storage ? roomLeft(_live.storage)?.share : 0);
    box?.style.setProperty('--gauge-sweep', sweepLevel(t, lit, pop, settle).toFixed(3));
    if (box && !box.hasAttribute('data-sweep')) box.setAttribute('data-sweep', '');
    _sweeping = requestAnimationFrame(tick);
  };
  _sweeping = requestAnimationFrame(tick);
}

// THE MODULE SEATS WITH THE ROOM (K82; K84). On a cold start the module's
// own lamps (the contacts, the neon, the slit's hairline) are the room's:
// each comes up on the ignition's own level, from the first frame to rest,
// with the floor and everything the engine lights. Each lamp is a layer,
// written as opacity (its resting opacity times the room's level), so
// nothing under it repaints; at the end the stylesheet has it back at
// exactly that resting value.
export const SHIP_OPACITY_CAP = 0.999;
let _seating = 0;
function _seatShip() {
  if (_seating || !document.documentElement.hasAttribute('data-ignition')) return;
  let lamps = null;
  const tick = () => {
    const ship = $('br-ship');
    if (!document.documentElement.hasAttribute('data-ignition')) {
      if (ship) {
        ship.querySelectorAll('.br-ship-lamp').forEach((el) => el.style.removeProperty('opacity'));
        ship.removeAttribute('data-seat');
      }
      _seating = 0;
      return;
    }
    if (ship) {
      if (!lamps) {
        ship.setAttribute('data-seat', '');
        // Each lamp's resting opacity, read once (one style read, at the start).
        lamps = [...ship.querySelectorAll('.br-ship-lamp')].map((el) => [el, Number(getComputedStyle(el).opacity) || 1]);
      }
      // The room's level this frame (chrome.js, the one clock). Never quite
      // 1 while the clock holds them: in WebKit a layer crossing opacity 1
      // (the tube at its crest, measured at 1.27 s and 1.67 s in Safari) is
      // re-composited, a 35–50 ms frame each way.
      const level = ignitionLevel();
      for (const [el, rest] of lamps) el.style.opacity = Math.min(SHIP_OPACITY_CAP, rest * level).toFixed(3);
    }
    _seating = requestAnimationFrame(tick);
  };
  _seating = requestAnimationFrame(tick);
}

export function gaugeTubes(share) {
  const lit = gaugeLit(share);
  let on = '', off = '';
  for (let i = 0; i < GAUGE_TUBES; i++) {
    const tube = `<i class="br-tube${i < lit ? ' is-lit' : ''}" style="--i:${i}"></i>`;
    if (i < lit) on += tube; else off += tube;
  }
  return `<span class="br-tubes" aria-hidden="true">${on ? `<span class="br-tubes-lit" data-backlit>${on}</span>` : ''}${off}</span>`;
}

const roundish = (n) => `about ${(n >= 1000 ? Math.round(n / 100) * 100 : n).toLocaleString()}`;

function _paintStorage(now) {
  const st = isLoggedIn() ? _live.storage : null;
  const room = roomLeft(st);
  if (!room) {
    paintHTML($('br-storage'), !isLoggedIn() ? ''
      : say.label('STORAGE') + say.meta(_live.storageRead === 'failed' ? 'no answer from the site' : 'Measuring…', 'live'));
    return;
  }
  const measured = st.measuredAt ? `measured ${ago(st.measuredAt, now)}` : '';
  const roomText = `room for ${roundish(room.photos)} more photos or ${roundish(room.hours)} hours of audio`;
  // Past the free tier is news, and it stays on every screen. The room left
  // explains the figure, so a touch screen drops it (.br-room) and the meter
  // keeps saying it to a screen reader.
  const said = room.over
    ? say.meta(`past the free ${bytesLabel(room.free)} · about $${((room.over / 1e9) * R2_PER_GB_MONTH).toFixed(2)} a month`, 'live', ' is-needs')
    : say.meta(roomText, 'info', ' br-room');
  const valueText = `${bytesLabel(room.used)} of ${bytesLabel(room.free)} free${room.over ? '' : `; ${roomText}`}`;
  const tiers = [st.repo && `text ${bytesLabel(st.repo.bytes)}`, st.d1 && `drafts ${bytesLabel(st.d1.bytes)}`].filter(Boolean).join(' · ');
  // The words under the gauge move every minute ("measured 8 min ago"); the
  // gauge keeps its element while it reads the same, or its light would heat
  // from black on each of them.
  const box = $('br-storage');
  const was = box?.querySelector('.br-gauge');
  const wrote = paintHTML(box, say.figure(bytesLabel(room.used)) +
    `<div class="br-gauge${room.share >= 0.9 ? ' is-needs' : ''}" style="--share:${room.share.toFixed(4)};--gauge-lit:${gaugeLit(room.share)}" role="meter" aria-valuemin="0" aria-valuemax="${room.free}" aria-valuenow="${room.used}" aria-valuetext="${escapeHTML(valueText)}" aria-label="Storage used">${gaugeTubes(room.share)}</div>` +
    say.label(`STORAGE · OF ${escapeHTML(bytesLabel(room.free))} FREE`) +
    said +
    say.meta(`${escapeHTML(tiers)}${tiers && measured ? ' · ' : ''}${measured ? `<button type="button" class="br-remeasure" onclick="bridgeRemeasure()" title="Measure again">${escapeHTML(measured)}</button>` : ''}`, 'live', ' br-meta--dim'));
  const is = wrote && was && box.querySelector('.br-gauge');
  if (is && is.outerHTML === was.outerHTML) is.replaceWith(was);
}

export async function bridgeRemeasure() {
  try {
    const res = await remeasureStorage();
    if (res && res.ok) {
      _live.storage = res;
      if (res.held) toast('Measured a few minutes ago — that is still the number', 'info');
    }
  } catch (err) { toast(`Could not measure: ${err.message}`, 'error'); }
  renderBridge();
}

// ---- the surface: a list shows what fits ----
//
// On a tablet or a desk the Bridge is exactly the pane and never scrolls
// (css: THE SURFACE). A channel's list has the height its row gives it, so it
// shows the lines that fit, whole, and counts the rest in one more line. On a
// phone the list is as long as it is and nothing is held back (it never
// overflows, so this does nothing there). Run after every paint, and when the
// pane changes size.
//
// A list whose lines were not repainted (paintHTML writes only when they
// change, so its first line is the same node) at the same height keeps its
// last fit, untouched (K72). Each pass of the loop below is a layout, and
// with a list that overflows it ran on every paint: 8.5 ms of a 9.5 ms
// paint at iPad speed, found by the probe's budget.
// A font arriving changes every line's height without a repaint, so it
// starts every fit afresh (_fitGen).
const _fitted = new WeakMap();
let _fitGen = 0;
export function _bridgeFit(list) {
  if (!list) return 0;
  const first = list.firstElementChild;
  const h = list.clientHeight;
  const last = _fitted.get(list);
  if (last && last.gen === _fitGen && last.first === first && last.h === h && first) return last.held;
  const held = _fitLoop(list);
  // The height as fitted: a list on a content-sized row can settle shorter
  // once its overflow is held back, and that is the height it is next read at.
  _fitted.set(list, { gen: _fitGen, first: list.firstElementChild, h: list.clientHeight, held });
  return held;
}
function _fitLoop(list) {
  [...list.children].filter((li) => li.classList.contains('br-more')).forEach((li) => li.remove());
  const items = [...list.children];
  items.forEach((li) => { li.hidden = false; });
  if (list.scrollHeight <= list.clientHeight + 1) return 0;
  const more = document.createElement('li');
  more.className = 'br-item br-more';
  list.append(more);
  let held = 0;
  for (let i = items.length - 1; i > 0 && list.scrollHeight > list.clientHeight + 1; i--) {
    items[i].hidden = true;
    more.innerHTML = say.meta(`+${++held} more`, 'live');
  }
  if (!held) more.remove();
  return held;
}
const FIT = ['br-waiting', 'br-front'];
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', () => { _fitGen++; if (_isUp()) _fitLists(); });
}
const _fitIds = () => [...FIT, ..._regions.map((r) => r.fit).filter(Boolean)];
function _fitLists() { for (const id of _fitIds()) _bridgeFit($(id)); }

// Every part of the page paints on its own: one that throws says so in its
// own place and in the ledger (once per fault, not once per tick), and the
// rest of the page paints as usual (K68 — one bad remembered value used to
// stop the paint at the front page and leave the shelf and fit pass undone).
const PAINTERS = [
  ['clock', 'br-clock', _paintClock], ['status', 'br-status', _paintStatus], ['headline', 'br-headline', _paintHead],
  ['since', 'br-since', _paintSince], ['ship', null, _paintShip], ['storage', 'br-storage', _paintStorage], ['waiting', 'br-waiting', _paintWaiting],
  ['pulse', 'br-pulse', _paintPulse], ['front', 'br-front', _paintFront],
];
const _broken = new Map();
function _paintSafe(id, elId, paint, now) {
  try {
    paint(now);
    _broken.delete(id);
  } catch (err) {
    console.error(`bridge ${id}:`, err);
    if (_broken.get(id) !== err.message) {
      _broken.set(id, err.message);
      logEvent(`✕ bridge ${id}: ${err.message}`, 'error');
    }
    const box = elId && $(elId);
    const note = say.meta("Couldn't draw this · details in the ledger", 'info');
    if (box) paintHTML(box, /^(OL|UL)$/.test(box.tagName) ? `<li class="br-item">${note}</li>` : note);
  }
}

export function renderBridge() {
  if (!$('view-bridge')) return;
  _sweepGauge();
  _seatShip();
  const now = Date.now();
  for (const [id, el, paint] of PAINTERS) _paintSafe(id, el, paint, now);
  for (const r of _regions) _paintSafe(r.id, r.fit, r.paint, now);
  _fitLists();
  if (_landed) { _landed = false; if (_isUp()) _announce(); }
  if (_isUp() && !document.hidden) {
    _readLive();
    // Once a minute, on the minute, so the clock never reads a minute late;
    // every figure on the page moves no faster than that (a build in flight
    // repaints with its own 8 s read). It used to tick every 15 s as well.
    clearTimeout(_minute);
    _minute = setTimeout(() => { if (_isUp()) renderBridge(); }, 60_000 - (now % 60_000) + 50);
  }
}
let _minute = 0;

// No timers while the page is hidden or the Bridge is not up.
function _rest() {
  clearTimeout(_minute);
  clearTimeout(_buildPoll);
}
function _leave() {
  _rest();
  if (_drag) _dragEnd();
}

registerView('bridge', { render: renderBridge, onLeave: _leave });
