/* ============================================================
   AUDIO-PLAYER.JS — the frameless waveform player
   ------------------------------------------------------------
   Classic script (window.AudioPlayer) — same posture as recent-index.js and
   lighttable.js: loaded via <script src>, copied verbatim into the
   site-in-a-ZIP export, and rendered offline from the data island. No build
   step, no imports, no third party. Native <audio> does the playing; the CSP
   already allows it (media-src 'self' + CDN), so this widens nothing.

   ONE player, three surfaces — the homepage card, the /listen permalink, and
   inline in a field note (where consecutive tracks auto-group into a
   tracklist). It has NO box, stroke or background of its own: every color is
   a theme token, so it reads as drawn into the page rather than dropped onto
   it, and every preset/theme gets it for free.

   THE WAVEFORM IS PRE-COMPUTED. Peaks (PEAK_COUNT values, 0–1) are measured
   ONCE in the console at attach time and travel in data/audio.json, so a
   visitor never downloads an audio file just to render a card. The <audio> is
   preload="none" — bytes are fetched only when someone presses play. That is
   what keeps a 12-track tracklist as cheap as a paragraph of text.

   Progress is ONE CSS custom property (--ap-progress, 0–1): the fill bar row
   is clipped to it, so painting is a single style write and the colors stay
   in CSS where the theme can reach them.
   ============================================================ */
(function () {
  'use strict';

  // Stored resolution. Every track in data/audio.json carries this many peaks;
  // display resamples DOWN per variant, so one stored array serves every
  // surface and changing a bar count never re-measures audio.
  var PEAK_COUNT = 96;

  // Bars drawn per variant. Deterministic (never measured from layout) — a
  // runtime auto-fit would cause layout shift and break the offline export,
  // the same reason recent-index.js tiers text by length instead of fitting.
  var BAR_COUNTS = { card: 56, full: 96, row: 40 };

  // A silent sample still gets a sliver of bar: a zero-height gap reads as a
  // rendering fault, a floor reads as intent.
  var BAR_FLOOR = 0.06;

  var SEEK_STEP = 5;   // seconds per arrow key

  // ---- pure helpers (exported for the test suite + the console) ----

  function clamp01(n) {
    var v = Number(n);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function normalizePeaks(peaks) {
    if (!peaks || typeof peaks.length !== 'number') return [];
    var out = [];
    for (var i = 0; i < peaks.length; i++) out.push(clamp01(peaks[i]));
    return out;
  }

  // Resample a peak array to `count` bars by bucket-averaging. Handles both
  // directions: downsampling averages each bucket, upsampling repeats the
  // nearest source value (start === end collapses to one sample).
  function resamplePeaks(peaks, count) {
    var src = normalizePeaks(peaks);
    var n = Math.floor(Number(count) || 0);
    if (!src.length || n < 1) return [];
    var out = [];
    for (var i = 0; i < n; i++) {
      var start = Math.floor((i * src.length) / n);
      var end = Math.floor(((i + 1) * src.length) / n);
      if (end <= start) end = start + 1;
      var sum = 0, seen = 0;
      for (var j = start; j < end && j < src.length; j++) { sum += src[j]; seen++; }
      out.push(seen ? sum / seen : 0);
    }
    return out;
  }

  // Peaks serialize as a compact comma string (2 decimals ≈ 4 bytes/bar, so a
  // 96-peak track costs ~400 bytes in data/audio.json — cheap enough to keep
  // in git, which is where derived-but-versioned content belongs).
  function peaksToString(peaks) {
    return normalizePeaks(peaks).map(function (p) {
      return String(Math.round(p * 100) / 100);
    }).join(',');
  }

  function peaksFromString(str) {
    if (!str) return [];
    return String(str).split(',').reduce(function (acc, part) {
      var t = part.trim();
      if (t !== '') acc.push(clamp01(parseFloat(t)));
      return acc;
    }, []);
  }

  // m:ss, or h:mm:ss once an hour is on the clock (podcast episodes get long).
  function formatTime(sec) {
    var s = Math.floor(Number(sec) || 0);
    if (!isFinite(s) || s < 0) s = 0;
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var rest = s % 60;
    var mm = h ? (m < 10 ? '0' + m : String(m)) : String(m);
    return (h ? h + ':' : '') + mm + ':' + (rest < 10 ? '0' + rest : String(rest));
  }

  // The card badge — a duration reads better rounded up to whole minutes than
  // as a false-precision clock ("24 MIN", not "23:41").
  function durationLabel(sec) {
    var s = Math.floor(Number(sec) || 0);
    if (!isFinite(s) || s <= 0) return '';
    if (s < 60) return s + ' SEC';
    return Math.max(1, Math.round(s / 60)) + ' MIN';
  }

  // Split a list of elements into runs of DOM-adjacent siblings. This is what
  // turns "the author dropped three audio shortcodes in a row" into one
  // numbered tracklist, while a lone shortcode elsewhere in the post stays a
  // standalone player. Pure (it only reads `nextElementSibling`), so the
  // grouping rule is pinned by the test suite without a browser.
  function groupAdjacent(els) {
    var list = (els && typeof els.length === 'number') ? Array.prototype.slice.call(els) : [];
    var runs = [];
    var current = [];
    for (var i = 0; i < list.length; i++) {
      var prev = current.length ? current[current.length - 1] : null;
      if (prev && prev.nextElementSibling === list[i]) {
        current.push(list[i]);
      } else {
        if (current.length) runs.push(current);
        current = [list[i]];
      }
    }
    if (current.length) runs.push(current);
    return runs;
  }

  // A click at x within a track of width w → a fraction of the duration.
  function seekFraction(x, width) {
    var w = Number(width) || 0;
    if (w <= 0) return 0;
    return clamp01(Number(x) / w);
  }

  var g = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  var API = {
    PEAK_COUNT: PEAK_COUNT,
    BAR_COUNTS: BAR_COUNTS,
    BAR_FLOOR: BAR_FLOOR,
    clamp01: clamp01,
    normalizePeaks: normalizePeaks,
    resamplePeaks: resamplePeaks,
    peaksToString: peaksToString,
    peaksFromString: peaksFromString,
    formatTime: formatTime,
    durationLabel: durationLabel,
    seekFraction: seekFraction,
    groupAdjacent: groupAdjacent,
  };
  g.AudioPlayer = API;

  // Everything below needs a DOM. Bailing here keeps the Node import pure so
  // the vitest suite can exercise the helpers above without a browser.
  if (typeof document === 'undefined') return;

  // ---- CDN audio URL — mirrors recent-index.js frameSrc() ----
  function cdnRoot() {
    var meta = document.querySelector('meta[name="cdn-base"]');
    return ((meta && meta.content) || (location.origin + '/api/cdn')).replace(/\/+$/, '');
  }

  function audioSrc(filename) {
    var f = String(filename || '');
    if (/^(https?:)?\/\//.test(f) || f.charAt(0) === '/') return f;  // already a URL
    return cdnRoot() + '/audio/' + encodeURIComponent(f);
  }
  API.audioSrc = audioSrc;

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // ---- one-at-a-time playback ----
  // Every mounted player registers here so starting one stops the rest. This
  // is what makes a tracklist feel like a record rather than a pile of
  // widgets. Also covers players on different surfaces of the same page.
  var mounted = [];
  function pauseOthers(except) {
    for (var i = 0; i < mounted.length; i++) {
      if (mounted[i] !== except) mounted[i].pause();
    }
  }

  // ---- scrolling title ----
  // A title too long for its box slides, but only when there is something to
  // see: paused-by-default, driven by a CSS animation, and switched off
  // entirely under prefers-reduced-motion (the CSS handles that half).
  function marquee(node) {
    if (!node) return;
    // Measure after layout — scrollWidth is only meaningful once painted.
    var check = function () {
      var overflows = node.scrollWidth - node.clientWidth > 1;
      node.classList.toggle('is-long', overflows);
      if (overflows) {
        // Distance to travel, as a CSS var, so the animation runs at a
        // constant speed regardless of how much overflow there is.
        var over = node.scrollWidth - node.clientWidth;
        node.style.setProperty('--ap-scroll', '-' + over + 'px');
        node.style.setProperty('--ap-scroll-dur', Math.max(4, over / 22) + 's');
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(check);
    else check();
  }
  API.marquee = marquee;

  // ---- share (mirrors js/page-wall.js shareWallpaper) ----
  function share(url, title, btn) {
    if (navigator.share) {
      navigator.share({ title: title || '', url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        if (!btn) return;
        var was = btn.getAttribute('aria-label') || '';
        btn.classList.add('copied');
        btn.setAttribute('aria-label', 'Link copied');
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.setAttribute('aria-label', was);
        }, 1500);
      }).catch(function () {});
    }
  }
  API.share = share;

  // ---- the player ----
  // opts: { src|filename, peaks, duration, variant, title, sub }
  function create(opts) {
    var o = opts || {};
    var variant = BAR_COUNTS[o.variant] ? o.variant : 'full';
    var barCount = BAR_COUNTS[variant];
    var duration = Number(o.duration) || 0;

    var root = el('div', 'ap ap-' + variant);
    root.style.setProperty('--ap-progress', '0');

    // -- play/pause: a bare mark, no circle or pill --
    var play = el('button', 'ap-play');
    play.type = 'button';
    play.setAttribute('aria-label', 'Play');
    play.innerHTML =
      '<svg class="ap-glyph ap-glyph-play" viewBox="0 0 14 16" aria-hidden="true" focusable="false">' +
      '<path d="M1 1.2 L13 8 L1 14.8 Z"/></svg>' +
      '<svg class="ap-glyph ap-glyph-pause" viewBox="0 0 14 16" aria-hidden="true" focusable="false">' +
      '<path d="M2 1.5h3.4v13H2z M8.6 1.5H12v13H8.6z"/></svg>';

    // -- waveform: the whole thing is the seek surface --
    var wave = el('div', 'ap-wave');
    wave.setAttribute('role', 'slider');
    wave.setAttribute('tabindex', '0');
    wave.setAttribute('aria-label', 'Seek');
    wave.setAttribute('aria-valuemin', '0');
    wave.setAttribute('aria-valuemax', String(Math.round(duration)));
    wave.setAttribute('aria-valuenow', '0');
    wave.setAttribute('aria-valuetext', formatTime(0));

    var heights = resamplePeaks(o.peaks, barCount);
    if (!heights.length) {
      // No peaks (a legacy or hand-written entry) — a flat, quiet rail still
      // seeks and still reads as a player, so the surface degrades instead of
      // collapsing.
      heights = [];
      for (var k = 0; k < barCount; k++) heights.push(0.34);
      root.classList.add('ap-flat');
    }

    function barRow(cls) {
      var row = el('div', 'ap-bars ' + cls);
      var frag = document.createDocumentFragment();
      for (var i = 0; i < heights.length; i++) {
        var b = el('span', 'ap-bar');
        var h = Math.max(BAR_FLOOR, heights[i]);
        b.style.height = (Math.round(h * 1000) / 10) + '%';
        frag.appendChild(b);
      }
      row.appendChild(frag);
      row.setAttribute('aria-hidden', 'true');
      return row;
    }
    wave.appendChild(barRow('ap-bars-base'));
    wave.appendChild(barRow('ap-bars-fill'));

    var time = el('span', 'ap-time');
    time.textContent = duration ? formatTime(duration) : '--:--';

    root.appendChild(play);
    root.appendChild(wave);
    root.appendChild(time);

    // -- the audio element: created now, fetched never (preload="none") --
    var audio = el('audio');
    audio.preload = 'none';
    audio.src = audioSrc(o.src || o.filename);
    if (o.title) audio.setAttribute('title', o.title);
    root.appendChild(audio);

    var api = {
      root: root,
      audio: audio,
      pause: function () { try { audio.pause(); } catch (e) {} },
      play: function () { try { audio.play(); } catch (e) {} },
    };

    function knownDuration() {
      return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    }

    function paint() {
      var total = knownDuration();
      var pct = total > 0 ? clamp01(audio.currentTime / total) : 0;
      root.style.setProperty('--ap-progress', String(pct));
      wave.setAttribute('aria-valuenow', String(Math.round(audio.currentTime || 0)));
      wave.setAttribute('aria-valuetext', formatTime(audio.currentTime || 0));
      // Count DOWN while playing (how much is left is the useful number), and
      // show the full length at rest.
      time.textContent = (!audio.paused && total > 0)
        ? '-' + formatTime(Math.max(0, total - audio.currentTime))
        : (total > 0 ? formatTime(total) : '--:--');
    }

    function setPlayingUi(playing) {
      root.classList.toggle('is-playing', playing);
      play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      // Surfaces that wrap the player (the card wants its title to scroll
      // while the track runs) get told rather than reaching into it.
      if (typeof o.onstate === 'function') o.onstate(playing);
    }

    play.addEventListener('click', function (e) {
      // The card wraps this player in a link; a press here is a transport
      // control, never navigation.
      e.preventDefault();
      e.stopPropagation();
      if (audio.paused) audio.play().catch(function () {});
      else audio.pause();
    });

    audio.addEventListener('play', function () {
      pauseOthers(api);
      setPlayingUi(true);
      paint();
    });
    audio.addEventListener('pause', function () { setPlayingUi(false); paint(); });
    audio.addEventListener('ended', function () {
      setPlayingUi(false);
      audio.currentTime = 0;
      paint();
    });
    audio.addEventListener('timeupdate', paint);
    audio.addEventListener('loadedmetadata', function () {
      if (isFinite(audio.duration) && audio.duration > 0) {
        wave.setAttribute('aria-valuemax', String(Math.round(audio.duration)));
      }
      paint();
    });

    // -- seeking: press anywhere on the wave, drag to scrub --
    function seekToEvent(ev) {
      var total = knownDuration();
      if (total <= 0) return;
      var rect = wave.getBoundingClientRect();
      var x = (ev.clientX != null ? ev.clientX : 0) - rect.left;
      audio.currentTime = seekFraction(x, rect.width) * total;
      paint();
    }

    var scrubbing = false;
    wave.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      scrubbing = true;
      try { wave.setPointerCapture(ev.pointerId); } catch (e) {}
      seekToEvent(ev);
    });
    wave.addEventListener('pointermove', function (ev) {
      if (scrubbing) seekToEvent(ev);
    });
    function endScrub(ev) {
      if (!scrubbing) return;
      scrubbing = false;
      try { wave.releasePointerCapture(ev.pointerId); } catch (e) {}
    }
    wave.addEventListener('pointerup', endScrub);
    wave.addEventListener('pointercancel', endScrub);

    // Keyboard: the wave is a slider, so arrows scrub and space toggles.
    wave.addEventListener('keydown', function (ev) {
      var total = knownDuration();
      var handled = true;
      if (ev.key === 'ArrowRight') audio.currentTime = Math.min(total, audio.currentTime + SEEK_STEP);
      else if (ev.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - SEEK_STEP);
      else if (ev.key === 'Home') audio.currentTime = 0;
      else if (ev.key === 'End') audio.currentTime = Math.max(0, total - 0.25);
      else if (ev.key === ' ' || ev.key === 'Enter') {
        if (audio.paused) audio.play().catch(function () {}); else audio.pause();
      } else handled = false;
      if (handled) { ev.preventDefault(); ev.stopPropagation(); paint(); }
    });

    // A click anywhere on the player chrome shouldn't follow the card's link.
    root.addEventListener('click', function (ev) {
      if (ev.target === root) return;
      ev.stopPropagation();
    });

    mounted.push(api);
    paint();
    return api;
  }
  API.create = create;

  // Mount every [data-ap-src] placeholder under `root`. This is how the
  // markdown renderer and the permalink page get players without either of
  // them knowing how one is built.
  function scan(root) {
    var host = root || document;
    var nodes = host.querySelectorAll('[data-ap-src]:not([data-ap-ready])');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      node.setAttribute('data-ap-ready', '1');
      var player = create({
        src: node.getAttribute('data-ap-src'),
        peaks: peaksFromString(node.getAttribute('data-ap-peaks')),
        duration: parseFloat(node.getAttribute('data-ap-duration')) || 0,
        variant: node.getAttribute('data-ap-variant') || 'full',
        title: node.getAttribute('data-ap-title') || '',
      });
      node.appendChild(player.root);
    }
  }
  API.scan = scan;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scan(); });
  } else {
    scan();
  }
})();
