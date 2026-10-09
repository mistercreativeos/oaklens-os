// OAKLENS Field Console — init.
//
// The composition root, and the only module that knows every other one. It
// exists so nothing else has to: registerSurfaces() hands chrome its view
// renderers, its leave-cleanups and its long-press menus, hands sync the upload
// probe, and hands the FN menu and the share block each other — the six seams,
// all wired in one place. init() then boots
// state, chrome, dropzones, the resume-sync listeners and the service worker,
// and registers itself on DOMContentLoaded.
//
// Being last in the layer order is what lets it import freely: every name here
// points DOWN. Anything that ever needs to point up from a lower module gets a
// registration here instead — that is the pattern, and adding a direct import
// in the other direction is what re-tangles the graph.
//
// Extracted from console-ui.js 2026-07-29 — the last of fifteen. See
// dev/console-module-plan.md.

import { STATE, load, restoreSidebar, restoreFnBar, resetConsole } from '../console-state.js';
import { isLoggedIn } from '../console-api.js';
import { registerView, registerLongPress, refreshSurface, seatView, startView, refreshStageIndicators, themeInit, wireDropzone, _wireSheetDrag, _initKeyboardInsets, _initViewportFrame, _initStickyHeaders, _initLongPress, _initTabPulse, closeActionSheet, closeMoreSheet, igniteConsole, ignitionLevel, wakeBays, licenseFloats } from './chrome.js';
import { lightingInit } from './lighting.js';
import { _initHelp, helpIsOpen } from './help.js';
import { updatePurgeR2Button, _registerLibraryUploadProbe } from './sync.js';
import { _libraryUploadsPending } from './upload.js';
import { renderWall, renderNetwork, renderLibrary, wallIngest, libraryIngest } from './more-views.js';
import { renderArchive, archiveEnter, archiveIngestPhoto, archiveUpdatePreview, restoreGearMemory, setGearRemember } from './archive.js';
import { renderBuffer, bufferIngest, bufferPromote, bufferRemove, burstLinkMode, burstToggleFrame, enterBurstLinkMode, exitBurstLinkMode } from './buffer.js';
import { renderFN, fnHeroIngest, fnHeroClear, fnSetupEnhancements, fnCloseDrawer, fnExitFocus, fnFlushSave, fnEnter, _registerFnShare } from './fn-editor.js';
import { FocalModal, bufferFocal, loadOgCards } from './focal.js';
import { closeAssetLibrary } from './asset-library.js';
import { registerShareRepaint, shareNote, shareCloseSheet } from './share.js';
import { cardsRepaint } from './cards.js';
import { renderAudio, audioAddFiles } from './audio.js';
import { _pulseCloseLog, _pulseCloseTray } from './pulse.js';
import { renderPublish, syncFromServer } from './publish.js';
import { checkAuth, closeSettings, _updateSettingsDots, _checkSessionExpiry, _initOfflineIndicator, applyInstancePosture, _wireRingJoin, maybeShowWelcome, maybeResumePublishSetup } from './session.js';
import { renderBench } from './bench.js';
import { bridgeWire } from './bridge.js';

// ============== INIT ==============
// Develop-in thumbnails (craft pass): grid images carry opacity:0 until
// is-loaded lands. load doesn't bubble but IS capturable, so one document
// listener covers every render path (innerHTML included) with no per-render
// wiring; the sweep catches images whose load beat this listener.
export function wireDevelopIn() {
  const mark = (img) => img.classList.add('is-loaded');
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLImageElement) mark(e.target);
  }, true);
  document.querySelectorAll('img').forEach((img) => { if (img.complete) mark(img); });
  // Failsafe for any cache-hit whose load fired before the listener could
  // see it: sweep freshly-inserted subtrees for already-complete images. A
  // thumbnail must never be able to stay at opacity:0.
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        const imgs = node.matches?.('img') ? [node] : node.querySelectorAll?.('img') || [];
        for (const img of imgs) if (img.complete && img.naturalWidth) mark(img);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// The composition root: the one place that knows both the chrome primitives and
// every surface, so neither has to know the other. Runs first in init(), before
// anything can route or long-press.
export function registerSurfaces() {
  // Fourth seam: sync must not commit the library index while library uploads
  // are in flight, and the queue lives above it — hand sync the probe here,
  // where both sides are visible, like every other registration below.
  _registerLibraryUploadProbe(_libraryUploadsPending);

  // Fifth and sixth seams, both about the share block (chunk 8). The FN editor's
  // ⋯ menu offers "Share this note" but sits four layers below the painter, so
  // it gets the action registered rather than imported; and a stamp finishes
  // inside share.js, which cannot repaint the studio rail that drew the button.
  _registerFnShare(shareNote);
  registerShareRepaint(cardsRepaint);

  registerView("buffer", {
    render: renderBuffer,
    // Link mode is entered only from the buffer and its selection is ephemeral,
    // so navigating away backs out of it.
    onLeave: () => { if (burstLinkMode) exitBurstLinkMode(); },
  });
  registerView("archive", { render: renderArchive, onEnter: archiveEnter });
  registerView("fn", {
    render: renderFN,
    // The insert drawer is a modal sheet and lives OUTSIDE the view (it has to
    // — .layout carries a z-index, so a sheet inside it renders under the tab
    // bar). Nothing hides it when you navigate away, so close it here.
    // Leaving also leaves focus mode (a class on <body>) and lands a save
    // still waiting on its debounce.
    onLeave: () => { fnFlushSave(); fnCloseDrawer(); fnExitFocus(); },
    onEnter: fnEnter,
  });
  registerView("wall",    renderWall);
  registerView("friends", renderNetwork);
  registerView("library", renderLibrary);
  registerView("audio",   renderAudio);
  registerView("publish", renderPublish);
  registerView("bench",   () => renderBench().catch(err => console.error('Bench render error:', err)));

  registerLongPress({
    hostId: "buffer-display",
    itemSelector: ".buffer-frame",
    title: "FRAME ACTIONS",
    // Link mode owns its own taps; and with `?` on, a held thumb must not open
    // a menu under the dim — help absorbs clicks and drops itself, but a
    // long-press is a timer on pointerdown and only this gate can see it.
    enabled: () => !burstLinkMode && !helpIsOpen(),
    actions: (id) => [
      { icon: "▲", label: "Promote to Archive", fn: () => bufferPromote(id) },
      { icon: "◎", label: "Focal point",        fn: () => bufferFocal(id) },
      { icon: "⛓", label: "Link burst…",        fn: () => enterBurstLinkMode() },
      { icon: "×", label: "Remove frame", danger: true, fn: () => bufferRemove(id) },
    ],
  });
}

export function init() {
  registerSurfaces();
  load();
  themeInit();
  restoreSidebar();
  restoreFnBar();
  wireDevelopIn();
  lightingInit({ room: ignitionLevel });   // the bloom; finds its own emitters, inert where a 2D context cannot be had; the cold start's level is chrome's
  // WHERE YOU START (chrome.js, START VIEW): the markup marks no surface
  // active, so the first one is resolved and seated here, with its resting
  // lamp (K40d) — before the cold start, which gives whatever is showing the
  // full sequence. It is rendered with the others at the foot of init().
  const start = startView();
  seatView(start);
  const coldStart = igniteConsole();  // the cold start (K41b): once per session, bounded, off under reduced motion
  _initHelp();      // the `?` key; the overlay itself builds on first use
  loadOgCards();   // mark frames that already have a live OG card (persists across reloads)
  refreshStageIndicators();
  _updateSettingsDots();
  updatePurgeR2Button();

  wireDropzone("buffer-dropzone", "buffer-file-input", bufferIngest);
  wireDropzone("archive-dropzone", "archive-file-input", archiveIngestPhoto);
  wireDropzone("wall-dropzone", "wall-file-input", wallIngest);
  wireDropzone("fn-hero-slot", "fn-hero-input", fnHeroIngest);
  wireDropzone("library-dropzone", "library-file-input", libraryIngest);
  wireDropzone("audio-dropzone", "audio-file-input", (files) => audioAddFiles(files));
  // The Bridge is a drop target as a whole page, not a bay; it wires its own.
  bridgeWire();
  // The first view is seated, not routed, so its bays would never wake on a
  // touch screen. The cold start lights them when it runs.
  if (!coldStart) wakeBays(document.querySelector(".view.active"));
  licenseFloats();
  document.getElementById("fn-hero-clear")?.addEventListener("click", e => {
    e.stopPropagation();
    fnHeroClear();
  });

  // Grabber drag-to-dismiss on every sheet-presented surface (touch band only;
  // the wiring is inert on desktop where modals stay centered dialogs).
  _wireSheetDrag("settings-modal", closeSettings);
  _wireSheetDrag("focal-modal", () => FocalModal.close());
  _wireSheetDrag("asset-library-modal", closeAssetLibrary);
  _wireSheetDrag("more-sheet", closeMoreSheet);
  _wireSheetDrag("pulse-log-sheet", _pulseCloseLog);
  _wireSheetDrag("fn-drawer", fnCloseDrawer);
  _wireSheetDrag("share-sheet", shareCloseSheet);

  let _lastFocusSync = 0;
  checkAuth();
  _wireRingJoin();          // ring join mailto; must be built at runtime, not markup
  applyInstancePosture();   // demo badge + truthful deploy copy; async, cosmetic
  maybeShowWelcome();       // first run only: the site decides, once (src/api/welcome.js)
  maybeResumePublishSetup();   // a Turn on Publish left open by a reloaded tab
  if (isLoggedIn()) {
    // At once, with the Bridge's first reads (K76): the lamp goes amber once
    // and turns green when the console is ready. (It waited 400ms, which
    // showed a green it then took back.) Quiet: the lamp is the news.
    setTimeout(() => syncFromServer({ quiet: true }), 0);
    _lastFocusSync = Date.now();
  } else {
    const el = document.getElementById('sync-status');
    if (el) el.textContent = '// Log in to enable auto-sync';
  }

  // Auto-sync when the app regains focus. A phone/tablet keeps a PWA's page
  // alive across backgrounding, so init()'s one-shot sync never reruns — a
  // console left open for hours (an iPad mini overnight) silently drifts from
  // main and can then republish stale state over another device's fresh commit.
  // Re-pulling on resume keeps returning-to-the-app fresh. Throttled so rapid
  // app switches don't hammer GitHub; skipped when logged out or offline.
  //
  // Three signals for full Android + iOS coverage, all funneled through one
  // throttle so overlapping events fire at most one sync:
  //   • visibilitychange   — the reliable app/tab foreground signal on both
  //     Android Chrome and iOS Safari, standalone PWAs included.
  //   • focus              — window refocus (desktop, some mobile).
  //   • pageshow(persisted) — back/forward bfcache restore, which on both
  //     platforms can skip visibilitychange entirely.
  const FOCUS_SYNC_MIN_GAP = 60_000;   // at most one resume-driven pull per minute
  function _autoSyncOnFocus() {
    if (document.visibilityState === 'hidden') return;
    if (!isLoggedIn() || !navigator.onLine) return;
    const now = Date.now();
    if (now - _lastFocusSync < FOCUS_SYNC_MIN_GAP) return;
    _lastFocusSync = now;
    syncFromServer({ quiet: true });
  }
  document.addEventListener('visibilitychange', _autoSyncOnFocus);
  window.addEventListener('focus', _autoSyncOnFocus);
  window.addEventListener('pageshow', (e) => { if (e.persisted) _autoSyncOnFocus(); });

  // Lite offline shell + session-lifetime watch (field/iPad QOL)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/dev/sw.js').catch(() => {});
  }
  _initOfflineIndicator();
  // Before the keyboard watcher: it reads the same viewport, and the safe-area
  // correction decides how tall the bottom chrome is.
  _initViewportFrame();
  _initKeyboardInsets();
  _initStickyHeaders();
  _initLongPress();
  _initTabPulse();
  setInterval(_checkSessionExpiry, 60_000);

  // All six are text inputs now — camera/lens/medium stopped being <select>s
  // when the gear list opened up (2026-08-19), and "input" covers typing and
  // picking a saved suggestion alike.
  ["arch-title","arch-sub","arch-loc","arch-cam","arch-lens","arch-med"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", archiveUpdatePreview);
  });
  // Gear memory: fill the camera/lens/medium suggestion lists and prefill the
  // compose form with the last gear staged. Safe here — load() ran at the top
  // of init(), so the lists can already draw on the frames in STATE.
  restoreGearMemory();
  document.getElementById("arch-gear-remember")?.addEventListener("change", e => {
    setGearRemember(e.target.checked);
  });
  archiveUpdatePreview();

  fnSetupEnhancements();

  renderBuffer();
  renderArchive();
  renderFN();
  renderWall();
  renderNetwork();
  renderLibrary();
  renderAudio();
  // The surfaces above are drawn whether or not they are showing; any other
  // start (cards, pulse, publish, bench) is drawn now that it is up.
  if (!["buffer", "archive", "fn", "wall", "friends", "library", "audio"].includes(start)) refreshSurface(start);

  document.addEventListener("keydown", e => {
    if (e.altKey && e.key.toLowerCase() === "r") { e.preventDefault(); resetConsole(); }
  });

  // --- Burst linking: frame selection (delegated on the stable buffer container) ---
  document.getElementById("buffer-display")?.addEventListener("click", e => {
    if (!burstLinkMode) return;            // normal click behavior preserved otherwise
    const frame = e.target.closest(".buffer-frame");
    if (!frame) return;
    e.preventDefault();
    e.stopPropagation();
    burstToggleFrame(frame.dataset.id, frame.closest(".buffer-grid")?.dataset.day);
  });

  // --- Escape: close the open sheet, else exit Link mode ---
  // Link mode is entered ONLY by an explicit action — the ⛓ LINK button
  // (toggleBurstLinkMode) or the long-press "Link burst…" menu item. There is
  // deliberately no Shift/keyboard shortcut: a bare Shift used to flip the
  // buffer into Link mode, so ordinary keystrokes hijacked clicks into linking
  // frames "out of nowhere." Escape still backs out cleanly.
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!document.getElementById("action-sheet")?.classList.contains("hidden")) { closeActionSheet(); return; }
    if (!document.getElementById("more-sheet")?.classList.contains("hidden")) { closeMoreSheet(); return; }
    if (!document.getElementById("pulse-log-sheet")?.classList.contains("hidden")) { _pulseCloseLog(); return; }
    // The glyph menu is a panel, not a sheet, so it reads `.open` rather than
    // `.hidden` — but it is the topmost thing on the Pulse stage when it is up,
    // and Escape should reach it before anything underneath.
    if (document.getElementById("pulse-tray")?.classList.contains("open")) { _pulseCloseTray(); return; }
    // The FN insert drawer is a sheet too — but fn-editor.js owns its Escape
    // (it unwinds the ⋯ menu and the preview panel in the same press), so this
    // one only has to not swallow the key on the way past.
    if (burstLinkMode) { exitBurstLinkMode(); return; }
  });
}

document.addEventListener("DOMContentLoaded", init);
