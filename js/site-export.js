// OAKLENS // SITE EXPORT — orchestrator (ES module).
//
// The Publish tab's site-in-a-ZIP button: a complete offline mirror of the
// *published* site — rendered pages fetched from the serving origin (so the
// worker's edge-injected chrome is baked in), assets, content JSON +
// markdown, and the CDN media the content references — every path rewritten
// relative, so index.html opens from a thumb drive with no server.
//
// What ships is defined by js/export-manifest.js (fork-editable, data-only);
// the rewriting/harvesting engine is js/site-export-core.js (pure,
// unit-tested). This module is only the browser glue: fetching, JSZip,
// telemetry, the download. Exports mirror content as served on main — the
// console's staged-but-unpublished edits are deliberately not included.

import { EXPORT_MANIFEST } from './export-manifest.js';
import {
  relPrefix,
  buildRoutes,
  rewriteCssText,
  rewriteHtml,
  inlineCssFonts,
  stripEsmExports,
  injectOfflineRuntime,
  harvestCdnKeys,
  tierForKey,
  expandImageRules,
  mergeKeyTiers,
  zipPathForKey,
  buildOfflineDataJs,
  buildOfflineShimJs,
  buildReadme,
  buildExportReport,
} from './site-export-core.js';
import {
  showToast,
  startProgress,
  updateProgress,
  endProgress,
  logEvent,
} from './console-telemetry.js';

let _running = false;

const _ymd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function _status(msg) {
  const el = document.getElementById('site-export-status');
  if (el) el.textContent = msg;
}

function _tiersFromUI() {
  const on = (id, dflt) => {
    const el = document.getElementById(id);
    return el ? el.checked : dflt;
  };
  return {
    web: on('se-tier-web', true),
    hires: on('se-tier-hires', true),
    video: on('se-tier-video', true),
    full: on('se-tier-full', false),
  };
}

async function _fetchText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

async function _fetchBlob(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.blob();
}

// Resolve a CSS font url() (relative to its stylesheet) against the origin
// and return it as a data: URI. Null on failure — the url() stays relative
// and the shipped font file still covers non-Chromium browsers.
async function _fontDataUri(ref, cssPath) {
  try {
    const abs = new URL(ref, `${location.origin}/${cssPath}`);
    if (abs.origin !== location.origin) return null;
    const blob = await _fetchBlob(abs.pathname);
    const mime = /\.woff2$/i.test(abs.pathname) ? 'font/woff2'
      : /\.woff$/i.test(abs.pathname) ? 'font/woff'
      : /\.otf$/i.test(abs.pathname) ? 'font/otf' : 'font/ttf';
    const b64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

// Small worker pool — enough parallelism to hide latency without dogpiling
// the /api/cdn proxy from a field connection.
async function _pool(items, size, worker) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i], i);
      }
    })
  );
}

export async function exportSiteZip() {
  if (_running) return showToast('site export already running', { kind: 'error' });
  if (typeof JSZip === 'undefined') {
    return showToast('⚠ JSZip not loaded — reconnect and reload, then retry', { kind: 'error' });
  }
  _running = true;
  const btn = document.getElementById('site-export-btn');
  if (btn) btn.disabled = true;

  const manifest = EXPORT_MANIFEST;
  const origin = location.origin;
  // Every CDN spelling the content can carry: the configured custom domain
  // (via the edge-injected meta on this very document), that same root
  // absolutized against the origin, and the bare proxy path. Longest first
  // so absolute forms win over their own suffixes.
  const metaCdn = (document.querySelector('meta[name="cdn-base"]')?.content || '').replace(/\/+$/, '');
  const cdnBases = [...new Set([metaCdn, `${origin}/api/cdn`, '/api/cdn'].filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const routes = buildRoutes(manifest.pages);
  const vendors = Object.fromEntries((manifest.vendor || []).map((v) => [v.src, v.file]));
  const tiers = _tiersFromUI();
  const enabledTiers = Object.keys(tiers).filter((t) => tiers[t]);

  const zip = new JSZip();
  const root = `site-export-${_ymd()}`;
  const put = (path, content, binary = false) =>
    zip.file(`${root}/${path}`, content, binary ? { compression: 'STORE', binary: true } : {});

  const harvested = []; // {key, tier} from pages + data + posts
  const offlineFiles = {}; // repo-path → text, for the data island
  const apiSnapshots = {};
  const failures = [];
  let fetchedBytes = 0;
  let postCount = 0;

  const baseSteps = manifest.pages.length + manifest.assets.length + manifest.dataFiles.length;
  let done = 0;
  let total = baseSteps;
  startProgress('site-export', 'SITE ◫', total);
  const step = () => updateProgress('site-export', ++done, total);

  try {
    logEvent(`site export started · tiers: ${enabledTiers.join('+') || 'none'}`);

    // -- 0 · classicized ES modules the pages fall back to on file://
    //        (import() of local modules is CORS-blocked there)
    const offlineModuleFiles = [];
    for (const mod of manifest.offlineModules || []) {
      put(mod.file, stripEsmExports(await _fetchText(mod.src)));
      offlineModuleFiles.push(mod.file);
    }

    // -- 1 · pages, as served (edge chrome included), references relativized
    _status('fetching pages…');
    for (const page of manifest.pages) {
      const ctx = { prefix: relPrefix(page.file), routes, cdnBases, vendors };
      // The 404 page answers with its own status by design — still a page.
      const res = await fetch(page.route, { cache: 'no-cache' });
      if (!res.ok && !(res.status === 404 && page.route.endsWith('404.html'))) {
        throw new Error(`${page.route} → HTTP ${res.status}`);
      }
      const { html, cdnKeys } = rewriteHtml(await res.text(), ctx);
      put(page.file, injectOfflineRuntime(html, ctx.prefix, offlineModuleFiles));
      for (const key of cdnKeys) harvested.push({ key, tier: tierForKey(key) });
      step();
    }

    // -- 2 · static assets (CSS gets its url() references relativized and
    //        its fonts inlined — file:// enforces CORS on font loads)
    _status('fetching assets…');
    for (const asset of manifest.assets) {
      if (/\.css$/i.test(asset)) {
        const ctx = { prefix: relPrefix(asset), routes, cdnBases };
        const keys = new Set();
        const css = rewriteCssText(await _fetchText(`/${asset}`), ctx, keys);
        put(asset, await inlineCssFonts(css, (ref) => _fontDataUri(ref, asset)));
        for (const key of keys) harvested.push({ key, tier: tierForKey(key) });
      } else if (/\.(js|svg|txt|xml|webmanifest)$/i.test(asset)) {
        put(asset, await _fetchText(`/${asset}`));
      } else {
        put(asset, await _fetchBlob(`/${asset}`), true);
      }
      step();
    }

    // Vendored third-party page scripts (none today — the published site is
    // dependency-free): mirror the exact file the page loads; the page
    // rewrite above already points the <script src> at this local copy, so
    // a miss must fail the export.
    for (const v of manifest.vendor || []) {
      put(v.file, await _fetchText(v.src));
    }

    // -- 3 · content: data JSON (real files + data island) …
    _status('fetching content…');
    const datasets = {};
    for (const path of manifest.dataFiles) {
      const text = await _fetchText(`/${path}`);
      put(path, text);
      offlineFiles[path] = text;
      try { datasets[path] = JSON.parse(text); } catch { datasets[path] = null; }
      for (const key of harvestCdnKeys(text, cdnBases)) {
        harvested.push({ key, tier: tierForKey(key) });
      }
      step();
    }

    // … and the field-note markdown behind post.html
    const postsCfg = manifest.posts;
    const postEntries = (datasets[postsCfg.data] || []).filter(
      (p) => p[postsCfg.idField] && (!p.status || p.status === 'published')
    );
    total += postEntries.length + manifest.apiSnapshots.length;
    for (const p of postEntries) {
      const path = `${postsCfg.dir}/${p[postsCfg.idField]}.md`;
      try {
        const text = await _fetchText(`/${path}`);
        put(path, text);
        offlineFiles[path] = text;
        postCount++;
        for (const key of harvestCdnKeys(text, cdnBases)) {
          harvested.push({ key, tier: tierForKey(key) });
        }
      } catch (err) {
        failures.push(`${path} (${err.message})`);
      }
      step();
    }

    // -- 4 · API snapshots for data-driven widgets (archive buffer strip)
    for (const api of manifest.apiSnapshots) {
      try {
        apiSnapshots[api] = await _fetchText(api);
      } catch (err) {
        failures.push(`${api} (${err.message})`);
      }
      step();
    }

    // Best-effort extras (sitemap/feed) — online-only documents, but their
    // presence makes the zip a complete mirror of what the worker serves.
    for (const extra of manifest.extras || []) {
      try {
        put(extra.replace(/^\//, ''), await _fetchText(extra));
      } catch { /* optional by contract */ }
    }

    // -- 5 · the media set: manifest rules ∪ harvested refs, tier-filtered
    const allKeys = mergeKeyTiers([...expandImageRules(datasets, manifest.imageRules), ...harvested]);
    const wanted = [];
    const skipped = [];
    for (const [key, tier] of allKeys) (tiers[tier] ? wanted : skipped).push(key);

    total += wanted.length;
    updateProgress('site-export', done, total);
    _status(`mirroring ${wanted.length} media files…`);
    await _pool(wanted, 4, async (key, i) => {
      try {
        // Always through the same-origin R2 proxy: no CORS dance, and it
        // works whether or not a custom CDN domain is configured.
        const blob = await _fetchBlob(`/api/cdn/${key}`);
        fetchedBytes += blob.size;
        put(zipPathForKey(key), blob, true);
      } catch (err) {
        failures.push(`cdn/${key} (${err.message})`);
      }
      step();
      if (i % 25 === 0 || i === wanted.length - 1) {
        _status(`mirroring media · ${Math.min(i + 1, wanted.length)}/${wanted.length} · ${(fetchedBytes / 1048576).toFixed(1)} MB`);
      }
    });

    // -- 6 · offline runtime + paperwork
    put('offline/site-data.js', buildOfflineDataJs({
      generated: new Date().toISOString(),
      files: offlineFiles,
      api: apiSnapshots,
    }));
    put('offline/offline-shim.js', buildOfflineShimJs(routes));
    const mb = (fetchedBytes / 1048576).toFixed(1);
    const info = {
      host: location.host,
      origin,
      date: _ymd(),
      generated: new Date().toISOString(),
      tiers: enabledTiers,
      pageCount: manifest.pages.length,
      assetCount: manifest.assets.length,
      dataCount: manifest.dataFiles.length,
      postCount,
      imageCount: wanted.length - failures.filter((f) => f.startsWith('cdn/')).length,
      mb,
      skipped,
      failures,
    };
    put('README.txt', buildReadme(info));
    put('export-report.txt', buildExportReport(info));

    // -- 7 · zip + hand over
    _status(`building zip (${mb} MB fetched)…`);
    startProgress('site-zip', 'ZIP ◫', 100);
    let blob;
    try {
      blob = await zip.generateAsync(
        { type: 'blob', streamFiles: true },
        (meta) => updateProgress('site-zip', Math.round(meta.percent), 100)
      );
    } finally {
      endProgress('site-zip');
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${root}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);

    const summary = `✓ site export ready · ${manifest.pages.length} pages · ${info.imageCount} media · ${(blob.size / 1048576).toFixed(1)} MB`;
    _status(summary.slice(2) + (failures.length ? ` · ${failures.length} failed (see export-report.txt inside the zip)` : ''));
    logEvent(summary);
    showToast(summary, { kind: 'success' });
    if (failures.length) {
      showToast(`⚠ ${failures.length} download${failures.length > 1 ? 's' : ''} failed — listed in export-report.txt`, { kind: 'error' });
    }
  } catch (err) {
    _status(`export failed: ${err.message}`);
    logEvent(`site export failed · ${err.message}`, 'error');
    showToast(`⚠ site export failed — ${err.message}`, { kind: 'error' });
  } finally {
    endProgress('site-export');
    if (btn) btn.disabled = false;
    _running = false;
  }
}
