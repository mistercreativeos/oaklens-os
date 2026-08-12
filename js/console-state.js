// OAKLENS // FIELD CONSOLE — state core (ES module).
//
// Phase 3 of the console decomposition: the in-memory STATE, its localStorage
// persistence, stage counters, session trash, the pending R2-delete queue, and
// persisted UI preferences (sidebar) live here. dev/field-console.html imports
// this module and mirrors its exports onto window, so the remaining classic
// script and inline on*-handlers keep working unchanged.
//
// Network calls go through js/console-api.js (real import below).
//
// Toasts + error latching route through js/console-telemetry.js (imported).
//
// Transitional coupling: functions here still call rendering globals that
// js/console-ui.js defines (refreshStageIndicators, renderTrash, the render*
// family incl. renderAudio, showView, fnNewPost, isVideoAsset,
// scheduleLibrarySync, updatePurgeR2Button). Those resolve through the global
// scope at call time.
//
// Mutable-array contract: sessionTrash and _pendingR2Deletes are const arrays
// mutated in place (never reassigned), so the module bindings and the window
// mirrors are always the same object. Replace contents via setPendingR2Deletes
// or .length = 0 — never with `= []`.

import { deleteAssets, isLoggedIn } from './console-api.js';
import { showToast, latchError } from './console-telemetry.js';

// ============== STATE ==============
export const STATE = {
  buffer:     [],   // {id, image (dataURL), filename, captured_at, published_at, archived: false}
  archive:    [],   // {id, image, filename, title, sub, location, camera, lens, medium, hash, slug, added_at}
  posts:      [],   // {id, fn_id, title, location, date, body (markdown), added_at}
  wallpapers: [],   // {id, src, filename, title, desc, isNew}
  barrel:     [],   // {id, date, title, url}
  friends:    [],   // {id, name, tag, location, url, added_at} — About §004 NETWORK / FRIENDS OF
  library:    [],   // {id, filename, hash, added_at, _uploaded, _uploading, _uploadError} — pre-staged, never published
  audio:      [],   // {id, slug, filename, title, sub, duration, peaks, featured, episode, download, added_at}
  staged:     {     // tracks unpublished changes per surface
    buffer: 0, archive: 0, posts: 0, wallpapers: 0, barrel: 0, friends: 0, library: 0, audio: 0
  }
};

export const STORAGE_KEY = "oaklens_console_v01";

// ============== R2 CLEANUP QUEUE ==============
// Tracks R2 keys to delete when publishing or library auto-syncing.
// Entries: { keys: [...], surface: 'buffer'|'archive'|..., entryId: '...' }
export const _pendingR2Deletes = [];

// Replace the queue's contents in place (identity-preserving — see header).
export function setPendingR2Deletes(items) {
  _pendingR2Deletes.length = 0;
  _pendingR2Deletes.push(...items);
}

// ============== PERSISTENCE ==============
export function save() {
  try {
    // Strip base64 image blobs before saving — they eat localStorage
    const lean = JSON.parse(JSON.stringify(STATE));
    lean.buffer.forEach(b => { delete b.image; });
    lean.archive.forEach(a => { delete a.image; });
    lean.posts.forEach(p => { if (p.hero && p.hero.startsWith("data:")) delete p.hero; });
    lean.wallpapers.forEach(w => { if (w.src && w.src.startsWith("data:")) delete w.src; });
    lean.library.forEach(l => { delete l.image; });

    // Drop imported entries — they re-sync from GitHub on next login, so spending
    // the (~5MB) localStorage budget persisting them risks a silent quota failure
    // that loses locally-created entries. Library now syncs from GitHub too (and
    // auto-publishes on change), so its imported entries are safe to drop as well —
    // locally-created library entries carry no _imported flag and are kept here as
    // a fallback until the next sync re-imports them.
    lean.buffer = lean.buffer.filter(b => !b._imported);
    lean.archive = lean.archive.filter(a => !a._imported);
    lean.wallpapers = lean.wallpapers.filter(w => !w._imported);
    lean.barrel = lean.barrel.filter(b => !b._imported);
    lean.friends = lean.friends.filter(f => !f._imported);
    lean.posts = lean.posts.filter(p => !p._imported);
    lean.library = lean.library.filter(l => !l._imported);
    lean.audio = (lean.audio || []).filter(a => !a._imported);

    const json = JSON.stringify(lean);
    const sizeKB = Math.round(json.length / 1024);

    localStorage.setItem(STORAGE_KEY, json);

    // Persist pending R2 deletions so queued cleanups survive tab closes.
    // Stored separately to avoid bloating the main STATE budget.
    try {
      if (_pendingR2Deletes.length) {
        localStorage.setItem('oaklens_pending_r2_deletes', JSON.stringify(_pendingR2Deletes));
      } else {
        localStorage.removeItem('oaklens_pending_r2_deletes');
      }
    } catch { /* non-critical — main STATE was already saved */ }

    // Warn when approaching 4MB (localStorage limit is ~5MB)
    if (sizeKB > 4000) {
      console.warn(`[save] localStorage: ${sizeKB}KB — approaching 5MB limit`);
      showToast(`⚠ Storage: ${sizeKB}KB / ~5000KB — consider clearing old buffer entries`, { kind: 'error' });
    }
  } catch (e) {
    console.error('[save] localStorage write failed:', e);
    latchError('storage', 'localStorage full — data NOT saved');
    showToast("⚠ localStorage full — data NOT saved. Clear old entries or export.", { kind: 'error' });
  }
}
export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.assign(STATE, data);
  } catch(e){ console.warn("load failed", e); }

  // Restore persisted R2 deletion queue (survives tab close)
  try {
    const r2Raw = localStorage.getItem('oaklens_pending_r2_deletes');
    if (r2Raw) {
      const restored = JSON.parse(r2Raw);
      if (Array.isArray(restored) && restored.length) {
        setPendingR2Deletes(restored);
        console.log(`[load] restored ${restored.length} pending R2 deletion(s)`);
      }
    }
  } catch { /* non-critical */ }

  // Reconcile uploads interrupted by a reload/tab kill. The upload queue holds
  // generated variants in memory only, so an entry still flagged _uploading
  // after a restart has NO upload behind it and never will — the image bytes
  // are gone (iOS jetsams backgrounded PWA tabs; no blob persistence by
  // design). Convert to a visible failure so the publish gates block it, the
  // frame shows ✕ FAILED, and the user knows exactly which files to re-drop.
  // Without this, the entry would sail through publish and commit a filename
  // pointing at a CDN object that doesn't exist.
  let interrupted = 0;
  for (const surface of ['buffer', 'archive', 'wallpapers', 'library', 'audio']) {
    for (const e of STATE[surface] || []) {
      if (e && e._uploading) {
        delete e._uploading;
        e._uploadError = 'interrupted by reload — re-drop this file';
        interrupted++;
      }
    }
  }
  if (interrupted) {
    const n = interrupted, pl = n > 1 ? 's' : '';
    latchError('upload', `${n} upload${pl} interrupted by reload — re-drop the ✕ FAILED frame${pl}`);
    showToast(`⚠ ${n} upload${pl} interrupted by reload — marked ✕ FAILED, re-drop to recover`, { kind: 'error' });
  }
}

// ============== STAGE TRACKING ==============
export function bumpStage(surface, delta) {
  if (delta === undefined) delta = 1;
  STATE.staged[surface] = Math.max(0, (STATE.staged[surface] || 0) + delta);
  refreshStageIndicators();
  save();
}
export function clearStage() {
  Object.keys(STATE.staged).forEach(k => STATE.staged[k] = 0);
  refreshStageIndicators();
  save();
}
export function totalStaged() {
  // Library is a staging area only — it never publishes, so it doesn't
  // contribute to the "pending changes" count surfaced in the publish UI.
  return Object.entries(STATE.staged)
    .filter(([surface]) => surface !== 'library')
    .reduce((sum, [, n]) => sum + n, 0);
}

// ============== SESSION TRASH ==============
export const sessionTrash = [];

export function trashItem(surface, id) {
  const arr = STATE[surface];
  const idx = arr.findIndex(x => x.id === id);
  if (idx < 0) return;
  const [removed] = arr.splice(idx, 1);
  sessionTrash.unshift({
    surface,
    item: removed,
    deletedAt: new Date().toLocaleTimeString(),
    label: removed.title || removed.fn_id || removed.filename || (surface + " item"),
  });
  // Imported items were already published — trashing them is a new pending deletion (+1).
  // Newly-added items (never published) — trashing cancels the pending add (-1).
  bumpStage(surface, removed._imported ? 1 : -1);

  // Queue R2 cleanup for uploaded items
  if ((removed._uploaded || removed._imported) && removed.filename) {
    const base = removed.filename.replace(/\.[^.]+$/, '');
    let keys;
    if (surface === 'audio') {
      // One canonical object per track — no derived variants to chase, which
      // is the whole reason audio lives in its own flat prefix.
      keys = [`audio/${removed.filename}`];
    } else if (surface === 'library' && isVideoAsset(removed)) {
      // Video assets live under videos/ as the original clip + a poster webp
      keys = [
        `videos/${removed.filename}`,
        `videos/posters/${base}.webp`,
      ];
    } else {
      const folder = surface === 'wallpapers' ? 'wallpaper' : 'archive';
      keys = [
        `${folder}/${base}-480w.webp`,
        `${folder}/${base}-1024w.webp`,
        `${folder}/${base}-2048w.webp`,
      ];
      if (surface === 'wallpapers' && removed.fullres) {
        keys.push(`wallpaper/full/${removed.fullres}`);
      }
    }
    _pendingR2Deletes.push({ keys, surface, entryId: removed.id });
  }

  save();
  renderTrash();
  // Re-render affected surface
  const renderers = {
    buffer: renderBuffer,
    archive: renderArchive,
    posts: () => { renderFN(); fnNewPost(); },
    wallpapers: renderWall,
    barrel: renderBarrel,
    friends: renderNetwork,
    library: renderLibrary,
    audio: renderAudio,
  };
  renderers[surface]?.();
  showToast("Moved to trash: " + sessionTrash[0].label, { kind: 'warning' });
}

export function trashRestore(trashIndex) {
  const trashed = sessionTrash.splice(trashIndex, 1)[0];
  if (!trashed) return;
  STATE[trashed.surface].unshift(trashed.item);
  // Reverse of trashItem: restoring a published item cancels the pending deletion (-1);
  // restoring a new item reinstates the pending add (+1).
  bumpStage(trashed.surface, trashed.item._imported ? -1 : 1);
  // Cancel any queued R2 deletion for this item
  setPendingR2Deletes(_pendingR2Deletes.filter(d => d.entryId !== trashed.item.id));
  save();
  if (trashed.surface === 'library') scheduleLibrarySync();
  renderBuffer(); renderArchive(); renderFN();
  renderWall(); renderBarrel(); renderNetwork(); renderLibrary(); renderAudio(); renderTrash();
  showToast("Restored: " + trashed.label, { kind: 'success' });
}

export function trashClearAll() {
  if (!sessionTrash.length) return;
  if (!confirm("Permanently discard " + sessionTrash.length + " trashed item(s)?")) return;

  // Determine which R2 deletions can fire immediately vs. must wait for publish.
  // - Non-imported items: safe to delete now (no live JSON reference).
  // - Imported LIBRARY items: also safe — library is never rendered on the live site,
  //   and autoSyncLibrary() already committed the updated index.
  // - Imported non-library items (archive/buffer/wall/barrel): defer to publish —
  //   their R2 files are still referenced by the live site until the JSON is committed.
  if (_pendingR2Deletes.length && isLoggedIn()) {
    const immediateIds = new Set(
      sessionTrash
        .filter(t => !t.item._imported || t.surface === 'library')
        .map(t => t.item.id)
    );
    const immediateDeletes = _pendingR2Deletes.filter(d => immediateIds.has(d.entryId));
    const deferredDeletes = _pendingR2Deletes.filter(d => !immediateIds.has(d.entryId));

    if (immediateDeletes.length) {
      const keys = immediateDeletes.flatMap(d => d.keys);
      // "keys cleared", never "removed": R2's delete is idempotent, so
      // data.deleted counts delete calls that succeeded — a cleared key
      // verifiably no longer exists, but may never have (e.g. a failed upload).
      deleteAssets(keys)
        .then(data => showToast(`✓ R2 cleanup: ${(data.deleted || []).length} keys cleared`, { kind: 'success' }))
        .catch(err => showToast(`⚠ R2 cleanup ${err.status ? 'error' : 'failed'}: ${err.message}`, { kind: 'error' }));
    }

    setPendingR2Deletes(deferredDeletes);
    save();  // persist updated queue

    if (deferredDeletes.length) {
      const deferredKeys = deferredDeletes.flatMap(d => d.keys).length;
      showToast(`Trash emptied · ${deferredKeys} R2 objects queued for next publish`, { kind: 'warning' });
    }
  }

  sessionTrash.length = 0;
  renderTrash();
  if (!_pendingR2Deletes.length) showToast("Trash emptied", { kind: 'success' });
  updatePurgeR2Button();
}

// Once an item's R2 variants are PERMANENTLY deleted — the publish commit fires
// the queued deletes, or the owner drains them via "Purge Queued R2" — its
// sessionTrash entry can no longer be restored: the media is gone for good and
// (for published/live surfaces) the removal is already committed to main. Leaving
// a ↩ RESTORE button on it is the bug the owner hit — the trash offering to
// "restore" frames whose R2 files no longer exist. Drop the matching entries so
// the affordance disappears exactly when it stops being real. Keyed off the
// deletes that ACTUALLY fired, so a trashed library item (its R2 delete is
// deferred, not fired here) keeps its still-valid restore. Caller passes the
// fired-delete descriptors ({ entryId }); returns how many trash rows were dropped.
export function dropTrashForDeletedR2(firedDeletes) {
  if (!sessionTrash.length || !Array.isArray(firedDeletes) || !firedDeletes.length) return 0;
  const goneIds = new Set(firedDeletes.map((d) => d.entryId).filter(Boolean));
  if (!goneIds.size) return 0;
  let dropped = 0;
  for (let i = sessionTrash.length - 1; i >= 0; i--) {
    if (goneIds.has(sessionTrash[i].item.id)) {
      sessionTrash.splice(i, 1);
      dropped++;
    }
  }
  if (dropped) renderTrash();
  return dropped;
}

// ============== SIDEBAR COLLAPSE ==============
// Reclaim the 200px nav strip without dropping into full focus mode. Persisted so
// the choice sticks across sessions (focus mode stays the separate "go dark" path).
const SIDEBAR_KEY = 'oaklens_sidebar_collapsed';
function _applySidebarBtn(collapsed) {
  const btn = document.getElementById('sidebar-toggle');
  if (!btn) return;
  btn.textContent = collapsed ? '››' : '‹‹';
  btn.title = collapsed ? 'Show navigation' : 'Collapse navigation';
}
export function toggleSidebar() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch {}
  _applySidebarBtn(collapsed);
}
export function restoreSidebar() {
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_KEY) === '1'; } catch {}
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  _applySidebarBtn(collapsed);
}

// The mobile sibling of the sidebar collapse: on the tab-bar band (phone/tablet)
// there's no sidebar to reclaim — the bottom tab bar is the chrome eating writing
// space. This hides it while in Field Notes (the CSS gates the effect to #view-fn
// so the preference never strands the user bar-less on a nav-only surface).
// Persisted so a travel-keyboard setup sticks across sessions. Full focus mode
// stays the separate "go dark" path.
const FN_BAR_KEY = 'oaklens_fn_bar_hidden';
function _applyFnBarBtns(hidden) {
  const glyph = hidden ? '▴' : '▾';
  const label = hidden ? 'Show tab bar' : 'Hide tab bar';
  // Wide header toggle carries a label; the portrait action-bar one is glyph-only.
  const wide = document.getElementById('fn-bar-toggle');
  const mini = document.getElementById('fn-bar-toggle-p');
  for (const [btn, text] of [[wide, glyph + ' BAR'], [mini, glyph]]) {
    if (!btn) continue;
    btn.textContent = text;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    btn.classList.toggle('active', hidden);
  }
}
export function toggleFnBar() {
  const hidden = document.body.classList.toggle('fn-bar-hidden');
  try { localStorage.setItem(FN_BAR_KEY, hidden ? '1' : '0'); } catch {}
  _applyFnBarBtns(hidden);
}
export function restoreFnBar() {
  let hidden = false;
  try { hidden = localStorage.getItem(FN_BAR_KEY) === '1'; } catch {}
  document.body.classList.toggle('fn-bar-hidden', hidden);
  _applyFnBarBtns(hidden);
}

// ============== RESET ==============

export function resetConsole() {
  if (!confirm("Wipe ALL in-memory data? This clears localStorage. Cannot be undone.")) return;
  localStorage.removeItem(STORAGE_KEY);
  sessionTrash.length = 0;
  Object.assign(STATE, {
    buffer: [], archive: [], posts: [], wallpapers: [], barrel: [], friends: [], library: [], audio: [],
    staged: { buffer: 0, archive: 0, posts: 0, wallpapers: 0, barrel: 0, friends: 0, library: 0, audio: 0 }
  });
  refreshStageIndicators();
  renderTrash();
  showView("buffer");
  showToast("✓ console reset", { kind: 'success' });
}
