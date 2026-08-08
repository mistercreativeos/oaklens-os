// OAKLENS // SITE EXPORT — core engine (ES module).
//
// The pure half of the site-in-a-ZIP exporter: URL mapping, HTML/CSS
// reference rewriting, CDN-key harvesting, image-rule expansion, and the
// generated offline runtime (fetch shim + data island). DOM-free and
// dependency-free — unit-tested in tests/site-export.test.js. The browser
// orchestration (fetching, JSZip, telemetry, download) lives in
// js/site-export.js.
//
// The mapping problem in one paragraph: the live site leans on the serving
// origin — root-absolute links (/archive), a CDN root resolved from the
// edge-injected <meta name="cdn-base">, and fetch() of /data/*.json and
// /posts/*.md. A zip opened from file:// has no origin: fetch of local
// files is blocked, absolute paths point at the filesystem root, and
// extensionless routes don't resolve to index.html. So the exporter (a)
// rewrites every reference it can see in the saved HTML/CSS to a relative
// path, and (b) ships an offline runtime that answers fetch() from an
// embedded snapshot and relativizes references built by page JS at runtime.

// ---- reference mapping ----

// Tier essentialness for merging duplicate keys: a frame that is both
// directly referenced (web) and rule-expanded (hires) stays in the most
// essential tier so it survives the narrowest export.
const TIER_RANK = { web: 1, video: 2, hires: 3, full: 4 };

export function relPrefix(file) {
  return '../'.repeat(file.split('/').length - 1);
}

// route table from the manifest's pages: '/archive' → 'archive/index.html'.
// A page's optional `aliases` (alternate spellings the live worker redirects,
// e.g. /field-notes/post.html → /field-notes/post) map to the same file so
// old links inside saved content still resolve offline.
export function buildRoutes(pages) {
  const routes = {};
  for (const p of pages) {
    for (const route of [p.route, ...(p.aliases || [])]) {
      routes[route === '/' ? '/' : route.replace(/\/+$/, '')] = p.file;
    }
  }
  return routes;
}

// Map one reference (attribute value, css url(), …) into the zip.
// ctx: { prefix, routes, cdnBases, vendors? }. Returns { out, cdnKey } or
// null to leave the reference untouched (external URLs, mailto:, anchors,
// routes the export doesn't carry — /dev, /portal).
export function mapReference(ref, ctx) {
  if (!ref) return null;
  // Vendored third-party scripts: exact URL → the mirrored local copy.
  if (ctx.vendors && ctx.vendors[ref]) return { out: ctx.prefix + ctx.vendors[ref], cdnKey: null };
  for (const base of ctx.cdnBases) {
    if (ref === base) return { out: `${ctx.prefix}cdn`, cdnKey: null };
    if (ref.startsWith(base + '/')) {
      const key = ref.slice(base.length + 1).split('#')[0].split('?')[0];
      if (!key) return { out: `${ctx.prefix}cdn`, cdnKey: null };
      return { out: `${ctx.prefix}cdn/${key}`, cdnKey: key };
    }
  }
  // Root-absolute from here ('//' is protocol-relative → external); relative
  // refs are already portable, except that cache-buster queries on plain
  // assets (main.css?v=N) resolve inconsistently on file:// — shed them.
  if (ref[0] !== '/' || ref[1] === '/') {
    if (ref[0] !== '/' && !/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
      const qAt = ref.indexOf('?');
      if (qAt > 0) {
        const path = ref.slice(0, qAt);
        if (/\.(css|m?js|woff2?|ttf|otf|webp|jpe?g|png|gif|svg|ico|mp4|webm|webmanifest|xml|txt)$/i.test(path)) {
          return { out: path, cdnKey: null };
        }
      }
    }
    return null;
  }
  const hashAt = ref.indexOf('#');
  const hash = hashAt >= 0 ? ref.slice(hashAt) : '';
  let path = hashAt >= 0 ? ref.slice(0, hashAt) : ref;
  const qAt = path.indexOf('?');
  const query = qAt >= 0 ? path.slice(qAt) : '';
  if (qAt >= 0) path = path.slice(0, qAt);

  const routeKey = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const file = ctx.routes[routeKey];
  // Routes keep their query (post.html?slug=… means something); plain files
  // drop it (?v= cache-busters would break file:// resolution on some setups).
  if (file) return { out: ctx.prefix + file + query + hash, cdnKey: null };
  if (/\.[a-z0-9]+$/i.test(path)) return { out: ctx.prefix + path.slice(1) + hash, cdnKey: null };
  return null;
}

// ---- HTML / CSS rewriting ----

// url(...) occurrences in CSS text or style attributes.
export function rewriteCssText(css, ctx, keys) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => {
    const r = mapReference(ref.trim(), ctx);
    if (!r) return m;
    if (r.cdnKey) keys.add(r.cdnKey);
    return `url(${q}${r.out}${q})`;
  });
}

function rewriteSrcsetValue(value, ctx, keys) {
  return value
    .split(',')
    .map((part) => {
      const t = part.trim();
      if (!t) return t;
      const sp = t.indexOf(' ');
      const url = sp === -1 ? t : t.slice(0, sp);
      const rest = sp === -1 ? '' : t.slice(sp);
      const r = mapReference(url, ctx);
      if (!r) return t;
      if (r.cdnKey) keys.add(r.cdnKey);
      return r.out + rest;
    })
    .join(', ');
}

// Rewrite the references a saved page carries in its markup: href/src/
// poster/content (incl. the edge-injected cdn-base meta), srcset, and
// inline style url(). Regexes only touch attribute syntax, so string
// literals inside inline <script> bodies pass through — references built
// by page JS at runtime are the offline shim's job, not this pass's.
export function rewriteHtml(html, ctx) {
  const keys = new Set();
  const mapAttr = (m, pre, val, post) => {
    const r = mapReference(val, ctx);
    if (!r) return m;
    if (r.cdnKey) keys.add(r.cdnKey);
    return pre + r.out + post;
  };
  let out = html
    .replace(/(\s(?:href|src|poster|content)=")([^"]*)(")/gi, mapAttr)
    .replace(/(\s(?:href|src|poster|content)=')([^']*)(')/gi, mapAttr);
  out = out.replace(/(\ssrcset=")([^"]*)(")/gi, (m, pre, val, post) =>
    pre + rewriteSrcsetValue(val, ctx, keys) + post);
  out = out.replace(/(\sstyle=")([^"]*)(")/gi, (m, pre, val, post) =>
    val.includes('url(') ? pre + rewriteCssText(val, ctx, keys) + post : m);
  return { html: out, cdnKeys: keys };
}

// Turn a dependency-free ES module into a classic script: strip the export
// keywords so its top-level declarations become globals. Only for modules
// with no imports — a page opened from file:// can't import() local modules
// (CORS), so the export loads this copy up front and the page falls back to
// the globals it defines.
export function stripEsmExports(src) {
  if (/^\s*import\b/m.test(src)) {
    throw new Error('offlineModules entries must be dependency-free (no import statements)');
  }
  return src.replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '');
}

// Fonts referenced by CSS get inlined as data: URIs — Chromium enforces CORS
// on font loads even from file://, so a relative url() that works for every
// other asset type is blocked for fonts. `loadDataUri(ref)` resolves a url()
// reference to a data: URI (or null to leave it alone; the file still ships).
export async function inlineCssFonts(css, loadDataUri) {
  const FONT_URL_RE = /url\(\s*(['"]?)([^'")]+\.(?:woff2?|ttf|otf))\1\s*\)/gi;
  const unique = [...new Set([...css.matchAll(FONT_URL_RE)].map((m) => m[2]))];
  const inlined = new Map();
  for (const ref of unique) {
    const uri = await loadDataUri(ref);
    if (uri) inlined.set(ref, uri);
  }
  return css.replace(FONT_URL_RE, (m, q, ref) =>
    inlined.has(ref) ? `url(${q}${inlined.get(ref)}${q})` : m);
}

// The offline-runtime tags, first in <head> so they execute before any
// page script (post.html loads lighttable.js inside <head>). Classic
// scripts, not modules — ES modules are CORS-blocked on file://.
// `extraScripts` carries the classicized offlineModules. Font preloads go:
// with the faces inlined into the CSS they only produce a CORS error in
// the file:// console.
export function injectOfflineRuntime(html, prefix, extraScripts = []) {
  const tags = ['offline/site-data.js', ...extraScripts, 'offline/offline-shim.js']
    .map((f) => `<script src="${prefix}${f}"></script>`)
    .join('');
  return html
    .replace(/<link\b[^>]*\bas="font"[^>]*>\s*/gi, '')
    .replace(/<head([^>]*)>/i, (m, attrs) => `<head${attrs}>${tags}`);
}

// ---- CDN-key harvesting + image-rule expansion ----

const _escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MEDIA_EXT_RE = '[\\w.%+~/-]+?\\.(?:webp|jpe?g|png|gif|mp4|webm)';

// Scan free text (data JSON, markdown bodies) for CDN object references the
// image rules can't know about — inline blog media, pre-staged library
// assets an FN body uses, OG cards.
export function harvestCdnKeys(text, cdnBases) {
  const keys = new Set();
  for (const base of cdnBases) {
    const re = new RegExp(`${_escapeRe(base)}/(${MEDIA_EXT_RE})`, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) keys.add(m[1]);
  }
  return keys;
}

export function tierForKey(key) {
  return /\.(mp4|webm)$/i.test(key) ? 'video' : 'web';
}

// datasets: { 'data/archive.json': [...], … } (parsed). Applies each
// manifest rule to each entry of its source array.
export function expandImageRules(datasets, rules) {
  const out = [];
  for (const rule of rules) {
    const arr = datasets[rule.source];
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      let keys = [];
      try { keys = rule.expand(entry) || []; } catch { /* one bad entry never sinks the export */ }
      out.push(...keys);
    }
  }
  return out;
}

export function mergeKeyTiers(entries) {
  const merged = new Map();
  for (const { key, tier } of entries) {
    if (!key) continue;
    const cur = merged.get(key);
    if (!cur || (TIER_RANK[tier] || 9) < (TIER_RANK[cur] || 9)) merged.set(key, tier);
  }
  return merged;
}

// Keys travel URL-encoded (that's how they appear in URLs); on disk the
// object's real name is the decoded form, which is what an encoded src
// resolves back to. Undecodable junk stays as-is.
export function zipPathForKey(key) {
  try { return `cdn/${decodeURIComponent(key)}`; } catch { return `cdn/${key}`; }
}

// ---- generated offline runtime ----

// The data island: everything the pages fetch(), embedded as one classic
// script. <-escaped so no content can close the tag or open another.
export function buildOfflineDataJs(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return (
    '// OAKLENS // OFFLINE DATA ISLAND — generated by the Field Console site export.\n' +
    '// The offline shim answers the pages\' fetch() calls from this snapshot.\n' +
    'window.__OAKLENS_OFFLINE__ = ' + json + ';\n'
  );
}

// The shim: patches fetch() to serve the data island, and relativizes
// root-absolute references that page JS builds at runtime (post links,
// inline blog media) via a click handler + MutationObserver. Deliberately
// plain ES5 classic JS: it must run from file:// in anything.
export function buildOfflineShimJs(routes) {
  return `// OAKLENS // OFFLINE SHIM — generated by the Field Console site export.
// Makes the exported pages work with no server and no network: fetch() of
// site data is answered from the embedded snapshot (file:// blocks fetch of
// local files), and root-absolute URLs built by page scripts at runtime are
// remapped onto this folder. The published site never loads this file.
(function () {
  'use strict';
  var ROUTES = ${JSON.stringify(routes)};
  var sc = document.currentScript;
  var src = sc && sc.src ? sc.src : '';
  var ROOT = src.indexOf('offline/') !== -1 ? src.slice(0, src.lastIndexOf('offline/')) : '';

  function hasExt(path) {
    var dot = path.lastIndexOf('.');
    return dot > path.lastIndexOf('/') && dot !== path.length - 1;
  }

  // '/archive?f=x' → ROOT + 'archive/index.html?f=x'; '/api/cdn/<key>' →
  // ROOT + 'cdn/<key>'; unknown extensionless routes → null (leave alone).
  function mapAbs(url) {
    if (!url || url.charAt(0) !== '/' || url.charAt(1) === '/') return null;
    var hash = '';
    var hi = url.indexOf('#');
    if (hi >= 0) { hash = url.slice(hi); url = url.slice(0, hi); }
    var query = '';
    var qi = url.indexOf('?');
    if (qi >= 0) { query = url.slice(qi); url = url.slice(0, qi); }
    if (url.indexOf('/api/cdn/') === 0) return ROOT + 'cdn/' + url.slice(9) + hash;
    var routeKey = url;
    while (routeKey.length > 1 && routeKey.charAt(routeKey.length - 1) === '/') {
      routeKey = routeKey.slice(0, -1);
    }
    if (ROUTES[routeKey]) return ROOT + ROUTES[routeKey] + query + hash;
    if (hasExt(url)) return ROOT + url.slice(1) + hash;
    return null;
  }

  // ---- fetch() from the snapshot ----
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
      var clean = url.split('#')[0].split('?')[0];
      var data = window.__OAKLENS_OFFLINE__ || {};
      var files = data.files || {};
      var api = data.api || {};
      if (clean.charAt(0) === '/' && clean.charAt(1) !== '/') {
        var rel = clean.slice(1);
        if (Object.prototype.hasOwnProperty.call(files, rel)) {
          var type = rel.slice(-5) === '.json' ? 'application/json' : 'text/plain; charset=utf-8';
          return Promise.resolve(new Response(files[rel], { status: 200, headers: { 'Content-Type': type } }));
        }
        if (Object.prototype.hasOwnProperty.call(api, clean)) {
          return Promise.resolve(new Response(api[clean], { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (clean.indexOf('/api/') === 0) {
          return Promise.resolve(new Response('{"ok":false,"offline":true}', { status: 503, headers: { 'Content-Type': 'application/json' } }));
        }
        var mapped = mapAbs(url);
        if (mapped && realFetch) return realFetch(mapped, init);
      }
      if (realFetch) return realFetch(input, init);
      return Promise.reject(new TypeError('fetch unavailable offline'));
    } catch (e) {
      return Promise.reject(e);
    }
  };

  // ---- runtime-built references ----
  function fixAttr(el, name) {
    var v = el.getAttribute(name);
    if (!v) return;
    var m = mapAbs(v);
    if (m) el.setAttribute(name, m);
  }
  function fixSrcset(el) {
    var v = el.getAttribute('srcset');
    if (!v || v.indexOf('/') !== 0 && v.indexOf(', /') === -1 && v.indexOf(',/') === -1) return;
    var parts = v.split(',');
    var changed = false;
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].replace(/^\\s+/, '');
      if (!t) continue;
      var sp = t.indexOf(' ');
      var u = sp === -1 ? t : t.slice(0, sp);
      var rest = sp === -1 ? '' : t.slice(sp);
      var m = mapAbs(u);
      if (m) { parts[i] = m + rest; changed = true; }
    }
    if (changed) el.setAttribute('srcset', parts.join(', '));
  }
  function fixStyle(el) {
    var v = el.getAttribute('style');
    if (!v || v.indexOf('url(') === -1) return;
    var out = '';
    var idx = 0;
    var pos;
    while ((pos = v.indexOf('url(', idx)) !== -1) {
      var end = v.indexOf(')', pos);
      if (end === -1) break;
      var inner = v.slice(pos + 4, end);
      var trimmed = inner.replace(/^\\s+|\\s+$/g, '');
      var quote = '';
      if (trimmed.charAt(0) === '"' || trimmed.charAt(0) === "'") {
        quote = trimmed.charAt(0);
        trimmed = trimmed.slice(1, -1);
      }
      var m = mapAbs(trimmed);
      out += v.slice(idx, pos) + 'url(' + quote + (m || trimmed) + quote + ')';
      idx = end + 1;
    }
    out += v.slice(idx);
    if (out !== v) el.setAttribute('style', out);
  }
  function fixEl(el) {
    if (!el || el.nodeType !== 1 || !el.getAttribute) return;
    fixAttr(el, 'src');
    fixAttr(el, 'href');
    fixAttr(el, 'poster');
    fixSrcset(el);
    fixStyle(el);
    if (el.querySelectorAll) {
      var kids = el.querySelectorAll('[src],[href],[poster],[srcset],[style]');
      for (var i = 0; i < kids.length; i++) {
        fixAttr(kids[i], 'src');
        fixAttr(kids[i], 'href');
        fixAttr(kids[i], 'poster');
        fixSrcset(kids[i]);
        fixStyle(kids[i]);
      }
    }
  }
  if (window.MutationObserver) {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) fixEl(added[j]);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  // Belt-and-suspenders for links whose href was set after insertion.
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document && !(t.tagName === 'A' && t.getAttribute('href'))) t = t.parentNode;
    if (!t || t === document) return;
    var href = t.getAttribute('href');
    if (!href || href.charAt(0) !== '/') return;
    var mapped = mapAbs(href);
    if (mapped) { e.preventDefault(); window.location.href = mapped; }
  }, true);
})();
`;
}

// ---- zip paperwork ----

export function buildReadme(info) {
  const failed = (info.failures || []).length;
  return `OAKLENS // SITE-IN-A-ZIP · ${info.host} · ${info.date}
=====================================================
A complete offline mirror of the published site, exported from the
Field Console. Every path in here is relative: open index.html in any
browser — from this folder, a thumb drive, cold storage — and the site
works with no server, no account, and no network.

WHAT'S INSIDE
  index.html + pages/     the site as served (edge chrome baked in)
  css/ js/ fonts/         the published assets, untouched
  data/*.json             content source of truth (what git tracks)
  posts/*.md              field-note markdown, one file per FN//
  cdn/                    ${info.imageCount} media files mirrored from storage
  offline/                the shim that makes fetch() + links work offline
${failed ? `
HEADS-UP
  ${failed} media download${failed > 1 ? 's' : ''} failed during this export — each is listed in
  export-report.txt. The pages fall back to another size variant or
  the '//' placeholder, same as online.
` : ''}
WHAT NEEDS THE NETWORK
  Music embeds (Apple Music iframes), the subscribe form, the client
  portal, and the Field Console are live-service features — they wait
  quietly until the site is back online. Everything else is local.

RESTORING / REDEPLOYING
  data/ and posts/ are byte-identical to what the git repository tracks:
  copy them into a fresh clone, commit, deploy. Images restore to any
  S3-compatible bucket from cdn/ (one rclone copy). See setup.md in the
  repository for the full path from zero.

Generated ${info.generated} by the Field Console site exporter.
`;
}

export function buildExportReport(info) {
  const lines = [
    `OAKLENS // SITE EXPORT REPORT · ${info.generated}`,
    `origin: ${info.origin}`,
    `tiers: ${info.tiers.join(', ') || '(none)'}`,
    `pages: ${info.pageCount} · assets: ${info.assetCount} · data files: ${info.dataCount} · posts: ${info.postCount}`,
    `media mirrored: ${info.imageCount} (${info.mb} MB fetched)`,
  ];
  if (info.skipped.length) {
    lines.push('', `skipped (excluded tiers): ${info.skipped.length}`);
  }
  if (info.failures.length) {
    lines.push('', `FAILED DOWNLOADS (${info.failures.length}) — these objects 404'd or errored; the`,
      'pages fall back to another size variant or a placeholder offline:');
    for (const f of info.failures) lines.push(`  ${f}`);
  } else {
    lines.push('', 'no failed downloads.');
  }
  return lines.join('\n') + '\n';
}
