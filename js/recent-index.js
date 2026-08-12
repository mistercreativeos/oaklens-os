/* ============================================================
   RECENT-INDEX.JS — homepage "recent work" grid
   ------------------------------------------------------------
   Classic script (window.RecentIndex) — same posture as lighttable.js: loaded
   via <script src>, copied verbatim into the site-in-a-ZIP export
   (js/export-manifest.js `assets`), and rendered offline from the data island
   through the export's fetch() shim. No build step, no imports, no third party.

   Merges data/archive.json (photo cards) + data/posts.json (Field-Note text
   cards) + data/audio.json (audio cards), takes the most recent items, and
   renders a 3-up mixed row into #recent-index. Text cards carry the
   adaptive-tier craft: a render-time drop cap, a blinking editor caret, and
   statement/feature/standard sizing so short posts read as intentional and
   long ones fill like the preview. Audio cards carry a waveform player drawn
   from pre-measured peaks (js/audio-player.js) — no audio is fetched until
   someone presses play. A MISSING data file (an un-seeded fork) falls back to
   the bundled CC0 samples — the same split the archive/wall pages make
   (missing → samples, empty → empty); audio has no samples and so treats both
   the same.
   ============================================================ */
(function () {
  'use strict';

  var GRID_SIZE = 4;
  // The excerpt is a TEASE, not a summary — a line or two that ends on a clean
  // thought and makes a reader open the post. Deliberately short: a wall of
  // text on the homepage buries the tile's neighbours and gets skipped. Long
  // posts get trimmed to their first sentence(s); the type scales up to fill.
  var TEASE_MAX = 150;

  // ---- strip: mirror worker.js feedSummary()'s cleaning so a card reads the
  //      same as the feed — drop HTML + shortcode divs, markdown images,
  //      links→text, headings, bare embed URLs (Apple Music), emphasis/code
  //      chars; collapse whitespace. No truncation here (tiering wants the full
  //      length). ----
  function recentStrip(md) {
    if (!md) return '';
    return String(md)
      .replace(/<[^>]*>/g, ' ')                  // HTML passthrough + shortcode divs
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')     // markdown images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // links → their text
      .replace(/^#{1,6}\s+/gm, '')               // headings
      .replace(/^https?:\/\/\S+$/gm, ' ')        // bare embed links (Apple Music)
      .replace(/[*_`>~]/g, '')                   // emphasis/code/quote chars
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---- truncate: cut long text to `max`, preferring a clean sentence end in
  //      the back half (reads finished, no dangling ellipsis) and falling back
  //      to a word boundary + ellipsis. Short text is returned whole. ----
  function recentTruncate(t, max) {
    if (max == null) max = TEASE_MAX;
    if (!t || t.length <= max) return t || '';
    var cut = t.slice(0, max);
    var sent = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    if (sent > max * 0.55) return cut.slice(0, sent + 1);
    var brk = cut.lastIndexOf(' ');
    return cut.slice(0, brk > 0 ? brk : max) + '…';
  }

  // strip + truncate, for callers/tests that want the finished excerpt in one.
  function recentExcerpt(md, max) {
    return recentTruncate(recentStrip(md), max);
  }

  // ---- tier: the TEASE length → statement | feature | standard. Deterministic
  //      (no runtime auto-fit — that causes layout shift and breaks the offline
  //      export). Type size steps DOWN as the tease gets longer (see the
  //      .wk-text[data-tier] rules) so a one-liner becomes a big pull-quote and
  //      a two/three-line tease a slightly smaller one — every tier stays
  //      glanceable and fills the tile with balanced margins, never a wall. ----
  function recentTier(len) {
    if (len <= 55) return 'statement';
    if (len <= 105) return 'feature';
    return 'standard';
  }

  // ---- drop-cap initial: the first grapheme, but only when it is a Latin
  //      letter. A leading quote / number / emoji / non-Latin char (or an empty
  //      excerpt) returns '' and the caller skips the cap — never render a
  //      broken cap. ----
  function recentInitial(text) {
    var s = String(text || '');
    var ch = (typeof Array.from === 'function' ? Array.from(s) : s.split(''))[0] || '';
    return /[A-Za-z]/.test(ch) ? ch : '';
  }

  // ---- card focal point: the recent-work card is a tall 4:5 crop, so a frame
  //      may carry its own `cardFocus` tuned for it. Fall back to the shared
  //      thumbnail `focus`, then '' (CSS center). Keeping this pure lets the
  //      test suite pin the fallback without a DOM. ----
  function cardFocus(entry) {
    return (entry && (entry.cardFocus || entry.focus)) || '';
  }

  // ---- RAW (buffer) cards: the owner can "feature" a raw buffer frame — a
  //      daily — onto the grid, cited as "RAW · f#NNN". Capped to ONE card for
  //      now (RAW_MAX); the server hands over a few featured frames so opening
  //      this up to fill more slots later is a one-line change here. Pure so the
  //      cap is pinned by the test suite. ----
  var RAW_MAX = 1;
  function rawPick(featured, max) {
    if (max == null) max = RAW_MAX;
    return (featured || []).filter(function (r) { return r && r.filename; }).slice(0, max);
  }

  // A featured RAW daily is PINNED to a fixed slot (the third card) and always
  // shows, no matter its capture date — so the owner can feature ANY frame from
  // ANY period and have it land on the homepage. The other slots fill
  // newest-first around it. (With no featured frame the caller keeps the normal
  // newest-first mix, and the freshest item naturally reclaims the slot.) Pure,
  // so the placement is pinned by the test suite.
  var RAW_SLOT = 2;   // 0-based → the third card, visible in both 3-up and 4-up
  function pinRaw(nonRaw, rawItem, gridSize) {
    var picks = (nonRaw || []).slice(0, gridSize - 1);
    picks.splice(Math.min(RAW_SLOT, picks.length), 0, rawItem);
    return picks.slice(0, gridSize);
  }

  // ---- Audio cards: fed ONLY from the audio registry (data/audio.json), never
  //      deduced from a post's mix of text and media. An entry the owner flags
  //      `featured` surfaces as a play-card, exactly the way a buffer frame's
  //      `featured` surfaces the RAW daily. Capped to one for now — a card is a
  //      single statement; an EP is a field note with a tracklist. ----
  var AUDIO_MAX = 1;
  function audioPick(list, max) {
    if (max == null) max = AUDIO_MAX;
    return (list || [])
      .filter(function (a) { return a && a.featured && a.filename && a.slug; })
      .slice(0, max);
  }

  // Pinned to the SECOND slot, ahead of the RAW daily's third. Applied BEFORE
  // pinRaw so the running order lands photo · audio · RAW — all three visible
  // in the 3-up desktop row. (Pinning after would push RAW to the fourth slot,
  // which desktop hides.) Pure, so the placement is pinned by the test suite.
  var AUDIO_SLOT = 1;
  function pinAudio(items, audioItem, gridSize) {
    var picks = (items || []).slice();
    picks.splice(Math.min(AUDIO_SLOT, picks.length), 0, audioItem);
    return picks.slice(0, gridSize);
  }

  // ---- dates ----
  // Mirror worker.js feedDate(): added_at (ISO) then date (YYYY-MM-DD).
  function itemDate(x) { return x.added_at || x.date || ''; }
  // Meta year: prefer a trailing 4-digit year in a frame's location ("San
  // Francisco, 2025" → the shoot year the archive shows); else the record year.
  function yearOf(x) {
    var m = String(x.location || '').match(/(\d{4})\D*$/);
    if (m) return m[1];
    var y = String(itemDate(x)).slice(0, 4);
    return /^\d{4}$/.test(y) ? y : '';
  }

  // ---- selection: newest first, but keep the row mixed ----
  // The barrel this replaces was a mixed "Latest" feed; the owner wants the
  // recent-work grid to surface both the photography and the writing. So when
  // both datasets are non-empty but the top-N came out single-type, trade the
  // oldest pick for the newest item of the missing type, then re-sort by date.
  function pickRecent(archive, posts, rawFeatured, audioFeatured) {
    var items = []
      .concat((archive || [])
        .filter(function (e) { return e && e.filename && e.slug; })
        .map(function (e) { return { kind: 'photo', data: e, d: itemDate(e) }; }))
      .concat((posts || [])
        .filter(function (p) { return p && p.fn_id; })
        .map(function (p) { return { kind: 'text', data: p, d: itemDate(p) }; }));

    items.sort(function (a, b) { return String(b.d).localeCompare(String(a.d)); });

    // Featured items are PINNED and always show regardless of date — the rest
    // fills newest-first around them. Audio first (slot 1), then the RAW daily
    // (slot 2); see pinAudio for why that order matters. When nothing is
    // featured, fall through to the normal mixed newest-first grid.
    var audio = audioPick(audioFeatured);
    var raw = rawPick(rawFeatured);
    var pinned = items;
    if (audio.length) {
      pinned = pinAudio(pinned, { kind: 'audio', data: audio[0], d: audio[0].added_at || '' }, GRID_SIZE);
    }
    if (raw.length) {
      pinned = pinRaw(pinned, { kind: 'photo', raw: true, data: raw[0], d: raw[0].captured_at || '' }, GRID_SIZE);
    }
    if (audio.length || raw.length) return pinned.slice(0, GRID_SIZE);

    var picks = items.slice(0, GRID_SIZE);

    var hasPhoto = items.some(function (i) { return i.kind === 'photo'; });
    var hasText = items.some(function (i) { return i.kind === 'text'; });
    function ensure(kind) {
      if (picks.length < GRID_SIZE) return;
      if (picks.some(function (i) { return i.kind === kind; })) return;
      var newest = items.find(function (i) { return i.kind === kind; });
      if (newest) picks[picks.length - 1] = newest;
    }
    if (hasPhoto && hasText) { ensure('photo'); ensure('text'); }

    picks.sort(function (a, b) { return String(b.d).localeCompare(String(a.d)); });

    // Evaluation adjustment: if the only text card is in the 4th slot,
    // swap it with the 3rd slot so it displays in 3-card (desktop/mobile) views.
    if (picks.length === 4 && picks[3].kind === 'text' && !picks.slice(0, 3).some(function (i) { return i.kind === 'text'; })) {
      var temp = picks[2];
      picks[2] = picks[3];
      picks[3] = temp;
    }

    return picks;
  }

  // ---- sample fallback: a MISSING data file is an un-seeded fork ----
  // Same contract as the archive/wall pages (manual §5.21): a file that fails
  // to load falls back to bundled CC0 samples, while a file that loads as []
  // means the content was cleared on purpose and stays empty. Before this the
  // homepage hid the recent-work section in both states, so a fresh fork's
  // homepage read emptier than its own archive page.
  //
  // The photo entries mirror the first three of page-archive.js
  // getSampleData() — same slugs, so the card links open the same sample
  // frames in the archive lightbox. The note mirrors posts/fn-sample.md
  // (which also ships in a fork, so the card's link renders a real post);
  // its body must stay in sync with that file — the test suite compares
  // them. Everything is dateless on purpose: with three photos ahead of one
  // note, pickRecent keeps concat order and its slot-3 swap lands the row as
  // photo · photo · note in the 3-up view — the fresh-fork target.
  function sampleFrames() {
    return ['First Shadow', 'In Flight', 'Golden Ray'].map(function (title, i) {
      return {
        slug: 'sample-' + String(i).padStart(2, '0'),
        filename: 'sample-' + String(i).padStart(2, '0'),
        title: title,
        location: 'Sample City, 2026',
        camera: 'Mirrorless',
      };
    });
  }
  function sampleNote() {
    return {
      fn_id: 'fn-sample',
      title: 'Learning to See Again',
      location: 'Sample City',
      body: 'The first walk with a new camera is never about the pictures — it is about learning to see again. Every block becomes an audition: the light on a wall you have passed a hundred times, the geometry of a stairwell that turns out to have rhythm.\n\nNothing from the first day survives the edit. That is fine. The frames were never the point — the point was recalibrating, walking slower, letting the eye catch on things the errand-brain filters out. A camera is just a reason to look.\n\nThis is a sample field note. It ships with the engine so a brand-new site has something on its Field Notes page and its homepage from the first minute — a stand-in, not a seed. Publish your first real note from the Field Console and this one steps aside.',
    };
  }
  // null = the fetch failed (missing file / un-seeded fork) → samples.
  // Anything else (including []) is real data and passes through.
  function withSampleFallback(data, samples) {
    return data === null ? samples : (Array.isArray(data) ? data : []);
  }

  // Expose the pure helpers for the test suite (Node) and for the offline
  // global. Harmless in the browser.
  var g = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);
  g.RecentIndex = {
    recentStrip: recentStrip,
    recentTruncate: recentTruncate,
    recentExcerpt: recentExcerpt,
    recentTier: recentTier,
    recentInitial: recentInitial,
    cardFocus: cardFocus,
    rawPick: rawPick,
    pinRaw: pinRaw,
    audioPick: audioPick,
    pinAudio: pinAudio,
    pickRecent: pickRecent,
    sampleFrames: sampleFrames,
    sampleNote: sampleNote,
    withSampleFallback: withSampleFallback,
  };

  // Everything below needs a DOM. Bailing here keeps the Node import pure so the
  // vitest suite can exercise the helpers above without a browser.
  if (typeof document === 'undefined') return;

  // ---- CDN image URL — mirror archive/index.html cdnSrc() ----
  function cdnRoot() {
    var meta = document.querySelector('meta[name="cdn-base"]');
    return ((meta && meta.content) || (location.origin + '/api/cdn')).replace(/\/+$/, '');
  }
  function frameSrc(filename, size) {
    var base = encodeURIComponent(String(filename).replace(/\.[^.]+$/, ''));
    return cdnRoot() + '/archive/' + base + '-' + size + 'w.webp';
  }

  // ---- DOM helpers ----
  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // ---- frame number → f#NNN (zero-padded to 3, matching the console/light-table) ----
  function frameTag(num) { return 'f#' + String(num || 0).padStart(3, '0'); }

  function photoCard(entry, isRaw) {
    var a = el('a', 'wk-card');
    // RAW cards deep-link to the buffer frame (by id — always exact); archive
    // cards to the curated frame (by slug).
    a.href = isRaw
      ? '/archive/buffer/?f=' + encodeURIComponent(entry.id || '')
      : '/archive/?f=' + encodeURIComponent(entry.slug || '');
    var img = el('div', 'wk-img');
    img.style.backgroundImage = "url('" + frameSrc(entry.filename, 1024) + "')";
    var cardPos = cardFocus(entry);
    if (cardPos) img.style.backgroundPosition = cardPos;
    var tag = el('span', 'wk-tag');
    tag.textContent = isRaw ? 'RAW' : 'Archive';
    img.appendChild(tag);
    var body = el('div', 'wk-body');
    var title = el('div', 'wk-title');
    // A buffer frame has no title — its identity IS the permanent frame number.
    title.textContent = isRaw ? frameTag(entry.num) : (entry.title || '');
    var meta = el('div', 'wk-meta');
    meta.textContent = isRaw
      ? String(entry.captured_at || '').slice(0, 4)
      : [entry.camera, yearOf(entry)].filter(Boolean).join(' · ');
    body.appendChild(title);
    body.appendChild(meta);
    a.appendChild(img);
    a.appendChild(body);
    return a;
  }

  function textCard(post) {
    var excerpt = recentTruncate(recentStrip(post.body), TEASE_MAX);
    var tier = recentTier(excerpt.length);
    var initial = recentInitial(excerpt);

    var a = el('a', 'wk-card wk-text');
    a.href = '/field-notes/post?slug=' + encodeURIComponent(post.fn_id || '');
    a.setAttribute('data-tier', tier);

    var kicker = el('span', 'wk-kicker');
    var dot = el('span', 'wk-dot');
    dot.setAttribute('aria-hidden', 'true');
    kicker.appendChild(dot);
    kicker.appendChild(document.createTextNode('Field Note'));

    var title = el('div', 'wk-t-title');
    title.textContent = post.title || '';

    var snip = el('div', 'wk-snip');
    if (excerpt) {
      // Drop cap opens feature + standard (a bold graphic initial); statement
      // is all-display type, so no cap — the words are already the flourish.
      if (initial && tier !== 'statement') {
        var cap = el('span', 'wk-dropcap');
        cap.textContent = initial;
        snip.appendChild(cap);
        snip.appendChild(document.createTextNode(excerpt.slice(initial.length)));
      } else {
        snip.appendChild(document.createTextNode(excerpt));
      }
    }
    // Blinking editor caret — the note is "still being written." Text cards only.
    var caret = el('span', 'ed-caret');
    caret.setAttribute('aria-hidden', 'true');
    snip.appendChild(caret);

    var meta = el('div', 'wk-t-meta');
    meta.textContent = [post.location, yearOf(post)].filter(Boolean).join(' · ');

    a.appendChild(kicker);
    a.appendChild(title);
    a.appendChild(snip);
    a.appendChild(meta);
    return a;
  }

  // ---- audio card ----
  // Built from a registry entry, so every value on it was typed by the author
  // rather than guessed from a post's contents.
  //
  // The whole tile links to the /listen permalink through a stretched overlay
  // on the title's anchor. That keeps ONE anchor and ONE button in the markup:
  // a <button> nested inside an <a> is invalid HTML and unreadable to a screen
  // reader, which is the trap this pattern exists to avoid. CSS raises the
  // player and the share button above the overlay so they stay pressable.
  function listenHref(entry) {
    return '/listen/?a=' + encodeURIComponent(entry.slug || '');
  }

  var SHARE_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M8 0.9 11.25 4.15 9.95 5.45 8.9 4.4 8.9 10.5 7.1 10.5 7.1 4.4 6.05 5.45 4.75 4.15Z"/>'
    + '<path d="M2.6 6.8h2.3v6.5h6.2V6.8h2.3v8.3H2.6z"/></svg>';

  function audioCard(entry) {
    var card = el('div', 'wk-card wk-audio');

    var kicker = el('span', 'wk-kicker');
    var dot = el('span', 'wk-dot');
    dot.setAttribute('aria-hidden', 'true');
    kicker.appendChild(dot);
    kicker.appendChild(document.createTextNode('Audio'));

    var title = el('div', 'wk-a-title');
    var link = el('a');
    link.href = listenHref(entry);
    link.textContent = entry.title || '';
    title.appendChild(link);

    card.appendChild(kicker);
    card.appendChild(title);

    if (entry.sub) {
      var sub = el('div', 'wk-a-sub');
      sub.textContent = entry.sub;
      card.appendChild(sub);
    }

    // The player is progressive enhancement: if audio-player.js failed to load
    // the card still reads and still links to the permalink, rather than
    // rendering as a broken tile.
    var AP = g.AudioPlayer;
    var hasPlayer = AP && typeof AP.create === 'function';
    if (hasPlayer) {
      var player = AP.create({
        src: entry.filename,
        peaks: AP.peaksFromString(entry.peaks),
        duration: entry.duration,
        variant: 'card',
        title: entry.title || '',
        // The card owns its own playing state so the title can scroll while
        // the track runs — the player tells it rather than the CSS reaching in.
        onstate: function (playing) { card.classList.toggle('is-playing', playing); },
      });
      card.appendChild(player.root);
      AP.marquee(title);
    }

    var foot = el('div', 'wk-a-foot');
    var meta = el('div', 'wk-a-meta');
    var bits = [];
    var dur = hasPlayer ? AP.durationLabel(entry.duration) : '';
    if (dur) bits.push(dur);
    var yr = yearOf(entry);
    if (yr) bits.push(yr);
    meta.textContent = bits.join(' · ');
    foot.appendChild(meta);

    var share = el('button', 'wk-a-share');
    share.type = 'button';
    share.setAttribute('aria-label', 'Share this track');
    share.innerHTML = SHARE_SVG;
    share.addEventListener('click', function (ev) {
      // Sits over the stretched card link — a press here shares, never navigates.
      ev.preventDefault();
      ev.stopPropagation();
      if (hasPlayer) AP.share(location.origin + listenHref(entry), entry.title || '', share);
    });
    foot.appendChild(share);

    card.appendChild(foot);
    return card;
  }

  // null = the data file is MISSING (an un-seeded fork), [] = it loaded empty
  // (cleared on purpose). The caller maps null to the sample fallback — the
  // same missing-vs-empty split the archive and wall pages make (manual §5.21).
  function getJson(path) {
    return fetch(path)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function render() {
    var host = document.getElementById('recent-index');
    if (!host) return;
    // /api/buffer-summary is a tiny precomputed endpoint (also snapshotted into
    // the offline export) — it carries the featured RAW frames so the homepage
    // never downloads the full buffer.json just to show one daily.
    Promise.all([
      getJson('/data/archive.json'),
      getJson('/data/posts.json'),
      getJson('/api/buffer-summary'),
      // The audio registry. No sample fallback here on purpose: the engine
      // ships sample FRAMES and a sample NOTE, but no sample audio file — an
      // un-seeded fork should show no audio card rather than a play button
      // that 404s. Missing and empty therefore mean the same thing.
      getJson('/data/audio.json'),
    ])
      .then(function (res) {
        var archive = withSampleFallback(res[0], sampleFrames());
        var posts = withSampleFallback(res[1], [sampleNote()]);
        var summary = (res[2] && !Array.isArray(res[2])) ? res[2] : {};
        var rawFeatured = Array.isArray(summary.featured) ? summary.featured : [];
        var audio = Array.isArray(res[3]) ? res[3] : [];
        var picks = pickRecent(archive, posts, rawFeatured, audio);
        var section = host.closest ? host.closest('.cl-work') : null;
        if (!picks.length) {
          if (section) section.hidden = true;
          return;
        }
        var frag = document.createDocumentFragment();
        picks.forEach(function (item) {
          frag.appendChild(
            item.kind === 'audio' ? audioCard(item.data)
              : item.kind === 'photo' ? photoCard(item.data, item.raw)
                : textCard(item.data)
          );
        });
        host.textContent = '';
        host.appendChild(frag);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
