// OAKLENS Field Console — sync.
//
// The library auto-sync (data/library.json auto-commits on change — library is
// infrastructure, not editorial content, so it never waits for a manual
// Publish) plus the pending-R2-delete drain and its Purge button.
//
// Sits BELOW the surfaces and the upload queue: libraryRemove() schedules a
// sync, and nothing here calls back up. The one thing it needs from above —
// "are library uploads still in flight?" — arrives through the fourth seam:
// init() registers upload's _libraryUploadsPending() via
// _registerLibraryUploadProbe(), because reading upload's queue variable from
// here would be an upward import the layering forbids (and one the callgraph
// cannot even see — variables are not calls).
//
// _librarySyncFailed is exported as a live binding: the reconnect/visibility
// resume paths (publish/session) read it to decide whether a failed index
// commit needs re-running.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { STATE, _pendingR2Deletes, setPendingR2Deletes, save, dropTrashForDeletedR2 } from '../console-state.js';
import { isLoggedIn, publishFiles, deleteAssets, isNotConfigured } from '../console-api.js';
import { showToast, logEvent } from '../console-telemetry.js';
import { toast } from './chrome.js';

// ============== LIBRARY AUTO-SYNC ==============
// Library is infrastructure (a staging area), not editorial content, so its
// metadata index (data/library.json) auto-commits to GitHub on change rather
// than waiting for a manual Publish. This keeps the index durable across browser
// sessions (e.g. private browsing) since the R2 images already persist.
let _librarySyncTimer = null;
let _librarySyncing = false;
export let _librarySyncFailed = false;   // set on failure → reconnect listener re-runs it

// The fourth seam. The auto-sync must pause while library uploads are still in
// flight, but the queue is a module-level variable in `upload`, which sits
// ABOVE this module and already imports it (the ingests schedule syncs).
// Reading `_uploadQueue` from here is an upward reference the callgraph cannot
// even see — variables are not calls — so the dependency is inverted like the
// other seams: init() registers a probe and sync only ever asks it. The
// default answers "none in flight", which is correct before wiring — nothing
// can enqueue until init() has run.
let _libraryUploadsInFlight = () => false;
export function _registerLibraryUploadProbe(fn) { _libraryUploadsInFlight = fn; }

export function scheduleLibrarySync() {
  // Debounce: wait 2 seconds after the last change, then sync. This collapses a
  // batch of uploads (or rapid deletes) into a single commit.
  clearTimeout(_librarySyncTimer);
  _librarySyncTimer = setTimeout(autoSyncLibrary, 2000);
}

export async function autoSyncLibrary() {
  if (_librarySyncing) return;
  if (!isLoggedIn()) return;

  // Don't commit while library uploads are still in flight — wait for the images
  // to land on the CDN so the committed index never points at a missing file.
  // Only queued/uploading items block; finished (done/failed/skipped) entries may
  // linger in the panel and must not stall the sync. (Asked through the probe —
  // the queue lives in `upload`, above this module.)
  if (_libraryUploadsInFlight()) {
    scheduleLibrarySync();   // retry after current uploads finish
    return;
  }

  _librarySyncing = true;

  try {
    const libraryJson = JSON.stringify(STATE.library.map(l => ({
      id: l.id,
      filename: l.filename || null,
      ...(l.kind ? { kind: l.kind } : {}),
      hash: l.hash || null,
      added_at: l.added_at || null,
    })), null, 2);

    await publishFiles([{ path: 'data/library.json', content: libraryJson }]);

    // Execute queued R2 deletions for library items
    const libR2 = _pendingR2Deletes.filter(d => d.surface === 'library');
    if (libR2.length) {
      const libKeys = libR2.flatMap(d => d.keys);
      try {
        // "keys cleared" — see the same wording in trashClearAll: an
        // idempotent delete proves absence, not prior existence.
        const delData = await deleteAssets(libKeys);
        toast(`✓ R2 cleanup: ${(delData.deleted || []).length} library keys cleared`, 'success');
      } catch (err) {
        toast(`⚠ R2 cleanup ${err.status ? 'error' : 'failed'}: ${err.message}`, 'error');
      }
      setPendingR2Deletes(_pendingR2Deletes.filter(d => d.surface !== 'library'));
      save();  // persist updated queue
    }

    logEvent('✓ library index committed', 'info');
    toast('✓ library synced to GitHub', 'success');
    _librarySyncFailed = false;
  } catch (err) {
    if (err.status === 401) return;   // API layer dropped to login; retry on next change
    if (isNotConfigured(err)) return; // no GitHub on this instance — the index
                                      // lives in localStorage; nothing to retry,
                                      // and the API layer already ledger-logged it
    _librarySyncFailed = true;
    if (err.offline) {
      showToast('⊘ offline — library sync queued for reconnect', { kind: 'warning', id: 'lib-offline' });
      logEvent('⊘ library sync deferred — offline', 'info');
      return;
    }
    console.error('[library-sync]', err.message);
    toast(`⚠ library sync failed: ${err.message}`, 'error');
    // Data is still in localStorage as a fallback — will retry on next change.
  } finally {
    _librarySyncing = false;
  }
}

// Show/hide the "Purge Queued R2" button based on whether there are orphaned
// pending deletes. Called after load, sync, trash operations.
export function updatePurgeR2Button() {
  const btn = document.getElementById('purge-r2-btn');
  if (!btn) return;
  if (_pendingR2Deletes.length && isLoggedIn()) {
    btn.style.display = '';
    btn.textContent = `⚠ Purge Queued R2 (${_pendingR2Deletes.length})`;
  } else {
    btn.style.display = 'none';
  }
}

// Manual fallback: force-drain all pending R2 deletions immediately, regardless
// of surface or imported status. Use when orphaned R2 keys survive a tab close
// and there's no other trigger to clean them up.
export async function drainOrphanedR2Deletes() {
  if (!_pendingR2Deletes.length) {
    toast('No pending R2 deletions', 'info');
    return;
  }
  if (!isLoggedIn()) {
    toast('⚠ Log in first', 'error');
    return;
  }

  const fired = [..._pendingR2Deletes];
  const allKeys = fired.flatMap(d => d.keys);
  if (!confirm(`Delete ${allKeys.length} orphaned R2 objects?\n\n${allKeys.slice(0, 10).join('\n')}${allKeys.length > 10 ? '\n…and ' + (allKeys.length - 10) + ' more' : ''}`)) return;

  try {
    const data = await deleteAssets(allKeys);
    toast(`✓ Purge: ${(data.deleted || []).length} R2 keys cleared`, 'success');
  } catch (err) {
    // Keep the queue on ANY failure (the old code dropped it when the server
    // reported an error, orphaning the keys with no other cleanup trigger).
    toast(`⚠ Purge ${err.status ? 'error' : 'failed'}: ${err.message}`, 'error');
    return;
  }

  setPendingR2Deletes([]);
  // These objects are now permanently gone — drop any sessionTrash rows that
  // pointed at them so the trash stops offering a dead ↩ RESTORE (same reason
  // as the publish path).
  dropTrashForDeletedR2(fired);
  save();
  updatePurgeR2Button();
}
