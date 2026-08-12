// OAKLENS Field Console — audio.
//
// The Audio shelf: the ONE place a track exists, however it got here. Drop a
// file on the shelf or attach one inside a field note and it lands in the same
// registry (STATE.audio → data/audio.json), so there is never a second copy to
// keep in sync and the file is only ever stored once on R2.
//
// The waveform is measured HERE, once, at attach time — decodeAudioData over
// the file the author just picked, boiled down to PEAK_COUNT values that ride
// in the registry. That is what lets the public player draw a card without
// downloading a byte of audio. A browser that cannot decode the codec still
// gets a usable entry: duration comes off a probe <audio> element and the
// player falls back to its flat rail.
//
// Promote-to-card lives on every row rather than only here (see _audioPromote):
// the owner should never have to walk back to this shelf to feature something
// they just uploaded from somewhere else. The CARD still reads only the
// registry — the action travels, the data does not.
//
// The handlers below are called from inline on*= attributes in the rendered
// rows, which run in global scope, so every one of them must stay an exported
// function (see the asset-library header for what happens otherwise).

import { STATE, save, bumpStage, trashItem } from '../console-state.js';
import { logEvent } from '../console-telemetry.js';
import { toast, escapeHTML, escapeAttrJS, refreshSurface } from './chrome.js';
import { todayISO, uid, cleanFilename } from './utils.js';
import { _enqueueUpload } from './upload.js';
import { fnInsertAtCursor } from './fn-editor.js';

// Must match js/audio-player.js PEAK_COUNT — one stored resolution serves every
// display variant, so this number only changes if BOTH sides change together.
const PEAK_COUNT = 96;

// Mirrors the server's ALLOWED_AUDIO_TYPES (src/api/assets.js). Kept as a
// suffix list because that is what a file picker actually hands back.
const AUDIO_EXT_RE = /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i;
const MAX_AUDIO_BYTES = 128 * 1024 * 1024;

// ---- pure helpers ----

// A slug is the track's permanent address (/listen/?a=<slug>) and its handle in
// a post shortcode, so it must be URL-clean and must not collide. Exported for
// the test suite.
export function audioSlugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')      // drop a file extension
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'track';
}

// Collision-proof the slug against the registry. Renaming a track later must
// never silently steal another one's permalink, so `skipId` lets an edit keep
// its own slug.
export function audioUniqueSlug(base, existing, skipId) {
  const taken = new Set((existing || [])
    .filter((e) => e && e.id !== skipId && e.slug)
    .map((e) => e.slug));
  let slug = audioSlugify(base);
  if (!taken.has(slug)) return slug;
  for (let n = 2; n < 999; n++) {
    const next = `${slug}-${n}`;
    if (!taken.has(next)) return next;
  }
  return `${slug}-${Date.now()}`;
}

// Normalize measured samples to the loudest peak. Without this a quietly
// recorded voice memo draws a nearly flat line while a mastered track fills the
// card — the waveform would read as "how loud was this" rather than "what is
// its shape", which is not what it is for.
export function audioNormalizePeaks(peaks) {
  const list = (peaks || []).map((p) => (Number.isFinite(p) ? Math.abs(p) : 0));
  const max = list.reduce((m, p) => (p > m ? p : m), 0);
  if (max <= 0) return list.map(() => 0);
  return list.map((p) => Math.min(1, p / max));
}

export function audioPeaksToString(peaks) {
  return (peaks || []).map((p) => String(Math.round(p * 100) / 100)).join(',');
}

// ---- measurement ----

// Peak-per-bucket (not average): a transient that survives averaging is what
// makes a waveform look like the music rather than like a hill.
function _peaksFromBuffer(buf) {
  const ch = buf.getChannelData(0);
  const size = Math.max(1, Math.floor(ch.length / PEAK_COUNT));
  const peaks = [];
  for (let i = 0; i < PEAK_COUNT; i++) {
    const start = i * size;
    let peak = 0;
    for (let j = 0; j < size && start + j < ch.length; j++) {
      const v = Math.abs(ch[start + j]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
  }
  return audioNormalizePeaks(peaks);
}

// Duration without decoding — the fallback when a codec is not decodable in
// this browser (some .flac / .opus builds). Resolves 0 rather than rejecting:
// an entry with no duration is still a working track.
function _probeDuration(file) {
  return new Promise((resolve) => {
    let url;
    try { url = URL.createObjectURL(file); } catch { resolve(0); return; }
    const el = new Audio();
    const done = (d) => { try { URL.revokeObjectURL(url); } catch {} resolve(d); };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => done(0);
    el.src = url;
  });
}

export async function audioMeasure(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) {
    let ctx = null;
    try {
      ctx = new Ctx();
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      return { peaks: _peaksFromBuffer(buf), duration: buf.duration || 0 };
    } catch (err) {
      logEvent(`◇ audio: could not decode ${file.name} for a waveform (${err.message}) — `
        + 'storing duration only', 'info');
    } finally {
      try { ctx && ctx.close && ctx.close(); } catch {}
    }
  }
  return { peaks: [], duration: await _probeDuration(file) };
}

// ---- ingest ----

// The single entry point for adding audio, wherever it came from. `insertInto`
// is the field-note path: after the track lands, drop its shortcode at the
// cursor so attaching from the editor is one gesture.
export async function audioAddFiles(files, opts) {
  const list = [...(files || [])];
  if (!list.length) return [];
  const options = opts || {};
  const added = [];

  for (const file of list) {
    if (!AUDIO_EXT_RE.test(file.name || '')) {
      toast(`✕ Not an audio file: ${file.name}`, 'error');
      continue;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      toast(`✕ ${file.name} is over 128MB`, 'error');
      continue;
    }

    const filename = cleanFilename(file.name);
    if (STATE.audio.some((a) => a.filename === filename)) {
      toast(`⚠ Already on the shelf: ${filename}`, 'error');
      continue;
    }

    // Title defaults to the filename with its extension and separators tidied
    // — a sensible thing to publish if the author never opens the edit field.
    const guessTitle = String(file.name || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Untitled';

    toast(`◇ Reading ${filename}…`, 'info');
    const { peaks, duration } = await audioMeasure(file);

    const entry = {
      id: uid(),
      slug: audioUniqueSlug(guessTitle, STATE.audio),
      filename,
      title: guessTitle,
      sub: '',
      duration: Math.round(duration),
      peaks: audioPeaksToString(peaks),
      size: file.size,
      mime: file.type || '',
      featured: false,
      episode: false,
      download: false,
      added_at: todayISO(),
      _uploading: true,
    };
    STATE.audio.unshift(entry);
    bumpStage('audio');
    save();

    // One canonical object — no variants to generate, which is why audio needs
    // none of the image pipeline.
    _enqueueUpload(entry.id, 'audio', [new File([file], `audio/${filename}`, { type: file.type })], filename);
    added.push(entry);

    if (options.insertInto) audioInsertShortcode(entry.slug);
  }

  renderAudio();
  return added;
}

export function audioInsertShortcode(slug) {
  const textarea = document.getElementById('fn-body');
  if (!textarea) return;
  // Slug only. Everything else resolves from the registry at render time, so a
  // track renamed later is renamed in every post that ever embedded it.
  fnInsertAtCursor(textarea, `\n<div class="audio-embed" data-slug="${slug}"></div>\n`, '');
  toast('✓ Track inserted — drop another right below it for a tracklist', 'success');
}

// ---- row actions (called from inline on*= handlers) ----

// Featuring is exclusive: the homepage shows ONE audio card, so promoting a
// track demotes whatever held the slot. Doing that silently would be worse than
// refusing — so it says which track stepped aside.
export function _audioPromote(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry) return;
  if (entry.featured) {
    entry.featured = false;
    bumpStage('audio');
    save();
    renderAudio();
    toast('Removed from the homepage card', 'warning');
    return;
  }
  const previous = STATE.audio.find((a) => a.featured && a.id !== id);
  STATE.audio.forEach((a) => { a.featured = a.id === id; });
  bumpStage('audio');
  save();
  renderAudio();
  toast(previous
    ? `✓ Featured — "${previous.title}" stepped off the card`
    : '✓ Featured on the homepage card', 'success');
}

export function _audioToggleEpisode(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry) return;
  entry.episode = !entry.episode;
  bumpStage('audio');
  save();
  renderAudio();
  // The distinction that matters: the feed is what podcast apps subscribe to,
  // so a loose sketch marked as an episode reaches every subscriber.
  toast(entry.episode ? '✓ In the podcast feed' : 'Removed from the podcast feed',
    entry.episode ? 'success' : 'warning');
}

export function _audioToggleDownload(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry) return;
  entry.download = !entry.download;
  bumpStage('audio');
  save();
  renderAudio();
  toast(entry.download ? '✓ Download link shown' : 'Download link hidden',
    entry.download ? 'success' : 'warning');
}

export function _audioEdit(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry) return;
  const title = window.prompt('Title:', entry.title || '');
  if (title === null) return;
  const sub = window.prompt('Subtitle (artist, episode number, anything):', entry.sub || '');
  if (sub === null) return;
  entry.title = title.trim() || entry.title;
  entry.sub = sub.trim();
  // The slug is the permanent address: once published, a share link and every
  // post shortcode point at it, so renaming the TITLE must not move the track.
  // A never-published entry has nothing pointing at it yet and can still be
  // re-slugged to match its new name.
  if (!entry._imported) {
    entry.slug = audioUniqueSlug(entry.title, STATE.audio, entry.id);
  }
  bumpStage('audio');
  save();
  renderAudio();
  toast('✓ Updated', 'success');
}

export function _audioInsert(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry) return;
  audioInsertShortcode(entry.slug);
}

export function _audioDelete(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry) return;
  if (!confirm(`Move "${entry.title || entry.filename}" to trash?\n\nIts audio file is removed from the CDN on the next publish.`)) return;
  trashItem('audio', id);
}

// ---- render ----

function _fmtDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (!s) return '--:--';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

function _fmtSize(bytes) {
  const b = Number(bytes) || 0;
  if (!b) return '';
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.round(b / 1024)}KB`;
}

// A miniature of the published waveform, drawn from the SAME stored peaks the
// public player uses — so what the shelf shows is literally what ships.
function _sparkline(peaksStr) {
  const peaks = String(peaksStr || '').split(',')
    .map((p) => parseFloat(p))
    .filter((p) => Number.isFinite(p));
  if (!peaks.length) return '<div class="aud-spark empty">// no waveform</div>';
  const step = Math.max(1, Math.floor(peaks.length / 40));
  const bars = [];
  for (let i = 0; i < peaks.length; i += step) {
    bars.push(`<span style="height:${Math.max(6, Math.round(peaks[i] * 100))}%"></span>`);
  }
  return `<div class="aud-spark">${bars.join('')}</div>`;
}

export function renderAudio() {
  const host = document.getElementById('audio-display');
  if (!host) return;

  const count = document.getElementById('audio-count');
  if (count) count.textContent = STATE.audio.length;
  const stats = document.getElementById('audio-stats');
  if (stats) {
    const total = STATE.audio.reduce((n, a) => n + (a.duration || 0), 0);
    stats.textContent = STATE.audio.length
      ? `${STATE.audio.length} track${STATE.audio.length === 1 ? '' : 's'} · ${_fmtDuration(total)}`
      : '— tracks';
  }

  if (!STATE.audio.length) {
    host.innerHTML = '<div class="empty-state">// NO AUDIO YET — DROP A TRACK, AN EPISODE, OR A VOICE MEMO ABOVE</div>';
    return;
  }

  host.innerHTML = STATE.audio.map((a) => {
    const state = a._uploadError ? 'err' : a._uploading ? 'up' : '';
    const badge = a._uploadError ? '<span class="aud-badge err">✕ FAILED</span>'
      : a._uploading ? '<span class="aud-badge up">↑ UPLOADING</span>'
        : '';
    const meta = [_fmtDuration(a.duration), _fmtSize(a.size), a.slug].filter(Boolean).join(' · ');
    return `<div class="aud-row ${state}">
      <div class="aud-main">
        <div class="aud-title">${escapeHTML(a.title || a.filename || 'Untitled')}${badge}</div>
        <div class="aud-sub">${escapeHTML(a.sub || '')}</div>
        ${_sparkline(a.peaks)}
        <div class="aud-meta">${escapeHTML(meta)}</div>
      </div>
      <div class="aud-actions">
        <button class="btn btn-sm ${a.featured ? 'btn-stage' : 'btn-ghost'}"
          onclick="_audioPromote('${escapeAttrJS(a.id)}')"
          title="Show this track as the homepage audio card">${a.featured ? '★ ON CARD' : '☆ CARD'}</button>
        <button class="btn btn-sm ${a.episode ? 'btn-stage' : 'btn-ghost'}"
          onclick="_audioToggleEpisode('${escapeAttrJS(a.id)}')"
          title="Include in the podcast feed (feed.xml enclosure)">${a.episode ? '◉ EPISODE' : '○ EPISODE'}</button>
        <button class="btn btn-sm ${a.download ? 'btn-stage' : 'btn-ghost'}"
          onclick="_audioToggleDownload('${escapeAttrJS(a.id)}')"
          title="Offer a download link on the track page">↓ DL</button>
        <button class="btn btn-sm btn-ghost" onclick="_audioInsert('${escapeAttrJS(a.id)}')"
          title="Insert into the open field note">✎ INSERT</button>
        <button class="btn btn-sm btn-ghost" onclick="_audioEdit('${escapeAttrJS(a.id)}')">✎ EDIT</button>
        <button class="btn btn-sm btn-danger" onclick="_audioDelete('${escapeAttrJS(a.id)}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

// The FN editor's "attach audio" button. Opens a picker, ingests through the
// same path as the shelf, and inserts the shortcode — so a track attached from
// the editor is a first-class registry entry, not a second kind of thing.
export function fnAttachAudio() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac';
  input.multiple = true;
  input.addEventListener('change', () => {
    if (input.files && input.files.length) audioAddFiles(input.files, { insertInto: true });
  });
  input.click();
}

// Mark an upload as landed. The queue speaks surfaces, and `audio` is one, so
// this rides the existing refreshSurface seam rather than inventing another.
export function _audioUploadDone() {
  refreshSurface('audio');
}
