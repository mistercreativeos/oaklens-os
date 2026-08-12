// OAKLENS Field Console — chrome.
//
// The bottom layer of the console UI: toast, theme, the view router, sheets and
// their drag-to-dismiss, sticky headers, keyboard insets, stage indicators,
// dropzone wiring, and the HTML escapers. Everything here is generic UI
// plumbing — it knows nothing about buffers, frames, posts or publishing.
//
// It imports NO surface, and that is load-bearing: every other console module
// sits above this one, so a dependency pointing outward from here would put a
// cycle in the module graph. Where this layer used to name a surface directly —
// which renderer a view uses, what a long press offers — the surface now
// registers itself instead (registerView / registerLongPress, wired in init()).
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { showToast } from '../console-telemetry.js';
import { STATE, totalStaged } from '../console-state.js';

// ============== TOAST ==============
// Thin wrapper over the telemetry engine — every legacy call site gets
// coalescing, severity-aware lifetimes, and the stack cap for free.
export function toast(msg, kind = "info") {
  showToast(msg, { kind });
}

// ============== THEME — STUDIO (dark) / DAYLIGHT (light) ==============
// The <head> boot script already resolved the pre-paint theme; this section
// owns the toggle + persistence. Default follows the system; a manual choice
// sticks via localStorage (same pattern as the sidebar collapse).
const THEME_KEY = "console_theme";
const THEME_BAR = { dark: "#050505", light: "#f4f1ea" };   // matches --surface-0

export function applyTheme(mode) {
  document.documentElement.dataset.theme = mode === "light" ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_BAR[mode] || THEME_BAR.dark);
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    // Glyph shows what a tap switches TO: sun from the studio, lamp from the field.
    btn.textContent = mode === "light" ? "◗" : "☀";
    btn.title = mode === "light" ? "Switch to STUDIO (dark)" : "Switch to DAYLIGHT (light)";
  }
}

export function themeInit() {
  const saved = localStorage.getItem(THEME_KEY);
  const system = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(saved || system);
  // No manual override → keep tracking the system as it changes (e.g. iPadOS
  // auto dark at sunset). A saved choice always wins.
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", e => {
    if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? "light" : "dark");
  });
}

export function themeToggle() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// ============== STICKY HEADERS (iOS large-title compression) ==============
// In the tab-bar band, view headers pin to the top as glass and compress once
// the content starts moving. One passive scroll listener, one body class —
// the size/padding change is pure CSS transition.
export function _initStickyHeaders() {
  const main = document.querySelector(".main");
  if (!main) return;
  let raf = 0;
  main.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      document.body.classList.toggle("hdr-compact", main.scrollTop > 24);
    });
  }, { passive: true });
}

// ============== ACTION SHEET (long-press context menu) ==============
// Generic bottom action sheet. Long-press on a buffer frame opens one with
// that frame's actions — the touch replacement for the hover action cluster.
let _actionSheetActions = [];

export function openActionSheet(title, actions) {
  const t = document.getElementById("action-sheet-title");
  const list = document.getElementById("action-sheet-items");
  const ov = document.getElementById("action-sheet");
  if (!t || !list || !ov) return;
  _actionSheetActions = actions;
  t.textContent = title;
  list.innerHTML = actions.map((a, i) =>
    `<button class="sheet-item${a.danger ? " danger" : ""}" onclick="_actionSheetRun(${i})">
       <span class="sheet-icon">${a.icon || "·"}</span> ${a.label}
     </button>`).join("");
  ov.classList.remove("hidden", "closing");
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add("open")));
}

export function _actionSheetRun(i) {
  const fn = _actionSheetActions[i]?.fn;
  closeActionSheet();
  if (fn) fn();
}

export function closeActionSheet() {
  const ov = document.getElementById("action-sheet");
  if (!ov || ov.classList.contains("hidden")) return;
  ov.classList.remove("open");
  setTimeout(() => ov.classList.add("hidden"), 380);
}

// Long-press detection on buffer frames (coarse pointers only). Delegated on
// the stable container; >10px of travel or an early lift cancels, so scroll
// and plain taps are never hijacked. Burst-link mode owns its own taps.
let _lpFired = false;   // swallow the ghost click that trails a fired long-press

// Surfaces register their own menus rather than being named here. This layer
// owns the *gesture*; what a long press offers is the surface's business. The
// menu was hard-coded to the buffer's four frame actions, which meant the
// lowest layer of the console reached up into three surfaces above it —
// including bufferFocal(), which lives higher still.
//
// `enabled` is checked at pointerdown, exactly where the old `|| burstLinkMode`
// test sat, so a surface that owns its own taps (Link mode) suppresses the
// press before the timer starts rather than after it fires.
const _longPressTargets = [];

export function registerLongPress(config) {
  _longPressTargets.push(config);
}

export function _initLongPress() {
  for (const cfg of _longPressTargets) _wireLongPress(cfg);
  // One global swallow, not one per host: the ghost click lands on document.
  document.addEventListener("click", e => {
    if (_lpFired) { e.stopPropagation(); e.preventDefault(); _lpFired = false; }
  }, true);
}

function _wireLongPress({ hostId, itemSelector, title, actions, enabled }) {
  const host = document.getElementById(hostId);
  if (!host) return;
  let timer = 0, x0 = 0, y0 = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = 0; } };
  host.addEventListener("pointerdown", e => {
    _lpFired = false;
    if (!matchMedia("(pointer: coarse)").matches) return;
    if (enabled && !enabled()) return;
    const item = e.target.closest(itemSelector);
    if (!item) return;
    x0 = e.clientX; y0 = e.clientY;
    timer = setTimeout(() => {
      timer = 0;
      const menu = actions(item.dataset.id, item);
      if (!menu || !menu.length) return;
      // The lift that ends this press still synthesizes a click — without the
      // flag it would land on the fresh sheet's backdrop and dismiss it.
      _lpFired = true;
      setTimeout(() => { _lpFired = false; }, 700);   // in case no click arrives (iOS)
      if (navigator.vibrate) navigator.vibrate(10);
      openActionSheet(title, menu);
    }, 450);
  });
  host.addEventListener("pointermove", e => {
    if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel();
  });
  host.addEventListener("pointerup", cancel);
  host.addEventListener("pointercancel", cancel);
}

// ============== KEYBOARD INSETS (visualViewport → --kb-inset) ==============
// iPadOS never resizes the LAYOUT viewport for the on-screen keyboard — only
// the visual viewport shrinks. Height-bound surfaces (the FN compose) and
// bottom-pinned chrome would sit behind the keys without this. We publish the
// stolen height as --kb-inset and flag body.kb-open so CSS can duck the tab
// bar and shrink the writing surface to what is actually visible.
export function _initKeyboardInsets() {
  const vv = window.visualViewport;
  if (!vv) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty("--kb-inset", inset + "px");
    // >80px = a real keyboard, not a URL-bar twitch or floating mini-keyboard drift.
    document.body.classList.toggle("kb-open", inset > 80);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  update();
}

// ============== VIEW ROUTING ==============
// Views reachable only through the More sheet — the More tab lights up as
// their proxy in the tab bar.
const MORE_VIEWS = ["wall", "barrel", "friends", "library", "audio", "bench"];

// Surfaces register themselves; the router does not know them by name. Each
// entry is { render, onLeave? } — `render` draws the view, `onLeave` cleans up
// when the user navigates away from it.
const _views = new Map();

export function registerView(name, handlers) {
  _views.set(name, typeof handlers === "function" ? { render: handlers } : handlers);
}

// Redraw a surface WITHOUT navigating to it — the same registry the router
// uses, so anything that can be shown can be refreshed.
//
// This is the third seam, and it exists for the same reason as the other two.
// Low-level code often has to redraw a surface above it: the upload queue marks
// a frame done and the buffer must repaint. Naming renderBuffer() there makes
// the queue import the buffer, while the buffer's ingest already calls into the
// queue — a cycle, and cycles are what re-version every module whenever one
// changes. Asking for a surface by name costs one map lookup and removes the
// import entirely.
//
// Callers pass a VIEW name ('wall'), which is not always the STATE key
// ('wallpapers'); translating between the two is the caller's business, not
// this layer's.
export function refreshSurface(name) {
  _views.get(name)?.render?.();
}

// Test seams. Registration replaced a hard-coded table, which traded a compile-
// time mistake ("renderWall is not defined") for a silent one — miss a
// registerView() call and the nav button just does nothing, which is exactly the
// class of dead control this refactor already shipped once. These let
// tests/console-boot.test.js assert the markup's data-view targets and the
// registered names are the same set.
export function _registeredViews() { return [..._views.keys()]; }
export function _registeredLongPress() { return _longPressTargets.slice(); }

// Which surface is showing. Seeded from the markup's own .view.active on first
// use so no view name is hard-coded here, then tracked explicitly — reading it
// back off the DOM every time would lose the thread the moment a view has no
// container (a config-gated surface), silently stopping every later onLeave.
let _currentView = null;

export function showView(name) {
  if (_currentView === null) {
    _currentView = document.querySelector(".view.active")?.id.replace(/^view-/, "") ?? null;
  }
  // Run the outgoing view's cleanup before the swap. This replaces a hard-coded
  // `if (name !== "buffer" && burstLinkMode) exitBurstLinkMode()`: Link mode is
  // bound to the buffer surface and can only be active while it is showing, so
  // "leaving buffer" and that condition are the same event — but expressed this
  // way the router needs to know neither burstLinkMode nor exitBurstLinkMode.
  // (Selection is ephemeral and must not persist across surface switches.)
  if (_currentView && _currentView !== name) _views.get(_currentView)?.onLeave?.();
  _currentView = name;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + name)?.classList.add("active");
  // Sidebar, tab bar, and More sheet all share the data-view contract.
  document.querySelectorAll(".nav-btn, .tab-btn, .sheet-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(`.nav-btn[data-view="${name}"], .tab-btn[data-view="${name}"], .sheet-item[data-view="${name}"]`)
    .forEach(b => b.classList.add("active"));
  document.getElementById("tab-more-btn")?.classList.toggle("active", MORE_VIEWS.includes(name));
  _views.get(name)?.render?.();
}
export function openPublishView() { showView("publish"); }

// ============== MORE SHEET (tab bar secondary surfaces) ==============
export function openMoreSheet() {
  const ov = document.getElementById("more-sheet");
  if (!ov) return;
  ov.classList.remove("hidden");
  // Two-frame open so the slide/fade transitions run from their start values.
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add("open")));
}

export function closeMoreSheet() {
  const ov = document.getElementById("more-sheet");
  if (!ov || ov.classList.contains("hidden")) return;
  ov.classList.remove("open");
  setTimeout(() => ov.classList.add("hidden"), 380);   // past --dur-3
}

export function sheetGo(view) {
  closeMoreSheet();
  showView(view);
}

// ============== TOUCH SHEETS — animated dismiss + grabber drag ==============
// In the tab-bar band every modal presents as a bottom sheet (CSS owns the
// geometry); this section owns the exits: an animated hide that slides the
// sheet home, and a pointer-drag on the grabber with flick/threshold dismiss.
const SHEET_MQ = "(max-width: 1180px), (pointer: coarse)";
const _sheetMode = () => matchMedia(SHEET_MQ).matches;

export function hideOverlay(id) {
  const ov = document.getElementById(id);
  if (!ov || ov.classList.contains("hidden")) return;
  if (!_sheetMode()) { ov.classList.add("hidden"); return; }   // desktop: instant
  ov.classList.add("closing");
  setTimeout(() => {
    // Re-open during the exit animation wins — only finish if still closing.
    if (ov.classList.contains("closing")) {
      ov.classList.remove("closing");
      ov.classList.add("hidden");
    }
  }, 230);   // just past --dur-2
}

export function _wireSheetDrag(overlayId, closeFn) {
  const ov = document.getElementById(overlayId);
  const panel = ov?.querySelector(".modal, .sheet");
  const grab = ov?.querySelector(".modal-grabber, .sheet-grabber");
  if (!ov || !panel || !grab) return;
  let y0 = 0, dy = 0, t0 = 0, live = false;
  grab.addEventListener("pointerdown", e => {
    if (!_sheetMode()) return;
    live = true; y0 = e.clientY; dy = 0; t0 = performance.now();
    panel.style.transition = "none";
    grab.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grab.addEventListener("pointermove", e => {
    if (!live) return;
    dy = Math.max(0, e.clientY - y0);          // only downward tracking
    panel.style.transform = `translateY(${dy}px)`;
  });
  const settle = () => {
    if (!live) return;
    live = false;
    const flick = dy > 60 && (performance.now() - t0) < 300;
    if (flick || dy > panel.offsetHeight * 0.3) {
      panel.style.transition = "transform var(--dur-2) var(--ease-out)";
      panel.style.transform = "translateY(105%)";
      closeFn();
    } else {
      panel.style.transition = "transform var(--dur-2) var(--ease-spring)";
      panel.style.transform = "";
    }
    setTimeout(() => { panel.style.transition = ""; panel.style.transform = ""; }, 400);
  };
  grab.addEventListener("pointerup", settle);
  grab.addEventListener("pointercancel", settle);
}

// ============== STAGE INDICATORS (UI) — counters live in console-state.js ==============
export function refreshStageIndicators() {
  const total = totalStaged();
  const btn = document.getElementById("publish-btn");
  const badge = document.getElementById("publish-badge");
  const stat = document.getElementById("topbar-stage-stat");
  const pip = document.getElementById("nav-stage-pip");
  badge.textContent = total;
  if (total > 0) {
    btn.classList.remove("empty");
    stat.innerHTML = `<span class="accent">${total} PENDING</span>`;
    pip.style.display = "block";
  } else {
    btn.classList.add("empty");
    stat.textContent = "NO PENDING CHANGES";
    pip.style.display = "none";
  }
  // Sidebar counts
  document.getElementById("nav-count-buffer").textContent  = STATE.buffer.length;
  document.getElementById("nav-count-archive").textContent = STATE.archive.length;
  document.getElementById("nav-count-fn").textContent      = STATE.posts.length;
  document.getElementById("nav-count-wall").textContent    = STATE.wallpapers.length;
  document.getElementById("nav-count-barrel").textContent  = STATE.barrel.length;
  document.getElementById("nav-count-friends").textContent = STATE.friends.length;
  document.getElementById("nav-count-library").textContent = STATE.library.length;

  // Tab bar + More sheet mirrors (guarded — markup may trail the module)
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const tabBadge = document.getElementById("tab-publish-badge");
  if (tabBadge) { tabBadge.textContent = total; tabBadge.classList.toggle("zero", total === 0); }
  setTxt("tab-count-buffer",  STATE.buffer.length  || "");   // :empty hides zeros
  setTxt("tab-count-fn",      STATE.posts.length   || "");
  setTxt("tab-count-archive", STATE.archive.length || "");
  setTxt("sheet-count-wall",    STATE.wallpapers.length);
  setTxt("sheet-count-barrel",  STATE.barrel.length);
  setTxt("sheet-count-friends", STATE.friends.length);
  setTxt("sheet-count-library", STATE.library.length);
}

// Escape a string for safe injection into innerHTML.
export function escapeHTML(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Escape for embedding inside an onclick="fn('...')" handler: JS-escape the
// single-quoted string body first, then HTML-escape for the attribute context.
// Which build is actually running, read from the page and the service worker
// rather than from a hand-maintained constant, so it cannot drift out of date.
//
// The sidebar footer already carries a version string, but the sidebar is
// display:none below 1180px — so on an iPad, where this console mostly gets
// used, there was no way to tell whether an update had landed. Since a refactor
// deliberately changes nothing visible, "did the PWA refresh?" was unanswerable,
// and a test run against stale code looks exactly like a passing one.
//
// Both halves are observed, not declared. The import map is the page's own
// statement of its module versions, so if a stale field-console.html is being
// served from cache this reports the stale numbers — which is precisely the
// question. The cache name comes from the installed worker and is bumped on
// every deploy. Together they answer whether the update took.
export async function renderBuildStamp() {
  const el = document.getElementById('settings-build');
  if (!el) return;

  let imports = {};
  try {
    imports = JSON.parse(document.querySelector('script[type="importmap"]')?.textContent || '{}').imports || {};
  } catch { /* malformed or absent — reported as unknown below */ }
  const mods = Object.keys(imports).sort().map((path) => {
    const v = (imports[path] || '').match(/\?v=(\d+)/)?.[1];
    return `${path.replace(/^\/js\//, '').replace(/\.js$/, '')} v${v ?? '?'}`;
  });

  let sw;
  try {
    sw = (await caches.keys()).find((k) => k.startsWith('oaklens-console-')) || '// not cached yet';
  } catch { sw = '// cache API unavailable'; }

  el.innerHTML =
    `<div>service worker &nbsp;<span class="accent">${escapeHTML(sw)}</span></div>` +
    `<div style="margin-top:6px; word-break:break-word;">${
      mods.length ? mods.map(escapeHTML).join(' · ') : '// no import map — modules are unversioned'
    }</div>`;
}

export function escapeAttrJS(str) {
  return escapeHTML(String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

// ============== DROPZONE WIRING ==============
export function wireDropzone(id, fileInputId, onFiles) {
  const dz = document.getElementById(id);
  const input = document.getElementById(fileInputId);
  if (!dz || !input) return;
  dz.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files?.length) onFiles([...input.files]);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); })
  );
  ["dragleave", "drop"].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); })
  );
  dz.addEventListener("drop", e => {
    if (e.dataTransfer?.files?.length) onFiles([...e.dataTransfer.files]);
  });
}
