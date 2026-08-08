// OAKLENS // FIELD CONSOLE — raw-lens.js (ES module).
//
// RAW LENS: the in-console RAW browser. Android has no OS-level RAW quick-look
// (iOS Files/Photos does), so this overlay is the phone's path from "SD card in
// a USB-C reader" to "JPEG in the Buffer": pick RAW files → instant contact
// sheet from each file's EXIF thumbnail → assess full camera-rendered previews
// on demand → commit selected frames as JPEGs into the existing ingest
// pipelines (Buffer multi, Archive single, FN// hero single).
//
// Field discipline (the same BART-tunnel rules as the upload queue):
//   · ZERO network until commit — indexing and preview pulls are local ranged
//     reads (File.slice), ~64–128 KB per file for the index. A 2000-frame card
//     never loads whole RAWs into memory; full previews live in a 6-slot LRU.
//   · Commit hands standard JPEG Files to bufferIngest/archiveIngestPhoto/
//     fnHeroIngest — dedupe, EXIF date, variant generation, retry/backoff and
//     offline requeue all apply unchanged.
//   · Every phase reports through the telemetry engine (lamp, rail, ledger,
//     coalescing toasts) so the phone always shows what is happening.
//   · The RAW original never uploads — it stays on the card for the Bench/B2
//     CLI path at the desk (§5.14). This surface extracts; it does not archive.
//
// Cross-module calls go through window.* (bufferIngest, showToast, …) — the
// HTML bridge mirrors every module's exports onto window, and importing
// console-ui.js here under a ?v= URL would risk a second module instance.
// Only the DOM-free engine is imported directly.

import {
  isRawFilename, indexRawFile, indexDeep, groupBursts,
  formatExposure, formatAperture, formatFocal,
} from './raw-extract.js';

// ---- telemetry shims (window.* — no-op safe before the bridge lands) ----
const tShowToast   = (m, o) => window.showToast?.(m, o);
const tLogEvent    = (m, k) => window.logEvent?.(m, k);
const tBegin       = (c, l) => window.beginActivity?.(c, l) || (() => {});
const tStartProg   = (id, l, t) => window.startProgress?.(id, l, t);
const tUpdateProg  = (id, d, t) => window.updateProgress?.(id, d, t);
const tEndProg     = (id) => window.endProgress?.(id);

const $ = (id) => document.getElementById(id);

const BURST_GAP_MS = 2000;
const PREVIEW_LRU_CAP = 6;
const INDEX_CONCURRENCY = 4;     // metadata-only reads — light enough to overlap
const THUMB_CONCURRENCY = 4;
const RENDER_THROTTLE_MS = 400;
const HANDOFF_TIMEOUT_MS = 90 * 1000;

const TARGETS = {
  buffer:  { label: '→ BUFFER',  multi: true,  ingest: (files) => window.bufferIngest?.(files) },
  archive: { label: '→ ARCHIVE', multi: false, ingest: (files) => window.archiveIngestPhoto?.(files) },
  fnhero:  { label: '→ FN HERO', multi: false, ingest: (files) => window.fnHeroIngest?.(files) },
  library: { label: '→ LIBRARY', multi: true,  ingest: (files) => window.libraryIngest?.(files) },
};

// ============== STATE ==============
let target = 'buffer';
let entries = [];               // [{ id, file, name, base, size, format, index, thumbUrl, dateMs, status }]
let selected = new Set();       // entry ids
let mode = 'grid';              // 'dense' | 'grid'
let burstsOn = true;
let expandedStacks = new Set(); // stack keys (lead entry id)
let assessId = null;            // entry id open in assess view, or null
let indexing = false;
let historyDepth = 0;           // rawlens states pushed (Android back button)
let renderTimer = null;
let nextId = 1;
let awaitingPick = false;       // picker fired, files not back yet (handoff cover)
let handoffTimer = null;
let thumbIO = null;             // IntersectionObserver — thumbs load view-first
const thumbQueue = [];
let thumbActive = 0;

// Full-preview LRU: id -> { blob, url }
const previewCache = new Map();

function cachePreview(id, blob) {
  if (previewCache.has(id)) return previewCache.get(id);
  const rec = { blob, url: URL.createObjectURL(blob) };
  previewCache.set(id, rec);
  if (previewCache.size > PREVIEW_LRU_CAP) {
    const [oldId, old] = previewCache.entries().next().value;
    URL.revokeObjectURL(old.url);
    previewCache.delete(oldId);
  }
  return rec;
}

// ============== PUBLIC: OPEN / CLOSE ==============
// Entry points: view buttons call openRawLens(target) (opens + fires the
// picker); dropzone routing calls RawLens.intake(files, target) directly.
export function openRawLens(t) {
  _open(t);
  // Same user gesture — chain straight into the system file picker.
  if (!entries.length) pickFiles();
}

function _open(t) {
  target = TARGETS[t] ? t : 'buffer';
  const modal = $('rawlens-modal');
  if (!modal) return;
  if (modal.classList.contains('hidden')) {
    modal.classList.remove('hidden');
    document.body.classList.add('rl-lock');
    history.pushState({ rawLens: 1 }, '');
    historyDepth = 1;
    tLogEvent(`◇ raw lens open ${TARGETS[target].label}`);
  }
  renderChrome();
  renderGrid();
}

export function closeRawLens() {
  // Route through history so the Android back stack stays truthful.
  if (historyDepth > 0) history.go(-historyDepth);
  else _teardown();
}

function _teardown() {
  const modal = $('rawlens-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  document.body.classList.remove('rl-lock');
  $('rl-assess')?.classList.add('hidden');
  for (const rec of previewCache.values()) URL.revokeObjectURL(rec.url);
  previewCache.clear();
  for (const e of entries) { if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl); }
  entries = [];
  selected.clear();
  expandedStacks.clear();
  assessId = null;
  historyDepth = 0;
  thumbQueue.length = 0;
  thumbIO?.disconnect();
  hideHandoff();
  $('rl-grid')?.replaceChildren();
}

// Hardware/browser back: pop assess first, then the whole overlay.
function onPopState() {
  if ($('rawlens-modal')?.classList.contains('hidden')) return;
  if (assessId != null) { historyDepth = Math.max(0, historyDepth - 1); _closeAssessUI(); }
  else { historyDepth = 0; _teardown(); }
}

// ============== PUBLIC: FILE INTAKE ==============
export function pickFiles() {
  // The input's `accept` lists the RAW extensions + Android's registered
  // image/x-* RAW MIME types. That matters on Android: a filterless input
  // builds a */* intent and the OS answers with a Camera/Camcorder/Media
  // chooser that can't browse USB storage — the specific MIMEs make Chrome
  // open the real document picker (Files/DocumentsUI) directly.
  awaitingPick = true;
  $('rawlens-file-input')?.click();
}

// ---- picker-handoff cover ----
// After a big "Select all" the picker closes and Chrome spends many seconds
// materializing hundreds of content-URI Files before ANY event reaches us —
// a dead window we can't shorten, only cover. The moment the app regains
// visibility with a pick outstanding, show the READING CARD state; the
// input's change/cancel event (or a safety timeout) clears it.
function showHandoff() {
  $('rl-handoff')?.classList.remove('hidden');
  clearTimeout(handoffTimer);
  handoffTimer = setTimeout(hideHandoff, HANDOFF_TIMEOUT_MS);
}

function hideHandoff() {
  awaitingPick = false;
  clearTimeout(handoffTimer);
  handoffTimer = null;
  $('rl-handoff')?.classList.add('hidden');
}

// Escape hatch for pickers that grey out lesser-known RAW MIMEs (e.g. CR3 on
// older Androids): an unfiltered input — everything comes back, and the
// content-sniffing index sorts RAW from noise.
export function pickAnyFiles() {
  awaitingPick = true;
  $('rawlens-file-input-any')?.click();
}

// Dropzone routing hook — console-ui.js hands RAW files here when they land
// on a Buffer/Archive/FN dropzone (drag-drop on desktop, picker on mobile).
export function intake(files, t) {
  _open(t || target);
  addFiles(files);
}

export const isRaw = isRawFilename;

// Picker returns are judged permissively: Android providers sometimes hand
// back RAW files with mangled display names or blank MIME types, and the
// index is content-sniffing anyway — only reject files that are *obviously*
// something else (those belong on the normal dropzones).
const OBVIOUS_NON_RAW_RE = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?|mp4|mov|webm|mkv|mp3|wav|json|txt|xmp|pdf|zip)$/i;
function looksRawish(f) {
  if (isRawFilename(f.name)) return true;
  if ((f.type || '').startsWith('image/x-')) return true;   // registered RAW MIMEs
  if (OBVIOUS_NON_RAW_RE.test(f.name || '')) return false;
  const t = f.type || '';
  return (t === '' || t === 'application/octet-stream') && f.size > 512 * 1024;
}

async function addFiles(fileList) {
  const files = [...fileList].filter(looksRawish);
  const rejected = fileList.length - files.length;
  if (rejected > 0) tShowToast(`${rejected} non-RAW file${rejected > 1 ? 's' : ''} ignored — drop JPEGs on the dropzone instead`, { kind: 'info' });
  if (!files.length) {
    if (fileList.length) tShowToast('✕ no RAW files in that selection', { kind: 'error' });
    renderChrome();
    return;
  }

  // Dedupe re-picks by identity (name + size + mtime).
  const known = new Set(entries.map(e => `${e.name}|${e.size}|${e.file.lastModified}`));
  const fresh = files.filter(f => !known.has(`${f.name}|${f.size}|${f.lastModified}`));
  const dups = files.length - fresh.length;
  if (dups > 0) tShowToast(`${dups} already on the light table`, { kind: 'info' });
  if (!fresh.length) return;

  const batch = fresh.map(f => ({
    id: 'r' + (nextId++),
    file: f,
    name: f.name,
    base: f.name.replace(/\.[^.]+$/, ''),
    size: f.size,
    format: '',
    index: null,
    thumbUrl: null,
    dateMs: null,
    status: 'pending',   // pending | ok | noPreview | error
  }));
  entries.push(...batch);
  renderChrome();
  scheduleRender();
  await indexBatch(batch);
}

// ============== INDEXING (bounded concurrency, ranged reads only) ==============
function readRangeOf(file) {
  return async (offset, length) =>
    new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}

async function indexBatch(batch) {
  indexing = true;
  const total = batch.length;
  let done = 0, failed = 0;
  const end = tBegin('rawlens', 'RAW IDX');
  tStartProg('raw-index', 'RAW IDX', total);

  const queue = [...batch];
  const worker = async () => {
    for (;;) {
      const e = queue.shift();
      if (!e) return;
      try {
        const idx = await indexRawFile(readRangeOf(e.file), e.size, e.name);
        e.index = idx;
        e.format = (idx.format || '').toUpperCase();
        e.dateMs = idx.date ? idx.date.getTime() : null;
        e.status = idx.preview ? 'ok' : 'noPreview';
        // Metadata only in this pass — thumb BYTES load lazily, view-first,
        // via the IntersectionObserver, so a full card populates the grid as
        // fast as the headers can be walked. Small EXIF thumbnail preferred;
        // previews under 1 MB are safe to hand an <img> directly.
        if (idx.preview) {
          e.thumbRef = idx.thumb || (idx.preview.length <= 1024 * 1024 ? idx.preview : null);
        }
      } catch (err) {
        e.status = 'error';
        failed++;
        tLogEvent(`✕ raw index ${e.name}: ${err.message || err}`, 'error');
      }
      done++;
      tUpdateProg('raw-index', done);
      if (done % 10 === 0 || done === total) renderChrome();
      scheduleRender();
    }
  };
  await Promise.all(Array.from({ length: Math.min(INDEX_CONCURRENCY, total) }, worker));

  indexing = false;
  tEndProg('raw-index');
  end(true);
  const noPrev = batch.filter(e => e.status === 'noPreview').length;
  const okCount = batch.filter(e => e.status === 'ok').length;
  let msg = `✓ indexed ${okCount}/${total} RAW frame${total > 1 ? 's' : ''}`;
  if (noPrev) msg += ` · ${noPrev} no preview`;
  if (failed) msg += ` · ${failed} failed`;
  tShowToast(msg, { id: 'raw-index', kind: failed ? 'error' : 'success', ledger: true });
  renderChrome();
  renderGrid();
}

// ============== LAZY THUMBS (view-first, bounded concurrency) ==============
function requestThumb(entry) {
  if (!entry || entry.thumbUrl || entry._thumbQueued || !entry.thumbRef) return;
  entry._thumbQueued = true;
  thumbQueue.push(entry);
  pumpThumbs();
}

function pumpThumbs() {
  while (thumbActive < THUMB_CONCURRENCY && thumbQueue.length) {
    const e = thumbQueue.shift();
    thumbActive++;
    (async () => {
      try {
        const t = e.thumbRef;
        const bytes = await e.file.slice(t.offset, t.offset + t.length).arrayBuffer();
        e.thumbUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        // Swap in place — no grid re-render for a thumb arriving.
        for (const tile of document.querySelectorAll(`.rl-tile[data-id="${e.id}"]`)) {
          const ph = tile.querySelector('.rl-tile-ph');
          if (!ph) continue;
          const img = document.createElement('img');
          img.src = e.thumbUrl;
          img.alt = e.name;
          img.decoding = 'async';
          ph.replaceWith(img);
        }
      } catch { /* placeholder stays — assess view can still deep-pull */ }
      thumbActive--;
      pumpThumbs();
    })();
  }
}

// ============== PREVIEW EXTRACTION (on-demand, LRU) ==============
async function extractPreview(e) {
  const hit = previewCache.get(e.id);
  if (hit) return hit;
  // Unparsed file: one bounded deep scan, only now that the user asked.
  if (!e.index?.preview && !e.deepTried) {
    e.deepTried = true;
    const end = tBegin('rawlens', 'RAW SCAN');
    try {
      const seg = await indexDeep(readRangeOf(e.file), e.size);
      if (seg) { e.index = { ...(e.index || {}), preview: seg }; e.status = 'ok'; }
      end(true);
    } catch (err) { end(false, `deep scan ${e.name}: ${err.message || err}`); }
  }
  const p = e.index?.preview;
  if (!p) throw new Error('no embedded JPEG found');
  const bytes = await e.file.slice(p.offset, p.offset + p.length).arrayBuffer();
  return cachePreview(e.id, new Blob([bytes], { type: 'image/jpeg' }));
}

// ============== ORDER / GROUPS ==============
function orderedEntries() {
  return [...entries].sort((a, b) => {
    if (a.dateMs != null && b.dateMs != null && a.dateMs !== b.dateMs) return a.dateMs - b.dateMs;
    if ((a.dateMs != null) !== (b.dateMs != null)) return a.dateMs != null ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function groupedEntries() {
  const list = orderedEntries();
  return burstsOn ? groupBursts(list, BURST_GAP_MS) : list.map(e => [e]);
}

// ============== SELECTION ==============
function toggleSelect(id) {
  const multi = TARGETS[target].multi;
  if (selected.has(id)) selected.delete(id);
  else {
    if (!multi) selected.clear();
    selected.add(id);
  }
  renderChrome();
  renderGrid();
  if (assessId != null) renderAssessChrome();
}

export function selectAll() {
  if (!TARGETS[target].multi) return;
  for (const e of entries) if (e.status === 'ok') selected.add(e.id);
  renderChrome(); renderGrid();
}

export function selectNone() {
  selected.clear();
  renderChrome(); renderGrid();
}

export function selectStack(leadId) {
  if (!TARGETS[target].multi) return;
  for (const group of groupedEntries()) {
    if (group[0].id !== leadId) continue;
    const allIn = group.every(e => e.status !== 'ok' || selected.has(e.id));
    for (const e of group) {
      if (e.status !== 'ok') continue;
      if (allIn) selected.delete(e.id); else selected.add(e.id);
    }
    break;
  }
  renderChrome(); renderGrid();
}

// ============== MODES ==============
export function setMode(m) {
  mode = m === 'dense' ? 'dense' : 'grid';
  renderChrome(); renderGrid();
}

export function toggleBursts() {
  burstsOn = !burstsOn;
  expandedStacks.clear();
  renderChrome(); renderGrid();
}

export function toggleStack(leadId) {
  if (expandedStacks.has(leadId)) expandedStacks.delete(leadId);
  else expandedStacks.add(leadId);
  renderGrid();
}

// ============== RENDER: CHROME ==============
const fmtMB = (n) => (n / (1024 * 1024)).toFixed(1) + ' MB';
const timeOf = (ms) => {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':');
};
const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}·${String(d.getMonth() + 1).padStart(2, '0')}·${String(d.getDate()).padStart(2, '0')}`;
};

function renderChrome() {
  const t = TARGETS[target];
  const st = $('rl-status');
  if (st) {
    const parts = [];
    if (indexing) parts.push(`INDEXING ${entries.filter(e => e.status !== 'pending').length}/${entries.length}…`);
    else parts.push(`${entries.length} FRAME${entries.length === 1 ? '' : 'S'}`);
    if (selected.size) parts.push(`${selected.size} SELECTED`);
    st.textContent = '// ' + parts.join(' · ');
  }
  $('rl-target-label') && ($('rl-target-label').textContent = t.label);
  $('rl-mode-dense')?.classList.toggle('active', mode === 'dense');
  $('rl-mode-grid')?.classList.toggle('active', mode === 'grid');
  $('rl-bursts-toggle')?.classList.toggle('active', burstsOn);
  const multiBtns = $('rl-multi-actions');
  if (multiBtns) multiBtns.style.display = t.multi ? '' : 'none';

  const bar = $('rl-commitbar');
  if (bar) {
    bar.classList.toggle('hidden', selected.size === 0);
    const info = $('rl-commit-info');
    if (info) {
      let bytes = 0;
      for (const e of entries) if (selected.has(e.id)) bytes += e.index?.preview?.length || 0;
      info.textContent = t.multi
        ? `${selected.size} FRAME${selected.size === 1 ? '' : 'S'} · ≈${fmtMB(bytes)} JPEG`
        : `1 FRAME · ≈${fmtMB(bytes)} JPEG`;
    }
    const btn = $('rl-commit-btn');
    if (btn) btn.textContent = t.multi ? `EXTRACT ${t.label} (${selected.size})` : `USE FRAME ${t.label}`;
  }
  const empty = $('rl-empty');
  if (empty) empty.style.display = entries.length ? 'none' : '';
}

// ============== RENDER: GRID ==============
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = null; renderGrid(); }, RENDER_THROTTLE_MS);
}

function makeTile(e, inStack) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'rl-tile' + (selected.has(e.id) ? ' selected' : '') + (inStack ? ' in-stack' : '');
  tile.dataset.id = e.id;
  tile.dataset.act = 'assess';

  if (e.thumbUrl) {
    const img = document.createElement('img');
    img.src = e.thumbUrl;
    img.alt = e.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    tile.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'rl-tile-ph';
    ph.textContent = e.status === 'pending' ? '…'
      : e.status === 'error' ? '✕'
      : e.status === 'noPreview' ? 'RAW' : '◌';
    tile.appendChild(ph);
    // Indexed but no bytes yet → load when (near) visible.
    if (e.thumbRef && thumbIO) thumbIO.observe(tile);
  }

  const dot = document.createElement('span');
  dot.className = 'rl-select-dot';
  dot.dataset.id = e.id;
  dot.dataset.act = 'select';
  dot.textContent = selected.has(e.id) ? '✓' : '';
  dot.setAttribute('role', 'checkbox');
  dot.setAttribute('aria-checked', selected.has(e.id) ? 'true' : 'false');
  dot.setAttribute('aria-label', 'Select ' + e.name);
  tile.appendChild(dot);

  const label = document.createElement('span');
  label.className = 'rl-tile-label';
  label.textContent = e.dateMs != null ? timeOf(e.dateMs) : e.base;
  tile.appendChild(label);
  return tile;
}

function makeStackTile(group) {
  const lead = group[0];
  const tile = makeTile(lead, false);
  tile.classList.add('rl-stack');
  tile.dataset.act = 'stack';
  const badge = document.createElement('span');
  badge.className = 'rl-stack-badge';
  badge.textContent = '×' + group.length;
  tile.appendChild(badge);
  return tile;
}

function makeStackHead(group) {
  const head = document.createElement('div');
  head.className = 'rl-stack-head';
  const lbl = document.createElement('span');
  lbl.textContent = `BURST ×${group.length}`;
  head.appendChild(lbl);
  if (TARGETS[target].multi) {
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'rl-stack-act';
    all.dataset.id = group[0].id;
    all.dataset.act = 'stack-all';
    all.textContent = '± ALL';
    head.appendChild(all);
  }
  const col = document.createElement('button');
  col.type = 'button';
  col.className = 'rl-stack-act';
  col.dataset.id = group[0].id;
  col.dataset.act = 'stack';
  col.textContent = 'COLLAPSE';
  head.appendChild(col);
  return head;
}

function renderGrid() {
  const grid = $('rl-grid');
  if (!grid) return;
  grid.className = 'rl-grid ' + mode;
  const frag = document.createDocumentFragment();
  let lastDay = null;

  for (const group of groupedEntries()) {
    const lead = group[0];
    const day = lead.dateMs != null ? dayOf(lead.dateMs) : '// NO DATE';
    if (day !== lastDay) {
      lastDay = day;
      const h = document.createElement('div');
      h.className = 'rl-day';
      h.textContent = day;
      frag.appendChild(h);
    }
    if (group.length > 1 && !expandedStacks.has(lead.id)) {
      frag.appendChild(makeStackTile(group));
    } else if (group.length > 1) {
      frag.appendChild(makeStackHead(group));
      for (const e of group) frag.appendChild(makeTile(e, true));
    } else {
      frag.appendChild(makeTile(lead, false));
    }
  }
  grid.replaceChildren(frag);
}

function onGridClick(ev) {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  ev.preventDefault();
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'select':    ev.stopPropagation(); toggleSelect(id); break;
    case 'stack':     toggleStack(id); break;
    case 'stack-all': selectStack(id); break;
    case 'assess':    openAssess(id); break;
  }
}

// ============== ASSESS (full view) ==============
function assessList() {
  // Flat sorted order — swiping walks through bursts frame by frame.
  return orderedEntries().filter(e => e.status !== 'error');
}

async function openAssess(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  const layer = $('rl-assess');
  if (!layer) return;
  if (assessId == null) { history.pushState({ rawLens: 2 }, ''); historyDepth++; }
  assessId = id;
  layer.classList.remove('hidden');
  renderAssessChrome();

  const img = $('rl-assess-img');
  const status = $('rl-assess-status');
  img.style.opacity = '0.25';
  status.textContent = e.index?.preview ? '// EXTRACTING…' : '// DEEP SCAN…';
  const end = tBegin('rawlens', 'RAW PULL');
  try {
    const rec = await extractPreview(e);
    if (assessId !== id) { end(true); return; }   // user swiped on
    img.src = rec.url;
    img.style.opacity = '';
    status.textContent = '';
    end(true);
  } catch (err) {
    if (assessId === id) {
      img.removeAttribute('src');
      img.style.opacity = '';
      status.textContent = '✕ ' + (err.message || 'extract failed');
    }
    end(false, `raw pull ${e.name}: ${err.message || err}`);
    tShowToast(`✕ ${e.name}: ${err.message || 'no preview'}`, { kind: 'error' });
  }
}

// One spec line: plain text parts joined by accent pipes (archive-tag idiom).
// Built with DOM nodes — EXIF strings come off the card, never innerHTML them.
function renderSpecLine(id, parts) {
  const el = $(id);
  if (!el) return;
  const clean = parts.filter(Boolean);
  el.style.display = clean.length ? '' : 'none';
  const nodes = [];
  clean.forEach((p, i) => {
    if (i) {
      const pipe = document.createElement('span');
      pipe.className = 'pipe';
      pipe.textContent = '|';
      nodes.push(pipe);
    }
    nodes.push(document.createTextNode(p));
  });
  el.replaceChildren(...nodes);
}

function renderAssessChrome() {
  const e = entries.find(x => x.id === assessId);
  if (!e) return;
  $('rl-assess-meta').textContent = e.name;

  // The formalized readout: gear / exposure / file — camera-tag style.
  const x = e.index?.exif || {};
  renderSpecLine('rl-spec-gear', [e.index?.camera, x.lens]);
  renderSpecLine('rl-spec-expo', [
    formatFocal(x.focal, x.focal35),
    formatAperture(x.fnumber),
    formatExposure(x.exposure),
    x.iso ? 'ISO ' + Math.round(x.iso) : '',
  ]);
  renderSpecLine('rl-spec-file', [
    e.dateMs != null ? dayOf(e.dateMs) + ' ' + timeOf(e.dateMs) : '',
    fmtMB(e.size) + ' ' + (e.format || 'RAW'),
    e.index?.preview ? 'JPEG ≈' + fmtMB(e.index.preview.length) : '',
  ]);

  const list = assessList();
  const i = list.findIndex(x => x.id === assessId);
  $('rl-assess-pos').textContent = `${i + 1}/${list.length}`;
  const sel = $('rl-assess-select');
  sel.textContent = selected.has(e.id) ? '✓ SELECTED' : (TARGETS[target].multi ? '+ SELECT' : '◉ USE THIS FRAME');
  sel.classList.toggle('on', selected.has(e.id));
}

export function assessStep(dir) {
  const list = assessList();
  if (!list.length) return;
  const i = list.findIndex(x => x.id === assessId);
  const next = list[(i + dir + list.length) % list.length];
  openAssess(next.id);
}

export function assessToggleSelect() {
  if (assessId != null) toggleSelect(assessId);
}

// Copy filename + full spec to the clipboard — for pasting into notes or a
// culling doc at the sit-down session later.
export async function assessCopySpec() {
  const e = entries.find(x => x.id === assessId);
  if (!e) return;
  const x = e.index?.exif || {};
  const join = (parts) => parts.filter(Boolean).join(' · ');
  const text = [
    e.name,
    join([e.index?.camera, x.lens]),
    join([formatFocal(x.focal, x.focal35), formatAperture(x.fnumber),
          formatExposure(x.exposure), x.iso ? 'ISO ' + Math.round(x.iso) : '']),
    join([e.dateMs != null ? dayOf(e.dateMs).replace(/·/g, '-') + ' ' + timeOf(e.dateMs) : '',
          fmtMB(e.size) + ' ' + (e.format || 'RAW')]),
  ].filter(Boolean).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    tShowToast('⧉ spec copied', { kind: 'success' });
  } catch (err) {
    tShowToast('✕ copy failed: ' + (err.message || err), { kind: 'error' });
  }
}

export function closeAssess() {
  if (assessId == null) return;
  if (historyDepth > 1) history.back();   // popstate closes the layer
  else _closeAssessUI();
}

function _closeAssessUI() {
  assessId = null;
  $('rl-assess')?.classList.add('hidden');
  const img = $('rl-assess-img');
  if (img) img.removeAttribute('src');
  renderGrid();
  renderChrome();
}

// ============== COMMIT ==============
export async function commitSelection() {
  const t = TARGETS[target];
  const chosen = orderedEntries().filter(e => selected.has(e.id));
  if (!chosen.length) return tShowToast('nothing selected', { kind: 'error' });
  if (!t.multi && chosen.length > 1) return tShowToast('pick one frame', { kind: 'error' });

  const btn = $('rl-commit-btn');
  if (btn) btn.disabled = true;
  const end = tBegin('rawlens', 'RAW→JPG');
  tStartProg('raw-commit', 'RAW→JPG', chosen.length);

  const files = [];
  let failed = 0;
  for (let i = 0; i < chosen.length; i++) {
    const e = chosen[i];
    try {
      const rec = await extractPreview(e);
      const f = new File([rec.blob], e.base + '.jpg', {
        type: 'image/jpeg',
        lastModified: e.dateMs || e.file.lastModified,
      });
      // Capture date parsed straight from the RAW container — readEXIFDate
      // checks this before falling back to the embedded JPEG's own EXIF.
      if (e.dateMs != null) f._rawCaptureDate = new Date(e.dateMs);
      files.push(f);
    } catch (err) {
      failed++;
      tLogEvent(`✕ raw extract ${e.name}: ${err.message || err}`, 'error');
    }
    tUpdateProg('raw-commit', i + 1);
  }
  tEndProg('raw-commit');
  if (btn) btn.disabled = false;

  if (!files.length) {
    end(false, 'raw extract: no frames extractable');
    return tShowToast('✕ extraction failed for all selected frames', { kind: 'error' });
  }
  end(true);
  tLogEvent(`◇ raw lens ${t.label}: ${files.length} frame${files.length > 1 ? 's' : ''} extracted${failed ? ` · ${failed} failed` : ''}`);
  if (failed) tShowToast(`⚠ ${failed} frame${failed > 1 ? 's' : ''} failed to extract — committing the rest`, { kind: 'error' });

  // Hand off to the standard pipeline, then drop the overlay so its
  // toasts/queue telemetry own the screen.
  closeRawLens();
  t.ingest(files);
}

// ============== INIT ==============
function init() {
  // Both pickers feed the same intake. The ledger breadcrumb is the field
  // diagnostic for Android's flaky return path: no entry = change never
  // fired (activity killed mid-pick); "returned 0" = the OS ate the picks.
  for (const id of ['rawlens-file-input', 'rawlens-file-input-any']) {
    const input = $(id);
    if (!input) continue;
    input.addEventListener('change', () => {
      hideHandoff();
      const files = [...(input.files || [])];
      tLogEvent(`◇ picker returned ${files.length} file${files.length === 1 ? '' : 's'}`);
      if (files.length) addFiles(files);
      input.value = '';
    });
    // Chrome fires cancel when the picker is dismissed with nothing chosen.
    input.addEventListener('cancel', () => {
      hideHandoff();
      tLogEvent('◇ picker cancelled');
    });
  }

  // Handoff cover: the app regaining visibility with a pick outstanding means
  // the picker closed and Chrome is now materializing the selection.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && awaitingPick) showHandoff();
  });

  // Thumbs load view-first: tiles report in as they approach the viewport.
  if (typeof IntersectionObserver !== 'undefined') {
    thumbIO = new IntersectionObserver((hits) => {
      for (const h of hits) {
        if (!h.isIntersecting) continue;
        thumbIO.unobserve(h.target);
        requestThumb(entries.find(x => x.id === h.target.dataset.id));
      }
    }, { rootMargin: '600px 0px' });   // prefetch well ahead of the scroll
  }
  $('rl-grid')?.addEventListener('click', onGridClick);
  window.addEventListener('popstate', onPopState);

  // Swipe left/right in assess view.
  const layer = $('rl-assess');
  if (layer) {
    let x0 = null, y0 = null;
    layer.addEventListener('touchstart', (ev) => {
      x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY;
    }, { passive: true });
    layer.addEventListener('touchend', (ev) => {
      if (x0 == null) return;
      const dx = ev.changedTouches[0].clientX - x0;
      const dy = ev.changedTouches[0].clientY - y0;
      x0 = y0 = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) assessStep(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  document.addEventListener('keydown', (ev) => {
    if ($('rawlens-modal')?.classList.contains('hidden')) return;
    if (assessId != null) {
      if (ev.key === 'ArrowRight') assessStep(1);
      else if (ev.key === 'ArrowLeft') assessStep(-1);
      else if (ev.key === ' ') { ev.preventDefault(); assessToggleSelect(); }
      else if (ev.key === 'Escape') closeAssess();
    } else if (ev.key === 'Escape') closeRawLens();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

// Namespace for inline on*-handlers in the markup (mirrored onto window by
// the HTML bridge, same as every other module).
export const RawLens = {
  open: openRawLens, close: closeRawLens, pick: pickFiles, pickAny: pickAnyFiles,
  intake, isRaw,
  setMode, toggleBursts, selectAll, selectNone,
  assessStep, assessToggleSelect, closeAssess, copySpec: assessCopySpec,
  commit: commitSelection,
};
