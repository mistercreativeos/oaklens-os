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
const THEME_BAR = { dark: "#000000", light: "#f4f1ea" };   // matches --surface-0

// localStorage THROWS rather than returning null in a partitioned browser or
// with site data blocked, and themeInit() runs at boot — so an unguarded read
// here took the whole console down before it painted a pixel. Every other
// surface already try/catches its storage access; console-state.js states the
// rule as "guard the block, never the function", which is what these are: the
// block is the access itself, and a theme preference that cannot be read or
// kept is a degraded preference, never a failed boot.
const themePref = () => {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
};
const rememberTheme = (mode) => {
  try { localStorage.setItem(THEME_KEY, mode); } catch { /* preference won't stick; the theme still applies */ }
};

export function applyTheme(mode) {
  document.documentElement.dataset.theme = mode === "light" ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_BAR[mode] || THEME_BAR.dark);
  // Every switch says what a tap switches TO (the Bridge's mast: sun from the
  // studio, lamp from the field), and every choice says which is on (Settings).
  const light = mode === "light";
  document.querySelectorAll("[data-theme-switch]").forEach((b) => {
    b.textContent = light ? "◗ STUDIO" : "☀ DAYLIGHT";
    b.title = light ? "Switch to STUDIO (dark)" : "Switch to DAYLIGHT (light)";
  });
  document.querySelectorAll("[data-theme-choice]").forEach((b) => {
    const on = b.dataset.themeChoice === (light ? "light" : "dark");
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  });
  // Settings' fold says which is on without being opened.
  const fold = document.getElementById("settings-fold-theme");
  if (fold) fold.textContent = light ? "Daylight" : "Studio";
}

export function themeInit() {
  applyScale();
  window.addEventListener("resize", applyScale, { passive: true });
  const saved = themePref();
  const system = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(saved || system);
  // No manual override → keep tracking the system as it changes (e.g. iPadOS
  // auto dark at sunset). A saved choice always wins.
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", e => {
    if (!themePref()) applyTheme(e.matches ? "light" : "dark");
  });
}

export function themeToggle() {
  themeSet(document.documentElement.dataset.theme === "light" ? "dark" : "light");
}

export function themeSet(mode) {
  rememberTheme(mode);
  applyTheme(mode);
}

// ============== THE SCALE (K74) ==============
// A large screen at 1x zooms the whole console; the boot script in
// field-console.html decides how far (window.consoleScale) and re-decides on
// a resize. Settings can hold it at 1x, per device.
const SCALE_KEY = "console_scale";
export function applyScale() {
  let held = false;
  try { held = localStorage.getItem(SCALE_KEY) === "1"; } catch { /* no storage: Auto */ }
  document.querySelectorAll("[data-scale-choice]").forEach((b) => {
    const on = b.dataset.scaleChoice === (held ? "1" : "auto");
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  });
  const fold = document.getElementById("settings-fold-scale");
  if (fold) fold.textContent = held ? "1×" : `Auto · ×${uiZoom()}`;
}
export function scaleSet(choice) {
  try {
    if (choice === "1") localStorage.setItem(SCALE_KEY, "1"); else localStorage.removeItem(SCALE_KEY);
  } catch { /* the choice won't stick; it still applies */ }
  window.consoleScale?.();
  // Everything that measures the window measures it again: the light, the
  // Bridge's fit, the help overlay.
  window.dispatchEvent(new Event("resize"));
  applyScale();
}

// ============== STICKY HEADERS (iOS large-title compression) ==============
// In the tab-bar band, view headers pin to the top as glass and compress once
// the content starts moving. One passive scroll listener, one body class —
// the size/padding change is pure CSS transition.
//
// Two thresholds, not one. Compaction is flow-neutral now (the CSS trades
// padding for margin, and the title scales with a transform), and that is
// the fix for the 2026-09-22 loop: the header shrank 21px at 24px, scroll
// anchoring pulled scrollTop from 30 to 9, the header grew back, and it
// flipped 35 times in 1.5s. The gap between the two numbers is the
// insurance. A sub-pixel of rounding in the middle of the transition must
// never be able to re-cross a single line and start it again.
const HDR_COMPACT_AT = 24;
const HDR_RELEASE_AT = 8;
export function _initStickyHeaders() {
  const main = document.querySelector(".main");
  if (!main) return;
  let raf = 0;
  main.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const on = document.body.classList.contains("hdr-compact");
      const y = main.scrollTop;
      if (!on && y > HDR_COMPACT_AT) document.body.classList.add("hdr-compact");
      else if (on && y < HDR_RELEASE_AT) document.body.classList.remove("hdr-compact");
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
//
// THE DEADBAND IS LOAD-BEARING, not a tidy-up. iPadOS 26 web apps report a
// visual viewport that is persistently tens of px shorter than the layout
// viewport with no keyboard anywhere — so the raw difference is not "the
// keyboard", it is a standing offset. Published as-is it silently shortens
// every surface that subtracts --kb-inset (the FN compose, now the Pulse
// studio) for the entire session, which looks like a layout bug and is
// invisible to reason about. Anything under the same 80px that already
// gates body.kb-open is not a keyboard, so it publishes zero.
export const KB_MIN = 80;

export function _initKeyboardInsets() {
  const vv = window.visualViewport;
  if (!vv) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const raw = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    // >80px = a real keyboard, not a URL-bar twitch, a floating mini-keyboard,
    // or the iPadOS 26 standing offset.
    const open = raw > KB_MIN;
    document.documentElement.style.setProperty("--kb-inset", (open ? raw : 0) + "px");
    document.body.classList.toggle("kb-open", open);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  update();
}

// ============== VIEW ROUTING ==============
// Views reachable only through the More sheet — the More tab lights up as
// their proxy in the tab bar.
const MORE_VIEWS = ["wall", "friends", "library", "audio", "cards", "pulse", "bench"];

// Surfaces register themselves; the router does not know them by name. Each
// entry is { render, onLeave? } — `render` draws the view, `onLeave` cleans up
// when the user navigates away from it.
const _views = new Map();

// A view registers { render, onLeave?, onEnter?(seed) }. onEnter is THE
// VIEW SEAM (K65, docs/ideas/spark-to-post.md): `showView(name, seed)` hands
// the arriving view structured state, after its render, inside the same
// swap. It replaces the cross-view hand-offs that guessed at timing (a
// `setTimeout(80)`; a load called before the view had rendered, because the
// swap runs a frame later inside a View Transition).
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

export function showView(name, seed) {
  if (_currentView === null) {
    _currentView = document.querySelector(".view.active")?.id.replace(/^view-/, "") ?? null;
  }
  // Run the outgoing view's cleanup before the swap. This replaces a hard-coded
  // `if (name !== "buffer" && burstLinkMode) exitBurstLinkMode()`: Link mode is
  // bound to the buffer surface and can only be active while it is showing, so
  // "leaving buffer" and that condition are the same event — but expressed this
  // way the router needs to know neither burstLinkMode nor exitBurstLinkMode.
  // (Selection is ephemeral and must not persist across surface switches.)
  const arriving = _currentView !== name;
  if (_currentView && arriving) {
    _views.get(_currentView)?.onLeave?.();
    _restBays(document.getElementById("view-" + _currentView));
    _restRows(document.getElementById("view-" + _currentView));
  }
  _currentView = name;
  _rememberView(name);
  // THE SWAP IS A CROSSFADE (K50b — the owner, on the phone: "tapping between
  // archive and publish there is a consistent hard flash … no hard cuts").
  // The old view went display:none in the frame the new one started from
  // opacity 0, so the pane was black for a frame. Where the browser has View
  // Transitions the swap runs inside one: the old pane (K79: the pane only,
  // css § CROSSFADE) is held as an image and cross-faded into the live new
  // one by the compositor (the bay's
  // wake and the light's own fade show through it, because the new side is
  // live). Nothing here waits on it — every caller sees the same bookkeeping
  // (_currentView, onLeave) at once — and where the API is missing, or the
  // person asked for reduced motion, it is the plain swap it always was.
  const swap = (crossfaded = false) => {
    // Inside a crossfade the view does not also run its own entrance (K79):
    // set as it becomes visible, so the class decides whether view-in starts.
    document.getElementById("view-" + name)?.classList.toggle("vt-in", crossfaded);
    _markActive(name);
    _views.get(name)?.render?.();
    if (seed !== undefined) _views.get(name)?.onEnter?.(seed);
    // After render: a view can rebuild around its bay, and the wake measures it.
    if (arriving) {
      wakeBays(document.getElementById("view-" + name));
      wakeRows(document.getElementById("view-" + name));
      // The light hears it at the swap (K53): its eye adaptation lets a
      // bright surface ARRIVE at its settled exposure, and inside a View
      // Transition the entrance animation it used to listen for starts a
      // crossfade later than the light first measures the new surface.
      document.getElementById("view-" + name)?.dispatchEvent(new CustomEvent("console-arrive", { bubbles: true }));
    }
  };
  // A seed that asks for focus swaps at once: iOS raises the keyboard only
  // for a focus() inside the tap's own call stack, and a View Transition runs
  // the swap a frame later.
  if (arriving && _crossfades() && !(seed && seed.focus)) {
    // The page stops drawing from here until the new surface is captured
    // (K52b): `_drawing` is the moment it starts again, for anything that
    // must not be caught moving by the freeze (the floor's pulse).
    const vt = document.startViewTransition(() => swap(true));
    const resumed = vt.ready.catch(() => {});
    _drawing = resumed;
    resumed.then(() => { if (_drawing === resumed) _drawing = null; });
  } else swap();
}
// Every mark that says "you are here": the view itself, the matching sidebar
// row, tab cell and More-sheet item (one data-view contract), the More tab as
// proxy for its surfaces, and the resting lights.
function _markActive(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + name)?.classList.add("active");
  // Sidebar, tab bar, and More sheet all share the data-view contract.
  document.querySelectorAll(".nav-btn, .tab-btn, .sheet-item").forEach(b => b.classList.remove("active"));
  // WHERE YOU ARE is a resting light (K40d): the sidebar row of the current
  // view carries data-lit so the bloom pools softly under the glass around
  // it (its CSS keeps the row's own clothes and sets --lit-level low). Nav
  // rows only — a lit TAB cell means "publish pending" on the touch band.
  document.querySelectorAll(".nav-btn[data-lit]").forEach(b => b.removeAttribute("data-lit"));
  document.querySelector(`.nav-btn[data-view="${name}"]`)?.setAttribute("data-lit", "accent");
  document.querySelectorAll(`.nav-btn[data-view="${name}"], .tab-btn[data-view="${name}"], .sheet-item[data-view="${name}"]`)
    .forEach(b => b.classList.add("active"));
  document.getElementById("tab-more-btn")?.classList.toggle("active", MORE_VIEWS.includes(name));
  // A top-row key is lit while its surface is up (K50c — the owner: "the
  // pulse button should heat up when active like the ? button"; K63 made it
  // every key that names a surface), in the help key's own vocabulary:
  // data-lit, which the stylesheet dresses and the engine pools around.
  document.querySelectorAll(".topbar [data-key-for]").forEach((k) => {
    if (k.dataset.keyFor === name) k.setAttribute("data-lit", "accent"); else k.removeAttribute("data-lit");
    k.setAttribute("aria-pressed", String(k.dataset.keyFor === name));
  });
}

/**
 * A top-row key: its surface, or, pressed again while its surface is up,
 * back to the Bridge (2026-10-06, the owner: the pulse key "activates and
 * users should be able to click again to deactivate and automatically
 * return to the bridge"). The Bridge's own key has nowhere to return to.
 */
export function topbarKey(name) {
  const up = !!document.querySelector(`#view-${name}.active`);
  showView(up && name !== "bridge" ? "bridge" : name);
}

// ============== START VIEW ==============
// Which surface the console opens to. It used to be whichever one the markup
// shipped marked .active — the Buffer, from when the console was a camera's
// back pocket: pull it out, drop the shot, gone. A writer or a musician
// opened onto a camera roll they don't have. Now the markup marks nothing and
// init() seats the first of these that names a surface this console has (and
// the default is the Bridge, the front page every discipline shares):
//
//   1. a link        — ?view=fn (a bookmark, a home-screen shortcut)
//   2. this device   — Settings → "Opens to", which may also be "last used"
//   3. the site      — site.config.js console.startView, stamped by the edge
//                      onto <meta name="console-start-view">
//   4. the Bridge
//
// Per device on purpose: the phone in the field and the desk machine are
// different jobs, and each remembers its own.
export const START_VIEW_KEY = "oaklens_start_view";   // a view name, or "last"
const LAST_VIEW_KEY = "oaklens_last_view";
const START_FALLBACK = "bridge";

/** Pure: the first candidate that names one of `available`. */
export function resolveStartView({ link, device, last, site, available }) {
  const ok = (v) => typeof v === "string" && available.includes(v);
  if (ok(link)) return link;
  if (device === "last" && ok(last)) return last;
  if (ok(device)) return device;
  if (ok(site)) return site;
  return ok(START_FALLBACK) ? START_FALLBACK : (available[0] ?? null);
}

/** The surfaces a start can name: registered AND present. A config-gated
 *  view (the bench, off) has a renderer but no container, and must not win. */
export function availableViews() {
  return [..._views.keys()].filter((n) => document.getElementById("view-" + n));
}

/** The site's own default, as the edge stamped it (empty off the edge). */
export function siteStartView() {
  return document.querySelector('meta[name="console-start-view"]')?.content || null;
}

export function startView() {
  let device = null, last = null, link = null;
  try { device = localStorage.getItem(START_VIEW_KEY); last = localStorage.getItem(LAST_VIEW_KEY); } catch {}
  try { link = new URLSearchParams(location.search).get("view"); } catch {}
  return resolveStartView({ link, device, last, site: siteStartView(), available: availableViews() });
}

function _rememberView(name) {
  // Only real surfaces: a test probe or a gated name must never become the
  // place a later boot tries to open.
  if (!document.getElementById("view-" + name)) return;
  try { localStorage.setItem(LAST_VIEW_KEY, name); } catch {}
}

/** Boot only: put `name` up with no crossfade, no onLeave and no render —
 *  init() renders it once the rest of the console is wired, and runs the
 *  cold start around whatever is seated here. */
export function seatView(name) {
  if (!name) return;
  _currentView = name;
  _markActive(name);
}

let _drawing = null;
/** Run `fn` once the page is drawing again: at once, unless a surface switch
 *  has just frozen the frame, in which case the moment the crossfade starts. */
export function whenDrawing(fn) {
  if (_drawing) _drawing.then(fn); else fn();
}
function _crossfades() {
  if (typeof document.startViewTransition !== "function") return false;
  try { return !matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; }
}
export function openPublishView() { showView("publish"); }

// ============== THE PULSE (K51) ==============
//
// The owner: a tap on the floor should send "a light pulse emitted outward,
// left and right, end to end across the bar from the point of the button …
// organic, tactile, and just a little spark while you navigate".
//
// One launch, then friction. Both fronts leave the key at the speed that
// would carry the far one REACH times its distance, and slow on e^(-K·t): fast
// off the key, still moving when they meet the walls. That is the spark — a
// wave that stops short of the wall reads as a fade, and one at constant
// speed reads as a progress bar. Brightness decays on its own clock (TAU), a
// front lengthens as it travels (the energy spreading out), and a key it
// passes under catches it at the brightness it has by then. The near wall is
// reached first and brighter, the far one later and dimmer, because they are
// the same wave.
//
// Everything is computed here, once per tap, and handed to the compositor as
// keyframes: transform and opacity on a handful of small boxes. No layout, no
// paint, and the light engine (lighting.js) never wakes for it. How the light
// LOOKS is the stylesheet's (§ THE PULSE); `--tab-pulse` on the bar is the
// dial, 0 on paper and under reduced motion.
export const PULSE = {
  K: 3.2,        // friction, 1/s
  REACH: 1.28,   // how far the launch would carry the far front, as a share of its distance to the wall
  TAU: 0.46,     // the brightness's decay, s
  RISE: 0.035,   // s from the strike to full brightness
  SPREAD: 1.2,   // a front's growth in length over its travel
  FADE: 0.14,    // s a front takes to go out once its head is through the wall
  STEPS: 16,     // keyframes per front
  LIVE: 3,       // pulses on the floor at once; a fourth retires the oldest
};

/** When a front launched toward a wall `L`-reach away arrives `d` px out, in s. */
export function pulseArrival(d, L) {
  return d >= L ? Infinity : -Math.log(1 - d / L) / PULSE.K;
}

/** One front's journey from `x0` to a wall `d` px away in direction `dir`
 *  (±1), with reach `L`: its keyframes, its length in ms, and the brightness
 *  it has left when its head meets the wall. Pure, so the physics is tested
 *  without a browser. */
export function pulseFront(x0, d, dir, L, gain = 1) {
  const { K, TAU, RISE, SPREAD, FADE, STEPS } = PULSE;
  const tWall = pulseArrival(d, L);
  const tEnd = tWall + FADE;
  const frames = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = (tEnd * i) / STEPS;
    const x = L * (1 - Math.exp(-K * t));
    const out = t <= tWall ? 1 : Math.max(0, 1 - (t - tWall) / FADE);
    const a = Math.exp(-t / TAU) * Math.min(1, t / RISE) * out * gain;
    const s = 0.7 + SPREAD * (x / L);
    frames.push({
      offset: i / STEPS,
      transform: `translateX(${(x0 + dir * x).toFixed(1)}px) scaleX(${(dir * s).toFixed(3)})`,
      opacity: +a.toFixed(3),
    });
  }
  return { ms: tEnd * 1000, wallMs: tWall * 1000, frames, atWall: Math.exp(-tWall / TAU) * gain };
}

const _pulseEl = (cls) => { const el = document.createElement("span"); el.className = cls; return el; };

/** THE SCALE (K74): a large screen at 1× zooms the whole console (`zoom` on
 *  <html>, set by the page's boot script). A rect and a pointer come back
 *  zoomed; a style is written in the page's own px. Divide by this to go from
 *  one to the other. 1 everywhere else. */
export function uiZoom() {
  return parseFloat(document.documentElement.style.zoom) || 1;
}

/** Strike the floor at a key: the flash, a front each way, the walls, and
 *  every key the wave runs under. */
export function tabPulse(bar, key) {
  if (!bar || !key || typeof key.animate !== "function") return;
  let gain = 0;
  try { gain = parseFloat(getComputedStyle(bar).getPropertyValue("--tab-pulse")) || 0; } catch { gain = 0; }
  if (gain <= 0) return;
  const z = uiZoom();
  const br = bar.getBoundingClientRect();
  const kr = key.getBoundingClientRect();
  const W = br.width / z;
  if (!(W > 0)) return;
  const x0 = Math.min(W, Math.max(0, (kr.left + kr.width / 2 - br.left) / z));
  const dL = x0, dR = W - x0;
  const L = Math.max(dL, dR, 1) * PULSE.REACH;

  let layer = bar.querySelector(":scope > .tabbar-pulse");
  if (!layer) { layer = _pulseEl("tabbar-pulse"); layer.setAttribute("aria-hidden", "true"); bar.prepend(layer); }
  while (layer.children.length >= PULSE.LIVE) layer.firstElementChild.remove();
  const group = _pulseEl("tp-group");
  layer.appendChild(group);
  const runs = [];
  const run = (el, frames, opts) => { runs.push(el.animate(frames, { fill: "both", ...opts }).finished.catch(() => {})); };

  const flash = group.appendChild(_pulseEl("tp-flash"));
  run(flash, [
    { opacity: 0, transform: `translateX(${x0}px) scaleX(0.6)` },
    { opacity: gain, transform: `translateX(${x0}px) scaleX(1)`, offset: 0.12 },
    { opacity: 0, transform: `translateX(${x0}px) scaleX(1.6)` },
  ], { duration: 420, easing: "ease-out" });

  for (const [dir, d, side] of [[-1, dL, "left"], [1, dR, "right"]]) {
    if (d < 2) continue;
    const f = pulseFront(x0, d, dir, L, gain);
    run(group.appendChild(_pulseEl("tp-front")), f.frames, { duration: f.ms, easing: "linear" });
    run(group.appendChild(_pulseEl(`tp-kiss tp-kiss--${side}`)), [
      { opacity: 0 }, { opacity: f.atWall, offset: 0.16 }, { opacity: 0 },
    ], { duration: 560, delay: Math.max(0, f.wallMs - 24), easing: "ease-out" });
  }

  // The keys catch it: the struck one at once, the rest as the wave arrives.
  for (const btn of bar.querySelectorAll(".tab-btn")) {
    const glow = btn.querySelector(":scope > .tab-catch");
    if (!glow) continue;
    const r = btn.getBoundingClientRect();
    const dk = Math.abs((r.left + r.width / 2 - br.left) / z - x0);
    const t = btn === key ? 0 : pulseArrival(dk, L);
    if (!Number.isFinite(t)) continue;
    const a = (btn === key ? 1 : 0.8 * Math.exp(-t / PULSE.TAU)) * gain;
    run(glow, [{ opacity: 0 }, { opacity: a, offset: 0.2 }, { opacity: 0 }],
      { duration: btn === key ? 640 : 520, delay: Math.max(0, t * 1000 - 50), easing: "ease-out" });
  }
  Promise.all(runs).then(() => group.remove());
}

export function _initTabPulse() {
  const bar = document.querySelector(".tabbar");
  if (!bar) return;
  for (const btn of bar.querySelectorAll(".tab-btn")) {
    if (btn.querySelector(":scope > .tab-catch")) continue;
    const c = _pulseEl("tab-catch");
    c.setAttribute("aria-hidden", "true");
    btn.prepend(c);
  }
  // THE WAVE WAITS FOR THE PAGE (K52b). K51 struck on the press, and on
  // stock Chrome on Android the owner saw "click, stutter, then pulse": the
  // click a moment later starts the surface switch, and a View Transition
  // stops the page drawing until the next surface is built (35–77ms with the
  // real data at phone speed), so the wave froze mid-flight. K52 traded the
  // View Transition for a ghost and lost the crossfade's quality and the
  // surfaces' ignition. So the freeze stays, and the wave never meets it: the
  // press is the key's own light (CSS :active, instant, and nothing moving),
  // and the wave leaves on the click, once the page is drawing again
  // (whenDrawing), riding the crossfade from its first frame. A tap that
  // switches nothing (the current surface, More) strikes at once.
  bar.addEventListener("pointerdown", e => {
    const key = e.target.closest?.(".tab-btn");
    if (!key || e.button > 0) return;
    try { navigator.vibrate?.(6); } catch { /* no haptics here */ }
  }, { passive: true });
  // Bubbling, so the key's own onclick (the switch) has already run.
  bar.addEventListener("click", e => {
    const key = e.target.closest?.(".tab-btn");
    if (!key) return;
    whenDrawing(() => tabPulse(bar, key));
  });
}

// ============== BOTTOM SHEETS ==============
//
// Any `.sheet-overlay` opens and closes the same way, so the mechanics live here
// once. Generalised when Pulse needed a second sheet (its recent list, which the
// mobile layout has no room for as a rail): copying the two-frame open and the
// 380ms teardown into a second module is how two sheets end up animating
// differently a year later.
export function openSheet(id) {
  const ov = document.getElementById(id);
  if (!ov) return;
  ov.classList.remove("hidden");
  // Two-frame open so the slide/fade transitions run from their start values.
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add("open")));
}

export function closeSheet(id) {
  const ov = document.getElementById(id);
  if (!ov || ov.classList.contains("hidden")) return;
  ov.classList.remove("open");
  setTimeout(() => ov.classList.add("hidden"), 380);   // past --dur-3
}

// ---- the More sheet (tab bar secondary surfaces) ----
export function openMoreSheet() { openSheet("more-sheet"); }
export function closeMoreSheet() { closeSheet("more-sheet"); }

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
  const stat = document.getElementById("topbar-stage-stat");
  const pip = document.getElementById("nav-stage-pip");
  // The topbar button is a STATUS LIGHT: lit or unlit, no number. It is a
  // wayfinding control in the corner furthest from a thumb, and as the card
  // system adds change types its count only grew more abstract — "17" tells
  // you nothing you can act on. The number still has two honest homes: the
  // status strip beside it (glanceable telemetry, desktop) and the tab-bar
  // badge on touch, where the tab bar owns publish and there is no strip.
  // The itemised answer lives on the publish page itself.
  // And it is LIT, not merely outlined (2026-09-14, owner's call on phase 2 of
  // the lighting pass). "The publish button with work pending" was already one
  // of the four states design-spec.md §6.5 licenses to carry light, and the
  // only one of the four with no way to express it: the SYS lamp and the
  // progress rail glow in CSS, but this button's indicator is the flat square
  // pip, fenced against exactly that since 2026-08-23 so it can never read as
  // a second SYS lamp. data-lit lights the BUTTON and never touches the pip —
  // and it is the one steady light in the console, so it is also what the
  // canvas bloom pools from (js/console/lighting.js).
  //
  // ⚠️ BOTH publish controls, because they are one control at two breakpoints.
  // The topbar button is `display: none` under 1181px AND on any coarse
  // pointer, where the tab bar owns publish instead — so lighting only the
  // topbar would have shipped a feature that does nothing on an iPad, which is
  // this owner's primary surface. The hidden one measures 0×0 and the bloom
  // skips it, so the pair costs nothing at either width.
  const tabPublish = document.querySelector('.tab-btn[data-view="publish"]');
  if (total > 0) {
    btn.classList.remove("publish-btn--idle");
    btn.dataset.pending = "1";
    btn.setAttribute("data-lit", "accent");
    tabPublish?.setAttribute("data-lit", "accent");
    btn.setAttribute("aria-label", `Publish — ${total} pending change${total === 1 ? '' : 's'}`);
    stat.innerHTML = `<span class="accent">${total} PENDING</span>`;
    pip.style.display = "block";
  } else {
    btn.classList.add("publish-btn--idle");
    btn.dataset.pending = "0";
    btn.removeAttribute("data-lit");
    tabPublish?.removeAttribute("data-lit");
    btn.setAttribute("aria-label", "Publish — no pending changes");
    stat.textContent = "NO PENDING CHANGES";
    pip.style.display = "none";
  }
  // Sidebar counts
  document.getElementById("nav-count-buffer").textContent  = STATE.buffer.length;
  document.getElementById("nav-count-archive").textContent = STATE.archive.length;
  document.getElementById("nav-count-fn").textContent      = STATE.posts.length;
  document.getElementById("nav-count-wall").textContent    = STATE.wallpapers.length;
  document.getElementById("nav-count-friends").textContent = STATE.friends.length;
  document.getElementById("nav-count-library").textContent = STATE.library.length;
  const navAudio = document.getElementById("nav-count-audio");
  if (navAudio) navAudio.textContent = (STATE.audio || []).length;
  // Guarded like audio's, for the same reason: this markup can trail the module
  // in a fork mid-merge, and an unguarded write here throws on boot.
  const navCards = document.getElementById("nav-count-cards");
  if (navCards) navCards.textContent = (STATE.cards || []).length;

  // Tab bar + More sheet mirrors (guarded — markup may trail the module)
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const tabBadge = document.getElementById("tab-publish-badge");
  if (tabBadge) { tabBadge.textContent = total; tabBadge.classList.toggle("zero", total === 0); }
  setTxt("tab-count-buffer",  STATE.buffer.length  || "");   // :empty hides zeros
  setTxt("tab-count-fn",      STATE.posts.length   || "");
  setTxt("tab-count-archive", STATE.archive.length || "");
  setTxt("sheet-count-wall",    STATE.wallpapers.length);
  setTxt("sheet-count-friends", STATE.friends.length);
  setTxt("sheet-count-library", STATE.library.length);
  setTxt("sheet-count-audio",   (STATE.audio || []).length);
  setTxt("sheet-count-cards",   (STATE.cards || []).length);
}

// ============== IGNITION (the console armed, while a commit is in flight) ==============
//
// Owner's call, 2026-09-15. The commit used to announce itself by washing the
// whole publish panel in canvas bloom; it now announces itself by ARMING the
// controls — they take the accent and glow hot, like the spoolr dashboard's
// hood ornament coming up to heat, and stay that way until the commit is
// confirmed one way or the other.
//
// ⚠️ Not a fifth licensed light (design-spec.md §6.5): "the publish bar while
// it commits" was already licensed, and this is that same state wearing the
// controls instead of the panel behind them.
//
// The set is the console's action surface at that moment — the two buttons that
// can still change the outcome, and the three topbar chips plus the publish
// control, so the cluster ignites together rather than one chip staying cold
// among its neighbours. Missing ids are skipped: a fork's markup can trail the
// module, and half a set is better than a thrown boot.
const ARMED_CONTROLS = [
  '#gh-publish-btn',        // ▲ PUBLISH
  '#gh-clear-staged-btn',   // ⌫ CLEAR STAGED
  '#bridge-topbar-btn',     // ◈  the Bridge
  '#pulse-topbar-btn',      // ☺  post a pulse
  '#settings-topbar-btn',   // ⚙  settings — carries the logged-in dot
  '#publish-btn',           // the topbar publish control
];

// Must outlast --arm-cool (2.6s), or the attribute is pulled mid-fade and the
// glow snaps off instead of decaying. Shared by every heat() caller.
const ARM_COOL_MS = 2700;
let _armCoolTimer = 0;

/**
 * Arm or disarm the console. `on` is the whole API — publish.js says what is
 * happening and this decides what that looks like.
 *
 * ⚠️ The two-step is not superstition. A `filter` interpolates only against a
 * matching function list, so going straight from no filter to the hot one makes
 * the control BLINK on rather than ignite. So: set the resting attribute (which
 * declares every function at its no-op value), force one layout flush so the
 * browser actually computes that state, and only then go hot. On the way down
 * the reverse — drop to resting, and remove the attribute only once the cool
 * has finished.
 */
export function setCommitArmed(on) {
  const els = ARMED_CONTROLS
    .map((sel) => document.querySelector(sel))
    .filter(Boolean);
  if (!els.length) return;
  _armCoolTimer = heat(els, on, _armCoolTimer);
}

// ============== HEAT — one word for "in flight" ==============
// The emissive pass (K40, 2026-09-25) gave the console one physical quantity
// for light — heat — and one attribute for it: `data-heat`. `"hot"` is a thing
// in flight (a commit, an ingest); `""` is the RESTING half of the same coil;
// `"warm"` is under a hand and is CSS-only (:hover), never written from here.
// The commit ignition and the ingestion bay's rod both go through this, so the
// two cannot drift apart in timing or in trap-avoidance:
//
//   ⚠️ the resting attribute goes on FIRST and its style is computed, because
//   a `filter` interpolates only against a matching function list — from no
//   filter at all the browser swaps discretely and the control blinks on
//   instead of igniting (K38c). What has to be real is the resting STYLE, not
//   a layout: reading each control's computed filter settles exactly that, in
//   the same frame, where `document.body.offsetWidth` laid out the page (K56). Cooling is the reverse: drop to resting, and
//   release the attribute only once --arm-cool has run, or the glow snaps.
//
// Idempotent while hot: `dragover` fires continuously under a drag, and a
// style pass per event would be sixty a second for nothing. Returns the cool
// timer so a caller that owns one attribute set can cancel it on re-heat.
export function heat(els, on, timer = 0) {
  const list = Array.isArray(els) ? els.filter(Boolean) : (els ? [els] : []);
  if (!list.length) return 0;
  clearTimeout(timer);
  if (on) {
    if (list.every((el) => el.getAttribute("data-heat") === "hot")) return 0;
    list.forEach((el) => el.setAttribute("data-heat", ""));
    for (const el of list) void getComputedStyle(el).filter;   // the resting state is real
    list.forEach((el) => el.setAttribute("data-heat", "hot"));
    return 0;
  }
  list.forEach((el) => el.setAttribute("data-heat", ""));
  return setTimeout(() => {
    list.forEach((el) => el.removeAttribute("data-heat"));
  }, ARM_COOL_MS);
}

// ---- THE IGNITION (K41b, owner's call; one dial since K64) ---------------
// A cold start, once per session: the room comes up from OLED black the way
// an instrument's does. The owner, 2026-10-06: "a simple, smooth, ramp/heat
// up from oled black from the background light sources, and rubber banding
// back down to its resting state." Since K78 the curve is here, not in the
// stylesheet (IGNITE_CURVE, on the console's named heat and cool): the light
// engine reads the level each frame (ignitionLevel(), handed to it by init)
// and the Bridge's floor light (.room-floor) takes it as its opacity, a
// compositor property. Until K78 the stylesheet animated a registered number
// on <html> and another on .main, and WebKit restyled and repainted the whole
// page for each of them on every frame, every glowing letter with it: Safari
// drew the ignition at 15 fps where Brave held 60 (docs/maintenance/
// 2026-10-06-bridge-gold-master.md, the correction). This function decides
// WHETHER it runs, keeps its clock, and lights the top row's keys at the
// crest. (Until K64 it staggered every seam by its distance from the fed
// corner and breathed the bays; one curve for the room replaced both.)
//
// It is bounded by construction — one attribute set, one attribute removed —
// so the console's motion budget (one heartbeat: the SYS lamp's) holds the
// moment it is over. It does not run: under reduced motion (the state, not
// the journey); where @property is missing (the gauge's sweep and the text
// light ride on registered numbers, and would snap); in a hidden tab (nobody
// is watching, and it would be over by the time they were); or twice in one
// session (a reload mid-work comes back lit and still, because the instrument
// was already on).
export const IGNITE_DUR_MS = 3000;        // heat 1.5s (--arm-heat) + the rubber band 1.5s
export const IGNITE_HOLD_MS = 3200;       // ≥ the curve, so the engine follows it to rest before it parks
// The instrument row (K41c, owner's call; K64 keeps it simple): at the crest
// the top row's keys go HOT together on the console's own ignition (heat():
// the filter bloom, the accent, and the canvas pool, on --arm-heat) and let
// go on --arm-cool, the room's rubber band in the keys. The SYS lamp is not
// in the row: it owns the page's heartbeat and blinks on its own.
export const IGNITE_ROW_AT_MS = 1500;     // the crest: where the heat ends
export const IGNITE_ROW_HOT_MS = 600;     // how long they hold hot before they cool
const IGNITED_KEY = 'oaklens_ignited';
// The curve: [progress, level] stops, from OLED black to a crest above rest
// (under the engine's ceiling, 2), down through a dip and back to rest. The
// heat is the first segment, on --ease-heat, in --arm-heat's time; the
// rubber band is the rest, on --ease-cool.
export const IGNITE_CURVE = [[0, 0], [0.5, 1.16], [0.76, 0.95], [1, 1]];
export const IGNITE_CREST = 1.16;   // the curve's top: the floor's opacity is level / crest (css .room-floor)
/** The room's level at `t` ms into the cold start, on the given heat and cool easings. */
export function igniteLevel(t, heat = (x) => x, cool = (x) => x) {
  const p = Math.max(0, Math.min(1, t / IGNITE_DUR_MS));
  for (let i = 1; i < IGNITE_CURVE.length; i++) {
    const [p1, v1] = IGNITE_CURVE[i];
    if (p > p1 && i < IGNITE_CURVE.length - 1) continue;
    const [p0, v0] = IGNITE_CURVE[i - 1];
    const ease = i === 1 ? heat : cool;
    return v0 + (v1 - v0) * ease((p - p0) / (p1 - p0));
  }
  return 1;
}
// ONE CLOCK THAT STALLS WITH THE PAGE (K77). Each frame adds the time since
// the last, so the sequence keeps its own time on a slow frame (K78: until
// then every step was capped at 34 ms, and a page drawing at 15 fps played
// the room in slow motion, 3.2 s stretched to 6). A gap longer than
// IGNITE_STALL_MS is a stall (a cold launch in Safari or a PWA spends a
// second and more building the console after its first frame), not a slow
// frame: it counts as one frame, so the sequence freezes where it is and
// carries on when the page draws again. Until K77 the curve ran on its own
// clock and the timers here on theirs: the owner saw the fade-in "skip
// altogether" (the room lit by the time the page came back), the keys
// heated off the crest and the end cut the rubber band. The room's level,
// the floor, the crest, the end and the gauge's sweep (bridge.js,
// ignitionTime()) all read this one clock.
export const IGNITE_STALL_MS = 100;
export const IGNITE_FRAME_MS = 1000 / 60;
let _ignitionT = -1;
let _ignitionLevel = 1;
/** How far into the cold start the console is, in ms of drawn time; -1 when none is running. */
export function ignitionTime() { return _ignitionT; }
/** The room's level now: 0 (black) to the crest and back to 1; 1 when no cold start is running. */
export function ignitionLevel() { return _ignitionLevel; }

export function igniteConsole({ force = false } = {}) {
  const root = document.documentElement;
  if (!force) {
    try { if (sessionStorage.getItem(IGNITED_KEY)) return 0; } catch { /* private mode: every load is a first load */ }
    if (typeof CSS === 'undefined' || typeof CSS.registerProperty !== 'function') return 0;
    try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0; } catch { /* no matchMedia: run */ }
    if (document.hidden) return 0;
  }
  try { sessionStorage.setItem(IGNITED_KEY, '1'); } catch { /* private mode */ }
  root.setAttribute('data-ignition', '');

  // The row, together. A control the breakpoint has hidden is skipped, and
  // one already hot (a commit in flight on a reload) is left to its own
  // business.
  const row = [...document.querySelectorAll('.topbar button:not(.sys-lamp)')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  let lit = null;
  const crest = () => {
    lit = row.filter((el) => el.getAttribute('data-heat') !== 'hot');
    lit.forEach((el) => heat(el, true));
  };
  const cool = () => lit?.forEach((el) => heat(el, false));
  // The floor light takes the level as its opacity: a compositor property,
  // so nothing under it repaints (its gradient is drawn at the crest).
  const floor = document.querySelector('.room-floor');
  const setLevel = (level) => {
    _ignitionLevel = level;
    if (floor && root.getAttribute('data-theme') !== 'light') floor.style.opacity = String(Math.max(0, Math.min(1, level / IGNITE_CREST)));
  };
  const end = () => {
    root.removeAttribute('data-ignition');
    _ignitionT = -1;
    _ignitionLevel = 1;
    floor?.style.removeProperty('opacity');
  };

  _ignitionT = 0;
  setLevel(0);
  if (typeof requestAnimationFrame !== 'function') {
    setLevel(1);
    setTimeout(() => { crest(); setTimeout(cool, IGNITE_ROW_HOT_MS); }, IGNITE_ROW_AT_MS);
    setTimeout(end, IGNITE_HOLD_MS);
    return 1;
  }
  const heatCurve = easeToken('--ease-heat'), coolCurve = easeToken('--ease-cool');
  let last = 0, crested = false, cooled = false;
  const tick = (now) => {
    if (last) { const dt = Math.max(0, now - last); _ignitionT += dt > IGNITE_STALL_MS ? IGNITE_FRAME_MS : dt; }
    last = now;
    const t = _ignitionT;
    setLevel(igniteLevel(t, heatCurve, coolCurve));
    if (!crested && t >= IGNITE_ROW_AT_MS) { crested = true; crest(); }
    if (!cooled && t >= IGNITE_ROW_AT_MS + IGNITE_ROW_HOT_MS) { cooled = true; cool(); }
    if (t >= IGNITE_HOLD_MS) { end(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 1;
}

/** A cubic-bezier easing as a function of progress (Newton's method, then bisection). */
export function bezier(x1, y1, x2, y2) {
  const B = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const dB = (a, b, t) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) { const d = dB(x1, x2, t); if (Math.abs(d) < 1e-6) break; t -= (B(x1, x2, t) - x) / d; }
    if (!(t >= 0 && t <= 1) || Math.abs(B(x1, x2, t) - x) > 1e-4) {
      let lo = 0, hi = 1; t = x;
      for (let i = 0; i < 30; i++) { if (B(x1, x2, t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    }
    return B(y1, y2, t);
  };
}
/** A named easing off the root (`--ease-pop`), as a function; linear if unreadable. */
export function easeToken(name) {
  try {
    const m = getComputedStyle(document.documentElement).getPropertyValue(name).match(/cubic-bezier\(([^)]+)\)/);
    const n = m ? m[1].split(',').map(Number) : [];
    if (n.length === 4 && n.every(Number.isFinite)) return bezier(...n);
  } catch { /* no styles: linear */ }
  return (x) => x;
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

  // The one line that is always shown (K50c): the console's own version. K97:
  // read off <meta name="console-version"> (the title is the app's plain name
  // now); the title's old "vN.N.N" is the fallback for a shell that predates it.
  const ver = document.querySelector('meta[name="console-version"]')?.getAttribute('content')
    || (document.title.match(/\bv(\d+(?:\.\d+)+)/) || [])[1];
  const line = document.getElementById('settings-build-version');
  if (line) line.textContent = ver ? `console v${ver}` : 'console';
  el.innerHTML =
    `<div>service worker &nbsp;<span class="accent">${escapeHTML(sw)}</span></div>` +
    `<div style="margin-top:6px; word-break:break-word;">${
      mods.length ? mods.map(escapeHTML).join(' · ') : '// no import map — modules are unversioned'
    }</div>`;
}

// What the device actually gives the console to draw in, next to the build
// stamp and for the same reason: an installed PWA is a black box from the
// outside. A layout that comes up wrong on someone's tablet is otherwise
// diagnosed by guessing at numbers nobody can see — and the two guesses that
// produce an identical-looking gap at the bottom of the screen (a wrong
// safe-area inset vs. a viewport shorter than its window) are told apart by
// exactly these values. iPadOS 26's windowed web apps are the live case:
// env(safe-area-inset-*) is unreliable there, so what the CSS believes and
// what the screen shows have to be readable side by side.
//
// The insets are read back off a probe element rather than assumed, because
// env() is only resolvable in CSS — JS has no other way to see it.
export function _viewportReadout() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;left:0;top:0;" +
    "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) " +
    "env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v) => Math.round(parseFloat(v) || 0);
  const safe = {
    top: px(cs.paddingTop), right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom), left: px(cs.paddingLeft),
  };
  probe.remove();

  const vv = window.visualViewport;
  const modes = ["standalone", "fullscreen", "minimal-ui", "browser"];
  return {
    safe,
    layout: { w: window.innerWidth, h: window.innerHeight },
    zoom: uiZoom(),
    visual: vv
      ? { w: Math.round(vv.width), h: Math.round(vv.height), offsetTop: Math.round(vv.offsetTop) }
      : null,
    screen: { w: window.screen?.width ?? 0, h: window.screen?.height ?? 0 },
    dpr: window.devicePixelRatio || 1,
    mode: modes.find((m) => matchMedia(`(display-mode: ${m})`).matches) || "unknown",
  };
}

// ============== THE BOTTOM DOUBLE-COUNT (iPadOS 26) ==============
// Measured on an iPad Mini, iPadOS 26.5.2, console installed to the Home Screen:
//
//   layout 744x1101 · screen 744x1133 · safe area t32 r0 b20 l0
//
// `layout + safe-top` is exactly `screen`, and the topbar's own geometry
// confirms the canvas starts at screen y=0 — content really does draw under the
// status bar, which is what viewport-fit=cover asks for. So the 32px the system
// reserved for the status bar did not come off the top: it is stranded at the
// BOTTOM, outside the canvas, and nothing the page does can paint there.
//
// The bug we CAN fix is that the device then also reports a 20px bottom inset.
// That inset means "leave room, the home indicator overlaps you" — and it does
// not overlap us, because the system already held 32px below the canvas for it.
// Paying it twice pushes the tab bar's icons a further 20px up from an edge
// they were already short of, which is most of what "the console doesn't fill
// the window" looks like.
//
// So: pad only for whatever the inset asks BEYOND what the system already held.
// The formula can only ever reduce padding, never add it, so the worst case if
// a device reports something strange is losing up to one inset of clearance —
// not chrome pushed off-screen. Browser tabs are left alone: there the
// difference between the window and the screen is just a window, not an inset.
// Takes the readout rather than fetching it, so the arithmetic is a pure
// function of six numbers and can be checked against a real device's reading
// without a real device.
export function _correctSafeBottom(readout) {
  const r = readout || _viewportReadout();
  if (r.mode !== "standalone" && r.mode !== "fullscreen") return null;

  // screen.width/height do not swap with orientation on every engine — take the
  // axis by size and compare like with like.
  const portrait = r.layout.h >= r.layout.w;
  const screenH = portrait
    ? Math.max(r.screen.w, r.screen.h)
    : Math.min(r.screen.w, r.screen.h);
  if (!screenH) return null;

  const held = Math.max(0, screenH - r.layout.h);
  const pad = Math.max(0, r.safe.bottom - held);
  document.documentElement.style.setProperty("--sys-below", held + "px");
  document.documentElement.style.setProperty("--safe-bottom", pad + "px");
  return { held, pad };
}

export function _initViewportFrame() {
  const apply = () => _correctSafeBottom();
  apply();
  // Orientation flips both the insets and which screen axis is the height.
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
}

// (renderViewportStamp — the Settings "Display" panel — went in K50c: the
//  owner, on the phone: "too much stuff". _viewportReadout stays: it is what
//  the chrome itself measures the viewport with, and the tests drive it.)

// ============== COPY (K65) ==============
// One way the console puts text on the clipboard. ⚠️ `navigator.clipboard`
// IS UNDEFINED OUTSIDE A SECURE CONTEXT, and the console is reachable from
// one that is not: a phone or an iPad opening it at `http://<LAN ip>:8787`
// while `wrangler dev` runs. Reading `.writeText` off undefined throws
// synchronously, before any `.then` exists to catch it, and from an inline
// on*= handler that is an unhandled TypeError: the button does nothing and
// says nothing. So it shows the text instead, which is the whole point of
// the gesture and can be selected. `writeText` is called synchronously, in
// the tap's own call stack, because iOS refuses it anywhere else.
// Resolves true when it is on the clipboard.
export function copyText(text, { ok = '✓ copied', what = 'the text' } = {}) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    toast(`Copy needs a secure connection — ${what} is ${text}`, 'warning');
    return Promise.resolve(false);
  }
  return navigator.clipboard.writeText(text).then(
    () => { toast(ok, 'success'); return true; },
    () => { toast(`Copy failed — ${what} is ${text}`, 'warning'); return false; },
  );
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
  // A drop in flight is the console doing something, and the BAY is the
  // emitter (K40b): frosted glass over the light, so heat() on it brings the
  // pool up under the glass, lights the rim from inside and the legend with
  // it. The engine's area law keeps a panel this size soft — this is not the
  // wash K38c took out, it is a bay glowing. (The first cut put a rod along
  // the top edge; the owner's read: "crow-barred in". The rod primitive stays
  // in the stylesheet as the filament vocabulary; no bay carries one.)
  _bays.add(dz);
  ["dragenter", "dragover"].forEach(ev =>
    dz.addEventListener(ev, e => {
      e.preventDefault();
      dz.classList.add("over");
      bayHeat(dz, true);
    })
  );
  ["dragleave", "drop"].forEach(ev =>
    dz.addEventListener(ev, e => {
      e.preventDefault();
      dz.classList.remove("over");
      bayHeat(dz, false);
    })
  );
  dz.addEventListener("drop", e => {
    if (e.dataTransfer?.files?.length) onFiles([...e.dataTransfer.files]);
  });
  // A POINTER OVER THE BAY IS THE SAME FADE-UP (owner's call, 2026-10-02):
  // the drag-over light was the bay's best moment and a mouse never saw it,
  // so hover heats it too, on the same coil. Touch is excluded on purpose — a
  // tap opens the picker, and a touch screen gets the wake on arrival
  // instead. A bay that is not a seam (the cover slot once it holds a
  // picture) is a photograph, not glass, and stays dark.
  dz.addEventListener("pointerenter", e => {
    if (e.pointerType !== "touch" && dz.hasAttribute("data-seam")) bayHeat(dz, true);
  });
  dz.addEventListener("pointerleave", e => {
    if (e.pointerType !== "touch" && !dz.classList.contains("over")) bayHeat(dz, false);
  });
}

// ============== THE BAYS — one coil per bay ==============
// Three things heat a bay — a drop in flight, a pointer over it, and the wake
// on a touch screen — and they share ONE cool timer per bay, so a hover that
// ends while the wake is mid-hold cannot leave a stale timer to drop a bay a
// drag has just heated.
const _bays = new Set();
const _bayCool = new WeakMap();
const _bayWake = new WeakMap();
export function bayHeat(dz, on) { _bayCool.set(dz, heat(dz, on, _bayCool.get(dz))); }

// THE WAKE (owner's call, 2026-10-02). A touch screen has no hover, so the
// bays light themselves when you arrive: every time a view with a bay comes
// up, each visible bay takes the drag-over fade-up on --arm-heat, holds a beat
// at the crest, and lets go on --arm-cool — the coil's own asymmetry, so it
// reads as warmth arriving and leaving, not a flash. It is the rhythm of
// moving between surfaces, not a heartbeat: one bounded event per arrival,
// and nothing moves once it has cooled.
//
// Not under reduced motion (the engine jumps levels there — it would be a
// blink), not while the cold start runs (that already lights the bays), and
// not with a pointer that can hover (that pointer heats the bay itself).
export const BAY_WAKE_AT_MS = 140;     // after the swap has painted
export const BAY_WAKE_STEP_MS = 180;   // a second bay in the same view follows the first
export const BAY_WAKE_HOLD_MS = 1500;  // = --arm-heat: the rise completes and the cool begins — a crest, no plateau

function _canWake() {
  try {
    if (!matchMedia("(hover: none)").matches) return false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  } catch { return false; }
  return !document.documentElement.hasAttribute("data-ignition");
}

export function wakeBays(scope) {
  if (!scope || !_canWake()) return;
  const bays = [..._bays].filter((dz) => {
    if (!scope.contains(dz) || !dz.hasAttribute("data-seam")) return false;
    const r = dz.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  bays.forEach((dz, i) => {
    clearTimeout(_bayWake.get(dz));
    _bayWake.set(dz, setTimeout(() => {
      bayHeat(dz, true);
      _bayWake.set(dz, setTimeout(() => {
        if (!dz.classList.contains("over")) bayHeat(dz, false);
      }, BAY_WAKE_HOLD_MS));
    }, BAY_WAKE_AT_MS + i * BAY_WAKE_STEP_MS));
  });
}

// ============== A ROW OF CARDS WAKES ON ARRIVAL (K50f) ==============
// The owner: Publish's stats rail has "a beautiful hover … an ignition
// sequence for that, so that when you tap on that page a subtle little
// rhythmic sequence happens on those buttons. No changes to the lighting."
// So a row that carries `data-wake-row` has its cards played through their
// OWN hover, in order: each gets `data-wake` (the stylesheet maps it to the
// card's hover dial and backlight, on the same rise) for WAKE_ROW_HOLD_MS,
// WAKE_ROW_STEP_MS after the one before, and lets go on the tier's slow fall.
// The engine follows the dial as it follows a hover (dialing()). Bounded —
// one pass per arrival — and, unlike the bays' wake, on every device: a
// hover is something only a mouse could see. Off under reduced motion and
// while the cold start runs; a card already under a hand is skipped.
export const WAKE_ROW_AT_MS = 260;     // as the crossfade lands
export const WAKE_ROW_STEP_MS = 70;    // one card after the next: a wave, not a flash
export const WAKE_ROW_HOLD_MS = 420;   // the rise completes and holds a beat before the fall
const _rowTimers = new WeakMap();

export function wakeRows(scope) {
  if (!scope) return;
  try { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch { return; }
  if (document.documentElement.hasAttribute("data-ignition")) return;
  for (const row of scope.querySelectorAll("[data-wake-row]")) {
    _restRow(row);
    const cards = [...row.querySelectorAll('[data-tier="card"]')].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const timers = [];
    cards.forEach((card, i) => {
      const at = WAKE_ROW_AT_MS + i * WAKE_ROW_STEP_MS;
      timers.push(setTimeout(() => { if (!card.matches(":hover")) card.setAttribute("data-wake", ""); }, at));
      timers.push(setTimeout(() => card.removeAttribute("data-wake"), at + WAKE_ROW_HOLD_MS));
    });
    _rowTimers.set(row, timers);
  }
}
function _restRow(row) {
  for (const t of _rowTimers.get(row) || []) clearTimeout(t);
  _rowTimers.delete(row);
  for (const c of row.querySelectorAll("[data-wake]")) c.removeAttribute("data-wake");
}
function _restRows(scope) {
  if (!scope) return;
  for (const row of scope.querySelectorAll("[data-wake-row]")) _restRow(row);
}

// Leaving a view puts its bays out at once. They are display:none by then, so
// nobody sees it — and the next arrival lights them from dark instead of
// finding them still warm from the last visit.
function _restBays(scope) {
  if (!scope) return;
  for (const dz of _bays) {
    if (!scope.contains(dz) || dz.classList.contains("over")) continue;
    clearTimeout(_bayWake.get(dz));
    clearTimeout(_bayCool.get(dz));
    dz.removeAttribute("data-heat");
  }
}

// EVERY KEY GETS THE ROOM'S OWN LIGHT (K48, owner's call). The top row's
// controls read as keys set into glass because the light behind them is the
// engine's: it comes up through the room's own pores and pools on the ground
// under the key. A CSS imitation drew a second membrane inside the button, out
// of phase with the room's, and read as "drawn on". So every button in the
// content is licensed the way the top row is, with `data-backlit`, and the
// stylesheet tunes its light to the top row's (tight, a whisper of haze).
//
// Licensed here and not in each template so that a button rendered tomorrow by
// any surface gets it too. Two kinds keep the CSS light: a button in a plane
// (outside the light layer's host — the canvas sits under the scrim), and a
// button held in place while the content scrolls (fixed or sticky — the
// floating Link, the burst bar), whose light would be left behind in the
// layer. Each button is judged once.
// K49: FN's keys too (its bar's buttons and the cover bay's chips); a chip
// on a photograph keeps its own frosted clothes and no light.
const FLOAT_SEL = ".btn, .fn-btn, .fn-chip:not(.fn-chip--onmedia)";
const _floatSeen = new WeakSet();
function _heldInPlace(el, host) {
  for (let n = el; n && n !== host; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === "fixed" || p === "sticky") return true;
  }
  return false;
}
function _licenseFloat(btn, host) {
  if (_floatSeen.has(btn)) return;
  _floatSeen.add(btn);
  if (!btn.hasAttribute("data-backlit") && !_heldInPlace(btn, host)) btn.setAttribute("data-backlit", "");
}
export function licenseFloats(host = document.querySelector("[data-light-layer]")) {
  if (!host) return;
  for (const b of host.querySelectorAll(FLOAT_SEL)) _licenseFloat(b, host);
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches(FLOAT_SEL)) _licenseFloat(n, host);
        for (const b of n.querySelectorAll(FLOAT_SEL)) _licenseFloat(b, host);
      }
    }
  }).observe(host, { childList: true, subtree: true });
}
