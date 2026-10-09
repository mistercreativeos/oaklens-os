// OAKLENS Field Console — session.
//
// Login/logout, the auth check, the Settings sheet (including the read-only
// site-template card and its copy-prompt helper), the status dots, the
// session-expiry warning, and the offline indicator.
//
// The offline indicator is the console's reconnect nerve: the `online` event
// resumes interrupted work, and — because iOS Safari does not reliably fire
// `online` for a PWA waking from the background — a visibilitychange fallback
// re-checks on foreground. It is gated on there actually being something to
// resume (a net-failed upload, a deferred library sync, a deferred login sync),
// so an ordinary tab switch stays a no-op. Those three reads are live-binding
// imports from upload/sync/publish; this module never assigns them.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { SESSION_KEY, getToken, setToken, clearToken, _tokenSecondsLeft, isLoggedIn, login, logoutServer, fetchSiteSettings, fetchWelcome, markWelcomed } from '../console-api.js';
import { showToast, setSystemState } from '../console-telemetry.js';
import { toast, hideOverlay, renderBuildStamp, escapeHTML, escapeAttrJS, refreshSurface, START_VIEW_KEY, resolveStartView, availableViews, siteStartView } from './chrome.js';
import { _librarySyncFailed } from './sync.js';
import { _hasNetFailedUploads } from './upload.js';
import { syncFromServer, _resumeAfterReconnect, _syncPendingReconnect } from './publish.js';
import { applyPodcastPosture } from './audio.js';
import { unreadableCopies, downloadUnreadable, removeUnreadable } from '../console-state.js';

// ============== SESSION AUTH (UI) ==============
// Token storage, JWT parsing, and the /api/auth request live in
// js/console-api.js (SESSION_KEY, getToken, setToken, clearToken, isLoggedIn,
// _tokenSecondsLeft, login). This section owns the login modal + settings UI.

// ---- ONE CARD --------------------------------------------------------------
// A password box is a HABIT. An owner who learns to type their password into
// whatever box appears is an owner who will type it into a box somebody else
// drew. So there is one card to learn, and both doors wear it: the console's
// own login modal, raised over the console, and the worker's gate at
// /dev/field-console for a browser that has never signed in
// (dev/console-gate.html, the same card).
//
// Until 2026-10-06 the gate had its own design and the console sent you to it
// on log out and in every new tab — a reload away from the console you were
// in. The owner's call: keep the card over the console. So log out stays
// here, the card comes up over a console that now reads SIGNED OUT, and the
// shell cookie is still retired, so a reload, or another browser, meets the
// gate.

// Repaint whatever is showing, so a surface that reads the session (the
// Bridge's SIGNED OUT) changes with it.
function _repaintShowing() {
  const view = document.querySelector('.view.active')?.id.replace(/^view-/, '');
  if (view) refreshSurface(view);
}

export function logout() {
  clearToken();
  closeSettings();
  // Retire the shell cookie: from here a reload or a new browser meets the
  // gate. Staged work stays — the console keeps it in localStorage.
  logoutServer().catch(() => {});
  checkAuth();
  _repaintShowing();
}

export async function loginSubmit() {
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  const pw = document.getElementById('login-password').value;
  if (!pw) return;

  if (btn) btn.disabled = true;
  if (errEl) errEl.textContent = '';

  try {
    const data = await login(pw);
    setToken(data.token);
    _expiryWarned = false;
    document.getElementById('login-password').value = '';
    checkAuth();
    _updateSettingsDots();
    _repaintShowing();
    setTimeout(() => syncFromServer({ quiet: true }), 200);   // the lamp says it (K76)
    maybeShowWelcome();   // the site is asked once there is a bearer to ask with
  } catch (err) {
    const msg = err.status === 0 ? 'network error — try again' : (err.data?.error || 'invalid credentials');
    if (errEl) errEl.textContent = '✕ ' + msg;
    document.getElementById('login-password').value = '';
    document.getElementById('login-password').focus();
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function checkAuth() {
  setSystemState(isLoggedIn() ? 'idle' : 'logged-out');
  const loginModal = document.getElementById('login-modal');
  if (!loginModal) return;
  if (!isLoggedIn()) {
    // No usable token: after log out, on an expired one, and in every new
    // TAB (the bearer lives in sessionStorage, which is per-tab, while the
    // shell cookie is 30 days). The card comes up over the console (ONE CARD).
    loginModal.classList.remove('hidden');
    // Resolve the field NOW, not inside the timer. A deferred document lookup
    // outlives whatever tore the page down around it — in the suite that means
    // the timer firing after the DOM global is gone, which surfaced as an
    // unhandled "document is not defined" that failed CI on a green run.
    const pwField = document.getElementById('login-password');
    if (pwField) setTimeout(() => pwField.focus(), 100);
  } else {
    loginModal.classList.add('hidden');
  }
}

export function openSettings() {
  _renderSettingsStatus();
  _renderUnreadable();
  _renderStartViewPicker();
  _renderSiteSettings();
  renderBuildStamp();   // async; the panel fills in a tick later
  document.getElementById('settings-modal').classList.remove('hidden', 'closing');
}

// ---- Opens to (this device) ----
// The device half of the start view (chrome.js, START VIEW): one choice, kept
// in localStorage, read at the next boot. "Site default" removes the key, so
// the site's own console.startView (or the Buffer) decides again. Labels come
// off the nav itself — the router knows no surface by name, and neither does
// this list — in the nav's own order.
function _viewLabel(name) {
  const src = document.querySelector(`.nav-btn[data-view="${name}"], .sheet-item[data-view="${name}"], .tab-btn[data-view="${name}"]`);
  if (!src) return name;
  const c = src.cloneNode(true);
  c.querySelectorAll('.nav-icon, .nav-count, .nav-stage-pip, .sheet-icon, .sheet-count, .tab-icon, .tab-count, .tab-badge, .settings-status-dot')
    .forEach((n) => n.remove());
  return c.textContent.replace(/\s+/g, ' ').trim() || name;
}

export function _renderStartViewPicker() {
  const el = document.getElementById('settings-start-view');
  if (!el) return;
  let chosen = '';
  try { chosen = localStorage.getItem(START_VIEW_KEY) || ''; } catch {}
  const available = availableViews();
  const ordered = [...new Set([...document.querySelectorAll('[data-view]')].map((b) => b.dataset.view))]
    .filter((n) => available.includes(n));
  const siteDefault = resolveStartView({ site: siteStartView(), available });
  const options = [
    ['', `Site default · ${_viewLabel(siteDefault)}`],
    ...ordered.map((n) => [n, _viewLabel(n)]),
    ['last', 'Last used'],
  ];
  _fold('settings-fold-start', (options.find(([value]) => value === chosen) || options[0])[1]);
  el.innerHTML = options.map(([value, label]) =>
    `<button type="button" class="focal-style-btn${value === chosen ? ' on' : ''}" role="radio"` +
    ` aria-checked="${value === chosen}" data-start="${value}">${escapeHTML(label)}</button>`).join('');
  el.onclick = (e) => {
    const btn = e.target.closest('[data-start]');
    if (!btn) return;
    const value = btn.dataset.start;
    try {
      if (value) localStorage.setItem(START_VIEW_KEY, value);
      else localStorage.removeItem(START_VIEW_KEY);
    } catch {
      showToast('// this browser is not keeping settings', { kind: 'error' });
      return;
    }
    _renderStartViewPicker();
    showToast(`✓ opens to ${value === 'last' ? 'the last surface used' : _viewLabel(value || siteDefault)}`, { kind: 'success' });
  };
}

// ---- Site Settings card (starter template, read-only v1) ----
// Shows the live template state from GET /api/site/settings and assembles a
// ready-to-paste prompt for the owner's AI maintainer. Deliberately no write
// path — settings live in site.config.js and deploy with the site.
let _siteSettings = null;

export async function _renderSiteSettings() {
  const el = document.getElementById('site-settings-card');
  if (!el) return;
  try {
    const s = await fetchSiteSettings();
    _siteSettings = s;
    const chip = (label, on) =>
      `<span style="display:inline-block; margin:2px 6px 2px 0; padding:1px 8px;` +
      ` border:1px solid var(--line-2); border-radius:var(--r-1, 3px);` +
      ` color:${on ? 'var(--ink-2, var(--text))' : 'var(--ink-3, var(--text-faint))'};">` +
      `${label} ${on ? '·on' : '·off'}</span>`;
    _fold('settings-fold-site', `${s.theme.preset} · ${s.theme.defaultMode}`);
    el.innerHTML =
      `<div>preset <span style="color:var(--accent-text, var(--accent));">${s.theme.preset}</span>` +
      ` · mode ${s.theme.defaultMode} · visitor toggle ${s.theme.toggle ? 'on' : 'off'}</div>` +
      `<div style="margin-top:4px;">${Object.entries(s.pages).map(([k, v]) => chip(k, v)).join('')}</div>` +
      `<div style="margin-top:4px;">${chip('demo mode', s.demoMode)}${chip('git deploy', s.repoConnected)}</div>`;
  } catch {
    _siteSettings = null;
    _fold('settings-fold-site', 'unavailable');
    el.innerHTML = '// unavailable — the worker answers /api/site/settings once deployed';
  }
}

// ---- First run ----
//
// A console that has never published anything belongs to someone who has been
// an owner for about ninety seconds. The cold run got a live site, opened the
// console, and had nowhere to learn the four things every new owner asks in
// their first five minutes. All four answers already existed; none of them was
// discoverable, which is the same as not existing.
//
// The card says "This won't show again", so it shows ONCE PER SITE, and the
// site decides (src/api/welcome.js): never welcomed, and nothing published.
// It used to decide here, from this browser's storage and this device's copy
// of the site, and both lied: every new device, home-screen app or cleared
// browser got it again, and a device that keeps nothing (THIS DEVICE 0%)
// welcomed an established site before its sync landed (2026-10-08).
//
// This browser keeps one key so the usual boot is a single read:
//   '1'        the site has answered: welcomed, or nothing to welcome
//   'pending'  dismissed here, the site not told yet (offline); told next boot
// Asked only when logged in (the site needs the bearer), again right after a
// login, and anything uncertain (offline, an error, a demo) shows nothing.
const WELCOME_KEY = 'oaklens-console-welcomed';
let _welcomeAsking = false;

function _welcomeLocal() {
  try { return localStorage.getItem(WELCOME_KEY); } catch { return null; }
}
function _welcomeRemember(v) {
  try { localStorage.setItem(WELCOME_KEY, v); } catch { /* private mode: the site still knows */ }
}

export async function maybeShowWelcome() {
  const local = _welcomeLocal();
  if (local === '1' || _welcomeAsking || !isLoggedIn()) return;
  _welcomeAsking = true;
  try {
    if (local === 'pending') {
      await markWelcomed();
      _welcomeRemember('1');
      return;
    }
    const r = await fetchWelcome();
    if (!r || r.ok !== true) return;          // ask again next boot
    if (r.show !== true) { _welcomeRemember('1'); return; }
    const el = document.getElementById('welcome-card');
    if (!el) return;
    el.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  } catch {
    /* offline, an error, a demo: show nothing, ask next boot */
  } finally {
    _welcomeAsking = false;
  }
}

export function dismissWelcome() {
  _welcomeRemember('pending');
  markWelcomed().then(() => _welcomeRemember('1'), () => { /* told on the next boot */ });
  const el = document.getElementById('welcome-card');
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => el.classList.add('hidden'), 200);
}

// ---- Instance posture (boot) ----
// Two config flags the shell reflects without a reload: demoMode shows the
// topbar "DEMO · BROWSE-ONLY" badge (writes answer 403 demoMode — see
// worker.js DEMO_LOCKED_ROUTES), and repoConnected swaps the publish card's
// deploy line from "run npx wrangler deploy" (the shipped default — true for
// an unconnected fork) to the auto-deploy promise, which is only true once
// the repo is wired to Cloudflare Builds. Config-driven because a Worker
// cannot detect its own git integration. Failure here is cosmetic: the
// defaults in the markup already tell a fork the truth.
export async function applyInstancePosture() {
  let s;
  try { s = await fetchSiteSettings(); } catch { return; }
  _siteSettings = s;
  const badge = document.getElementById('demo-badge');
  if (badge && s.demoMode) badge.style.display = '';
  const hint = document.getElementById('publish-deploy-hint');
  if (hint) {
    // Also PARKED ON THE ELEMENT, not just rendered into it. publish.js sits
    // below this module in the layer order and cannot import from it, but it
    // has to tell the truth about what a finished publish just did — "Cloudflare
    // is rebuilding" is a lie on an unconnected fork, and it was the exact lie
    // that hid a broken deploy through a whole cold run. A dataset flag is a
    // DOM read, not an upward import.
    hint.dataset.repoConnected = s.repoConnected ? '1' : '0';
    if (s.repoConnected) {
      hint.textContent = 'live in about a minute.';
    }
  }
  applyRingPosture(s.webring);
  // The Audio shelf's feed card. Fed from HERE rather than fetched again: this
  // is the one place the console reads GET /api/site/settings, and audio.js
  // sits below this module in the layer order, so a plain import is legal and
  // a second request would only be a second chance to disagree.
  applyPodcastPosture(s.podcast);
}

// ---- ANALOGS.NETWORK: the ring card in the NETWORK view ----
//
// Mirrors analogs.network's own join overlay. The two constants below are
// duplicated from src/shared/webring.js — the source of truth — because this
// is browser code and cannot import from the Worker's src/ tree. The
// duplication is pinned by tests/webring.test.js so the two cannot drift.
//
// ORDER IS PART OF THE CONTRACT: the email asks the applicant to pick a
// discipline BY NUMBER, so renumbering this list changes what they are asking
// for. It is the ring's palette order (nodes/node.schema.json).
const RING_DISCIPLINES = [
  'Photography', 'Digital Art', 'Writing', 'Code', 'Music', 'Design', 'Architecture',
];
const RING_HOST = 'analogs.network';

// Assembled at runtime, never a literal in the markup. The console document
// goes through the same HTMLRewriter as every public page, and its
// `a[href^="mailto:"]` handler would rewrite a literal ring address to this
// site's own contact address — silently, and only in production.
export function _wireRingJoin() {
  const cta = document.getElementById('ring-join-cta');
  if (!cta) return;
  const body = [
    'my site: ',
    'my name (or studio): ',
    'my discipline (pick a number): ',
    ...RING_DISCIPLINES.map((m, i) => `  [${i + 1}] ${m.toLowerCase()}`),
    '',
  ].join('\r\n');
  cta.href = 'mailto:' + ['themonitor', RING_HOST].join('@')
    + '?subject=' + encodeURIComponent('add me')
    + '&body=' + encodeURIComponent(body);
}

// Upgrade the card from the join pitch to the membership state. The markup's
// default is the fork truth ("not on the ring yet"), so a failed settings
// fetch leaves an honest card rather than a wrong one.
export function applyRingPosture(webring) {
  if (!webring) return;
  const id = String(webring.node).padStart(3, '0');
  const status = document.getElementById('ring-status');
  if (status) status.textContent = `// on the ring · node ${id} · ${webring.slug}`;
  const cta = document.getElementById('ring-join-cta');
  if (cta) {
    cta.href = `https://${RING_HOST}/#/${webring.slug}`;
    cta.textContent = 'View your node ↗';
  }
}

export function copySiteSettingsPrompt() {
  const s = _siteSettings;
  const cur = s
    ? `  preset=${s.theme.preset} defaultMode=${s.theme.defaultMode} toggle=${s.theme.toggle}\n` +
      `  pages: ${Object.entries(s.pages).map(([k, v]) => `${k}:${v}`).join(', ')}`
    : '  (unavailable — describe your current setup)';
  const prompt =
// Deliberately does NOT name a discipline. Every fork owner copies this
// straight into an assistant, so "my Oaklens OS photography site" (what it said
// until 2026-08-13) handed a writer or a musician a prompt that described
// someone else's practice — and the assistant would then reason from it.
`You are the AI maintainer for my Oaklens OS site.

Current settings (from /api/site/settings):
${cur}

Change request: <DESCRIBE THE CHANGE — e.g. "switch to the passe-partout
preset and enable theWall page">

Ground rules:
- Site settings live in site.config.js (theme{}, pages{}, nav[]).
- Theme presets are token blocks in css/main.css; the design spec is
  docs/starter-template/design-spec.md — follow it.
- Do not modify worker auth/publish/portal code for a settings change.
- Run \`npm test\` and keep it green. Commit with a clear message.`;
  navigator.clipboard.writeText(prompt).then(
    () => showToast('AI-maintainer prompt copied', { kind: 'success' }),
    () => showToast('Copy failed — clipboard unavailable', { kind: 'error' }),
  );
}

export function closeSettings() {
  hideOverlay('settings-modal');
}

export function _renderSettingsStatus() {
  const el = document.getElementById('settings-status');
  if (!el) return;
  const ok = isLoggedIn();
  _fold('settings-fold-session', ok ? 'active' : 'signed out');
  el.innerHTML =
    `<span style="color:${ok ? 'var(--green)' : 'var(--accent)'};">` +
    `${ok ? '✓' : '✕'} Session ${ok ? 'active' : 'not authenticated'}</span>`;
}

// Each folded section of Settings says its current value in its title, so
// the sheet answers at a glance and opens only for a change (2026-10-06).
function _fold(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}

// ---- Unreadable saved work (K68) ----
// Shown only when this device kept a copy of a state it couldn't read
// (console-state.js, UNREADABLE SAVED WORK). Download is the point of it;
// removing a copy is the owner's call, asked twice.
export function _renderUnreadable() {
  const box = document.getElementById('settings-unreadable');
  const list = document.getElementById('settings-unreadable-list');
  if (!box || !list) return;
  const copies = unreadableCopies();
  box.hidden = !copies.length;
  list.innerHTML = copies.map(({ key, at, bytes }) =>
    `<div class="settings-unreadable-row"><span>${escapeHTML(at)} · ${Math.max(1, Math.round(bytes / 1024))} KB</span> ` +
    `<button type="button" class="btn btn-ghost btn-sm" onclick="settingsUnreadable('download', '${escapeAttrJS(key)}')">⤓ Download</button>` +
    (key ? ` <button type="button" class="btn btn-ghost btn-sm" onclick="settingsUnreadable('remove', '${escapeAttrJS(key)}')">Remove</button>` : '') +
    `</div>`).join('');
}
export function settingsUnreadable(action, key) {
  if (action === 'download') downloadUnreadable(key);
  else if (action === 'remove' && confirm('Remove this copy from this device? Download it first if there is anything in it you want.')) removeUnreadable(key);
  _renderUnreadable();
}

// The dots are the SMD part (K47): the stylesheet colours the LED from its
// state, so the bezel, specular and glow all follow it.
export function _updateSettingsDots() {
  const state = isLoggedIn() ? 'ok' : 'off';
  ['settings-dot', 'sidebar-settings-dot', 'sheet-settings-dot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dataset.state = state;
  });
}

// ---- Session expiry warning ----
// The 24h token used to lapse silently and surface only as a 401 mid-publish.
// Poll once a minute: warn ~10 min out, and drop to the login modal on expiry
// so a long editing session never loses a publish to a surprise auth failure.
let _expiryWarned = false;
export function _checkSessionExpiry() {
  if (!getToken()) return;            // logged out — checkAuth/login modal owns this
  const left = _tokenSecondsLeft();
  if (left <= 0) {
    clearToken();
    checkAuth();
    _updateSettingsDots();
    toast('Session expired — please log in again', 'error');
    _expiryWarned = false;
    return;
  }
  if (left <= 600 && !_expiryWarned) {
    _expiryWarned = true;
    toast(`⚠ Session expires in ~${Math.ceil(left / 60)} min — re-auth soon to avoid losing a publish`, 'error');
  }
}

// ---- Offline indicator (lite PWA) ----
// Self-contained banner — no markup template changes. Surfaces connectivity so
// it's obvious in the field when a change can't sync yet.
export function _initOfflineIndicator() {
  const el = document.createElement('div');
  el.id = 'offline-indicator';
  el.textContent = "⚠ OFFLINE — changes won't sync until reconnected";
  el.style.cssText =
    'position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:9999;' +
    'background:var(--accent);color:#000;font-family:var(--font-mono);font-size:0.62rem;' +
    'letter-spacing:1.5px;padding:6px 14px;border-radius:4px;display:none;pointer-events:none;';
  document.body.appendChild(el);
  const sync = () => { el.style.display = navigator.onLine ? 'none' : 'block'; };
  window.addEventListener('online', () => { sync(); toast('✓ Back online', 'success'); _resumeAfterReconnect(); });
  window.addEventListener('offline', () => { sync(); toast("⚠ Offline — changes won't sync", 'error'); });
  // iOS Safari doesn't reliably fire `online` for a PWA resuming from the
  // background — the radio can come back while the page is suspended and no
  // event ever lands. Foregrounding is the moment the user is looking again,
  // so re-check then. Gated on there being something to actually resume, so an
  // ordinary tab switch stays a no-op (no stray toasts, no redundant syncs).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    sync();
    if (navigator.onLine && (
      _hasNetFailedUploads() || _librarySyncFailed || _syncPendingReconnect)) {
      _resumeAfterReconnect();
    }
  });
  sync();
}
