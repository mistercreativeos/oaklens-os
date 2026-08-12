// ---- R2 asset I/O: upload, delete, and the same-origin CDN proxy ----
//
// Extracted from worker.js (decomposition, manual §6.7). The upload sanitizer
// and the /api/cdn proxy deliberately share one key charset (R2_KEY_CHARS) so
// anything the console can store, the proxy can serve — real library filenames
// carry spaces, '=', '+' and parens. Uploads are restricted to the prefixes the
// console legitimately writes; the proxy is read-only and falls back to a
// bundled sample frame on a miss (zero-config fork demo imagery).

import { verifyToken } from '../shared/auth.js';
import { jsonRes } from '../shared/http.js';
import { cdnBase } from '../shared/site.js';

// R2 key prefixes the Field Console / bench-upload.sh are allowed to write to.
// Anything outside this set (notably data/ and the bucket root, where app state
// like the OG card index lives) is rejected by handleUpload.
//   archive/   frame variants + library staging
//   videos/    clips + posters
//   meta/      stamped OG cards
//   wallpaper/ wallpaper full-res
//   bench/     RAW-processing preview JPGs (scripts/bench-upload.sh)
//   audio/     tracks, episodes, voice memos (one canonical object each — the
//              waveform is pre-measured into data/audio.json, so unlike images
//              there are no derived variants to store)
const UPLOAD_KEY_PREFIXES = ['archive/', 'videos/', 'meta/', 'wallpaper/', 'bench/', 'audio/'];

// Charset an R2 object key may use, shared by the upload sanitizer and the
// /api/cdn proxy so anything the upload path can store, the proxy can serve.
// Real library filenames carry spaces, '=', '+' and parens (camera exports,
// pre-console migrations) — the live custom CDN domain serves them fine, and
// a zero-config fork serving through the proxy must too. '..' is rejected
// separately wherever a key is accepted.
const R2_KEY_CHARS = '\\w .+=()/-';
const UPLOAD_KEY_JUNK_RE = new RegExp(`[^${R2_KEY_CHARS}]`, 'g');
const CDN_PROXY_KEY_RE = new RegExp(
  `^(archive|meta|wallpaper|videos|homepage|about|blog|portal|bench|dev|audio)/[${R2_KEY_CHARS}]+\\.(webp|jpe?g|png|gif|mp4|webm|mp3|m4a|aac|ogg|opus|wav|flac)$`,
  'i'
);

// Content-Type fallback for a proxied object whose stored httpMetadata is
// missing (pre-console uploads, or a bucket seeded with rclone). An audio file
// served as image/webp under `nosniff` simply will not play, so every
// extension the key regex admits needs an answer here.
const EXT_TYPES = {
  mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
  webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', gif: 'image/gif',
};

// How long a proxied object may live in the colo cache. Matches the
// Cache-Control the proxy already sends, so the browser and the edge expire
// together.
const CDN_CACHE_TTL = 3600; // seconds

// ---- Edge cache plumbing (shared by the proxy and the purge) ----
//
// ONE function decides the cache key, because a proxy that populates one URL
// and a purge that deletes another is the same bug as no purge at all — and it
// only shows up as "the overwrite didn't take" an hour later.
//
// The key is built from the DECODED R2 key, per path segment, which is exactly
// how the pages build their <img src> (js/lighttable.js cdnSrc → an
// encodeURIComponent'd basename after a literal prefix). Encoding matters:
// a key like `shot+one-480w.webp` is requested as `shot%2Bone-480w.webp`, so a
// purge built on the raw key would delete an entry nothing ever wrote.
export function _proxyCacheUrl(origin, key) {
  return `${origin}/api/cdn/${key.split('/').map(encodeURIComponent).join('/')}`;
}

// `caches` is a Workers global; unit tests that never touch the cache don't
// define it. A missing cache API degrades to "always a miss", never a fault.
function _edgeCache() {
  try {
    return (typeof caches !== 'undefined' && caches.default) || null;
  } catch {
    return null;
  }
}

// Never block the response on a cache write (CLAUDE.md: side effects run under
// waitUntil). Tolerates a missing ctx — some call paths and tests have none —
// and swallows failures, because a cache miss is not an error worth surfacing.
function _background(ctx, promise) {
  const p = Promise.resolve(promise).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
}

// Drop an object from the colo cache after it is overwritten or deleted in R2.
// Both serving modes are purged: the same-origin proxy path (`/api/cdn/<key>`,
// which the console's canvas reads use even on an instance with a custom CDN)
// and the configured cdnBase URL. With no custom cdnBase the two are the same
// URL and the Set collapses them.
//
// NOTE (documented in manual §3.4): `cache.delete` only purges the colo that
// runs it. Other colos keep serving the old bytes until the TTL expires, so the
// durable convention stays "never overwrite a key" — this is a best-effort
// nicety for the author's own colo, not a consistency guarantee.
async function purgeCdnCache(origin, key) {
  const cache = _edgeCache();
  if (!cache) return;
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  const urls = new Set([`${origin}/api/cdn/${encoded}`, `${cdnBase(origin)}/${encoded}`]);
  for (const u of urls) {
    try { await cache.delete(new Request(u)); } catch { /* best-effort purge */ }
  }
}

// ---- POST /api/upload ----

export async function handleUpload(request, env) {
  if (!await verifyToken(request, env)) {
    return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonRes({ ok: false, error: 'invalid form data' }, 400);
  }

  const uploaded = [];
  const errors = [];

  const MAX_IMAGE_SIZE = 25 * 1024 * 1024; // 25MB
  const MAX_VIDEO_SIZE = 64 * 1024 * 1024; // 64MB — short looping field-note clips
  // 128MB ≈ two hours at 128kbps, so a full podcast episode fits without the
  // author re-encoding. R2 charges nothing for egress, which is what makes
  // self-hosting an episode feed practical at all.
  const MAX_AUDIO_SIZE = 128 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png', 'image/gif'];
  const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
  // What every current browser can actually decode + play natively. Kept in
  // sync with AUDIO_EXT_TYPES below (the proxy's Content-Type fallback).
  const ALLOWED_AUDIO_TYPES = [
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
    'audio/ogg', 'audio/opus', 'audio/wav', 'audio/x-wav', 'audio/flac',
  ];

  for (const [, file] of formData.entries()) {
    if (!(file instanceof File)) continue;

    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
    const isAudio = ALLOWED_AUDIO_TYPES.includes(file.type);
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
    if (!isVideo && !isImage && !isAudio) {
      return jsonRes({ error: 'Unsupported file type' }, 415);
    }
    const cap = isAudio ? MAX_AUDIO_SIZE : isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > cap) {
      return jsonRes({
        error: isAudio ? 'Audio too large (128MB max)'
          : isVideo ? 'Video too large (64MB max)'
          : 'File too large (25MB max)',
      }, 413);
    }

    const rawName = file.name || ''; // e.g. "archive/basename-1024w.webp" or "videos/clip.mp4"
    // Keep the R2_KEY_CHARS set, trim whitespace off every path segment (a
    // filename pasted with a stray trailing space must not mint a key the
    // author can't see), and drop empty segments.
    const path = rawName
      .replace(UPLOAD_KEY_JUNK_RE, '')
      .split('/').map((s) => s.trim()).filter(Boolean).join('/')
      .replace(/^[./]+/, '');
    if (!path) {
      errors.push(rawName || '(unnamed)');
      continue;
    }
    // R2 is a flat keyspace, but the worker writes app state there too
    // (data/bench.json, meta/*-og.webp). Restrict uploads to the prefixes the
    // console legitimately writes and reject any residual "../" so an authed
    // session can't clobber arbitrary keys. Defense in depth behind verifyToken.
    if (path.includes('..') || !UPLOAD_KEY_PREFIXES.some(pre => path.startsWith(pre))) {
      errors.push(path);
      continue;
    }
    try {
      const buf = await file.arrayBuffer();
      await env.CDN.put(path, buf, {
        httpMetadata: {
          contentType: file.type
            || (isAudio ? 'audio/mpeg' : isVideo ? 'video/mp4' : 'image/webp'),
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
      uploaded.push(path);
      // Purge the edge cache for this key so an overwrite is reflected here
      // immediately (both serving modes — see purgeCdnCache).
      await purgeCdnCache(new URL(request.url).origin, path);
    } catch (err) {
      console.error(`[upload] r2.put failed for ${path}:`, err.message);
      errors.push(path);
    }
  }

  if (errors.length > 0) {
    return jsonRes({ ok: false, error: 'some files failed', uploaded, errors }, 500);
  }
  return jsonRes({ ok: true, uploaded }, 200);
}

// ---- POST /api/delete-assets ----

export async function handleDeleteAssets(request, env) {
  if (!await verifyToken(request, env)) {
    return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  }

  let body;
  try { body = await request.json(); } catch {
    return jsonRes({ ok: false, error: 'invalid request' }, 400);
  }

  const files = body.files || [];
  if (!Array.isArray(files) || files.length === 0) {
    return jsonRes({ ok: false, error: 'no files provided' }, 400);
  }

  const deleted = [];
  const errors = [];

  for (const key of files) {
    // Same allowlist as the upload path. Deletes used to accept ANY key while
    // uploads were prefix-restricted — an asymmetry with no workflow behind
    // it: every key the console queues for deletion is a variant it wrote
    // under these prefixes (archive/, wallpaper/, videos/, meta/, bench/).
    // Walling the delete off from data/ and the bucket root costs nothing and
    // keeps a leaked token (or a console bug) from clearing app state.
    if (!key || typeof key !== 'string' || key.includes('..')
      || !UPLOAD_KEY_PREFIXES.some((pre) => key.startsWith(pre))) {
      errors.push(key || '(invalid)');
      continue;
    }
    try {
      await env.CDN.delete(key);
      deleted.push(key);
      // Purge the edge cache so a deleted asset doesn't linger here.
      await purgeCdnCache(new URL(request.url).origin, key);
    } catch (err) {
      console.error(`[delete-assets] r2.delete failed for ${key}:`, err.message);
      errors.push(key);
    }
  }

  if (errors.length > 0) {
    return jsonRes({ ok: false, error: 'some deletes failed', deleted, errors }, 500);
  }
  return jsonRes({ ok: true, deleted }, 200);
}

// ---- GET /api/og-cards ----
//
// Which frames already have a stamped OG card on R2 (meta/<base>-og.webp). The
// field console fetches this once to mark carded frames persistently, so
// "already made live" survives reloads (the flag lives in R2, not the JSON).
export async function handleOgCards(request, env) {
  if (!await verifyToken(request, env)) {
    return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  }
  try {
    const cards = [];
    let cursor;
    do {
      const listed = await env.CDN.list({ prefix: 'meta/', cursor, limit: 1000 });
      for (const o of listed.objects) {
        const m = /^meta\/(.+)-og\.webp$/.exec(o.key);
        if (m) cards.push(m[1]);
      }
      cursor = listed.truncated ? listed.cursor : null;
    } while (cursor);
    return jsonRes({ ok: true, cards }, 200);
  } catch (err) {
    return jsonRes({ ok: false, error: err.message }, 500);
  }
}

// ---- GET /api/cdn/<key> — same-origin R2 proxy ----
//
// The default serving path when no custom cdnBase is configured (a fresh fork
// needs zero DNS setup), and still the escape hatch the field console uses to
// draw frames onto a <canvas> without tainting it (a custom CDN domain sends no
// CORS headers). Read-only, restricted to the public asset prefixes. Video
// needs HTTP Range support (Safari won't play media from a server that ignores
// Range), so bytes=… requests are passed through to R2 and answered 206.
//
// EDGE CACHE (2026-08-06). `run_worker_first: true` means nothing here is
// cached automatically: before this, every image view on a zero-config fork
// cost one Worker invocation AND one R2 read, and a photo grid is 20–40 images
// per page view. Full (non-Range) GETs now check `caches.default` first and
// populate it in the background on a miss, so repeat views cost neither. Free-
// tier math is in manual §3.4. Three rules hold the cache honest:
//   · Range requests bypass it entirely — a 206 is not cacheable through the
//     cache API, and a partial body stored under the whole object's key would
//     be a corrupt hit.
//   · The sample-frame fallback is NEVER cached. It answers under the real
//     key's URL, so a cached sample would shadow a genuine upload — and since
//     `cache.delete` only reaches the colo that runs it, the upload purge
//     could not clear it everywhere. Same reasoning for 404s.
//   · What it populates, `purgeCdnCache` deletes: one shared key builder.
export async function handleCdnProxy(request, env, url, ctx) {
  const key = decodeURIComponent(url.pathname.slice('/api/cdn/'.length));
  if (key.includes('..') || !CDN_PROXY_KEY_RE.test(key)) {
    return new Response('bad key', { status: 400 });
  }

  let obj = null;
  let range = null;
  const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
  const isRangeRequest = !!(rangeMatch && (rangeMatch[1] || rangeMatch[2]));
  // Canonical, encoding-stable cache key — see _proxyCacheUrl. Only full GETs
  // touch the cache; a Range request never reads or writes it.
  const cache = isRangeRequest ? null : _edgeCache();
  const cacheKey = cache ? new Request(_proxyCacheUrl(url.origin, key)) : null;
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch { /* cache unavailable — fall through to R2 */ }
  }

  if (isRangeRequest) {
    const [, start, end] = rangeMatch;
    if (start === '') range = { suffix: parseInt(end, 10) };
    else if (end === '') range = { offset: parseInt(start, 10) };
    else range = { offset: parseInt(start, 10), length: parseInt(end, 10) - parseInt(start, 10) + 1 };
    try {
      obj = await env.CDN.get(key, { range });
    } catch {
      range = null; // unsatisfiable range — fall through to a full read
    }
  }
  if (!obj) {
    range = null;
    obj = await env.CDN.get(key);
  }
  if (!obj) {
    // Template sample fallback: a fresh fork has no R2 objects, so
    // /api/cdn/<section>/<file> falls back to a bundled sample frame at
    // /assets/samples/<file> when one exists — zero-config demo imagery
    // (the live instance's real objects are served above, so this only
    // fires on a genuine miss). See assets/samples/.
    const sampleName = key.split('/').pop();
    if (sampleName && env.ASSETS) {
      const sample = await env.ASSETS.fetch(new Request(`${url.origin}/assets/samples/${sampleName}`));
      if (sample.ok) {
        // Deliberately NOT cached under the real key — see the header note.
        return new Response(sample.body, {
          headers: {
            'Content-Type': 'image/webp',
            'Cache-Control': `public, max-age=${CDN_CACHE_TTL}`,
            'Accept-Ranges': 'bytes',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
    }
    return new Response('not found', { status: 404 });
  }

  const ext = key.split('.').pop().toLowerCase();
  const fallbackType = EXT_TYPES[ext] || 'image/webp';
  const headers = {
    // The stored contentType is author-controlled (set from the upload's
    // file.type), so `nosniff` keeps the browser from second-guessing it into
    // something scriptable. The key regex already caps the extension set.
    'Content-Type': obj.httpMetadata?.contentType || fallbackType,
    'Cache-Control': `public, max-age=${CDN_CACHE_TTL}`,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
  };
  if (range) {
    let offset, length;
    if (obj.range && obj.range.suffix != null) {
      length = Math.min(obj.range.suffix, obj.size);
      offset = obj.size - length;
    } else {
      offset = obj.range?.offset ?? 0;
      length = obj.range?.length ?? (obj.size - offset);
    }
    headers['Content-Range'] = `bytes ${offset}-${offset + length - 1}/${obj.size}`;
    headers['Content-Length'] = String(length);
    return new Response(obj.body, { status: 206, headers });
  }
  headers['Content-Length'] = String(obj.size);
  const res = new Response(obj.body, { headers });
  // Populate the colo cache with a copy; the caller gets the original body
  // immediately. `cache` is null for Range requests, so only whole objects are
  // ever stored — and only ones that came from R2, never the sample fallback.
  if (cache) _background(ctx, cache.put(cacheKey, res.clone()));
  return res;
}
