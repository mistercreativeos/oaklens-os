// ============================================================================
// HELP — "what does this do?", answered at the control being asked about.
//
// The console's only explanation channel before this was the `title=` tooltip.
// A tablet cannot show one, and the console's own iPad pass already ruled out
// hover-gated affordances (manual §5.17). So the teaching copy that existed was
// invisible to exactly the person most likely to need it, and the ledger has the
// receipts: a cold-run tester "clicked around and didn't know things", and a bug
// filed as a caching failure turned out to be a missing sentence
// (docs/maintenance/2026-08-10-quickstart-v1-and-maintenance-mode.md).
//
// THREE STATES, and the middle one is the point:
//
//   off    — nothing rendered. Only the `?` key is listening.
//   browse — every control on this view that has an entry is MARKED IN PLACE
//            (K93, 2026-10-07): it carries `.help-target`, and the stylesheet
//            gives it a soft bloom of the room's light, brighter under the
//            hand. Nothing is drawn over the page and nothing is positioned
//            by script, so the marks scroll with their controls at no cost. A
//            HUD line says to pick one.
//   card   — you tapped one. The screen dims around that one control (one
//            hole, measured once) and ONE card unfurls to explain it. Tap
//            anywhere → back to browse. Esc → browse.
//
// WHY THE MARKS LIVE ON THE CONTROLS (K93). From 2026-09-19 to K92 browse drew
// its marks in an overlay: a positioned frame and a filament rod per control,
// and an SVG mask with a hole per control cut out of the dim. Each scroll
// event re-measured every control and re-cut the mask; under a finger (which
// scrolls on another thread) the marks could only trail, so they hid during
// the scroll and re-seated after. Measured on 2026-10-07 (docs/capture, the
// Buffer scrolled for 2.4 s): WebKit at phone size drew 145 frames with help
// off and 71 with it open, 144 → 61 on an iPad; Brave's iPad 145 → 120. The
// owner: "this overlay when scrolling, especially on mobile, isn't able to
// keep up". A mark that is the control's own style has no position to keep.
// The one thing an outline on a target can lose to — an ancestor's
// `overflow: hidden` — clips a glow at worst; it never misplaces it.
//
// Why one card and not all of them: the design sketch this came from drew every
// card at once with curved leader lines and a collision resolver, and in the
// owner's own screenshot three of the six cards were clipped or overlapping. A
// solver that is 90% right is a permanent tax that breaks again every time a
// field is added to a form. One card needs no solver, fits a phone, and does not
// decay as the console grows.
//
// Why the copy lives here and not in the markup: it is ENGINE copy. Every fork
// ships it verbatim, so it carries no instance name, no domain, and never names
// one discipline as the category (docs/os-positioning.md §"Vocabulary rules").
// tests/console-help.test.js holds that line mechanically — including a
// banned-jargon list, because the whole feature is worthless the moment it
// starts sounding like the thing it is explaining.
//
// This module imports NOTHING. It reads the active view off the DOM and finds
// its targets by selector, which is what lets it sit second in the layer order
// and explain surfaces that are drawn entirely by modules far above it.
// ============================================================================

// ---- THE COPY ---------------------------------------------------------------
// `view: '*'` is the top bar — offered on every view. Everything else names a
// real `#view-<name>` section.
//
// Shape is the rep rhythm the preflight gym proved on this audience
// (docs/maintenance/2026-08-10-…:139): what it does → what that means for you →
// and, in `note`, the NON-result named so it reads as a state rather than a
// failure ("leave it and the middle of the frame is used").
//
// `sel` is a CSS selector, not an id, because the newest surfaces (Cards, Pulse)
// are rendered entirely from JS and hang their structure on classes. Entries
// whose target is not on screen right now are skipped silently — that is also
// what keeps a config-gated view (Bench) and a not-yet-rendered panel honest.
export const HELP = [
  // ---- the top bar — present on every view ----
  // Both homes of the one control: the topbar button on a desk, the tab-bar
  // cell on a phone or tablet, where the topbar's is `display: none`. Naming
  // only the first left the touch band — the audience this feature exists for —
  // with no answer for Publish at all (2026-09-24).
  {
    sel: '#publish-btn, .tabbar .tab-btn[data-view="publish"]', view: '*',
    title: 'Publish',
    body: 'Opens the page where you send your work live. Nothing you do anywhere else in here reaches your site until you go there and press publish.',
    note: 'It lights up when something is waiting.',
  },
  {
    sel: '#topbar-stage-stat', view: '*',
    title: "What's waiting",
    body: 'Counts the changes you have made that are not live yet. It goes back to nothing the moment you publish.',
    note: 'Every change counts as one, including removing something.',
  },
  {
    sel: '#sys-lamp', view: '*',
    title: 'The activity lamp',
    body: 'Your status light. It stirs while the console is busy in the background and settles when it is done.',
    note: 'Press it for a list of what just happened.',
  },
  {
    sel: '#bridge-topbar-btn', view: '*',
    title: 'The Bridge',
    body: 'Your front page: what is waiting on you, what your site says right now, and where you were.',
    note: 'It is where the console opens, unless you choose otherwise in Settings.',
  },
  {
    sel: '#pulse-topbar-btn', view: '*',
    title: 'Post a pulse',
    body: 'A one-line note that appears on your site within seconds. It is the one thing in here that does not wait for publish.',
    note: 'Press it again to go back to the Bridge.',
  },
  {
    sel: '#settings-topbar-btn', view: '*',
    title: 'Settings',
    body: "Where your sign-in, your site's basics and the console's own options live.",
    note: 'The small dot appears when something in there needs you.',
  },

  // ---- buffer ----
  {
    sel: '#buffer-dropzone', view: 'buffer',
    title: 'Drop work here first',
    body: 'Anything you drop lands here and waits. Nothing needs a title, a date or a description — the date is read out of the file itself.',
    note: 'This is the fast lane. Tidy it up later, or never.',
  },
  {
    sel: '#buffer-raw-lens-btn', view: 'buffer',
    title: 'Straight off the card',
    body: 'Opens a reader for camera card files and pulls the full-size picture out of each one, right here on your own machine.',
    note: 'Nothing is sent anywhere while you browse.',
  },
  {
    sel: '#burst-link-btn', view: 'buffer',
    title: 'Group a sequence',
    body: 'Turns on linking. Pick two or more frames from the same moment and they become one swipeable set on your site instead of separate posts.',
    note: 'Each frame keeps its own number, so older links still work.',
  },
  {
    sel: '#buffer-display', view: 'buffer',
    title: 'The marks under each frame',
    body: 'Every frame carries a small row of controls — feature it, move it into your curated collection, or retire it.',
    note: 'Feature is a switch — press it again to undo. Anything removed waits in the trash until you publish.',
  },

  // ---- archive ----
  // The pair the 2026-08-10 log named as Trap 2: two near-identical buttons,
  // side by side, doing different jobs, explained only in a tooltip.
  {
    sel: '#archive-focal-btn', view: 'archive',
    title: 'The part to keep',
    body: 'Your work gets cropped into squares and other shapes around the site. Drop a pin on what matters and every crop keeps it in view.',
    note: 'Leave it and the middle of the frame is used.',
  },
  {
    sel: '#archive-card-crop-btn', view: 'archive',
    title: 'The tall homepage card',
    body: 'Your homepage shows one piece taller than it really is. This sets what that taller version includes.',
    note: 'Leave it and it follows the pin you set above.',
  },
  {
    sel: '.gear-memory', view: 'archive',
    title: 'Remembered kit',
    body: 'The camera, lens and medium you type are kept on this device and offered back next time you fill the form.',
    note: 'Any words work — it is not a fixed list.',
  },
  {
    sel: '#archive-stage-btn', view: 'archive',
    title: 'Add to the archive',
    body: 'Files this piece, with its title and details, into your curated collection. It still waits for publish like everything else.',
    note: 'Smaller versions for the web are prepared as you do it.',
  },

  // ---- field notes ----
  {
    sel: '.fn-bar-telemetry, #fn-sync', view: 'fn',
    title: 'It saves itself',
    body: 'Your writing is saved as you type. This row tells you when it last happened, and how much you have written.',
    note: 'You never have to press save.',
  },
  {
    sel: '.fn-dock, .fn-btn--insert', view: 'fn',
    title: 'Drop things into the writing',
    body: 'The insert tools. Put a frame, a picture, a video, a track or a day right where the cursor is, without leaving the page.',
    note: 'Each one becomes a permanent reference that keeps working.',
  },
  {
    sel: '#fn-preview-btn', view: 'fn',
    title: 'See it as a reader will',
    body: 'Shows the finished note beside what you are typing, without closing anything.',
  },
  {
    sel: '.fn-btn--stage', view: 'fn',
    title: 'Ready to go out',
    body: 'Marks this note as finished and lines it up for the next publish.',
    note: 'Saving is not the same thing — a saved note stays private.',
  },

  // ---- wall ----
  {
    sel: '#wall-dropzone', view: 'wall',
    title: 'The wallpaper gallery',
    body: 'A separate page of images made to be downloaded and set as desktop backgrounds. Nothing here touches your main gallery.',
  },
  {
    sel: '#wall-url', view: 'wall',
    title: 'Adding one by name',
    body: 'If a picture is already stored with your site, type its filename here instead of dropping the file again.',
  },

  // ---- network ----
  {
    sel: '#ring-card', view: 'friends',
    title: 'A ring of independent sites',
    body: 'An optional list of sites run by other people making things. Joining adds a small link in your footer and changes nothing else.',
    note: 'Off unless you ask to join.',
  },
  {
    sel: '#friends-name', view: 'friends',
    title: 'Sites you point people to',
    body: 'Anyone you add shows up on your about page. A name is enough; the rest is optional.',
  },

  // ---- library ----
  {
    sel: '#library-dropzone', view: 'library',
    title: 'A shelf, not a page',
    body: 'Pictures and video parked here are ready to use but are not on your site yet. Pick them later from anywhere that asks for an image.',
  },
  {
    sel: '#library-display', view: 'library',
    title: 'What is on the shelf',
    body: 'Everything you have parked. None of it is visible to anyone until you place it somewhere.',
  },

  // ---- audio ----
  {
    sel: '#audio-dropzone', view: 'audio',
    title: 'One home for sound',
    body: 'Tracks, episodes and voice memos all live here, however they arrived. Each gets its own page and can be dropped into your writing.',
    note: 'The shape of the sound is measured once, so listeners never wait for it.',
  },
  {
    sel: '#audio-feed-card', view: 'audio',
    title: 'Ready for podcast apps',
    body: 'Your tracks can be followed in any podcast app. This card lists whatever is still missing before you can submit them.',
    note: 'Ignore it entirely and your tracks still play on your site.',
  },
  // A shelf with no tracks on it shows neither of these; they appear with the
  // first upload, which is exactly when someone wants them (owner, 2026-09-19).
  {
    sel: '.aud-row .aud-main', view: 'audio',
    title: 'What a track carries',
    body: 'Its name, the shape of the sound, how long it runs, and the address it lives at. The shape is measured once when you drop it in.',
    note: 'The address is permanent once published, so a link you shared keeps playing the same thing.',
  },
  {
    sel: '.aud-row .aud-actions', view: 'audio',
    title: 'What you can do with it',
    body: 'Put it on your homepage, add it to the feed people follow, offer it as a download, drop it into whatever you are writing, share it, or change its details.',
    note: 'The first two are different: your homepage holds a few, the feed holds everything you mark for it.',
  },
  {
    sel: '#audio-new-set-btn', view: 'audio',
    title: 'A set is a playlist',
    body: 'A named, ordered run of tracks with its own address you can share.',
    note: 'Once published, that address is yours for good — it is never handed to anything else.',
  },

  // ---- cards ----
  {
    sel: '.cards-head', view: 'cards',
    title: 'Now, and next',
    body: 'Your homepage twice over: what it holds right now, and what your next publish will make it. Only the next one can be changed.',
  },
  {
    sel: '.cards-ribbon', view: 'cards',
    title: 'The slots',
    body: 'Your homepage holds a set number of pieces. This strip shows which slot each one has taken.',
  },
  {
    sel: '.cards-grid, .cards-studio', view: 'cards',
    title: 'The tiles',
    body: 'A sketch of your homepage, arranged by the same rules your real site uses — so what you see here is what lands.',
  },

  // ---- bridge ----
  {
    sel: '#br-headline', view: 'bridge',
    title: 'The one thing that matters now',
    body: 'The biggest words say what is going on right now: changes waiting to go out, your site going live, or nothing waiting at all. Drag files over this page and it tells you where each one will go.',
  },
  {
    sel: '#br-waiting', view: 'bridge',
    title: 'Waiting on you',
    body: 'A short list of things you can finish, most important first. Each line takes you straight to it, not just to its screen.',
  },
  {
    sel: '#br-front', view: 'bridge',
    title: 'What visitors see',
    body: 'The cards on your homepage right now. A small mark means your next publish will change that one.',
  },
  {
    sel: '#br-spark', view: 'bridge',
    title: 'A spark',
    body: 'Catch a thought before it goes. It keeps itself as you type, privately, and waits under SPARKS in Field Notes.',
    note: 'Expand (or shift and return) turns it into a full note, with your cursor where you left off.',
  },
  {
    sel: '#br-shelf', view: 'bridge',
    title: 'Frames to cite',
    body: 'Your newest frames with their numbers. Tap one to put its f# in the spark; hold one to copy it.',
    note: 'A frame not yet published shows its number dimmed: it can still change until it is live.',
  },
  {
    sel: '#br-since', view: 'bridge',
    title: 'Days since, and send it out',
    body: 'How long since something went live. Send … out opens your newest piece for the platforms: how its link looks when pasted, the post counted for Bluesky and X, and a story card with a QR home.',
    note: 'Your site first, then the platforms. Nothing here posts for you.',
  },
  {
    sel: '#br-since', view: 'bridge',
    title: 'Days since you last published',
    body: 'How many days since something new went live on your site: a note, a photo, a track or a pulse. Zero means today.',
  },
  {
    sel: '#br-storage', view: 'bridge',
    title: 'How full your storage is',
    body: 'The line fills toward the free allowance. Underneath, the room left is counted in photos and hours of audio, from what yours actually take up.',
    note: 'Measured once a day. Tap the time under it to measure again.',
  },
  {
    sel: '#br-status', view: 'bridge',
    title: 'Live, and this device',
    body: 'When your site last went live, and how full this browser is with work you have not published yet.',
  },

  // ---- pulse ----
  {
    sel: '#pulse-line', view: 'pulse',
    title: 'One line, live now',
    body: 'Say what you are doing in a sentence. It goes up within seconds and clears itself later.',
  },
  {
    sel: '#pulse-palette', view: 'pulse',
    title: 'The mark beside it',
    body: 'A small glyph that sets the tone of the line. Pick one or leave it.',
  },
  {
    sel: '#pulse-post-btn', view: 'pulse',
    title: 'Straight out',
    body: 'Sends the line to your site immediately. This is the only thing in the console that does not wait for publish.',
  },

  // ---- bench ----
  {
    sel: '.bench-grid-container, #bench-grid', view: 'bench',
    title: 'The workbench',
    body: 'A queue for pieces you want to come back to and finish properly. Each one carries its own notes and its own stage.',
  },
  {
    sel: '.filter-bar', view: 'bench',
    title: 'Narrow the list',
    body: 'Shows only the pieces at one stage of work.',
  },

  // ---- publish ----
  {
    sel: '.publish-summary', view: 'publish',
    title: 'What is waiting',
    body: 'One tile per part of your site, with how much has changed. Press one to read the list.',
  },
  {
    sel: '#gh-publish-btn', view: 'publish',
    title: 'Send it all live',
    body: 'Takes everything waiting and sends it out in one go. It is all or nothing — there is no half-published state to get stuck in.',
    note: 'Give it a couple of minutes to appear.',
  },
  {
    sel: '#site-export-btn', view: 'publish',
    title: 'A copy you can hold',
    body: 'Downloads your whole published site as one file: pages, work and words. Open it from a memory stick with no internet at all.',
    note: 'It doubles as a backup.',
  },
];

// ---- STATE ------------------------------------------------------------------
// A synchronous variable, not a class on the DOM. Every close in this console
// defers `.hidden` by 230–380ms so the animation can finish, which makes the DOM
// an unreliable guard for a key handler firing in between (js/console/share.js
// learned this the hard way — see its Escape note).
let _mode = 'off';            // 'off' | 'browse' | 'card'
let _lit = [];                 // [{ item, el }] while browsing
let _target = null;            // the element the open card explains
let _wired = false;
let _viewSize = null;          // ResizeObserver on the active view (see _watchView)
let _viewNodes = null;         // MutationObserver on the same view
let _relayout = 0;             // the one frame both of those coalesce into

const GUTTER = 16;             // keep the card this far off every edge
const PAD = 4;                 // breathing room around the lit control

/**
 * Is the card presenting as a sheet rather than beside its control?
 *
 * WIDTH only. This also tested `(pointer: coarse)` until 2026-09-19, which made
 * every touchscreen a sheet — an iPad Pro in landscape and a touch laptop
 * included, where a two-sentence card then stretched across 1366 or 1920px.
 * Width is also the honest question: the sheet exists because no side of a
 * phone-width control has room for a 300px card beside it, and at 1024px every
 * side does. It is testable, too — a desktop browser cannot be made to report a
 * coarse pointer, so the old rule had a branch that only shipped devices ran. */
function _isSheet() {
  return window.matchMedia('(max-width: 700px)').matches;
}

// THE SCALE (K74): a large screen at 1× zooms the whole console (`zoom` on
// <html>). A rect and the window come back zoomed; the overlay is laid out in
// the page's own px, so both are read through these. At 1× they are the plain
// values.
function _zoom() { return parseFloat(document.documentElement.style.zoom) || 1; }
function _rect(el) {
  const r = el.getBoundingClientRect(), z = _zoom();
  if (z === 1) return r;
  return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z, x: r.x / z, y: r.y / z };
}
function _vw() { return window.innerWidth / _zoom(); }
function _vh() { return window.innerHeight / _zoom(); }

/**
 * How much of the bottom of the screen the tab bar owns right now, measured
 * rather than derived from a breakpoint. The bar comes and goes for four
 * different reasons — width, pointer type, the FN bar-hide toggle, and the
 * on-screen keyboard — and a card placed under it is a card you cannot read.
 */
function _bottomInset() {
  const bar = document.querySelector('.tabbar');
  if (!bar) return 0;
  const cs = getComputedStyle(bar);
  if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
  const r = _rect(bar);
  if (!r.height) return 0;
  return Math.max(0, Math.round(_vh() - r.top));
}

/** The topbar's mirror. Measured, not read off `--topbar-h`, for the same
 *  reason: the bar is one element and its height is whatever it renders as. */
function _topInset() {
  const bar = document.querySelector('.topbar');
  if (!bar) return 0;
  const cs = getComputedStyle(bar);
  if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
  const r = _rect(bar);
  if (!r.height) return 0;
  return Math.max(0, Math.round(r.bottom));
}

/**
 * The field a control's spotlight is allowed to occupy. The console has two
 * fixed bars, the topbar and (on the tab-bar band) the bottom bar, and the
 * content scrolls under both; a hole cut for a content control stops at the
 * bars exactly as its control does (owner, 2026-09-19: "they would fold
 * underneath the header like everything else"). A control that IS a bar gets
 * the whole window.
 */
function _onBar(el) {
  return !!el?.closest?.('.topbar, .tabbar');
}

export function _fieldFor(el) {
  const vw = _vw();
  const vh = _vh();
  if (_onBar(el)) {
    return { top: 0, bottom: vh, left: 0, right: vw };
  }
  return { top: _topInset(), bottom: vh - _bottomInset(), left: 0, right: vw };
}

function _activeView() {
  return document.querySelector('.view.active')?.id.replace(/^view-/, '') ?? null;
}

/** Entries whose target is on this view AND actually on screen right now. */
function _entriesForView() {
  const view = _activeView();
  const out = [];
  for (const item of HELP) {
    if (item.view !== '*' && item.view !== view) continue;
    // A selector may name alternatives, because a surface can render one of two
    // shapes for the same job — the Cards view is a grid OR a studio, Field
    // Notes puts its insert tools in a dock OR in the bar. The first one that is
    // actually on screen wins; the rest are simply the other layout.
    let el = null;
    for (const part of item.sel.split(',')) {
      const one = part.trim();
      if (!one) continue;
      el = item.view === '*'
        ? document.querySelector(one)
        : document.querySelector(`#view-${item.view} ${one}`);
      // A real box, not merely a rect: an empty container (the save readout
      // before the first save, the bench grid with nothing queued) reports
      // width but zero height, and spotlighting a hairline says nothing.
      if (el && _rect(el).height >= 4) break;
      el = null;
    }
    if (!el) continue;
    out.push({ item, el });
  }
  return out;
}

/** The overlay's own furniture, built once and reused: the card's dim with
 *  its one hole, the ring and the pool around the picked control, the card,
 *  and the HUD line. Browse uses only the line. */
function _layer() {
  let el = document.getElementById('help-layer');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'help-layer';
  el.className = 'help-layer';
  el.innerHTML =
    '<div class="help-catch" id="help-catch"></div>'
    + '<svg class="help-scrim" id="help-scrim" aria-hidden="true">'
    + '<defs><mask id="help-scrim-mask" maskUnits="userSpaceOnUse">'
    + '<rect id="help-scrim-field" x="0" y="0" fill="#fff"></rect>'
    + '<rect id="help-scrim-hole" x="0" y="0" width="0" height="0" rx="3" fill="#000"></rect>'
    + '</mask></defs>'
    + '<rect id="help-scrim-fill" x="0" y="0" mask="url(#help-scrim-mask)"></rect>'
    + '</svg>'
    + '<div class="help-hole" id="help-hole"></div>'
    + '<div class="help-glow" id="help-glow"></div>'
    + '<div class="help-card" id="help-card" role="dialog" aria-live="polite" aria-labelledby="help-card-title" tabindex="-1"></div>'
    + '<div class="help-bar" id="help-bar">'
    + '<span class="help-bar-text">Pick anything lit'
    + ' <span class="help-bar-count" id="help-bar-count"></span></span>'
    + '<button class="help-bar-btn" type="button">Done <kbd>Esc</kbd></button>'
    + '</div>';
  document.body.appendChild(el);
  return el;
}

// ---- BROWSE -----------------------------------------------------------------

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/**
 * Browse mode: mark every explained control on this view, in place. The mark
 * is one class (`.help-target`) and the stylesheet's rule for it: a bloom of
 * the room's light around the control, warmer under a pointer or focus. The
 * control's own appearance is otherwise left alone, and everything added here
 * is taken back in _mark(false).
 */
function _mark(on) {
  for (const { el } of _lit) {
    el.classList.remove('help-target', 'help-picked');
    delete el.dataset.helpFor;
    // Only ever remove what we added.
    if (el.dataset.helpTab === '1') { el.removeAttribute('tabindex'); delete el.dataset.helpTab; }
  }
  _lit = [];
  if (!on) return;
  for (const { item, el } of _entriesForView()) {
    el.classList.add('help-target');
    // Which entry marked it. Nothing reads it at runtime — it is here so the
    // marked set can be inspected and audited without re-deriving the table.
    el.dataset.helpFor = item.sel;
    // Half the explained targets are plain containers — the dropzones, the gear
    // block, the publish tiles, the card ribbon. A mouse can point at them and
    // a keyboard cannot reach them at all, which would make the help itself the
    // least accessible thing in the console. They borrow a tab stop while help
    // is on, and hand it straight back.
    if (!el.matches(FOCUSABLE)) { el.setAttribute('tabindex', '0'); el.dataset.helpTab = '1'; }
    _lit.push({ item, el });
  }
  const count = document.getElementById('help-bar-count');
  if (count) count.textContent = `· ${_lit.length} on this screen`;
}

/**
 * Punch the dim for the one control a card explains. A mask with one hole:
 * black hides the dim completely, grey lifts it part way. The buffer's
 * contact sheet is 75% of the screen, and cutting that out did not highlight
 * it, it switched the dim off (owner, 2026-09-19); past roughly a fifth of
 * the screen the lift ramps down, so a big region reads as RAISED while its
 * contents still sit under the veil. An empty rect closes the hole.
 */
function _cutScrim(r) {
  const svg = document.getElementById('help-scrim');
  if (!svg) return;
  const w = _vw();
  const h = _vh();
  for (const id of ['help-scrim-field', 'help-scrim-fill']) {
    const el = document.getElementById(id);
    el.setAttribute('width', w);
    el.setAttribute('height', h);
  }
  const hole = document.getElementById('help-scrim-hole');
  if (!r || r.width < 1 || r.height < 1) { hole.setAttribute('width', '0'); hole.setAttribute('height', '0'); return; }
  // To the hundredth, not the pixel: rounding moved a hole up to half a pixel
  // off its control, a bright sliver down one side.
  hole.setAttribute('x', r.left.toFixed(2));
  hole.setAttribute('y', r.top.toFixed(2));
  hole.setAttribute('width', r.width.toFixed(2));
  hole.setAttribute('height', r.height.toFixed(2));
  const frac = (r.width * r.height) / (w * h);
  const lift = frac <= 0.10 ? 1 : Math.max(0.2, 1 - (frac - 0.10) / 0.25);
  const v = Math.round(255 * (1 - lift));
  hole.setAttribute('fill', `rgb(${v},${v},${v})`);
}

/**
 * A control's box, padded, and clipped to what is actually on screen — where
 * "on screen" is the control's FIELD (see _fieldFor), not the window. The
 * buffer's contact sheet measures 29,148px tall; a spotlight is a picture of
 * what you can SEE, and what you can see of a scrolling control stops at the
 * fixed bar it slides under.
 */
export function _visibleRect(el, pad = PAD, field = _fieldFor(el)) {
  const b = _rect(el);
  const left = Math.max(field.left, b.left - pad);
  const top = Math.max(field.top, b.top - pad);
  return {
    left,
    top,
    width: Math.max(0, Math.min(field.right, b.right + pad) - left),
    height: Math.max(0, Math.min(field.bottom, b.bottom + pad) - top),
  };
}

/**
 * Do the marks still describe the screen? Two ways they stop: a control was
 * re-rendered under its mark (renderPublish() rebuilds the summary tiles after
 * a sync; the Cards view swaps its loading line for the grid a round trip
 * later), or a control that measured nothing when help opened has since grown
 * a box. Costs one selector pass, so it is asked on RELAYOUT only — a resize
 * or the active view's observers.
 */
function _marksStale() {
  if (_lit.some(({ el }) => !el.isConnected)) return true;
  const now = _entriesForView();
  return now.length !== _lit.length || now.some(({ el }, i) => el !== _lit[i].el);
}

function _enterBrowse() {
  const layer = _layer();
  const was = _target;
  _mode = 'browse';
  _hideCard();
  for (const { el } of _lit) el.classList.remove('help-picked');   // the hot one cools
  // Back from a card the marks are still in place; a render that finished on
  // its own is what _marksStale asks about.
  if (!_lit.length || _marksStale()) _mark(true);
  layer.classList.add('open');
  layer.classList.remove('carded');
  // The HUD line sits above the tab bar where there is one; measured once.
  layer.style.setProperty('--help-foot', `${_bottomInset()}px`);
  _cutScrim(null);
  document.body.classList.add('help-on');
  _watchView();
  // The console's own vocabulary for a control that is currently doing
  // something: data-lit gets the fill, the edge and the halo, and
  // js/console/lighting.js finds it by that attribute and pools light around it
  // without being told this surface exists.
  document.getElementById('help-topbar-btn')?.setAttribute('data-lit', 'accent');
  // Coming back from a card, the control you asked about keeps the focus, so a
  // keyboard carries on from where it was rather than at the top of the view.
  if (was?.isConnected) was.focus({ preventScroll: true });
  document.getElementById('help-topbar-btn')?.setAttribute('aria-expanded', 'true');
}

// ---- CARD -------------------------------------------------------------------

function _hideCard() {
  _target = null;
  const layer = document.getElementById('help-layer');
  layer?.classList.remove('carded');
  document.body.classList.remove('help-carded');
}

/**
 * Place the card on the first side that fits: below, above, right, left. Four
 * cases and a clamp — deliberately not a solver. With one card on screen there
 * is nothing to collide with, so "does it fit in the viewport" is the whole
 * question. Under 700px CSS lifts the card into a bottom sheet and this
 * positioning is ignored entirely.
 */
function _placeCard(card, rect) {
  const vw = _vw();
  const vh = _vh() - _bottomInset();
  if (_isSheet()) {
    card.style.left = '';
    card.style.top = '';
    // Which edge the sheet takes is decided by where the control ended up, not
    // by a breakpoint. A bounded view (Field Notes, Pulse) pins its actions to
    // the bottom of the screen and cannot scroll them anywhere — a bottom sheet
    // lands squarely on them — so a control sitting low gets a sheet at the top
    // instead. Everything else has already been lifted into the upper band.
    card.dataset.side = (rect.top + rect.height / 2) > vh / 2 ? 'sheet-top' : 'sheet';
    return;
  }
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const fits = {
    below: rect.bottom + 10 + h <= vh - GUTTER,
    above: rect.top - 10 - h >= GUTTER,
    right: rect.right + 10 + w <= vw - GUTTER,
    left: rect.left - 10 - w >= GUTTER,
  };
  const side = ['below', 'above', 'right', 'left'].find((s) => fits[s]) ?? 'below';
  let x;
  let y;
  if (side === 'below' || side === 'above') {
    x = rect.left + rect.width / 2 - w / 2;
    y = side === 'below' ? rect.bottom + 10 : rect.top - 10 - h;
  } else {
    x = side === 'right' ? rect.right + 10 : rect.left - 10 - w;
    y = rect.top + rect.height / 2 - h / 2;
  }
  card.dataset.side = side;
  const cx = Math.max(GUTTER, Math.min(vw - w - GUTTER, x));
  const cy = Math.max(GUTTER, Math.min(vh - h - GUTTER, y));
  card.style.left = `${cx}px`;
  card.style.top = `${cy}px`;
  // The clamp above can slide the card sideways off the control — a top-bar
  // button near the right edge is the usual one — and a pointer pinned to the
  // card's own centre then aims at empty chrome. Point it at the control.
  const along = (side === 'below' || side === 'above')
    ? { axis: '--arrow-x', v: rect.left + rect.width / 2 - cx, span: w }
    : { axis: '--arrow-y', v: rect.top + rect.height / 2 - cy, span: h };
  card.style.setProperty(along.axis, `${Math.max(12, Math.min(along.span - 12, along.v))}px`);
}

const VIEW_LABEL = {
  buffer: 'Buffer', archive: 'Archive', fn: 'Field Notes', wall: 'Wall',
  friends: 'Network', library: 'Library', audio: 'Audio',
  cards: 'Cards', pulse: 'Pulse', bench: 'Bench', publish: 'Publish',
};

function _paintCard(item) {
  const card = document.getElementById('help-card');
  card.textContent = '';
  // Which surface this belongs to, in the console's own sub-line voice. The
  // top-bar entries say "Everywhere", because they are.
  const eyebrow = document.createElement('div');
  eyebrow.className = 'help-card-eyebrow';
  eyebrow.append(
    document.createTextNode(item.view === '*' ? 'Everywhere' : (VIEW_LABEL[item.view] ?? item.view)),
    document.createElement('i'),
  );
  card.append(eyebrow);
  const h = document.createElement('h3');
  h.className = 'help-card-title';
  h.id = 'help-card-title';   // the dialog's accessible name (aria-labelledby, see _layer)
  h.textContent = item.title;
  const p = document.createElement('p');
  p.className = 'help-card-body';
  p.textContent = item.body;
  card.append(h, p);
  if (item.note) {
    const n = document.createElement('p');
    n.className = 'help-card-note';
    n.textContent = item.note;
    card.append(n);
  }
  return card;
}

/**
 * Lay the card mode out around its control: the hole, the ring, the pool and
 * the card. Called when a card opens (after our own scroll), on a resize, and
 * when the view's observers report a late render. Browse has nothing to lay
 * out: its marks are the controls' own style.
 *
 * @param {boolean} relayout — true when the LAYOUT may have changed (a resize,
 *   the active view's observers). Only then may the mark set be rebuilt.
 */
function _reflow(relayout = false) {
  if (_mode === 'browse') {
    if (relayout && _marksStale()) _mark(true);
    return;
  }
  if (_mode !== 'card' || !_target) return;
  if (!_target.getClientRects().length) { _enterBrowse(); return; }
  // Clamped to the viewport, because the hole is a picture of what you can SEE.
  const rect = _visibleRect(_target);
  // Scrolled fully out of view: an explanation with its subject off-screen is
  // just a floating paragraph, so go back to browse and let them pick again.
  if (rect.width === 0 || rect.height === 0) { _enterBrowse(); return; }
  rect.right = rect.left + rect.width;
  rect.bottom = rect.top + rect.height;
  const layer = document.getElementById('help-layer');
  layer.style.setProperty('--help-foot', `${_bottomInset()}px`);
  _cutScrim(rect);
  const hole = document.getElementById('help-hole');
  hole.style.left = `${rect.left}px`;
  hole.style.top = `${rect.top}px`;
  hole.style.width = `${rect.width}px`;
  hole.style.height = `${rect.height}px`;
  // The pool, sized off the control rather than fixed: a chip throws a small
  // one and a dropzone a wide one, which is the difference between light and a
  // decal pasted on at one size.
  const spread = Math.max(64, Math.min(180, Math.max(rect.width, rect.height) * 0.55));
  const glow = document.getElementById('help-glow');
  glow.style.left = `${rect.left - spread}px`;
  glow.style.top = `${rect.top - spread}px`;
  glow.style.width = `${rect.width + spread * 2}px`;
  glow.style.height = `${rect.height + spread * 2}px`;
  _placeCard(document.getElementById('help-card'), rect);
}

/** One relayout per frame, however many observations land in it. */
function _queueRelayout() {
  if (_relayout || _mode === 'off') return;
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
  _relayout = raf(() => { _relayout = 0; _reflow(true); }) || 1;
}

/** Point the late-layout observers at whichever view is up now. */
function _watchView() {
  _viewSize?.disconnect();
  _viewNodes?.disconnect();
  const view = document.querySelector('.view.active');
  if (!view) return;
  _viewSize?.observe(view);
  _viewNodes?.observe(view, { childList: true, subtree: true });
}

function _unwatchView() {
  _viewSize?.disconnect();
  _viewNodes?.disconnect();
  _relayout = 0;
}

/** The nearest ancestor that actually scrolls — the console has fourteen. */
function _scrollerFor(el) {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return document.querySelector('.main');
}

/**
 * Put the control somewhere the card can be read beside it.
 *
 * Two jobs, and they used to be one. A sheet owns the bottom of the screen, and
 * on a phone most controls ARE near the bottom — 13 of 82 explanations landed on
 * their own subject before this existed, so `reserve` is the card's height and
 * the control is lifted above it. But a control can simply be below the fold on
 * any width: at 760px, six of them were, and picking one did nothing visible
 * because the spotlight had no viewport left to draw in. Same scroll, same fix.
 *
 * A control taller than the free band (the buffer grid, the publish tiles)
 * cannot clear it entirely; its top in view is the honest best, and the hole
 * still says which one is meant.
 */
function _bringIntoView(el, reserve) {
  // A control that IS a bar scrolls with nothing; walking up from it finds no
  // scroller and falls back to .main, which would then scroll the CONTENT to
  // chase a button that never moves.
  if (_onBar(el)) return false;
  // Under the topbar is not "in view": the content slides beneath it, so a
  // control with 6px showing under the bar used to pass this test, get no
  // scroll, and open a card pointing at that sliver (2026-09-24).
  const top = _topInset() + 8;
  const floor = _vh() - _bottomInset() - reserve - 8;
  const r = _rect(el);
  if (r.top >= top && r.bottom <= floor) return false;
  // A control TALLER than the band can never satisfy the test above, so it
  // scrolled every single time — picking a frame inside the buffer's contact
  // sheet hauled the whole grid up to put its top at 8px (owner, 2026-09-19:
  // "the stroke over the buttons shifts"). For those, "enough of it is
  // showing" replaces "all of it fits".
  const band = floor - top;
  if (r.height > band) {
    const shown = Math.min(r.bottom, floor) - Math.max(r.top, top);
    if (shown >= band * 0.25) return false;
  }
  const scroller = _scrollerFor(el);
  if (!scroller) return false;
  // A control that fits rides a third of the way down, which reads as "this
  // one" rather than as a scroll. One taller than the band goes to the top.
  const rest = r.height >= floor - top
    ? top
    : Math.max(top, Math.min(floor - r.height, top + (floor - top) * 0.3));
  const was = scroller.scrollTop;
  scroller.scrollTop += r.top - rest;
  return scroller.scrollTop !== was;
}

/**
 * The invariant, enforced rather than reasoned about: a sheet must never end up
 * on top of the control it explains. If less of the spotlight is showing than
 * the spotlight is tall, take the other edge.
 */
function _forceClear(el) {
  const card = document.getElementById('help-card');
  const hole = _rect(document.getElementById('help-hole'));
  const cr = _rect(card);
  const top = card.dataset.side === 'sheet-top';
  const shown = top
    ? Math.min(hole.bottom, _vh()) - Math.max(hole.top, cr.bottom)
    : Math.min(hole.bottom, cr.top) - Math.max(hole.top, 0);
  if (shown >= Math.min(24, hole.height)) return;
  card.dataset.side = top ? 'sheet' : 'sheet-top';
}

function _showCard(item, el) {
  _layer();
  _mode = 'card';
  _target = el;
  // The marks stay. The stylesheet turns every one down but the picked
  // control's, which is held hot (`.help-picked`) while its card is open.
  for (const entry of _lit) entry.el.classList.toggle('help-picked', entry.el === el);
  _paintCard(item);
  document.getElementById('help-layer').classList.add('carded');
  document.body.classList.add('help-carded');
  // The card is measurable as soon as it is shown, so the scroll happens BEFORE
  // the only reflow rather than after a throwaway one.
  const reserve = _isSheet() ? document.getElementById('help-card').offsetHeight : 0;
  _bringIntoView(el, reserve);
  _reflow();
  if (_isSheet()) _forceClear(el);
  // Focus LAST. The card is display:none until `carded` lands and the layout
  // flushes, and focus() on a hidden element is silently a no-op.
  document.getElementById('help-card').focus({ preventScroll: true });
}

// ---- ENTRY POINTS -----------------------------------------------------------

/** Turn help on, or off if it is already on. Bound to `?` and the top-bar button. */
export function helpToggle() {
  // Only the overlay check — NOT helpKeyBlocked(). Where the caret is decides
  // whether the KEY means "help" or "a question mark"; it says nothing about a
  // deliberate press of the button.
  if (_mode === 'off') {
    if (_overlayOwnsScreen()) return;
    _wire();
    _enterBrowse();
  } else {
    helpClose();
  }
}

/** Leave help entirely, from any state. */
export function helpClose() {
  _mode = 'off';
  _unwatchView();
  for (const { el } of _lit) el.classList.remove('help-picked');
  _mark(false);
  _hideCard();
  const layer = document.getElementById('help-layer');
  layer?.classList.remove('open', 'carded');
  document.body.classList.remove('help-on', 'help-carded');
  _cutScrim(null);
  const btn = document.getElementById('help-topbar-btn');
  btn?.removeAttribute('data-lit');
  btn?.setAttribute('aria-expanded', 'false');
}

/** True while help is showing anything — read by the key handler in init.js. */
export function helpIsOpen() { return _mode !== 'off'; }

/** An overlay already owns the screen, and Escape belongs to it. */
function _overlayOwnsScreen() {
  return !!document.querySelector(
    '.modal-overlay:not(.hidden), .sheet-overlay:not(.hidden), .rl-overlay:not(.hidden)',
  );
}

/**
 * Should the `?` KEY be ignored right now? Two reasons: you are typing — `?` is
 * a character and belongs in the field — or an overlay owns the screen.
 *
 * ⚠️ Only the key. This used to gate `helpToggle()` as well, on the reasoning
 * that two doors into one state should agree; they should not. Leaving help on
 * a view with a text field puts focus back in that field, and the next press of
 * the BUTTON then did nothing at all. Clicking the button is unambiguous.
 */
export function helpKeyBlocked() {
  const el = document.activeElement;
  if (el && el.matches?.('input, textarea, select, [contenteditable], [contenteditable="true"]')) return true;
  return _overlayOwnsScreen();
}

// ---- LISTENERS --------------------------------------------------------------
// Wired once, on first use, so a console that never opens help pays nothing.
// No scroll listener (K93): browse has nothing to move, and in card mode the
// catch layer owns every touch, so the only scroll is our own _bringIntoView,
// which lays the card out itself.
function _wire() {
  if (_wired) return;
  _wired = true;

  // Capture phase, and it stops here. EVERY click in help mode is ours — which
  // is what stops a tap firing the control it is asking about, and is the whole
  // reason you can safely ask what Publish does.
  //
  // ⚠️ A click on the dim is ABSORBED, not an exit. It used to close help, and
  // that made a mode you were reading in disappear under an ordinary stray
  // click (owner, 2026-09-19: "too easy to click out of the help if I'm
  // clicking around"). There are three deliberate ways out — the `?` that let
  // you in, the Done button, and Escape — and no accidental ones.
  document.addEventListener('click', (e) => {
    if (_mode === 'off') return;
    e.preventDefault();
    e.stopPropagation();
    // The way out is the way in. The inline onclick on the button cannot fire
    // while help is open, because this handler stops the event first.
    if (e.target.closest?.('#help-topbar-btn') || e.target.closest?.('#help-bar')) {
      helpClose();
      return;
    }
    if (_mode === 'card') {
      if (!e.target.closest?.('#help-card')) _enterBrowse();
      return;
    }
    const hit = _lit.find(({ el }) => el === e.target || el.contains(e.target));
    if (hit) _showCard(hit.item, hit.el);
    // Anything else: absorbed.
  }, true);

  // A file let go over the console is a real action too — every dropzone
  // ingests on `drop` — so it is absorbed on the same terms as a click. The
  // default is prevented as well, because a drop nothing accepts is a drop
  // the BROWSER accepts: it navigates the tab to the file, and the console
  // with it. The cursor says "not allowed" over the dim, and nothing lands.
  // (Long-press is the third real action, and it is gated in init.js, where
  // the menus are registered.)
  for (const ev of ['dragenter', 'dragover', 'drop']) {
    document.addEventListener(ev, (e) => {
      if (_mode === 'off') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    }, true);
  }

  // Our own Escape, guarded on the synchronous state — NOT a line in init.js's
  // chain, which is bubble-phase and runs after the editor's.
  document.addEventListener('keydown', (e) => {
    if (_mode === 'off') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (_mode === 'card') _enterBrowse(); else helpClose();
      return;
    }
    // Tab to a marked control, then open it the way any control opens.
    if (_mode !== 'browse' || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (document.activeElement?.closest?.('#help-bar')) return;   // Done is real
    e.preventDefault();
    e.stopPropagation();
    // Absorbed for anything else focused, for the same reason a click is: the
    // keyboard must not reach a control the pointer cannot.
    const hit = _lit.find(({ el }) => el === document.activeElement);
    if (hit) _showCard(hit.item, hit.el);
  }, true);

  window.addEventListener('resize', () => _reflow(true));
  // Late layout. A view can finish rendering AFTER help opens — Bench and
  // Publish both do, and the Cards view takes a network round trip — which
  // leaves the mark set describing the layout as it was a moment ago. Two
  // observers on the ACTIVE VIEW catch it (pointed there by _watchView on
  // every entry into browse): its size, for a render that grows it, and its
  // children, for one that swaps nodes at the same height (renderPublish()
  // after a sync). Both land on the same frame.
  if (typeof ResizeObserver === 'function') _viewSize = new ResizeObserver(_queueRelayout);
  if (typeof MutationObserver === 'function') _viewNodes = new MutationObserver(_queueRelayout);
}

/** Wired from init.js — the `?` key. */
export function _initHelp() {
  document.addEventListener('keydown', (e) => {
    // `?` is Shift-something on most layouts, so shiftKey is expected and not
    // checked. The others are not ours: ⌘⇧/ opens the application Help menu on
    // macOS, and swallowing it would be taking a system shortcut.
    if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (_mode === 'off' && helpKeyBlocked()) return;
    e.preventDefault();
    helpToggle();
  });
}
