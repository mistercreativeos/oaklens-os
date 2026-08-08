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

import { SESSION_KEY, getToken, setToken, clearToken, _tokenSecondsLeft, isLoggedIn, login, logoutServer, fetchSiteSettings } from '../console-api.js';
import { showToast, setSystemState } from '../console-telemetry.js';
import { toast, hideOverlay, renderBuildStamp } from './chrome.js';
import { _librarySyncFailed } from './sync.js';
import { _hasNetFailedUploads } from './upload.js';
import { syncFromServer, _resumeAfterReconnect, _syncPendingReconnect } from './publish.js';

// ============== SESSION AUTH (UI) ==============
// Token storage, JWT parsing, and the /api/auth request live in
// js/console-api.js (SESSION_KEY, getToken, setToken, clearToken, isLoggedIn,
// _tokenSecondsLeft, login). This section owns the login modal + settings UI.

export function logout() {
  clearToken();
  // Retire the console-shell cookie too, so the document gate re-locks for
  // this browser (best-effort — the cookie's own expiry backstops it; the
  // already-loaded shell stays up with the login modal, same UX as before).
  logoutServer().catch(() => {});
  closeSettings();
  checkAuth();
  toast('Logged out', 'info');
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
    setTimeout(syncFromServer, 200);
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
    loginModal.classList.remove('hidden');
    setTimeout(() => document.getElementById('login-password')?.focus(), 100);
  } else {
    loginModal.classList.add('hidden');
  }
}

export function openSettings() {
  _renderSettingsStatus();
  _renderSiteSettings();
  renderBuildStamp();   // async; the panel fills in a tick later
  document.getElementById('settings-modal').classList.remove('hidden', 'closing');
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
    el.innerHTML =
      `<div>preset <span style="color:var(--accent-text, var(--accent));">${s.theme.preset}</span>` +
      ` · mode ${s.theme.defaultMode} · visitor toggle ${s.theme.toggle ? 'on' : 'off'}</div>` +
      `<div style="margin-top:4px;">${Object.entries(s.pages).map(([k, v]) => chip(k, v)).join('')}</div>` +
      `<div style="margin-top:4px;">${chip('demo mode', s.demoMode)}${chip('git deploy', s.repoConnected)}</div>`;
  } catch {
    _siteSettings = null;
    el.innerHTML = '// unavailable — the worker answers /api/site/settings once deployed';
  }
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
  if (hint && s.repoConnected) {
    hint.textContent = 'Cloudflare rebuilds from the repo — live in about a minute. No ZIP, no terminal, no cleanup.';
  }
}

export function copySiteSettingsPrompt() {
  const s = _siteSettings;
  const cur = s
    ? `  preset=${s.theme.preset} defaultMode=${s.theme.defaultMode} toggle=${s.theme.toggle}\n` +
      `  pages: ${Object.entries(s.pages).map(([k, v]) => `${k}:${v}`).join(', ')}`
    : '  (unavailable — describe your current setup)';
  const prompt =
`You are the AI maintainer for my Oaklens OS photography site.

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
  el.innerHTML =
    `<span style="color:${ok ? 'var(--green)' : 'var(--accent)'};">` +
    `${ok ? '✓' : '✕'} Session ${ok ? 'active' : 'not authenticated'}</span>`;
}

export function _updateSettingsDots() {
  const color = isLoggedIn() ? 'var(--green)' : 'var(--accent)';
  ['settings-dot', 'sidebar-settings-dot', 'sheet-settings-dot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.background = color;
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
