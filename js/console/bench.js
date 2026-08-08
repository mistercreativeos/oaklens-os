// OAKLENS Field Console — bench.
//
// The darkroom queue: the D1-backed list of RAW frames waiting to be
// developed, their status/notes edits, and the authed download of a RAW
// original through the worker's signed B2 proxy.
//
// Self-contained by design — it talks to its own API endpoints and draws its
// own view, touching no other surface and no shared STATE. That is why it
// stands alone rather than riding with the other More-sheet surfaces.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { fetchBench, patchBenchEntry, deleteBenchEntry, clearBenchDone, fetchRawBlob } from '../console-api.js';
import { toast, escapeHTML } from './chrome.js';
import { CDN_BASE } from './assets.js';

let BENCH_DATA = null;
let BENCH_FILTER = 'ACTIVE';
let BENCH_CURRENT_ENTRY_ID = null;

// ============== BENCH ==============
export async function renderBench() {
  const grid = document.getElementById('bench-grid');
  const empty = document.getElementById('bench-empty');
  const stats = document.getElementById('bench-stats');
  const clearBtn = document.getElementById('bench-clear-done-btn');
  const countEl = document.getElementById('nav-count-bench');

  if (!BENCH_DATA) {
    grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">LOADING...</div>';
    empty.style.display = 'none';
    await fetchBenchData();
  }

  if (!BENCH_DATA) return; // Error fetching

  const queued = BENCH_DATA.filter(b => b.status === 'queued').length;
  const inProgress = BENCH_DATA.filter(b => b.status === 'in-progress').length;
  const done = BENCH_DATA.filter(b => b.status === 'done').length;

  stats.textContent = `// ${queued} QUEUED · ${inProgress} IN-PROGRESS · ${done} DONE`;
  if (countEl) countEl.textContent = queued + inProgress;
  const sheetCount = document.getElementById('sheet-count-bench');
  if (sheetCount) sheetCount.textContent = queued + inProgress;
  
  clearBtn.style.display = done > 0 ? 'block' : 'none';

  let filtered = BENCH_DATA;
  if (BENCH_FILTER === 'ACTIVE') {
    filtered = BENCH_DATA.filter(b => b.status !== 'done');
  } else if (BENCH_FILTER !== 'ALL') {
    filtered = BENCH_DATA.filter(b => b.status.toLowerCase() === BENCH_FILTER.toLowerCase());
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    grid.innerHTML = filtered.map(item => {
      let badgeClass = item.status === 'in-progress' ? 'in-progress' : (item.status === 'done' ? 'done' : 'queued');
      let isDone = item.status === 'done' ? 'status-done' : '';
      return `
        <div class="bench-card ${isDone}" onclick="openBenchDetail('${item.id}')">
          <img class="bench-preview" src="${CDN_BASE}/${item.preview}" loading="lazy" onerror="this.style.display='none'">
          <div class="bench-filename">${escapeHTML(item.raw_filename || item.id.split('_').pop() + '.RW2')}</div>
          <div class="bench-date">${escapeHTML(item.session_date || item.id.split('_')[0])}</div>
          <div class="bench-badge ${badgeClass}">[${item.status || 'queued'}]</div>
        </div>
      `;
    }).join('');
  }
}

export async function fetchBenchData() {
  if (!getToken()) return;
  try {
    BENCH_DATA = await fetchBench();
  } catch (err) {
    console.error(err);
    BENCH_DATA = [];
    toast("Failed to load Bench data", "error");
  }
}

export async function refreshBench() {
  const grid = document.getElementById('bench-grid');
  grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">REFRESHING...</div>';
  await fetchBenchData();
  renderBench();
}

export function setBenchFilter(filter) {
  BENCH_FILTER = filter;
  document.querySelectorAll('#view-bench .filter-btn').forEach(b => {
    b.classList.toggle('active', b.textContent === filter);
  });
  renderBench();
}

export function openBenchDetail(id) {
  const item = BENCH_DATA.find(b => b.id === id);
  if (!item) return;
  BENCH_CURRENT_ENTRY_ID = id;

  document.querySelector('#view-bench .bench-grid-container').classList.add('hidden');
  document.querySelector('#view-bench .filter-bar').style.display = 'none';
  const detail = document.getElementById('bench-detail');
  detail.classList.add('open');

  document.getElementById('bench-detail-preview').src = `${CDN_BASE}/${item.preview}`;
  
  const queuedDate = item.queued_at ? new Date(item.queued_at).toISOString().split('T')[0] : '—';
  let statusHtml = item.status === 'in-progress' ? `<span style="color:var(--accent);">in-progress</span>` : item.status;
  
  document.getElementById('bench-detail-meta').innerHTML = `
    <div class="meta-label">RAW:</div><div>${escapeHTML(item.raw_filename || item.id.split('_').pop() + '.RW2')}</div>
    <div class="meta-label">ID:</div><div>${escapeHTML(item.id)}</div>
    <div class="meta-label">SESSION:</div><div>${escapeHTML(item.session_date || item.id.split('_')[0])}</div>
    <div class="meta-label">QUEUED:</div><div>${escapeHTML(queuedDate)}</div>
    ${item.camera ? `<div class="meta-label">CAMERA:</div><div>${escapeHTML(item.camera)}</div>` : ''}
    <div class="meta-label">STATUS:</div><div style="text-transform: uppercase;">${statusHtml}</div>
  `;

  document.getElementById('bench-detail-status-controls').innerHTML = ['queued', 'in-progress', 'done'].map(s => {
    let active = item.status === s ? 'active' : '';
    return `<button class="status-btn ${active}" onclick="updateBenchStatus('${item.id}', '${s}')">${s.toUpperCase()}</button>`;
  }).join('');

  document.getElementById('bench-detail-notes').value = item.notes || '';
  const rawFile = item.raw_filename || item.id.split('_').pop() + '.RW2';
  const dlBtn = document.getElementById('bench-detail-download');
  dlBtn.dataset.url = item.raw_url || `/api/bench/raw/${encodeURIComponent(rawFile)}`;
  dlBtn.dataset.filename = rawFile;
  dlBtn.style.display = (item.raw_url || item.raw_filename) ? '' : 'none';
}

export async function downloadBenchRaw(btn) {
  const url = btn.dataset.url;
  const filename = btn.dataset.filename;
  if (!url) return;
  const orig = btn.textContent;
  btn.textContent = 'DOWNLOADING…';
  btn.disabled = true;
  try {
    const blob = await fetchRawBlob(url);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    toast(`Download failed: ${err.message}`, 'error');
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

export function closeBenchDetail() {
  BENCH_CURRENT_ENTRY_ID = null;
  document.querySelector('#view-bench .bench-grid-container').classList.remove('hidden');
  document.querySelector('#view-bench .filter-bar').style.display = 'flex';
  document.getElementById('bench-detail').classList.remove('open');
  renderBench();
}

export async function updateBenchStatus(id, newStatus) {
  const item = BENCH_DATA.find(b => b.id === id);
  if (!item || item.status === newStatus) return;
  
  const oldStatus = item.status;
  item.status = newStatus; // Optimistic update
  
  // Update detail view if open
  if (BENCH_CURRENT_ENTRY_ID === id) {
    openBenchDetail(id);
  } else {
    renderBench();
  }

  try {
    await patchBenchEntry({ id, status: newStatus });
  } catch (err) {
    console.error(err);
    toast("Status update failed. Reverting.", "error");
    item.status = oldStatus;
    if (BENCH_CURRENT_ENTRY_ID === id) openBenchDetail(id);
    else renderBench();
  }
}

export async function saveBenchNotes() {
  const id = BENCH_CURRENT_ENTRY_ID;
  const item = BENCH_DATA?.find(b => b.id === id);
  if (!item) return;

  const notes = document.getElementById('bench-detail-notes').value;
  const oldNotes = item.notes;
  item.notes = notes; // Optimistic update
  toast("Saving notes...");

  try {
    await patchBenchEntry({ id, notes });
    toast("Notes saved", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to save notes", "error");
    item.notes = oldNotes;
    document.getElementById('bench-detail-notes').value = oldNotes || '';
  }
}

export async function removeBenchEntry() {
  const id = BENCH_CURRENT_ENTRY_ID;
  const item = BENCH_DATA?.find(b => b.id === id);
  if (!item) return;
  
  const filename = item.raw_filename || id.split('_').pop() + '.RW2';
  if (!confirm(`Remove ${filename} from bench?`)) return;

  const oldData = [...BENCH_DATA];
  BENCH_DATA = BENCH_DATA.filter(b => b.id !== id);
  closeBenchDetail(); // Back to grid

  try {
    await deleteBenchEntry(id);
    toast("Entry removed", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to remove entry", "error");
    BENCH_DATA = oldData;
    renderBench();
  }
}

export async function clearDoneBenchEntries() {
  const doneCount = BENCH_DATA.filter(b => b.status === 'done').length;
  if (doneCount === 0) return;
  if (!confirm(`Remove all ${doneCount} done entries?`)) return;

  const oldData = [...BENCH_DATA];
  BENCH_DATA = BENCH_DATA.filter(b => b.status !== 'done');
  renderBench(); // Optimistic

  try {
    await clearBenchDone();
    toast("Done entries cleared", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to clear done entries", "error");
    BENCH_DATA = oldData;
    renderBench();
  }
}
