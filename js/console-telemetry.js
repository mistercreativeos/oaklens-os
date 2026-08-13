// OAKLENS // FIELD CONSOLE — telemetry engine (ES module).
//
// The console's nervous system: one source of truth for "is the system doing
// something", rendered through three organs —
//   · the System Lamp (#sys-lamp): an HDD-style activity LED in the topbar
//   · toasts (#toast-zone): updatable, coalescing, severity-aware lifetimes
//   · the progress rail (#sys-progress): a 2px bar on the topbar's bottom edge
// plus the Activity Ledger (#sys-ledger), a click-to-open event log where
// errors latch until acknowledged instead of evaporating with a toast.
//
// Dependency-free by design: console-api.js / console-state.js / console-ui.js
// all import from here, never the reverse.
//
// Core model — reference-counted activity:
//   const end = beginActivity('sync', 'SYNC ▲');
//   ...await work...
//   end();                     // success — lamp settles when count hits 0
//   end(false, 'publish 500'); // failure — latches the error state + ledger
// The lamp derives its state (never hand-set during normal flow):
//   offline  >  latched error  >  busy (count > 0)  >  idle | logged-out
// setSystemState() only sets the *baseline* ('idle' after login,
// 'logged-out' after logout) or force-latches an 'error'.

// ============== INTERNAL STATE ==============
const _active = new Map();     // token -> { channel, label }
const _errors = new Map();     // channel -> message (latched until ack/success)
const _progress = new Map();   // id -> { done, total, label }
const _ledger = [];            // { t, label, kind } newest first, capped
const LEDGER_CAP = 40;

let _base = 'logged-out';      // 'idle' | 'logged-out' — set via setSystemState
let _offline = false;
let _nextToken = 1;
let _initialized = false;

const $ = (id) => document.getElementById(id);

// ============== SYSTEM LAMP ==============
function _deriveState() {
  if (_offline) return 'offline';
  if (_errors.size) return 'error';
  if (_active.size || _progress.size) return 'busy';
  return _base;
}

function _busyLabel() {
  // Aggregated progress beats individual labels (it carries the numbers).
  if (_progress.size) {
    let done = 0, total = 0, label = '';
    for (const p of _progress.values()) { done += p.done; total += p.total; label = p.label || label; }
    if (total > 0) return `${label || 'WORKING'} ${done}/${total}`;
    return label || 'WORKING';
  }
  const last = [..._active.values()].pop();
  return (last && last.label) || 'WORKING';
}

function _lampLabel(state) {
  switch (state) {
    case 'offline':    return 'OFFLINE';
    case 'error':      return 'ERR·' + [..._errors.keys()].pop().toUpperCase();
    case 'busy':       return _busyLabel();
    case 'idle':       return 'SYS.IDLE';
    case 'logged-out': return 'NO.AUTH';
  }
}

function _renderLamp() {
  const lamp = $('sys-lamp');
  if (!lamp) return;
  const state = _deriveState();
  lamp.dataset.state = state;
  const label = $('sys-lamp-label');
  if (label) label.textContent = _lampLabel(state);
  lamp.title = state === 'error'
    ? 'System error — click for the activity ledger'
    : 'System activity — click for the ledger';
}

// ============== PUBLIC: ACTIVITY ==============
// Track one async operation. Returns end(ok = true, errMsg = '').
export function beginActivity(channel, label) {
  const token = _nextToken++;
  _active.set(token, { channel, label });
  _renderLamp();
  let ended = false;
  return function end(ok = true, errMsg = '') {
    if (ended) return;   // idempotent — double-end must not corrupt the count
    ended = true;
    _active.delete(token);
    if (ok) {
      _errors.delete(channel);   // success clears this channel's latched error
      _renderLamp();
      _renderLedger();   // no-op unless open
    } else {
      latchError(channel, errMsg);
    }
  };
}

// Latch an error outside the beginActivity lifecycle (e.g. a retry loop that
// only counts as failed once every attempt is exhausted, or a storage-quota
// failure with no request attached). Cleared by ackErrors or a subsequent
// successful end() on the same channel.
export function latchError(channel, errMsg = '') {
  _errors.set(channel, errMsg || 'failed');
  logEvent(`✕ ${channel}: ${errMsg || 'failed'}`, 'error');
  _renderLamp();
  _renderLedger();
}

// Baseline / manual override. 'idle' and 'logged-out' set the resting state;
// 'error' force-latches (label = message); anything else is ignored — busy is
// always derived from live activity so the lamp can't lie.
export function setSystemState(state, label = '') {
  if (state === 'idle' || state === 'logged-out') { _base = state; _renderLamp(); }
  else if (state === 'error') latchError(label ? label.toLowerCase() : 'sys', label || 'error');
}

// Clear all latched errors (the ledger's ACK button).
export function ackErrors() {
  _errors.clear();
  _renderLamp();
  _renderLedger();
}

// ============== PUBLIC: LEDGER ==============
export function logEvent(label, kind = 'info') {
  const d = new Date();
  const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  _ledger.unshift({ t, label, kind });
  if (_ledger.length > LEDGER_CAP) _ledger.length = LEDGER_CAP;
  _renderLedger();
}

function _renderLedger() {
  const el = $('sys-ledger');
  if (!el || el.classList.contains('hidden')) return;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const latched = [..._errors.entries()].map(([ch, msg]) =>
    `<div class="ledger-row ledger-latched">✕ ${esc(ch)}: ${esc(msg)}</div>`).join('');
  const rows = _ledger.map(e =>
    `<div class="ledger-row ${e.kind === 'error' ? 'ledger-err' : ''}"><span class="ledger-t">${e.t}</span>${esc(e.label)}</div>`).join('');
  el.innerHTML =
    `<div class="ledger-head">// ACTIVITY LEDGER${_errors.size
      ? ` <button class="ledger-ack" id="sys-ledger-ack">ACK ERRORS</button>` : ''}</div>`
    + latched
    + (rows || '<div class="ledger-row ledger-empty">// no activity yet</div>');
  const ack = $('sys-ledger-ack');
  if (ack) ack.addEventListener('click', (e) => { e.stopPropagation(); ackErrors(); });
}

export function toggleLedger(force) {
  const el = $('sys-ledger');
  if (!el) return;
  const show = force !== undefined ? force : el.classList.contains('hidden');
  el.classList.toggle('hidden', !show);
  if (show) _renderLedger();
}

// ============== PUBLIC: TOASTS ==============
// showToast(msg, { kind, id, sticky, duration })
//   kind:    'info' | 'success' | 'error' (error also logs to the ledger)
//   id:      updatable toast — a later call with the same id morphs it in place
//   sticky:  no auto-dismiss until a later non-sticky update (batch progress)
// Identical kind+message repeats coalesce into one toast with a ×n counter.
const _toasts = new Map();     // key -> { el, timer, count }
// `warn` sits between the two: longer than an acknowledgement, shorter than a
// failure you may need to copy. It was missing until 2026-08-13, so every warn
// silently inherited the 2400ms info lifetime via the `|| TOAST_MS.info`
// fallback below — including "A pulse needs a line or a glyph", which is the
// first toast a new fork owner is likely to trigger.
const TOAST_MS = { info: 2400, success: 2400, warn: 4000, error: 6000 };
const TOAST_FADE_MS = 300;
const TOAST_MAX = 4;
let _overflowCount = 0;
let _overflowTimer = null;

export function showToast(msg, opts = {}) {
  const kind = opts.kind || 'info';
  const zone = $('toast-zone');
  if (!zone) return;
  if (kind === 'error') logEvent(msg, 'error');
  else if (opts.ledger) logEvent(msg, kind);

  const key = opts.id || (kind + '|' + msg);
  let t = _toasts.get(key);

  if (t && t.el.isConnected) {
    // Coalesce (same message) or update in place (explicit id).
    if (!opts.id) {
      t.count++;
      t.el.innerHTML = '';
      t.el.append(msg, Object.assign(document.createElement('span'), { className: 't-count', textContent: '×' + t.count }));
    } else {
      t.el.textContent = msg;
      t.el.className = 'toast ' + kind;
    }
  } else {
    t = { el: document.createElement('div'), timer: null, count: 1 };
    t.el.className = 'toast ' + kind;
    t.el.textContent = msg;
    zone.appendChild(t.el);
    _toasts.set(key, t);
    _enforceToastCap(zone);
  }

  clearTimeout(t.timer);
  if (!opts.sticky) {
    const ms = opts.duration || TOAST_MS[kind] || TOAST_MS.info;
    t.timer = setTimeout(() => {
      t.el.style.opacity = '0';
      t.el.style.transform = 'translateX(20px)';
      setTimeout(() => { t.el.remove(); _toasts.delete(key); }, TOAST_FADE_MS);
    }, ms);
  }
  return key;
}

export function dismissToast(id) {
  const t = _toasts.get(id);
  if (!t) return;
  clearTimeout(t.timer);
  t.el.remove();
  _toasts.delete(id);
}

// Cap the visible stack: evict the oldest auto-dismissing toast into a "+n
// earlier" pill so a burst of events can't wallpaper the screen.
function _enforceToastCap(zone) {
  const visible = [...zone.querySelectorAll('.toast:not(.toast-overflow)')];
  if (visible.length <= TOAST_MAX) return;
  const oldest = visible[0];
  for (const [key, t] of _toasts) {
    if (t.el === oldest) { clearTimeout(t.timer); _toasts.delete(key); break; }
  }
  oldest.remove();
  _overflowCount++;
  let pill = zone.querySelector('.toast-overflow');
  if (!pill) {
    pill = document.createElement('div');
    pill.className = 'toast toast-overflow';
    zone.prepend(pill);
  }
  pill.textContent = `+${_overflowCount} earlier — see ledger`;
  clearTimeout(_overflowTimer);
  _overflowTimer = setTimeout(() => { pill.remove(); _overflowCount = 0; }, 4000);
}

// ============== PUBLIC: PROGRESS ==============
// Determinate:   startProgress('ingest', 'PROC', 50); updateProgress('ingest', 12);
// Indeterminate: startProgress('publish', 'COMMIT');  (total omitted)
// Multiple concurrent ops aggregate on the rail; the lamp mirrors the numbers.
export function startProgress(id, label = '', total = 0) {
  _progress.set(id, { done: 0, total, label });
  _renderRail();
  _renderLamp();
}

export function updateProgress(id, done, total) {
  const p = _progress.get(id);
  if (!p) return;
  p.done = done;
  if (total !== undefined) p.total = total;
  _renderRail();
  _renderLamp();
}

export function endProgress(id) {
  _progress.delete(id);
  _renderRail();
  _renderLamp();
}

function _renderRail() {
  const rail = $('sys-progress');
  if (!rail) return;
  const fill = $('sys-progress-fill');
  if (!_progress.size) {
    rail.classList.remove('active', 'indeterminate');
    if (fill) fill.style.width = '0%';
    return;
  }
  let done = 0, total = 0;
  for (const p of _progress.values()) { done += p.done; total += p.total; }
  rail.classList.add('active');
  rail.classList.toggle('indeterminate', total === 0);
  if (fill && total > 0) fill.style.width = Math.min(100, (done / total) * 100) + '%';
}

// ============== INIT ==============
export function initTelemetry() {
  if (_initialized) return;
  _initialized = true;

  const lamp = $('sys-lamp');
  if (lamp) lamp.addEventListener('click', (e) => { e.stopPropagation(); toggleLedger(); });
  document.addEventListener('click', (e) => {
    const ledger = $('sys-ledger');
    if (ledger && !ledger.classList.contains('hidden') && !ledger.contains(e.target)) toggleLedger(false);
  });

  const zone = $('toast-zone');
  if (zone) zone.setAttribute('aria-live', 'polite');

  _offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  window.addEventListener('online', () => { _offline = false; _renderLamp(); logEvent('✓ back online', 'info'); });
  window.addEventListener('offline', () => { _offline = true; _renderLamp(); logEvent('⚠ connection lost', 'error'); });

  _renderLamp();
}

// Self-arm: modules execute before DOMContentLoaded, so the engine is live
// without anyone having to remember to boot it.
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initTelemetry);
}
