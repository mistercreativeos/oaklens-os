// OAKLENS Field Console — the bloom, and the heat behind it.
//
// Phase 2 of the lighting pass built the pool (K38): CSS can put a halo INSIDE
// a control's own box, but it cannot pool light onto the chassis around it. A
// `box-shadow` glow is clipped by every ancestor with `overflow: hidden`, it
// cannot cross a stacking context, and it stops dead at the edge of the topbar.
// Real light does none of those things — so the wide, soft part of it is
// painted on one body-level canvas that sits over the whole console.
//
// The emissive pass (K40, 2026-09-25) made the pool THERMAL. Until then the
// box glow heated over `--arm-heat` while the pool snapped on in one frame —
// the owner's "is the light animated?" had two answers. Now every emitter has a
// LEVEL (0..1) that eases toward its target on the console's own curves, the
// pool is drawn at that level, and a frame is requested only while a level is
// still moving. When nothing is in flight the engine parks: the static console
// costs zero frames, which is the same promise K38 made and K39e had to repair.
// See dev/console-lighting-system.md — the system this module is the engine of.
//
// ⚠️ THIS MODULE MAY NOT DECIDE WHAT GLOWS. That is a licence, not a style, and
// it is written down: `docs/starter-template/design-spec.md` §6.5. A surface
// opts in with `data-lit="accent|ok|warn"` (on) or `data-heat="hot"` (in
// flight) and this module finds it; nothing here names a surface, a view or an
// id, and adding one would make the bloom the fifth place the licence lives.
// The attribute goes on the thing that EMITS — a rod, a button — never on the
// panel it sits in, because the pool follows the box it is given and a panel
// would wash the page (K38c's finding, now a rule).
//
// Four things follow from the brief (`docs/next-session-brief.md` §0) and each
// one is load-bearing:
//
//   1. NO `mix-blend-mode: screen`. The bench uses it, and on a page this size
//      it forces the compositor to blend the whole document every paint — an
//      iPad cliff. `lighter` inside the emissive buffer gets the additive
//      accumulation where it is actually needed; the composite to screen is
//      ordinary source-over, which over a true-black ground is the same read.
//   2. COLOUR IS READ AT PAINT TIME, never tabled. `--lit-rgb` resolves through
//      the theme, the preset and the tone variant, so a table here would be six
//      copies of a value that already exists and would be wrong in DAYLIGHT, in
//      every preset but one, and in every fork. Same rule
//      `tests/theme-tokens.test.js` puts on card-paint.js, for the same reason.
//      The thermal curves are read the same way (`--arm-heat` / `--arm-cool`
//      off the emitter), so the pool and the box heat on ONE pair of curves and
//      a missing token means no journey rather than a journey of this module's
//      own invention.
//   3. BOUNDED, NOT A LOOP. `docs/ideas/motion-language.md` allows one heartbeat
//      per page and the SYS lamp already spends it. So this repaints on resize,
//      scroll, theme change and licence change — and while a level is in flight
//      it re-arms itself, for the length of the curve and no longer. Parked is
//      the resting state and a test drives the clock past the curve to prove
//      it. (K39e: a `ResizeObserver` re-pointed every paint was a 60fps loop
//      hiding behind "event-driven"; the observer now sees only the diff.)
//   4. THE LIGHT IS UNDER THE GLASS (K40b). The canvas sits at z-index -1:
//      above the root ground, below every in-flow box. Frosted chrome and bays
//      (`--frost-*` in the stylesheet) transmit it, diffused; opaque cards cast
//      their shape onto it. Until K40b it sat ABOVE the console (310) and each
//      emitter was punched back out of the frame so the canvas would not lay a
//      blurred copy over the crisp control — the light was painted ON the
//      surface, which is what a decal is. Under the glass there is nothing to
//      punch: a translucent control over its own pool IS the backlit cap.
//   5. EMISSION FALLS WITH AREA. A hot point on black is comfortable; a hot
//      panel is glare (K38c found it by eye). The level a big emitter paints
//      at is scaled by sqrt(reference / area), floored, so the ingestion bay
//      glows under its glass and never washes the page.
//   6. THE SEAMS ARE EMITTERS, AND THE ROOM HAS HAZE (K41). The owner's
//      mockup of the seams (docs: the emissive-seams mockup, 2026-09-26) asked
//      for two things a stylesheet cannot give: a seam whose light LEAVES the
//      line and pools on the ground either side, and a volumetric haze — the
//      cumulative light of every seam filling the negative space, "the phone
//      as a brick of light". The mockup painted that haze by hand, as a dozen
//      radial gradients placed where the seams happened to be. Here it is the
//      physics instead: `data-seam` names an element's EDGE as a line source
//      (or the element itself, or its perimeter), the engine emits from the
//      strip — never the panel — and every emitter, seam or lamp, casts a
//      second, far, faint field with a long reach. The sum of those fields IS
//      the haze, so it follows the seams wherever a view puts them, adds where
//      two meet, and costs one more baked sprite per shape. `--haze-gain` is
//      its one dial; the crisp core and the tight halation stay in CSS, where
//      a 1px line can be crisp — this buffer is a quarter scale and cannot.
//   7. THE IGNITION SEQUENCE IS CHROME'S; THIS ENGINE ONLY KEEPS WATCHING
//      (K41b; one level for the room since K64, kept by chrome.js since K78).
//      On a cold load js/console/chrome.js igniteConsole() marks <html
//      data-ignition> and runs the room's level 0 → hot → 1 on its clock;
//      init hands the engine that level (lightingInit({ room })), and the
//      strips read it every frame like every other dial, so the pool and the
//      haze flare and settle WITH the core, on one curve, with no ignition
//      code of their own. The one
//      thing the engine must know is that while the root says an ignition is
//      running, the light is moving even when every level rests — so it
//      keeps asking for frames until the attribute comes off, and parks then.
//
//   8. THE GROUND IS A SUBSTRATE, AND IT SHOWS ONLY WHERE LIGHT LANDS (K41e).
//      The owner's second mockup laid a micro-perforated membrane over the
//      whole document with mix-blend-mode: screen — the compositor cliff, and
//      a uniform tint over text and cards, which is wallpaper. Here the
//      membrane is what the light falls ON: a pore tile baked once and
//      multiplied into the light's alpha (each canvas's CSS mask since K78:
//      the compositor's, where it was a pattern fill at full resolution on
//      every repaint of the fixed canvas, which WebKit draws tile by tile on
//      the CPU), so pores keep the light, threads dim it, and the black
//      ground — where nothing lands — stays black. The texture appears near the seams and fades with the
//      haze, which is where the depth comes from; under the glass it shows
//      through the chrome like everything else. `--substrate-gain` is the
//      dial; 0 removes the pass entirely.
//
// A leaf: it imports nothing and is imported by nobody. init() calls
// lightingInit() once. See dev/console-module-plan.md.

// ---------------------------------------------------------------- the optics
//
// One emissive buffer at a quarter of CSS pixels, upscaled over the page. That
// is the whole pipeline, and the shape of it was decided by measurement rather
// than by the bench:
//
//   • THE SPREAD COMES FROM THE SHADOW, NOT FROM A BLUR CHAIN. The first draft
//     filled a flat rect and leaned on a mip chain to widen it. It does not:
//     upscaling is bilinear, so a source pixel's influence ends at its
//     neighbour's centre, and the pool died 30px out however the tiers were
//     weighted. A blur chain SOFTENS a falloff; it cannot invent one.
//   • A RADIAL GRADIENT WAS THE SECOND DRAFT AND IS WRONG OFF-SQUARE. Scaling
//     one circle into an oblong puts the emitter's edge at a different point
//     along the ramp per axis: the publish bar measured 0.18 above and 0.035 at
//     its sides — the same lamp, five times dimmer sideways.
//   • SO THE POOL IS THE SHAPE'S OWN SHADOW, cast in the emitter's colour at
//     zero offset. It is the only 2D-canvas primitive that spreads a fill the
//     same distance on every side of an arbitrary rounded rect. Measured 0.137
//     above and 0.133 beside, on the shape that was five times out.
//   • AND THE MIP CHAIN THEN EARNED NOTHING. With the shadow doing the
//     spreading, four weighted tiers measured slightly BRIGHTER near the
//     emitter and slightly SHORTER in the tail than the single buffer alone —
//     three extra canvases, a ping-pong downscale and four composites to make
//     the light a little more contrasty. Removed. This is the subtractive pass;
//     a technique that cannot show its work does not ship.
//   • THE POOL IS BAKED ONCE AND REPLAYED (K40). The shadow is cast into a
//     sprite the first time a shape+colour is seen and drawn from then on at
//     the emitter's level — the analogs.network `makeGlow` pattern. Measured
//     per frame in headless Chromium, quarter-scale buffer: 1 emitter 0.057 →
//     0.014 ms, 4: 0.087 → 0.028, 12: 0.152 → 0.041, 36: 0.381 → 0.067; the
//     bake itself is 0.3 ms once. Be honest about what that buys: at the
//     console's one-to-six emitters both are noise. It ships because the frame
//     cost is now FLAT while a level animates, and because the depth tint
//     below costs a second fill per bake instead of a second fill per frame.
//   • DEPTH IS ATTENUATION, NOT SHADOW. On a true-black ground nothing casts a
//     shadow — the pixels are off. What tells the eye that a lit thing sits in
//     front of the panel its light lands on is that the light COOLS with
//     distance: pure hue at the rim, sinking toward the ground in the tail
//     (the analogs ring's far side does the same, toward a deep desaturated
//     red). So the sprite is two shadows: a near one in the emitter's colour
//     and a wider one in that colour dimmed and part-desaturated. Derived from
//     `--lit-rgb` by arithmetic; nothing here names a colour.
const EM_SCALE = 0.25;

// The alpha an emitter casts at its own edge, before --bloom-gain. Not a token:
// it is the painter's own unit, and the dial an author reaches for lives in CSS.
const EMIT_ALPHA = 0.85;

// How far the pool reaches past the emitter's edge, in CSS pixels: a floor plus
// a share of the emitter's short side, so a 32px button pools ~82px and the
// publish bar pools ~240px. Bigger lamps throw further; the energy spreads with
// them, so the big one is not brighter — measured 0.137 at the bar's rim
// against 0.125 at the button's.
const POOL_BASE = 56;
const POOL_SHARE = 0.8;

// The near field: the share of the reach the pure-hue shadow covers. Past it
// the far shadow carries the light, in the cooled tone.
const NEAR_SHARE = 0.45;
// The far tone: the emitter's colour dimmed and pulled part way toward its own
// luminance — darker AND greyer, which is what distance does to light on a
// dark panel. Both are ratios of the emitter's colour, never a colour.
const FAR_DIM = 0.6;
const FAR_DESAT = 0.35;
const FAR_ALPHA = 0.7;

// The area law. A 100×32 control paints at its full level; a panel paints
// at sqrt(AREA_REF / area), never below AREA_FLOOR. The ingestion bay
// (~900×230) lands on the floor. 0.3 was the first floor and read as a slab
// through the bay's glass at gain 2; a bay should be dark inside, lit at the
// rim, glowing past it — the light is mostly for the ground around it.
const AREA_REF = 3200;
const AREA_FLOOR = 0.15;

// A seam (K41). The line the stylesheet draws is 1px; at a quarter scale that
// is a quarter of a buffer pixel and its shadow has no energy. So the strip a
// seam emits from is drawn SEAM_SRC CSS px thick — one buffer pixel — centred
// on the line, and its pool is drawn at SEAM_POOL of the level: a filament's
// halo is a fraction of a lamp's. Measured on the first cut at 1.0: 0.77
// alpha at the line, and a 1px seam read as a neon tube. The crisp core is
// CSS's; what this paints is the light that LEFT the line — its shadow, and
// never the strip itself, which at one buffer pixel strobes when it scrolls
// (see sprite()).
const SEAM_SRC = 4;
const SEAM_POOL = 0.22;
// A seam is FED from an edge and attenuates along its run (K40d: the
// stylesheet's --seam is brightest where the light enters and fades across),
// so the strip's fill is a gradient from full at the fed end — the left, or
// the top; the console's light lives at that corner — to SEAM_FAR at the far
// end. The pool and the haze inherit it from the fill, which is how the room
// stays organic: densest where the seams enter, thinning to true black.
const SEAM_FAR = 0.4;
// Light LEAVES a panel (K41d). An edge seam's haze is cast outward — the
// fattened source sits on the open side of the line, not astride it — so a
// housing does not pool light back into itself and the room is lit FROM its
// chrome: the sidebar's edge throws right, the topbar's down. A rule that is
// the line (no edge) casts both ways. The sidebar is the PRIMARY source —
// the owner's read: the console should be lit from the left, falling off to
// the right — and says so with `--haze-boost`, a per-host multiplier on the
// haze alone (the core and the pool keep their own dial), ceilinged here.
const BOOST_CEIL = 4;

// The haze: the far, faint field every emitter casts, whose sum is the room's
// ambient light. A line has no energy at this reach either, so the source is
// FATTENED by HAZE_SPREAD on every side before it is blurred by HAZE_REACH —
// which is what a lamp behind frosted glass does to a filament. Baked at the
// alpha of the MAXIMUM dial and drawn at level × (gain / HAZE_MAX)², because
// globalAlpha clamps at 1 and a sprite cannot be drawn brighter than it was
// baked. The dial is SQUARED on purpose: the fields of a dozen seams add, and
// a linear dial had no quiet end — at the first cut's 1/3 the open ground
// already sat at 0.17 and the black was gone. Squared, the stylesheet's
// `--haze-gain: 1.5` sits half way up the dial at a quarter of the ceiling,
// 0 is the void and HAZE_MAX is the mockup's brick of light. The ceiling is
// the dial's, not a typo guard. The reach is deliberately SHORT of the
// mockup's: at σ ≈ 100px a dozen fields summed to one flat wash and the
// black was gone from the open ground; at 60 the light gathers where seams
// meet and the OLED black seeps back between them — the owner's read.
const HAZE_REACH = 120;
const HAZE_SPREAD = 36;
const HAZE_ALPHA = 0.32;
const HAZE_MAX = 3;
// The sprite's margin past the fattened source. A canvas shadow of blur b is a
// Gaussian of σ = b/2, so a margin of one blur is two σ and clips the tail at
// 13% — a faint hard edge around every field. Three σ is 1%, and invisible.
const HAZE_MARGIN = HAZE_SPREAD + Math.ceil(HAZE_REACH * 1.5);

// The most gain anyone can ask for. See bloomGain(): a typo guard on a value
// that costs one full-canvas composite per unit.
const GAIN_MAX = 4;

// An emitter this far outside the viewport contributes nothing but a blurred
// fill. Generous enough that one just past the fold still spills into view,
// which is what tells you something is lit up there — and past the haze's
// whole margin (HAZE_MARGIN, 216), so a seam below the fold still fills the
// bottom of the room.
const CULL_MARGIN = 320;

// The dither. A quarter-scale pool upscaled bilinearly is a smooth 8-bit ramp,
// and on an OLED a smooth dark-red ramp BANDS — every step of 1/255 is a
// visible contour. A gray-centred noise tile blitted `source-atop` into the
// buffer (only where there is light; the black ground never greys) breaks the
// contours by optical mixing. Baked once; the offset moves per paint, so while
// a level animates the grain is temporal and while the engine is parked it
// holds still. Amplitude from the analogs LEAN profile: phones read more as
// codec noise.
const NOISE_S = 256;
const NOISE_SPAN = 30;
const DITHER_ALPHA = 0.06;

// The sprite cache is bounded. A console has a handful of emitter shapes; a
// grid of lit tiles would have a few dozen. Two sprites per shape since K41
// (the pool and its haze), three with a backlight (K44).
//
// ⚠️ K49 (2026-10-04, measured on an emulated phone): the cap was 48 and FIFO,
// and the archive and publish views have more shapes than that — every
// paint evicted the sprites it was about to need and re-baked them, each a
// shadowBlur (the most expensive thing a 2D canvas does): ~110 new canvases
// a paint, 6,400 in four idle seconds. Now the cache is LEAST-RECENTLY-USED
// (a hit moves to the back), bounded by a pixel budget as well as a count,
// and a sprite is baked at a QUANTISED size (spriteSize) and drawn stretched
// to the exact box — a few px on a blurred glow is invisible, and it makes a
// view's dozens of near-identical boxes share a handful of sprites.
const SPRITE_CAP = 160;
const SPRITE_PX_BUDGET = 6e6;   // baked pixels across every sprite (~24MB)

// The substrate (K41e). A staggered micro-perforation on a ~7 device px
// grid, applied at full resolution to the composited light — not in the
// quarter-scale buffer, where a 6px pitch is one and a half pixels. The tile
// is a MASK: pores at alpha 1, the membrane between them at 1 − gain × DEPTH,
// so at gain 0 it is opaque everywhere and changes nothing. Rotated a little
// so the grid does not register with the pixel grid or the seams.
//
// K50 (2026-10-04, the owner: the texture "still fights the text at the
// current pore size … add an emissive texture but not at the expense of
// being able to read text"). Two changes. The membrane is specified in
// DEVICE pixels now, not CSS pixels: it is a physical surface, and the same
// surface on a 2× display is a finer grain, not bigger dots. At 6 CSS px the
// pores were 12 device px apart on the owner's screen — the scale of a
// letter's counters, so the grid and the type fought — and at 7 device px
// they are a stipple under the text's scale, which the eye reads as a tone.
// And the threads pass more (DEPTH 0.7 → 0.55): a quieter weave. The
// engine owns every copy of the membrane (the canvases' masks and the
// stylesheet's `--substrate-pores` for the keys in a plane and a plane's
// air), so one set of numbers is the texture. K78: the fixed canvas's copy
// was a pattern of its own (a 7px lattice turned 18°, filled over the whole
// canvas on each repaint); it is the layers' periodic tile now, as a mask.
const SUBSTRATE_PORE = 1.0;         // device px, the pore's radius
const SUBSTRATE_DEPTH = 0.55;
// The periodic supercell for a CSS mask (see substrateTileURL): the lattice
// turned by atan(1/3) at a pitch of CELL/√10 (6.96px for 22) repeats on a
// whole-pixel square, so a tile can repeat without a seam.
const SUBSTRATE_CELL = 22;          // device px

// The backlight (K44, 2026-10-03). A panel or a card that carries
// `data-backlit` has a light BEHIND it, larger than it: the whole box, grown
// by --backlight-overhang and softened by --backlight-soft, sitting a little
// low (--backlight-y, a share of its height — the owner's "light from below"),
// at the host's own --backlight level. The glass in front transmits it (the
// stylesheet's frost), and the overhang is the halo. Tuned on the owner's
// bench (docs/ideas/backlit-glass-mockup.html, the take "1st pass") and ported
// with the bench's own maths, so the console renders what was dialled:
//   • the area law EASED (exponent BACKLIGHT_LAW): a backlight is meant to be
//     big, and the lamp's full law made a panel's light vanish;
//   • the sprite is the box's shadow only (its fill is drawn away), so the
//     light has no hard edge anywhere;
//   • the haze is the engine's own far field at the host's --backlight-haze.
const BACKLIGHT_ALPHA = 0.9;
const BACKLIGHT_LAW = 0.35;
const BACKLIGHT_DEFAULTS = { overhang: 12, soft: 58, y: 0.17 };

let canvas = null;
let ctx = null;
let em = null;
let emx = null;
let dirty = false;
let fixedDirty = true;     // the fixed canvas needs a redraw (K49: tracked apart from the layers')
let resizePending = true;  // the window may have changed size since it was last read
let liveCache = null;      // the emitters, as of the last time the document could have changed (K49)
let roster = null;         // that list split by licence, once per roster (K56)
let queued = 0;
let sized = { w: 0, h: 0, dpr: 0 };
let ro = null;
let watched = new Set();   // the emitters the size observer is pointed at right now
let thermal = new Map();   // element → { level, from, target, t0, dur, bez, last } — lit / hot
let seams = new Map();     // the same, for data-seam: its own level, so a bay that is
                           // both a seam and hot heats its FILL from dark
let inFlight = false;      // a level moved this frame and has not reached its target
let reduced = false;       // prefers-reduced-motion: levels jump, no journey
let noise = null;          // the dither tile, baked once
const sprites = new Map(); // `${w}x${h}r${r}:${rgb}` → { c, R }

/**
 * Every element currently licensed to emit. The attribute IS the contract:
 * `data-lit` is a thing that is ON, `data-heat="hot"` a thing IN FLIGHT.
 * (`data-heat="warm"` — under a hand — is deliberately NOT here: warm is in
 * the box, and only lit and hot leave it. A hover must never touch the canvas.)
 */
const LICENCE = '[data-lit], [data-heat="hot"], [data-seam], [data-backlit]';
function emitters() {
  return [...document.querySelectorAll(LICENCE)];
}

/** The backlight half of the licence (K44): a light behind the whole box. */
function isBacklit(el) {
  return el.hasAttribute('data-backlit');
}

/** The lit / hot half of the licence: the thing's whole box emits. */
function isLit(el) {
  return el.hasAttribute('data-lit') || el.getAttribute('data-heat') === 'hot';
}

/**
 * The seam half (K41). The value names WHICH edge of the box the seam runs
 * along — `top|right|bottom|left` — or `box` for the whole perimeter (a bay),
 * or nothing, for an element that IS the line (a rule, a leader): a thin one
 * is one strip along its length, a thick one is treated as a box. Null when
 * the element carries no seam.
 */
function seamEdge(el) {
  if (!el.hasAttribute('data-seam')) return null;
  const v = (el.getAttribute('data-seam') || '').trim();
  return /^(top|right|bottom|left|box)$/.test(v) ? v : '';
}

// ---- WHAT AN EMITTER IS, read once per roster (K56) ----------------------
// Measured 2026-10-05 on a phone-speed trace (the real data, CPU 4×): while a
// light moved, the engine re-read every emitter's whole description every
// frame — its licence, which canvas it belongs to (a `closest()`), its colour,
// its corner, its backlight's shape, each a computed-style read — 11–18
// thousand style reads in five seconds of an arrival, for values that cannot
// change while a dial moves. A light's FACTS change only when the document
// does, and the engine already hears every such change: a mutation, a resize,
// the theme, the ignition (each a full repaint, which starts a new roster).
// So the facts are read once per roster and kept; a frame reads only what
// moves — the dials (--seam-level, --backlight, --ignite, --lit-level) and
// the box (an element can be carried by a transform, so its rect stays live).
// A hand or a focus on an emitter (`touched`), or a transition ending on it,
// forgets that one element's facts, so a state rule that changes its colour
// is read on its next paint.
let rosterGen = 0;
let facts = new WeakMap();   // el → { gen, lit, edge, backlit, host?, rgb?, radius?, boost?, back? }
function factsOf(el) {
  let f = facts.get(el);
  if (f && f.gen === rosterGen) return f;
  f = { gen: rosterGen, lit: isLit(el), edge: seamEdge(el), backlit: isBacklit(el) };
  facts.set(el, f);
  return f;
}
/** One element's facts are stale (a hand, a focus, a transition ended on it). */
function forget(el) {
  if (el) facts.delete(el);
}

/**
 * The strips a seam emits from, in CSS px, each SEAM_SRC thick and centred on
 * the 1px line the stylesheet draws on that edge (the border area is the last
 * pixel INSIDE the box, so the line's centre is half a pixel in).
 */
function seamStrips(r, edge) {
  const half = SEAM_SRC / 2;
  // `out` is the open side the light leaves toward: the haze is cast that way.
  const top = () => ({ left: r.left, top: r.top + 0.5 - half, width: r.width, height: SEAM_SRC, out: 'top' });
  const bottom = () => ({ left: r.left, top: r.bottom - 0.5 - half, width: r.width, height: SEAM_SRC, out: 'bottom' });
  const left = () => ({ left: r.left + 0.5 - half, top: r.top, width: SEAM_SRC, height: r.height, out: 'left' });
  const right = () => ({ left: r.right - 0.5 - half, top: r.top, width: SEAM_SRC, height: r.height, out: 'right' });
  switch (edge) {
    case 'top': return [top()];
    case 'bottom': return [bottom()];
    case 'left': return [left()];
    case 'right': return [right()];
    case 'box': return [top(), bottom(), left(), right()];
    default: {
      // The element is the line. Thin one way → one strip down its own middle.
      if (r.height <= 2) return [{ left: r.left, top: r.top + r.height / 2 - half, width: r.width, height: SEAM_SRC, out: null }];
      if (r.width <= 2) return [{ left: r.left + r.width / 2 - half, top: r.top, width: SEAM_SRC, height: r.height, out: null }];
      return [top(), bottom(), left(), right()];
    }
  }
}

/**
 * The emitter's colour, resolved through theme + preset + tone variant at the
 * moment of painting. `--lit-rgb` is a bare `r, g, b` triplet by construction
 * (see the ARMED / LIVE block in field-console.css), which is what lets the
 * same token feed an rgba() in CSS and a fillStyle here.
 */
function litRgb(el) {
  try {
    const raw = (getComputedStyle(el).getPropertyValue('--lit-rgb') || '').trim();
    // Three integers or nothing. A malformed value must not reach fillStyle,
    // where it is silently ignored and the previous colour paints instead.
    return /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(raw) ? raw : null;
  } catch { return null; }
}

/** A surface's own brightness dial, 0..1; absent or unreadable is 1. */
function dial(el, name) {
  try {
    const raw = (getComputedStyle(el).getPropertyValue(name) || '').trim();
    if (raw === '') return 1;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
  } catch { return 1; }
}
/** A plain number off the host (px or a share), or the fallback. */
function num(el, name, fallback, lo, hi) {
  try {
    const raw = (getComputedStyle(el).getPropertyValue(name) || '').trim();
    if (raw === '') return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  } catch { return fallback; }
}

/** The lamp's dial (`--lit-level`, K40d) and the seam's (`--seam-level`, K41). */
const litLevel = (el) => dial(el, '--lit-level');
/**
 * The room's ignition (K41b; one level for the room since K64): from 0 (OLED
 * black) to a crest above rest and back to 1, once per session, and 1 after.
 * Read once a frame (paint() sets `room`), not per host. Since K78 it is the
 * canvases' opacity and nothing else (capped at 1: an opacity cannot
 * overshoot, so the crest is the floor's, the keys' and the gauge's, and the
 * canvases carry the rise and the dip): the light is drawn once, at its rest,
 * and the compositor brings it up. Until K78 the seams' pools took it whole
 * and the engine redrew every canvas through the cold start (the fixed one
 * every other frame, the layers every fourth), which held WebKit at 15 to
 * 25 fps where Blink held 60; the measured crest the redraws bought was 2%.
 * It may overshoot, so it is clamped to a ceiling, not to 1; absent or
 * unreadable is 1.
 * The level is chrome.js's (ignitionLevel()), handed in by init: this engine
 * imports nothing. Until K78 it was a registered number the stylesheet
 * animated on <html>, read here with getComputedStyle, and WebKit restyled
 * and repainted the whole page for it every frame.
 */
const IGNITE_CEIL = 2;
let room = 1;
let roomSource = null;
function roomIgnite() {
  if (!igniting() || !roomSource) return 1;
  try {
    const n = Number(roomSource());
    return Number.isFinite(n) ? Math.max(0, Math.min(IGNITE_CEIL, n)) : 1;
  } catch { return 1; }
}
const seamLevel = (el) => dial(el, '--seam-level');
/** The primary source's say: a per-host multiplier on the haze alone, 0..BOOST_CEIL, default 1. */
function hazeBoost(el) {
  try {
    const raw = (getComputedStyle(el).getPropertyValue('--haze-boost') || '').trim();
    if (raw === '') return 1;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(BOOST_CEIL, n)) : 1;
  } catch { return 1; }
}
/** …kept with the emitter's facts (K56): a tier's token, not a dial. */
function boostOf(el) {
  const f = factsOf(el);
  if (f.boost === undefined) f.boost = hazeBoost(el);
  return f.boost;
}

/**
 * Is any seam's dial in transition? `--seam-level` is a registered number
 * (2026-10-02), so a host that changes it under a hand — a card on hover, a
 * field on focus — transitions it, and the browser says so with transition
 * events. The set holds the hosts mid-transition; a host that leaves the DOM
 * mid-way is dropped rather than holding the engine awake.
 */
const dialHosts = new Set();
function dialing() {
  for (const el of dialHosts) if (!el.isConnected) dialHosts.delete(el);
  return dialHosts.size > 0;
}
function onDial(ev) {
  // A transition that has ended may have changed a fact (K56): a state rule
  // can carry a colour or a corner as well as a dial.
  if (ev.type !== 'transitionrun') forget(ev.target);
  if (ev.propertyName !== '--seam-level' && ev.propertyName !== '--backlight') return;
  if (!ev.target?.hasAttribute?.('data-seam') && !ev.target?.hasAttribute?.('data-backlit')) return;
  if (ev.type === 'transitionrun') dialHosts.add(ev.target);
  else dialHosts.delete(ev.target);
  lightingRepaintFor(ev.target);
}

/** Is the stylesheet's ignition sequence running? Read off the root each frame. */
function igniting() {
  try { return document.documentElement.hasAttribute('data-ignition'); } catch { return false; }
}

/** Is a lamp in this host on a journey right now (K54b)? A bay heating or
 *  cooling (`data-heat`, present from the first frame of the heat to the last
 *  of the cool) or a row of cards waking (`data-wake`). The eye adaptation
 *  must not measure the room then. It did, and it chased the room's own
 *  ignitions: the owner on the Archive, "at the end of the cool down the back
 *  lighting shifts", traced as the surface's exposure sinking 0.72 → 0.50
 *  while its bay cooled and climbing back for 2.6s after, about seven seconds
 *  of glide per arrival. And on Publish, "the ignition sequence ends up
 *  slowing down after 1 or 2 clicks": the glide left by the last surface's
 *  arrival was still running into the next one's card wake, so the cards
 *  peaked up to 150ms late and out of order. The room is measured at rest, on
 *  arrival and once the lamp has settled: the attribute coming off is itself a
 *  repaint. Names no surface; reads the two attributes the licence already
 *  has. */
function journeying(host) {
  try { return !!host.querySelector?.('[data-heat], [data-wake]'); } catch { return false; }
}

/**
 * A thermal curve, read off the emitter: `1.5s cubic-bezier(0.4, 0, 0.5, 1)`.
 * The token is the dial. If it is missing or unreadable the level JUMPS — a
 * missing curve is "no journey", never a journey this module made up.
 */
function curve(el, name) {
  try {
    const raw = (getComputedStyle(el).getPropertyValue(name) || '').trim();
    const m = raw.match(/^([\d.]+)(ms|s)\s+cubic-bezier\(\s*([^)]+?)\s*\)$/);
    if (!m) return { ms: 0, bez: null };
    const ms = parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1);
    const bez = m[3].split(',').map((n) => parseFloat(n));
    if (!Number.isFinite(ms) || bez.length !== 4 || bez.some((n) => !Number.isFinite(n))) return { ms: 0, bez: null };
    return { ms, bez };
  } catch { return { ms: 0, bez: null }; }
}

/**
 * y for x on a CSS cubic-bezier, so the pool follows the box's own easing to
 * the frame. Newton on the x polynomial, bisection when the slope is flat —
 * the standard shape, nothing clever.
 */
function bezierY(bez, x) {
  if (!bez) return x;
  const [x1, y1, x2, y2] = bez;
  const ax = 1 - 3 * x2 + 3 * x1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 6; i++) {
    const d = dx(t);
    if (Math.abs(d) < 1e-6) break;
    const e = sx(t) - x;
    if (Math.abs(e) < 1e-5) return sy(t);
    t -= e / d;
  }
  let lo = 0, hi = 1;
  t = x;
  while (hi - lo > 1e-4) {
    t = (lo + hi) / 2;
    if (sx(t) < x) lo = t; else hi = t;
  }
  return sy(t);
}

/**
 * The master dial, read from the root at paint time for the same reason the
 * colour is. DAYLIGHT sets it to 0: on paper "lit" reads as LIFTED — a ring and
 * a contact shadow — and a glow pooling onto warm paper reads as a screen
 * artefact. That is one token, not a `[data-theme]` branch in here.
 */
function bloomGain() {
  try {
    const raw = (getComputedStyle(document.documentElement)
      .getPropertyValue('--bloom-gain') || '').trim();
    const n = parseFloat(raw);
    // The ceiling is a typo guard, not a design limit: gain is spent as whole
    // composite passes (see paint step 2), so a stray `--bloom-gain: 300`
    // would cost 300 full-canvas draws a frame.
    return Number.isFinite(n) ? Math.max(0, Math.min(GAIN_MAX, n)) : 0;
  } catch { return 0; }
}

/**
 * The room's haze, 0..HAZE_MAX, read from the root at paint time like the
 * gain. 0 is the void (no far field at all, and no haze sprite is baked);
 * the stylesheet ships 1. A dial, not a theme branch: DAYLIGHT turns the
 * canvas off with --bloom-gain and never reaches this.
 */
function hazeGain() {
  try {
    const raw = (getComputedStyle(document.documentElement)
      .getPropertyValue('--haze-gain') || '').trim();
    if (raw === '') return 1;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(HAZE_MAX, n)) : 1;
  } catch { return 1; }
}

/** A plain number off the root (K49: the content's light profile), or the fallback. */
function rootNum(name, fallback, lo, hi) {
  try {
    const raw = (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim();
    if (raw === '') return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  } catch { return fallback; }
}

/** The membrane's dial, 0..1, read off the root at paint time; 0 is no membrane. */
function substrateGain() {
  try {
    const raw = (getComputedStyle(document.documentElement)
      .getPropertyValue('--substrate-gain') || '').trim();
    if (raw === '') return 0;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  } catch { return 0; }
}

/**
 * The room's settings, read once per full repaint (K56). The gain, the haze,
 * the membrane, the content profile, the spill and the eye's strength live on
 * the root and change with the theme or a breakpoint, and both reach a full
 * lightingRepaint(); the preset is stamped by the worker and never changes in
 * the page. They were read 7–8 times a frame, and the spill's on every scroll
 * frame of .main, the one path K45 made free. The generation is the repaint's,
 * not the roster's: with the gain at 0 (paper) there is no roster to start,
 * and a cache keyed on one would hold the light off after a switch to dark.
 */
let settingsGen = 0;
let settings = null;   // { gen, map }
function setting(key, read) {
  if (!settings || settings.gen !== settingsGen) settings = { gen: settingsGen, map: new Map() };
  let v = settings.map.get(key);
  if (v === undefined) { v = read(); settings.map.set(key, v); }
  return v;
}

function roundRect(g, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  // Safari < 16.4 has no roundRect. A square pool is a fine degradation; a
  // thrown TypeError in the paint path is not.
  if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, rad);
  else g.rect(x, y, w, h);
}

/** The far tone of an emitter's colour: dimmed, and pulled toward its own luminance. */
function farRgb(rgb) {
  const [r, g, b] = rgb.split(',').map((n) => parseInt(n, 10));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r, g, b].map((c) => Math.round((c + (L - c) * FAR_DESAT) * FAR_DIM)).join(', ');
}

/**
 * The fill for a seam's strip: fed from the left or the top, attenuating to
 * SEAM_FAR along the long axis. A shadow is cast from the fill's alpha, so the
 * pool and the haze fall off along the seam the way the core does. Null for a
 * lamp, whose whole box emits evenly.
 */
function fedFill(g, x, y, w, h, alpha, rgb) {
  const horizontal = w >= h;
  const grad = g.createLinearGradient(x, y, horizontal ? x + w : x, horizontal ? y : y + h);
  grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  grad.addColorStop(1, `rgba(${rgb}, ${alpha * SEAM_FAR})`);
  return grad;
}

/**
 * The pool for one shape, baked at level 1 in buffer space. Two shadows: the
 * near field in the emitter's colour and the far field in its cooled tone,
 * added, so the tail sinks toward the ground the way light on a dark panel
 * does. The sprite's margin IS the reach — the room the escaping light needs.
 */
function sprite(w, h, radius, rgb, seam = false) {
  const key = `${w}x${h}r${radius}:${rgb}${seam ? ':seam' : ''}`;
  const hit = spriteGet(key);
  if (hit) return hit;
  const R = POOL_BASE + Math.min(w, h) * POOL_SHARE;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil((w + 2 * R) * EM_SCALE));
  c.height = Math.max(1, Math.ceil((h + 2 * R) * EM_SCALE));
  const g = c.getContext('2d');
  if (!g) return null;
  g.globalCompositeOperation = 'lighter';
  // A seam bakes its SHADOWS ONLY (2026-10-01). Its strip is one buffer pixel
  // tall, so a fill here is a hard 1px line in a quarter-scale buffer, and a
  // hard line drawn at a fractional position changes shape with the fraction:
  // measured at 4 CSS px per cycle, its peak swung 53 → 67 → 53 (21%) as the
  // rule moved, which a scroll turns into a strobe on every horizontal seam
  // (a vertical one moves along its own length and shows nothing). The core
  // and the tight halation are the stylesheet's, where a 1px line is crisp
  // and scrolls with its page; what is baked here must be softer than a
  // buffer pixel. So the fill goes a canvas-height away and only its shadow
  // is brought back — the haze sprite's trick. Measured after: 3.6%, which is
  // the 8-bit floor. A lamp keeps its fill: its box sits under its own
  // control, and a lamp is not a 1px line.
  const away = seam ? c.height + R * EM_SCALE * 2 : 0;
  for (const [tone, alpha, reach] of [
    [farRgb(rgb), EMIT_ALPHA * FAR_ALPHA, R],
    [rgb, EMIT_ALPHA, R * NEAR_SHARE],
  ]) {
    g.save();
    g.shadowColor = `rgba(${tone}, ${alpha})`;
    g.shadowBlur = reach * EM_SCALE;
    g.shadowOffsetX = 0;
    g.shadowOffsetY = away;
    // The fill under the shadow is the CORE — the contact halation at the rim,
    // as bright as the thing making it. The punch-out takes it back off the
    // control, so what survives is the millimetre of light around the edge.
    // A seam's fill is fed from its edge (K41) and the shadow follows it; the
    // fill itself is out of frame (`away`, above).
    const x = R * EM_SCALE, y = R * EM_SCALE - away, sw = w * EM_SCALE, sh = h * EM_SCALE;
    g.fillStyle = seam && typeof g.createLinearGradient === 'function'
      ? fedFill(g, x, y, sw, sh, alpha, tone)
      : `rgba(${tone}, ${alpha})`;
    roundRect(g, x, y, sw, sh, radius * EM_SCALE);
    g.fill();
    g.restore();
  }
  return spritePut(key, { c, R });
}

/**
 * The haze for one shape (K41): the far, faint field, baked at HAZE_MAX's
 * alpha in the cooled tone and replayed at level × gain / HAZE_MAX. One
 * shadow, and ONLY the shadow: the fattened source is drawn a canvas-height
 * away and its shadow offset back, so no hard-edged band lands in the sprite
 * — a fill under this blur would be a lit slab the width of the spread.
 */
function hazeSprite(w, h, rgb, seam = false, out = null) {
  const key = `haze:${w}x${h}:${rgb}${seam ? ':seam' : ''}${out ? `:${out}` : ''}`;
  const hit = spriteGet(key);
  if (hit) return hit;
  const R = HAZE_MARGIN;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil((w + 2 * R) * EM_SCALE));
  c.height = Math.max(1, Math.ceil((h + 2 * R) * EM_SCALE));
  const g = c.getContext('2d');
  if (!g) return null;
  const away = c.height + HAZE_REACH * EM_SCALE * 2;
  g.save();
  g.shadowColor = `rgba(${farRgb(rgb)}, ${HAZE_ALPHA})`;
  g.shadowBlur = HAZE_REACH * EM_SCALE;
  g.shadowOffsetX = 0;
  g.shadowOffsetY = away;
  // The fattened source: astride the line for a rule, on the OPEN side of it
  // for a panel's edge — the same band, shifted one spread outward.
  const dx = out === 'right' ? HAZE_SPREAD : out === 'left' ? -HAZE_SPREAD : 0;
  const dy = out === 'bottom' ? HAZE_SPREAD : out === 'top' ? -HAZE_SPREAD : 0;
  const x = (R - HAZE_SPREAD + dx) * EM_SCALE, y = (R - HAZE_SPREAD + dy) * EM_SCALE - away;
  const sw = (w + 2 * HAZE_SPREAD) * EM_SCALE, sh = (h + 2 * HAZE_SPREAD) * EM_SCALE;
  g.fillStyle = seam && typeof g.createLinearGradient === 'function'
    ? fedFill(g, x, y, sw, sh, 1, rgb)
    : `rgba(${rgb}, 1)`;
  g.beginPath();
  g.rect(x, y, sw, sh);
  g.fill();
  g.restore();
  return spritePut(key, { c, R });
}

/**
 * The backlight's sprite (K44): the grown box's SHADOW only, at the host's
 * softness, in the emitter's hue. Keyed on size, radius, softness and colour,
 * so a panel bakes once and a grid of same-sized cards shares one.
 */
function backlightSprite(w, h, radius, soft, rgb) {
  const key = `back:${w}x${h}r${radius}s${soft}:${rgb}`;
  const hit = spriteGet(key);
  if (hit) return hit;
  const R = Math.ceil(soft * 1.6) + 2;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil((w + 2 * R) * EM_SCALE));
  c.height = Math.max(1, Math.ceil((h + 2 * R) * EM_SCALE));
  const g = c.getContext('2d');
  if (!g) return null;
  const away = c.height + soft * EM_SCALE * 2;
  g.save();
  g.shadowColor = `rgba(${rgb}, ${BACKLIGHT_ALPHA})`;
  g.shadowBlur = soft * EM_SCALE;
  g.shadowOffsetX = 0;
  g.shadowOffsetY = away;
  g.fillStyle = `rgba(${rgb}, 1)`;
  roundRect(g, R * EM_SCALE, R * EM_SCALE - away, w * EM_SCALE, h * EM_SCALE, radius * EM_SCALE);
  g.fill();
  g.restore();
  return spritePut(key, { c, R });
}

/** The cache's two halves (K49): a hit is moved to the back, so what is in use
 *  survives; a bake evicts from the front until both the count and the pixel
 *  budget are met. */
let spritePx = 0;
function spriteGet(key) {
  const hit = sprites.get(key);
  if (hit) { sprites.delete(key); sprites.set(key, hit); }
  return hit;
}
function spritePut(key, entry) {
  sprites.set(key, entry);
  spritePx += entry.c.width * entry.c.height;
  while (sprites.size > 1 && (sprites.size > SPRITE_CAP || spritePx > SPRITE_PX_BUDGET)) {
    const [k, e] = sprites.entries().next().value;
    sprites.delete(k);
    spritePx -= e.c.width * e.c.height;
  }
  return entry;
}
/** The size a sprite is BAKED at (K49): CSS px rounded to a step that grows
 *  with the box (4px under 160, 8px under 640, 16px past it). A line source
 *  under 8px keeps its exact thickness — that IS its shape. */
function spriteSize(n) {
  if (n < 8) return Math.max(1, n);
  const q = n < 160 ? 4 : n < 640 ? 8 : 16;
  return Math.max(q, Math.round(n / q) * q);
}

/** The dither tile: gray-centred noise, baked once. Null where a context cannot be had. */
function noiseTile() {
  if (noise) return noise;
  const c = document.createElement('canvas');
  c.width = c.height = NOISE_S;
  const g = c.getContext('2d');
  if (!g || typeof g.createImageData !== 'function') return null;
  const id = g.createImageData(NOISE_S, NOISE_S);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = 128 + (((Math.random() + Math.random() - 1) * NOISE_SPAN) | 0);
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  noise = c;
  return noise;
}

// THE SCALE (K74). A large screen at 1× zooms the whole console (`zoom` on
// <html>, set by the page's boot script, in steps). The engine works in the
// page's own CSS px, the ones a style is written in: a rect and the window
// come back zoomed and are divided by the zoom here, and the device ratio is
// multiplied by it, so the canvas still has a pixel per device pixel. At 1×
// every one of these is the plain value. Read off the inline style, which
// costs no layout.
function uiZoom() {
  return parseFloat(document.documentElement?.style.zoom) || 1;
}
/** A rect in the page's own px. */
function unzoomed(r, z = uiZoom()) {
  if (z === 1) return r;
  return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z, x: r.x / z, y: r.y / z };
}

/** Size the canvas + buffer to the viewport. */
function resize() {
  // Read the window only when it may have changed (K49): `innerWidth` forces
  // a synchronous layout whenever anything on the page has moved since the
  // last frame, and a lamp heating asks for sixty frames a second.
  if (!resizePending && sized.w) return false;
  resizePending = false;
  const z = uiZoom();
  const w = Math.max(1, (window.innerWidth || 0) / z);
  const h = Math.max(1, (window.innerHeight || 0) / z);
  // Capped: a 3× phone gains nothing on a surface that is one big blur, and it
  // is the device least able to pay for it.
  const dpr = Math.min(2, (window.devicePixelRatio || 1) * z);
  if (sized.w === w && sized.h === h && sized.dpr === dpr) return false;
  sized = { w, h, dpr };

  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  em.width = Math.max(1, Math.round(w * EM_SCALE));
  em.height = Math.max(1, Math.round(h * EM_SCALE));
  return true;
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** Point a level at a target on a curve, from wherever it is right now. */
function begin(s, target, cv, t) {
  s.from = s.level;
  s.target = target;
  s.t0 = t;
  s.dur = reduced ? 0 : cv.ms;
  s.bez = cv.bez;
}

/** Where a level is at time t. */
function advance(s, t) {
  if (s.dur <= 0) return s.target;
  const p = Math.min(1, Math.max(0, (t - s.t0) / s.dur));
  return p >= 1 ? s.target : s.from + (s.target - s.from) * bezierY(s.bez, p);
}

/**
 * Reconcile the licence with the levels. A newly licensed emitter starts cold
 * and heats; one that lost its licence cools in place and is forgotten once
 * dark. An element that left the DOM is dropped at once — its light has
 * nowhere to be.
 */
function reconcile(map, live, gain, t, enterLit = false) {
  // The licence and the gain are what decide the targets; with neither
  // changed since the last frame (one roster, K56), only the levels move.
  if (map.gen === rosterGen && map.gain === gain) return advanceAll(map, t);
  map.gen = rosterGen; map.gain = gain;
  const set = new Set(live);
  for (const el of live) {
    let s = map.get(el);
    // A SEAM enters lit (2026-10-02). It is lit at rest by construction —
    // the console's structure is a light guide — and its cold start is the
    // stylesheet's (`--ignite`), not this curve. Heating it from dark here
    // meant a surface that re-renders its cards (the archive, on every edit)
    // dropped their light and faded it back in over --arm-heat: a dip, every
    // time. A lamp still heats from cold.
    if (!s && enterLit) { s = { level: 1, from: 1, target: 1, t0: t, dur: 0, bez: null }; map.set(el, s); }
    if (!s) { s = { level: 0, from: 0, target: 0, t0: t, dur: 0, bez: null }; map.set(el, s); }
    if (s.target !== 1) begin(s, 1, curve(el, '--arm-heat'), t);
  }
  for (const [el, s] of map) {
    if (set.has(el)) continue;
    if (gain <= 0) { map.delete(el); continue; }
    // Gone from the DOM: an emitter that was still ON is dropped at once (a
    // re-rendered surface replaced it and the light would be stranded at the
    // old node's coordinates). One that was already COOLING keeps cooling
    // from its last box — a toast fades out and leaves, and its light should
    // finish leaving too, not pop.
    if (!el.isConnected && (s.target !== 0 || !s.last)) { map.delete(el); continue; }
    if (s.target !== 0) begin(s, 0, curve(el, '--arm-cool'), t);
  }
  return advanceAll(map, t);
}
/** Every level one frame on; a light that has finished going dark is forgotten. */
function advanceAll(map, t) {
  let moving = false;
  for (const [el, s] of map) {
    s.level = advance(s, t);
    if (s.level !== s.target) moving = true;
    else if (s.target === 0) map.delete(el);
  }
  return moving;
}

/**
 * The box an emitter paints from this frame: read fresh while it is in the
 * DOM (and remembered), or the last one it had while it cools after leaving.
 * Null when there is nothing to paint — no colour, hidden by the breakpoint,
 * or scrolled past the cull margin.
 */
function boxOf(el, s, cull = true) {
  let box = s.last;
  if (el.isConnected) {
    // Not rendered at all (K49): in a hidden view, or in content the browser
    // is SKIPPING (content-visibility: auto, off screen). Asked before the
    // rect, because a rect inside skipped content forces the browser to lay
    // it out — the very work the skip exists to save.
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ contentVisibilityAuto: true })) return null;
    const r = unzoomed(el.getBoundingClientRect());
    // A zero box is a control the breakpoint has hidden — the topbar publish
    // button under 1181px, the tab-bar one over it. Both carry the attribute at
    // once and only one is ever on screen. A seam in a hidden view is the same.
    if (r.width <= 0 || r.height <= 0) return null;
    // Cull BEFORE any style is read (2026-10-02): a grid of card seams is
    // mostly off screen, and the rect is the cheap question. The fixed canvas
    // culls to the viewport; a light LAYER (K49) to its window.
    if (culled(r, cull)) return null;
    // The colour and the corner are facts (K56): read on the first paint of a
    // roster that reaches this element, and kept while only dials move.
    const f = factsOf(el);
    if (f.rgb === undefined) {
      f.rgb = litRgb(el);
      f.radius = f.rgb ? parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 : 0;
    }
    if (!f.rgb) return null;
    box = { r, rgb: f.rgb, radius: f.radius };
    s.last = box;
  }
  if (!box) return null;
  if (culled(box.r, cull)) return null;
  return box;
}
/** Outside what this target draws? `true` is the viewport (and its margin);
 *  a band `{ top, bottom }` (viewport coordinates) is a layer's window. */
function culled(r, cull) {
  if (cull === true) {
    return r.bottom < -CULL_MARGIN || r.top > sized.h + CULL_MARGIN
      || r.right < -CULL_MARGIN || r.left > sized.w + CULL_MARGIN;
  }
  return !!cull && (r.bottom < cull.top || r.top > cull.bottom);
}

// ---- LIGHT LAYERS (K45, 2026-10-04) --------------------------------------
// The owner, on K44 live: the archive "is very choppy" when scrolled, and on a
// phone "the lighting lags behind the objects they are attached to". Measured
// on the owner's own machine (a Chrome trace of a trackpad-path scroll, CPU
// throttled 4× for a phone): 11 dropped frames in two seconds, a 34ms worst
// frame, and ~565ms of the engine's script — all of it redrawing light that
// had not changed, because the fixed canvas repainted on every scroll event.
// And the lag is structural: a real scroll runs on the compositor, so a fixed
// canvas redrawn on the main thread is always at least a frame behind it.
//
// So light that belongs to scrolling content now SCROLLS WITH IT. A host that
// carries `data-light-layer` (a scroller) gets a canvas of its own as its
// child: absolutely positioned at the top of its content, as tall as the
// content, at the emissive buffer's quarter scale and displayed upscaled
// (the same bilinear upscale the fixed composite does). Every emitter inside
// the host is drawn into it once; the compositor carries it on scroll, so a
// scroll costs the light nothing and can never lag. It is repainted only when
// something in it may have changed: a mutation, a resize, a dial moving
// under a hand, the ignition. The substrate is the layer element's CSS mask
// (a periodic tile of the same membrane), because a quarter-scale buffer
// cannot hold a 6px pore.
//
// K49 (2026-10-04, the owner on a phone: "extremely slow", and light that
// ghosts or sits misaligned; "optimized from a longterm (more data)
// perspective"). Three changes keep the layer's cost flat however much
// content there is:
//   • it is a WINDOW, not the whole content: LAYER_WINDOW_BEFORE screens above
//     the viewport to LAYER_WINDOW_AFTER below, re-centred when a scroll
//     brings the viewport within LAYER_EDGE of an edge. A 729-frame buffer is
//     178,000px of content; the old layer was capped at 64,000 and unlit
//     past it, and its cost grew with every frame added;
//   • a dial moving under a hand (or a lamp heating) repaints only the
//     REGION its light reaches (`partial`), from the boxes the last full
//     paint collected — dirty rectangles, so a hover costs the same in a view
//     of ten cards as in one of a thousand;
//   • an emitter HELD IN PLACE over the content (a sticky header, a docked
//     bar: `heldInPlace`) is not the content's — its light belongs to the
//     fixed canvas, or it scrolls away from the thing that makes it.
const LAYER_ATTR = 'data-light-layer';
const LAYER_MAX_H = 16000;      // layer px at quarter scale — a cap on the window, never reached in practice
const LAYER_WINDOW_BEFORE = 1;  // screens of content lit above the viewport…
const LAYER_WINDOW_AFTER = 2;   // …and below it (down is the common direction)
const LAYER_EDGE = 0.5;         // re-window when the viewport comes this close (screens) to an edge
const layers = new Map();       // host → { canvas, g, w, win, scratch, sg, sub, items, origin, band, gain, haze, back }
let layersDirty = true;
const layerPartial = new Set(); // emitters whose region of a layer must be redrawn
let held = new WeakMap();       // emitter → held in place over its layer host (fixed or sticky)?

/** Is this emitter held in place while its host scrolls (K49)? A fixed or
 *  sticky element between it and the host. Cached per element; the cache is
 *  dropped on resize, which is when a breakpoint can change a position. */
function heldInPlace(el, host) {
  let v = held.get(el);
  if (v !== undefined) return v;
  v = false;
  try {
    for (let n = el; n && n !== host; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === 'fixed' || p === 'sticky') { v = true; break; }
    }
  } catch { v = false; }
  held.set(el, v);
  return v;
}
/** The layer host an emitter's light belongs to, or null for the fixed canvas. */
function layerHostOf(el) {
  const h = el.closest ? el.closest(`[${LAYER_ATTR}]`) : null;
  return h && !heldInPlace(el, h) ? h : null;
}
/** The same answer, kept with the emitter's facts (K56): asked of every
 *  emitter every frame, to split the fixed canvas's light from the layers'. */
function hostOf(el) {
  const f = factsOf(el);
  if (f.host === undefined) f.host = layerHostOf(el);
  return f.host;
}

/** The membrane as a PERIODIC tile, for a CSS mask: the engine's lattice turned
 *  by atan(1/3) (18.43°, not 18°) at a pitch of CELL/√10 (6.96px for 22, not
 *  7), which is the one nearby rotation and pitch whose lattice repeats on a
 *  whole-pixel square — SUBSTRATE_CELL device px — so the tile repeats without
 *  a seam. The tile is drawn in device px; `substrateCell()` is the CSS size
 *  it is laid at (K50). */
let poreTile = '';
function substrateTileURL() {
  if (poreTile) return poreTile;
  const P = SUBSTRATE_CELL, a = [0.3 * P, 0.1 * P], b = [-0.1 * P, 0.3 * P], r = SUBSTRATE_PORE;
  const pts = new Set();
  for (let i = -12; i <= 12; i++) for (let j = -12; j <= 12; j++) {
    for (const [ox, oy] of [[0, 0], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]]) {
      const x = ((i * a[0] + j * b[0] + ox) % P + P) % P;
      const y = ((i * a[1] + j * b[1] + oy) % P + P) % P;
      pts.add(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
  }
  let circles = '';
  for (const p of pts) {
    const [x, y] = p.split(',').map(Number);
    for (const dx of [-P, 0, P]) for (const dy of [-P, 0, P]) {
      const cx = x + dx, cy = y + dy;
      if (cx > -r && cx < P + r && cy > -r && cy < P + r) circles += `<circle cx='${cx.toFixed(2)}' cy='${cy.toFixed(2)}' r='${r}'/>`;
    }
  }
  poreTile = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${P}' height='${P}'>${circles}</svg>`)}")`;
  return poreTile;
}
/** The membrane's device ratio: the fixed canvas's (capped at 2, see resize()),
 *  so every copy of the texture is the same texture. */
function substrateDpr() {
  try { return Math.min(2, Math.max(1, (window.devicePixelRatio || 1) * uiZoom())); } catch { return 1; }
}
/** The supercell's size in CSS px — how a tile drawn in device px is laid. */
function substrateCell() {
  return SUBSTRATE_CELL / substrateDpr();
}
/** The engine owns the membrane (K50): the stylesheet's copy — the mask for
 *  a key in a plane and for a plane's air, where the canvas cannot reach —
 *  is written onto the root here, from the same tile, at the same size. */
function writeMembrane() {
  try {
    const st = document.documentElement.style;
    st.setProperty('--substrate-pores', substrateTileURL());
    st.setProperty('--substrate-size', `${+substrateCell().toFixed(3)}px`);
  } catch { /* no root to write: nothing to mask */ }
}

function layerFor(host) {
  let L = layers.get(host);
  if (L && L.canvas.isConnected) return L;
  const c = document.createElement('canvas');
  c.className = 'lighting-layer';
  c.setAttribute('aria-hidden', 'true');
  const g = c.getContext && c.getContext('2d');
  if (!g) return null;
  const scratch = document.createElement('canvas');
  const sg = scratch.getContext('2d');
  host.appendChild(c);
  L = { canvas: c, g, w: 0, win: null, scratch, sg, sub: -1, items: null };
  layers.set(host, L);
  // The content's own size (K49): a view that grows or shrinks without the
  // engine seeing a mutation (an image landing, a font swapping in) moves
  // every light below the change. Each of the host's children is watched,
  // and a change redraws the layer.
  if (typeof ResizeObserver === 'function') {
    const kids = new ResizeObserver(() => lightingRepaintLayers());
    for (const kid of host.children) if (kid !== c) kids.observe(kid);
    L.kids = kids;
  }
  // The window's edges (K49): two invisible markers half a screen inside
  // them, watched by an IntersectionObserver rooted at the host. When a
  // scroll brings one into view the layer is re-windowed — the browser tells
  // us, off the scroll path, so a scroll never has to read the host's
  // geometry (which forces a layout whenever anything has moved).
  if (typeof IntersectionObserver === 'function') {
    L.marks = [0, 1].map(() => {
      const m = document.createElement('div');
      m.className = 'lighting-mark';
      m.setAttribute('aria-hidden', 'true');
      Object.assign(m.style, { position: 'absolute', left: '0', width: '1px', height: '1px', pointerEvents: 'none', visibility: 'hidden', display: 'none' });
      host.appendChild(m);
      return m;
    });
    L.io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting && e.target.style.display !== 'none')) lightingRepaintLayers();
    }, { root: host });
    for (const m of L.marks) L.io.observe(m);
  }
  return L;
}

/** The stretch of content a layer lights, in content px (K49). */
function layerWindow(host, content = host.scrollHeight) {
  const ch = Math.max(1, host.clientHeight || 0);
  const H = Math.max(1, content || 0);
  // Never past the content's end (K52b): a scroll left there by a longer
  // surface would put the window, and its markers, beyond the content, and
  // they would hold that length open.
  const top = Math.min(host.scrollTop || 0, Math.max(0, H - ch));
  const t = Math.max(0, Math.floor(top - LAYER_WINDOW_BEFORE * ch));
  const b = Math.min(H, Math.ceil(top + ch + LAYER_WINDOW_AFTER * ch));
  return { top: t, bottom: Math.max(t + 1, b) };
}
/** Has a scroll brought the viewport near the edge of what the layer lights? */
function layerNeedsWindow(host, L) {
  if (!L || !L.win) return false;
  const ch = host.clientHeight || 0, top = host.scrollTop || 0;
  return (L.win.top > 0 && top < L.win.top + LAYER_EDGE * ch)
    || (L.win.bottom < (host.scrollHeight || 0) && top + ch > L.win.bottom - LAYER_EDGE * ch);
}

/** How far the host's CONTENT reaches: the bottom of its lowest child, never
 *  counting the layer's own canvas or its window markers (K52b). Read, not
 *  written-then-read: K51 zeroed the canvas's height and read scrollHeight,
 *  which still counted the canvas's old TOP and the markers' (a zero-height
 *  box at y still reaches y). After a switch from a long surface to a short
 *  one that held the old length open, so the scroll stayed past the end of the
 *  new content and the window re-centred on it. K52 hid the canvas and the
 *  markers before measuring instead, which re-laid out the whole scroller on
 *  every resize of the layer, the Archive's grid included, on every touch:
 *  felt on a phone. Offsets cost one layout, the one any measure costs. With
 *  no layout to read (a test's mock), the scroller's own height stands in. */
function contentHeight(host, L) {
  let H = 0;
  for (const kid of host.children) {
    if (kid === L.canvas || (L.marks && L.marks.includes(kid))) continue;
    const b = (kid.offsetTop || 0) + (kid.offsetHeight || 0);
    if (b > H) H = b;
  }
  return H > 0 ? H : (host.scrollHeight || 0);
}

/** An inline style the engine alone writes, written only when it differs
 *  (K56): an unchanged write still dirties the style, and the next read in the
 *  frame pays for it. Whole-pixel lengths and keywords read back as written. */
function restyle(el, prop, v) {
  if (el.style[prop] !== v) el.style[prop] = v;
}

/** Size and place the layer over its window, without the layer itself counting. */
function sizeLayer(host, L) {
  const w = Math.max(1, host.clientWidth);
  // The room is at least the pane (K73, the owner: "the bottom 5th of the
  // background is missing … when i had multiple items in the trash and
  // deleted them"): a surface shorter than the pane still stands in a lit
  // room, down to the pane's floor. Never taller than what is there, so it
  // holds no scroll open (the canvas's own height is held to its window).
  const H = Math.max(contentHeight(host, L), host.clientHeight || 0);
  const win = layerWindow(host, H);
  const bw = Math.max(1, Math.round(w * EM_SCALE));
  const bh = Math.max(1, Math.min(LAYER_MAX_H, Math.round((win.bottom - win.top) * EM_SCALE)));
  restyle(L.canvas, 'width', `${w}px`);
  restyle(L.canvas, 'height', `${Math.min(Math.round(bh / EM_SCALE), win.bottom - win.top)}px`);
  restyle(L.canvas, 'top', `${win.top}px`);
  if (L.canvas.width !== bw || L.canvas.height !== bh) { L.canvas.width = bw; L.canvas.height = bh; }
  L.w = w; L.win = win;
  if (L.marks) {
    const ch = host.clientHeight || 0;
    const [top, bottom] = L.marks;
    restyle(top, 'display', win.top > 0 ? '' : 'none');
    restyle(top, 'top', `${Math.round(win.top + LAYER_EDGE * ch)}px`);
    restyle(bottom, 'display', win.bottom < H ? '' : 'none');
    restyle(bottom, 'top', `${Math.max(0, Math.round(win.bottom - LAYER_EDGE * ch))}px`);
  }
}

/** The membrane on a canvas: its CSS mask, set when the dial changes (a
 *  layer's since K49; the fixed canvas's since K78). `T` keeps what was set. */
function maskCanvas(T, el) {
  const sub = setting('sub', substrateGain);
  const cell = substrateCell();
  if (T.sub === sub && T.cell === cell) return;
  T.sub = sub; T.cell = cell;
  const st = el.style;
  if (sub <= 0) { st.maskImage = st.webkitMaskImage = ''; return; }
  const floor = (1 - sub * SUBSTRATE_DEPTH).toFixed(3);
  const img = `${substrateTileURL()}, linear-gradient(rgba(0,0,0,${floor}), rgba(0,0,0,${floor}))`;
  st.maskImage = st.webkitMaskImage = img;
  st.maskSize = st.webkitMaskSize = `${+cell.toFixed(3)}px ${+cell.toFixed(3)}px, 100% 100%`;
  st.maskRepeat = st.webkitMaskRepeat = 'repeat, no-repeat';
}
const maskLayer = (L) => maskCanvas(L, L.canvas);
const fixedMask = {};

// ---- THE SPILL (K54, 2026-10-05) ------------------------------------------
// The owner, on the phone and the iPad: the top row "shouldn't just be a hard
// edge. Light coming up from the interface beneath it should organically
// emit/bleed/seep into this bar … the soft edges of atmospheric haze … I
// wouldn't expect the very top edge of that bar to be lit, rather an organic
// soft roll off to black." The content's light lives in its layer, INSIDE the
// scroller, and a scroller clips: the haze stopped dead at the scroller's top,
// under a row that floats over plain black.
//
// So a host that carries `data-light-spill` lets its light out of its top
// edge. A small fixed canvas fills the space above the host (the top row and
// the safe area over it). Each update it takes the ROW of light at the host's
// visible top edge (one quarter-scale row of the layer, the light that is
// actually there) and stretches it up to the top of the screen. Every column
// rises from what lies beneath it: bright over a lit panel, dark over a gap.
// The light is then rolled off to black toward the top on an eased curve
// (`destination-in` a vertical gradient). It is drawn at an EIGHTH of CSS
// pixels and upscaled, which is the softness and nearly all of the economy.
// It wears the layer's membrane and its exposure, and fades in with it, so
// the light above the edge is the same light as below it. Cost per update:
// one drawImage of a strip a few hundred pixels wide into a buffer of about
// 150×10, and one gradient fill. A scroll of the host updates it once per
// frame; the layer itself still moves for free. `--spill-gain` (0..1) on the
// root is the dial: 0 (the desk, paper) removes the canvas from the page.
const SPILL_ATTR = 'data-light-spill';
const SPILL_SCALE = EM_SCALE / 2;
/** The eased roll-off, top (black) to the host's edge (the light as it is). */
const SPILL_FADE = [[0, 0], [0.3, 0.04], [0.55, 0.16], [0.75, 0.4], [0.9, 0.72], [1, 1]];
function spillOf(host, L) {
  if (!host.hasAttribute?.(SPILL_ATTR)) return null;
  if (L.spill && L.spill.canvas.isConnected) return L.spill;
  const c = document.createElement('canvas');
  c.className = 'lighting-spill';
  c.setAttribute('aria-hidden', 'true');
  const g = c.getContext && c.getContext('2d');
  if (!g) return null;
  document.body.appendChild(c);
  L.spill = { canvas: c, g, rect: null, fadeH: 0, fade: null, sub: -1 };
  return L.spill;
}
/** Paint the spill above a host from what its layer holds at its top edge. */
function drawSpill(host, L) {
  const gain = setting('spill', () => rootNum('--spill-gain', 0, 0, 1));
  const S = gain > 0 ? spillOf(host, L) : L.spill;
  if (!S) return;
  const st = S.canvas.style;
  if (gain <= 0 || !L.win || !host.isConnected) { if (st.display !== 'none') st.display = 'none'; return; }
  if (!S.rect) {
    // Read once, and again only after a resize: never on the scroll path.
    const r = unzoomed(host.getBoundingClientRect());
    S.rect = { left: r.left + (host.clientLeft || 0), top: r.top + (host.clientTop || 0), width: host.clientWidth || r.width };
  }
  const { left, top, width } = S.rect;
  if (top < 2 || width < 1) { if (st.display !== 'none') st.display = 'none'; return; }
  const bw = Math.max(1, Math.round(width * SPILL_SCALE));
  const bh = Math.max(1, Math.round(top * SPILL_SCALE));
  if (S.canvas.width !== bw || S.canvas.height !== bh) {
    S.canvas.width = bw; S.canvas.height = bh;
    Object.assign(st, { left: `${left}px`, top: '0px', width: `${width}px`, height: `${top}px` });
  }
  const g = S.g;
  g.clearRect(0, 0, bw, bh);
  const row = Math.floor(((host.scrollTop || 0) - L.win.top) * EM_SCALE);
  if (row >= 0 && row < L.canvas.height) {
    g.globalAlpha = gain;
    g.drawImage(L.canvas, 0, row, L.canvas.width, 1, 0, 0, bw, bh);
    g.globalAlpha = 1;
    if (S.fadeH !== bh) {
      const grad = g.createLinearGradient(0, 0, 0, bh);
      for (const [at, a] of SPILL_FADE) grad.addColorStop(at, `rgba(0,0,0,${a})`);
      S.fade = grad; S.fadeH = bh;
    }
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = S.fade;
    g.fillRect(0, 0, bw, bh);
    g.globalCompositeOperation = 'source-over';
  }
  // The layer's membrane and exposure, so the two read as one light.
  if (S.sub !== L.sub) {
    S.sub = L.sub;
    const ls = L.canvas.style;
    st.maskImage = st.webkitMaskImage = ls.maskImage || ls.webkitMaskImage || '';
    st.maskSize = st.webkitMaskSize = ls.maskSize || ls.webkitMaskSize || '';
    st.maskRepeat = st.webkitMaskRepeat = ls.maskRepeat || ls.webkitMaskRepeat || '';
  }
  if (st.opacity !== L.canvas.style.opacity) st.opacity = L.canvas.style.opacity;
  if (st.display !== 'block') st.display = 'block';
}
/** Every host that spills, after its layer may have changed. */
function drawSpills() {
  for (const [host, L] of layers) if (L.spill || host.hasAttribute?.(SPILL_ATTR)) drawSpill(host, L);
}
let spillQueued = 0;
/** A host's scroll moves what lies at its edge: one spill per frame, no more. */
function spillOnScroll(host) {
  const L = layers.get(host);
  if (!L || !(L.spill || host.hasAttribute?.(SPILL_ATTR)) || spillQueued) return;
  spillQueued = requestAnimationFrame(() => { spillQueued = 0; drawSpill(host, L); });
}

/** Where window coordinates start, in viewport coordinates, right now. */
function layerOrigin(host, L) {
  const hr = unzoomed(host.getBoundingClientRect());
  const ox = hr.left + host.clientLeft - host.scrollLeft;
  const oy = hr.top + host.clientTop - host.scrollTop + (L.win ? L.win.top : 0);
  const span = L.win ? L.win.bottom - L.win.top : Math.max(1, host.scrollHeight || 0);
  return { origin: { ox, oy }, band: { top: oy - CULL_MARGIN, bottom: oy + span + CULL_MARGIN } };
}

/** The whole layer: size it to its window, collect what lands there, draw. */
function paintLayer(host, list, gain, haze, back = 1) {
  const L = layerFor(host);
  if (!L) return;
  sizeLayer(host, L);
  maskLayer(L);
  const g = L.g;
  g.clearRect(0, 0, L.canvas.width, L.canvas.height);
  L.items = null;
  if (!list.length || gain <= 0) return;
  // Window coordinates: the host's padding box at scroll 0 (where an
  // absolutely positioned child of a scroller sits), less the window's top.
  const { origin, band } = layerOrigin(host, L);
  const set = new Set(list);
  const { boxes, backs } = collect(list, (el) => set.has(el), origin, band, back);
  L.items = { boxes, backs };
  Object.assign(L, { gain, haze, back });
  if (!boxes.length && !backs.length) { setExposure(L, 1); return; }
  drawLight(g, L.canvas, boxes, backs, haze);
  layerGain(L, gain, null);
  // Not while the cold start flares (K50c): the band's mean swings with the
  // flare and the exposure would chase it; the first read after the flare
  // settles is the surface's own.
  // …nor while a lamp IN the room is on a journey (K54b): the eye adapts to
  // the room, not to a lamp being lit in it.
  if (!igniting() && !journeying(host)) setExposure(L, layerExposure(host, L));
}

// ---- EYE ADAPTATION (K50, 2026-10-04) --------------------------------------
// The owner: "some of the ambient lighting when switching surfaces changes
// drastically enough that eyes have to adjust, which breaks concentration".
// Measured on the real buffer and archive: the content's light ranged 1.2
// (FN) to 2.85 (Publish) on one scale — Publish has panels where the buffer
// has photographs — and the step was taken in one frame. A room does not do
// that to an eye; an eye does it to a room, slowly. So the engine adapts the
// way the eye would: after a layer is painted it reads the mean light in the
// band on screen (one getImageData of the quarter buffer, ~80k pixels), sets
// the layer's EXPOSURE toward a reference, and glides there on --arm-cool —
// the opacity of the layer element, so the glide costs no repaint. A view
// arrives at the last view's brightness and settles into its own. The engine
// only ever brings a bright surface DOWN toward the quiet ones (the exposure
// is ≤ 1): a dim surface is not lifted, because light that is not there
// cannot be amplified without amplifying its noise. `--light-adapt` on the
// root is the strength: 0 is off and byte-identical to K49.
const ADAPT_REF = 2.2;    // the reference (0..255 luma × alpha, log-average): the quiet surfaces' own level, measured 2026-10-04 (1.7–1.8)
const ADAPT_MIN = 0.5;    // the floor: a surface is never dimmed past this share of itself (the brightest surfaces sit here)
const ADAPT_EPS = 1;      // the log-average's offset, so black pixels count as black and not as -∞
/** The light in the band on screen, as the eye weighs it: the LOG-AVERAGE
 *  luminance (the geometric mean, the measure HDR eye adaptation uses), so a
 *  few bright panels do not stand for the whole room — the ambient is what
 *  most of the field is doing, not what its brightest object is. Every other
 *  pixel of the quarter buffer is read; the result is in 0..255 luma × alpha. */
/** The band's pixels, read WITHOUT reading the light canvas (K54b). Chrome
 *  counts getImageData on a canvas and, past a few, moves it off the GPU, so
 *  every draw into it gets slower from then on. It said so in the console
 *  ("Multiple readback operations using getImageData are faster with the
 *  willReadFrequently attribute"), at about six reads per surface switch,
 *  and the owner felt it as "the ignition sequence ends up slowing down
 *  after 1 or 2 clicks". So the band is copied 1:1 into one small probe
 *  canvas made for reading (`willReadFrequently`), and THAT is read: the
 *  same pixels and the same mean, while the light canvas stays on the GPU.
 *  Where no probe can be made (a test's mock), the layer is read as before. */
let probe = null;
function readBand(L, top, h) {
  const w = L.canvas.width;
  if (probe === null) {
    try {
      const c = document.createElement('canvas');
      const g = c.getContext && c.getContext('2d', { willReadFrequently: true });
      probe = g && typeof g.getImageData === 'function' ? { c, g } : false;
    } catch { probe = false; }
  }
  if (!probe) return L.g.getImageData(0, top, w, h).data;
  if (probe.c.width < w || probe.c.height < h) { probe.c.width = Math.max(probe.c.width, w); probe.c.height = Math.max(probe.c.height, h); }
  probe.g.clearRect(0, 0, w, h);
  probe.g.drawImage(L.canvas, 0, top, w, h, 0, 0, w, h);
  return probe.g.getImageData(0, 0, w, h).data;
}
function layerMean(host, L) {
  if (!L.win || typeof L.g.getImageData !== 'function') return 0;
  const top = Math.max(0, Math.round(((host.scrollTop || 0) - L.win.top) * EM_SCALE));
  const h = Math.min(L.canvas.height - top, Math.max(1, Math.round((host.clientHeight || 0) * EM_SCALE)));
  if (h <= 0 || L.canvas.width <= 0) return 0;
  let d;
  try { d = readBand(L, top, h); } catch { return 0; }
  if (!d || !d.length) return 0;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 8) {
    sum += Math.log(ADAPT_EPS + (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * d[i + 3] / 255);
    n++;
  }
  return n ? Math.exp(sum / n) - ADAPT_EPS : 0;
}
/** The exposure a layer should sit at, from the light in the band on screen. */
function layerExposure(host, L) {
  const k = setting('adapt', () => rootNum('--light-adapt', 0, 0, 1));
  if (k <= 0) return 1;
  const mean = layerMean(host, L);
  if (!(mean > 0)) return 1;
  return Math.max(ADAPT_MIN, Math.min(1, (ADAPT_REF / mean) ** k));
}
/** Point a layer's exposure at a target. The first one is where it starts
 *  (no journey for a layer never seen before). After that: a surface that
 *  has just ARRIVED (its view entered within ADAPT_ARRIVE_MS) and would be
 *  brighter than it will settle at jumps straight to its target — the engine
 *  never flashes a room bright and then closes down, which is the very
 *  adjustment the eye was being asked to make; everything else glides on
 *  the root's --arm-cool, and paint() carries it frame by frame. So a dark
 *  surface after a bright one emerges (the eye opening), and a bright one
 *  after a dark one arrives already adapted. */
const ADAPT_ARRIVE_MS = 600;
function setExposure(L, target) {
  const t = now();
  if (!L.expo) {
    L.expo = { level: target, from: target, target, t0: t, dur: 0, bez: null };
    applyExposure(L);
    return;
  }
  if (L.expo.target === target) return;
  if (target < L.expo.level && L.entered && t - L.entered < ADAPT_ARRIVE_MS) {
    Object.assign(L.expo, { level: target, from: target, target, t0: t, dur: 0, bez: null });
    applyExposure(L);
    return;
  }
  let cv = { ms: 0, bez: null };
  try { cv = curve(document.documentElement, '--arm-cool'); } catch { /* no curve: jump */ }
  begin(L.expo, target, cv, t);
}
function applyExposure(L) {
  const v = (L.expo ? L.expo.level : 1) * Math.min(1, room);
  // Kept as written (K56): an opacity reads back normalised ('0.730' as
  // '0.73'), so the comparison is with the last value set, not the style.
  const o = v >= 0.999 ? '' : v.toFixed(3);
  if (L.opacity === o) return;
  L.opacity = o;
  L.canvas.style.opacity = o;
  if (L.spill) L.spill.canvas.style.opacity = o;   // K54: one light, one exposure
}
/** The room's ignition on the canvases (K64): the fixed one's opacity, and
 *  each layer's exposure, which multiplies it in (applyExposure). */
let roomOpacity = '';
function applyRoom() {
  const o = room >= 0.999 ? '' : Math.min(1, room).toFixed(3);
  if (canvas && roomOpacity !== o) { roomOpacity = o; canvas.style.opacity = o; }
  for (const [, L] of layers) applyExposure(L);
}
/** Advance every gliding exposure; true while any is still moving. */
function advanceExposures(t) {
  let moving = false;
  for (const [, L] of layers) {
    const s = L.expo;
    if (!s || s.level === s.target) continue;
    s.level = advance(s, t);
    applyExposure(L);
    if (s.level !== s.target) moving = true;
  }
  return moving;
}

/** One region of a layer (K49): the emitters in `els` are re-read (their dial
 *  moved, nothing else did), and the region their old and new light covers is
 *  cleared and redrawn from everything that reaches into it. */
function paintLayerPartial(host, els) {
  const L = layers.get(host);
  if (!L || !L.items || !L.win) return false;
  const { origin, band } = layerOrigin(host, L);
  const fresh = collect([...els], (el) => els.has(el), origin, band, L.back);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (it) => { if (!it.ext) return; x0 = Math.min(x0, it.ext.l); y0 = Math.min(y0, it.ext.t); x1 = Math.max(x1, it.ext.r); y1 = Math.max(y1, it.ext.b); };
  const keep = (arr) => arr.filter((it) => { if (els.has(it.el)) { grow(it); return false; } return true; });
  const boxes = keep(L.items.boxes), backs = keep(L.items.backs);
  for (const it of fresh.boxes) { grow(it); boxes.push(it); }
  for (const it of fresh.backs) { grow(it); backs.push(it); }
  L.items = { boxes, backs };
  if (x0 === Infinity) return true;
  const W = L.canvas.width, H = L.canvas.height;
  const cx = Math.max(0, Math.floor(x0 * EM_SCALE) - 2), cy = Math.max(0, Math.floor(y0 * EM_SCALE) - 2);
  const clip = { x: cx, y: cy, w: Math.min(W, Math.ceil(x1 * EM_SCALE) + 2) - cx, h: Math.min(H, Math.ceil(y1 * EM_SCALE) + 2) - cy };
  if (clip.w <= 0 || clip.h <= 0) return true;
  drawLight(L.g, L.canvas, boxes, backs, L.haze, clip);
  layerGain(L, L.gain, clip);
  return true;
}

/** Gain, the fixed composite's arithmetic on the buffer itself: the first
 *  pass is what is already drawn; each further pass adds what the last left
 *  room for (1-(1-a)^N), through a scratch copy — of the region only, on a
 *  partial repaint. */
function layerGain(L, gain, clip) {
  if (gain === 1) return;
  const g = L.g, s = L.scratch;
  if (s.width !== L.canvas.width || s.height !== L.canvas.height) { s.width = L.canvas.width; s.height = L.canvas.height; }
  const x = clip ? clip.x : 0, y = clip ? clip.y : 0;
  const w = clip ? clip.w : L.canvas.width, h = clip ? clip.h : L.canvas.height;
  L.sg.clearRect(x, y, w, h);
  L.sg.drawImage(L.canvas, x, y, w, h, x, y, w, h);
  if (gain < 1) {
    g.clearRect(x, y, w, h);
    g.globalAlpha = gain;
    g.drawImage(s, x, y, w, h, x, y, w, h);
  } else {
    for (let left = gain - 1; left > 0.004; left -= 1) {
      g.globalAlpha = Math.min(1, left);
      g.drawImage(s, x, y, w, h, x, y, w, h);
    }
  }
  g.globalAlpha = 1;
}

/** Every box a target draws, in that target's coordinates, each with its
 *  element and its EXTENT — how far its light reaches — so a partial repaint
 *  (K49) knows what a region holds. `back` scales every backlight (the
 *  content's light profile). */
function collect(live, inTarget, origin, cull, back = 1) {
  const shift = (r) => (origin
    ? { left: r.left - origin.ox, top: r.top - origin.oy, width: r.width, height: r.height,
      right: r.right - origin.ox, bottom: r.bottom - origin.oy }
    : r);
  const boxes = [];
  for (const [el, s] of thermal) {
    if (s.level <= 0 || !inTarget(el)) continue;
    const box = boxOf(el, s, cull);
    if (!box) continue;
    const r = shift(box.r);
    // The area law: the same light, spread over a panel, is dimmer. And the
    // surface's own dial: `--lit-level` (0..1, default 1), read at paint time
    // like everything else, so a resting lamp can be quiet by one token.
    const area = Math.max(1, r.width * r.height);
    const level = s.level * litLevel(el)
      * Math.max(AREA_FLOOR, Math.min(1, Math.sqrt(AREA_REF / area)));
    boxes.push({ el, r, rgb: box.rgb, level, pool: level, radius: box.radius, seam: false, out: null, boost: boostOf(el), ext: reach(r, POOL_BASE + Math.min(r.width, r.height) * POOL_SHARE) });
  }
  for (const [el, s] of seams) {
    if (s.level <= 0 || !inTarget(el)) continue;
    const box = boxOf(el, s, cull);
    if (!box) continue;
    // A seam is a line source: the strips along the named edge, at the seam's
    // own dial, its pool a filament's share of a lamp's. No area law — a strip
    // is thin by construction — and no radius: the light leaves a line, not a
    // box. The haze takes the whole level: a seam's far field is what fills
    // the room, and it is the same light however tight its halo.
    const level = s.level * seamLevel(el);
    const boost = boostOf(el);
    for (const r of seamStrips(shift(box.r), factsOf(el).edge)) {
      boxes.push({ el, r, rgb: box.rgb, level, pool: level * SEAM_POOL, radius: 0, seam: true, out: r.out, boost, ext: reach(r, POOL_BASE + Math.min(r.width, r.height) * POOL_SHARE) });
    }
  }
  // The backlights (K44): they enter lit (no journey); a host that changes its
  // level under a hand transitions its registered --backlight, and dialing()
  // keeps the frames for exactly that long.
  const backs = [];
  for (const el of live) {
    const f = factsOf(el);
    if (!f.backlit || !inTarget(el)) continue;
    const level = dial(el, '--backlight') * back;
    if (level <= 0) continue;
    const box = boxOf(el, {}, cull);
    if (!box) continue;
    const r = shift(box.r);
    // The backlight's shape is a fact (K56); its level, the dial, is not.
    const b = f.back || (f.back = {
      overhang: num(el, '--backlight-overhang', BACKLIGHT_DEFAULTS.overhang, 0, 120),
      soft: Math.round(num(el, '--backlight-soft', BACKLIGHT_DEFAULTS.soft, 2, 160)),
      y: num(el, '--backlight-y', BACKLIGHT_DEFAULTS.y, -1, 1),
      haze: num(el, '--backlight-haze', 1, 0, BOOST_CEIL),
    });
    const { overhang, soft, y } = b;
    backs.push({
      el, r, rgb: box.rgb, level, radius: box.radius, overhang, soft, y,
      haze: b.haze,
      ext: reach(r, overhang + Math.ceil(soft * 1.6) + 2 + Math.abs(y) * r.height),
    });
  }
  return { boxes, backs };
}
/** A box grown by the farthest its light (or its haze) can land. */
function reach(r, pad) {
  const p = Math.max(pad, HAZE_MARGIN);
  return { l: r.left - p, t: r.top - p, r: r.left + r.width + p, b: r.top + r.height + p };
}

/** Draw a target's light into a quarter-scale buffer: backlights, then pools
 *  and their haze, all additive; then the dither. */
function drawLight(g, buf, boxes, backs, haze, clip = null) {
  // A partial repaint (K49) clears and redraws one region and leaves the
  // rest of the buffer as it was; everything whose light reaches into the
  // region is drawn again, clipped to it, so it adds up exactly as before.
  if (clip) {
    g.save();
    if (typeof g.clip === 'function') { g.beginPath(); g.rect(clip.x, clip.y, clip.w, clip.h); g.clip(); }
    g.clearRect(clip.x, clip.y, clip.w, clip.h);
  } else {
    g.clearRect(0, 0, buf.width, buf.height);
  }
  const meets = (it) => !clip || !it.ext || (it.ext.r * EM_SCALE >= clip.x && it.ext.l * EM_SCALE <= clip.x + clip.w
    && it.ext.b * EM_SCALE >= clip.y && it.ext.t * EM_SCALE <= clip.y + clip.h);
  // A sprite is baked at a quantised size and drawn stretched to the exact
  // box (K49, spriteSize): `put` places one from its margin R.
  const put = (sp, x, y, w, h) => g.drawImage(sp.c, (x - sp.R) * EM_SCALE, (y - sp.R) * EM_SCALE,
    (w + 2 * sp.R) * EM_SCALE, (h + 2 * sp.R) * EM_SCALE);
  g.globalCompositeOperation = 'lighter';
  for (const b of backs) {
    if (!meets(b)) continue;
    const area = Math.max(1, b.r.width * b.r.height);
    const law = Math.max(AREA_FLOOR, Math.min(1, Math.sqrt(AREA_REF / area)) ** BACKLIGHT_LAW);
    const w = Math.round(b.r.width + 2 * b.overhang), h = Math.round(b.r.height + 2 * b.overhang);
    const qw = spriteSize(w), qh = spriteSize(h);
    const dy = b.y * b.r.height;
    const x = b.r.left - b.overhang, y = b.r.top - b.overhang + dy;
    if (haze > 0 && b.haze > 0) {
      const hz = hazeSprite(qw, qh, b.rgb);
      if (hz) {
        g.globalAlpha = Math.min(1, b.level * b.haze * (haze / HAZE_MAX) ** 2);
        put(hz, x, y, w, h);
      }
    }
    const sp = backlightSprite(qw, qh, Math.round(b.radius + b.overhang * 0.6), b.soft, b.rgb);
    if (!sp) continue;
    g.globalAlpha = Math.min(1, b.level * law);
    put(sp, x, y, w, h);
  }
  // 1 — the emissive buffer. `lighter` is the whole reason for a separate
  //     buffer: two emitters near each other must ADD, the way two lamps do,
  //     not paint one over the other. Each pool is its baked sprite, drawn at
  //     the emitter's level — so a heating lamp is the same light, dimmer.
  //     And each casts its haze (K41): the same sprite idea at a far reach,
  //     drawn at the room's dial, so the negative space fills with the SUM
  //     of what every emitter gives off, and nothing else.
  for (const it of boxes) {
    if (!meets(it)) continue;
    const { r, rgb, level, pool, radius, seam, out, boost } = it;
    const w = Math.round(r.width), h = Math.round(r.height);
    const qw = spriteSize(w), qh = spriteSize(h);
    if (haze > 0) {
      const hz = hazeSprite(qw, qh, rgb, seam, out);
      if (hz) {
        g.globalAlpha = Math.min(1, level * boost * (haze / HAZE_MAX) ** 2);
        put(hz, r.left, r.top, w, h);
      }
    }
    const sp = sprite(qw, qh, Math.round(radius), rgb, seam);
    if (!sp) continue;
    g.globalAlpha = Math.min(1, pool);
    put(sp, r.left, r.top, w, h);
  }
  g.globalAlpha = 1;
  // 1b — the dither, only where there is light (and only in the region).
  const tile = noiseTile();
  if (tile) {
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = DITHER_ALPHA;
    const x0 = clip ? clip.x : 0, y0 = clip ? clip.y : 0;
    const x1 = clip ? clip.x + clip.w : buf.width, y1 = clip ? clip.y + clip.h : buf.height;
    const ox = x0 - Math.floor(Math.random() * NOISE_S);
    const oy = y0 - Math.floor(Math.random() * NOISE_S);
    for (let y = oy; y < y1; y += NOISE_S) {
      for (let x = ox; x < x1; x += NOISE_S) g.drawImage(tile, x, y);
    }
    g.globalAlpha = 1;
  }
  g.globalCompositeOperation = 'source-over';
  if (clip) g.restore();
}

/** The emitters whose light a layer host draws, grouped once per roster (K56):
 *  a full layer paint used to filter the whole list once per host. */
function onHost(host) {
  if (!roster) return [];
  if (!roster.byHost) {
    roster.byHost = new Map();
    for (const el of roster.live) {
      const h = hostOf(el);
      if (h) (roster.byHost.get(h) || roster.byHost.set(h, []).get(h)).push(el);
    }
  }
  return roster.byHost.get(host) || [];
}

/** One frame. Cheap enough to be called from a scroll handler; called from one. */
function paint() {
  if (!ctx || !emx) return;
  // The fixed canvas is redrawn only when something on it may have changed
  // (K49): a hover in the content, or a lamp heating in it, repaints a region
  // of a layer and leaves the chrome's light — and its full-resolution
  // composite — alone.
  const doFixed = resize() || fixedDirty;
  fixedDirty = false;
  if (doFixed) ctx.clearRect(0, 0, canvas.width, canvas.height);

  const gain = setting('gain', bloomGain);
  const haze = setting('haze', hazeGain);
  // The licence is re-read only when the document may have changed (a
  // mutation, a resize, the theme: every full repaint); a frame that only
  // advances a level reuses the last list (K49).
  if (gain > 0 && !liveCache) { liveCache = emitters(); rosterGen++; }
  // …and split once per roster (K56): which are lamps, which are seams,
  // whether any is a backlight. A frame that only moves a dial asks none of
  // it again.
  const on = gain > 0;
  if (!roster || roster.gen !== rosterGen || roster.on !== on) {
    const all = on ? liveCache.filter((el) => el.isConnected) : [];
    roster = {
      gen: rosterGen, on, live: all,
      lit: all.filter((el) => factsOf(el).lit),
      seam: all.filter((el) => factsOf(el).edge !== null),
      anyBack: all.some((el) => factsOf(el).backlit),
    };
  // Re-point the size observer here rather than from the mutation callback:
  // `childList` on the whole body fires for every render in the console, and
  // a document-wide querySelectorAll per batch is a real cost on a grid of
  // several hundred frames. The frame already knows who is lit.
  //
  // ⚠️ Only the CHANGE in that set may touch the observer (2026-09-24). A
  // ResizeObserver delivers an initial notification for every `observe()` —
  // by spec, not by accident — so `disconnect()` + re-observe every paint
  // meant: paint → observe → "here is its size" → repaint → observe → … one
  // frame after another, for as long as anything was lit. Headless Chromium
  // measured 120 rAF callbacks in two idle seconds with one emitter and 0
  // with none — a 60fps loop hiding behind the promise of "event-driven",
  // running whenever work was waiting to publish, which is nearly always.
    observeSizes(all);
  }
  const { live } = roster;
  const t = now();
  // The room's ignition, once for the frame (K64), into every exposure.
  const was = room;
  room = roomIgnite();
  if (room !== was) applyRoom();
  // Two licences, two thermal maps (K41): an element can be a seam AND go hot
  // — the bay — and its fill must still heat from dark while its edge is
  // already lit. One level per element would make the fill pop on at 1.
  const movingLit = reconcile(thermal, roster.lit, gain, t);
  const movingSeam = reconcile(seams, roster.seam, gain, t, true);
  // While the ignition runs, the dials themselves are moving (K41b): keep the
  // frames coming so the pools follow the cores, and park when it is over.
  // …and while a seam's own dial is moving (2026-10-02): a card under the
  // pointer lifts its `--seam-level` on a CSS transition (the property is
  // registered, so it interpolates), and its pool must rise WITH its rim —
  // the curve is the stylesheet's, read here frame by frame like --ignite.
  // …and while a layer's exposure glides (K50): a style write per frame, no
  // repaint, for the length of --arm-cool after a surface changes.
  const movingExpo = advanceExposures(t);
  inFlight = movingLit || movingSeam || movingExpo || (gain > 0 && (igniting() || dialing()));
  if (!thermal.size && !seams.size && !roster.anyBack) {
    if (layersDirty) { layersDirty = false; for (const [, L] of layers) { L.g.clearRect(0, 0, L.canvas.width, L.canvas.height); L.items = null; if (L.spill) L.spill.g.clearRect(0, 0, L.spill.canvas.width, L.spill.canvas.height); } }
    layerPartial.clear();
    return;
  }

  // Two targets since K45. The FIXED canvas lights what does not scroll (the
  // chrome, and since K49 whatever is held in place over the content); each
  // LIGHT LAYER lights what scrolls inside its host, in a canvas that scrolls
  // WITH that content. Partition first, then each target collects its own
  // boxes and draws them.
  const fixedOnly = (el) => !hostOf(el);
  const fixed = doFixed ? collect(live, fixedOnly, null, true) : { boxes: [], backs: [] };
  if (fixed.boxes.length || fixed.backs.length) {
    drawLight(emx, em, fixed.boxes, fixed.backs, haze);
    // 2 — upscale onto the page, once per unit of gain.
    //
    // ⚠️ NOT `globalAlpha = gain`. The canvas spec CLAMPS globalAlpha to [0,1],
    // so that spelling made every value above 1 a silent no-op — the dial looked
    // like it worked and did nothing, which is the worst kind of knob. Gain is
    // spent as repeated composites instead: each pass adds what the last one left
    // room for, so N passes at alpha a resolve to 1-(1-a)^N. That lifts the faint
    // outer tail almost linearly while the core saturates, which is how a
    // brighter lamp actually reads — not a flat multiply that would just clip the
    // middle. At gain ≤ 1 this is one pass at `alpha = gain`: byte-identical to
    // what shipped.
    for (let left = gain; left > 0.004; left -= 1) {
      ctx.globalAlpha = Math.min(1, left);
      ctx.drawImage(em, 0, 0, canvas.width, canvas.height);
    }
    ctx.globalAlpha = 1;

    // 3 — the substrate (K41e): the light, through the membrane. A mask on
    //     the composited light's alpha, at full resolution, so the pores are
    //     crisp and the ground where nothing lands is untouched; none at
    //     gain 0. The canvas's CSS mask since K78, laid by the compositor: as
    //     a pattern filled over the whole canvas on each repaint it was every
    //     slow frame of Safari's cold start (WebKit fills a pattern tile by
    //     tile on the CPU, 100,000 tiles at 2×; skipping it alone took the
    //     ignition from 42 ms a frame to 17).
    maskCanvas(fixedMask, canvas);
    // (No punch-out since K40b: the light is under the glass, and what lies
    //  over the emitter's own box is the control, transmitting or not.)
  }

  // The layers. Repainted only when something IN them may have changed —
  // never for a scroll of their own host, which moves them for free (unless
  // the scroll nears the edge of the window they light). The content has a
  // light profile of its own (K49, `--light-content-backlight` and
  // `--light-content-haze` on the root): the phone dims it.
  const back = setting('content-back', () => rootNum('--light-content-backlight', 1, 0, 4));
  const contentHaze = haze * setting('content-haze', () => rootNum('--light-content-haze', 1, 0, 4));
  const layersRepainted = layersDirty || layerPartial.size > 0;
  if (layersDirty) {
    layersDirty = false;
    layerPartial.clear();
    const hosts = document.querySelectorAll(`[${LAYER_ATTR}]`);
    for (const host of hosts) paintLayer(host, onHost(host), gain, contentHaze, back);
    for (const [host, L] of layers) if (!host.isConnected) { L.canvas.remove(); L.kids?.disconnect(); L.io?.disconnect(); layers.delete(host); }
  } else if (layerPartial.size) {
    const byHost = new Map();
    for (const el of layerPartial) {
      const h = el.isConnected ? hostOf(el) : null;
      if (h) (byHost.get(h) || byHost.set(h, new Set()).get(h)).add(el);
    }
    layerPartial.clear();
    // No region to redraw from (the layer has not had a full paint yet): the
    // whole layer, now, in this frame.
    for (const [host, els] of byHost) {
      if (!paintLayerPartial(host, els)) paintLayer(host, onHost(host), gain, contentHaze, back);
    }
  }

  // What lies at each spilling host's edge may have changed with it (K54).
  if (layersRepainted) drawSpills();

  // A layer whose exposure was just re-targeted by its paint (K50) glides
  // from the next frame on: the glide is a style write per frame, and the
  // re-arm below carries it like any other moving level.
  if (advanceExposures(t)) inFlight = true;

  // 4 — and only while a level is still moving, ask for the next frame. This
  //     is the one place the engine re-arms itself; when every level rests on
  //     its target it does not, and the console is static again. What moves
  //     decides what the next frame redraws (K49): a lamp in the chrome (a
  //     toast heating, the nav's prism) the fixed canvas; one in the content
  //     its own region of the layer. The ignition moves everything.
  if (inFlight) {
    // The cold start (K41b) redraws nothing (K78): the room is the canvases'
    // opacity (applyRoom), a style write a frame on layers of their own.
    for (const m of [thermal, seams]) {
      for (const [el, st] of m) {
        if (st.level === st.target) continue;
        if (el.isConnected && hostOf(el)) layerPartial.add(el); else fixedDirty = true;
      }
    }
    for (const el of dialHosts) {
      if (el.isConnected && hostOf(el)) layerPartial.add(el); else fixedDirty = true;
    }
    schedule();
  }
}

/**
 * Mark the frame stale. At most one paint per animation frame no matter how
 * many events land — which is what makes a scroll handler affordable — and the
 * request is dropped while the tab is hidden, where rAF does not run anyway.
 */
export function lightingRepaint(fixedOnly = false) {
  fixedDirty = true;
  if (fixedOnly !== true) { layersDirty = true; liveCache = null; settingsGen++; }
  schedule();
}
/** A dial moved on one emitter (K49): redraw its region of a layer, or the
 *  fixed canvas if that is where its light is. */
function lightingRepaintFor(el) {
  const h = el && el.isConnected ? layerHostOf(el) : null;
  if (!h) { lightingRepaint(true); return; }
  layerPartial.add(el);
  schedule();
}
/** Can this change move a light? A licence always can; a child changing
 *  inside a part that has said it stands still (`data-light-still`) cannot. */
const STILL_ATTR = 'data-light-still';
function movesLight(r) {
  if (r.type === 'attributes') return true;
  const at = r.target?.nodeType === 1 ? r.target : r.target?.parentElement;
  return !at?.closest?.(`[${STILL_ATTR}]`);
}
/** The layers only: their content moved, or a scroll reached a window's edge. */
function lightingRepaintLayers() {
  layersDirty = true;
  schedule();
}
function schedule() {
  dirty = true;
  if (queued) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  // A canvas that is no longer in the document has nothing to paint into — a
  // torn-down shell, or a test that replaced the body. Stop, rather than keep
  // answering the document's observers from a layer nobody can see.
  if (canvas && !canvas.isConnected) return;
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);
  queued = raf(() => { queued = 0; if (dirty) { dirty = false; paint(); } }) || 1;
}

/**
 * Build the canvas and bind the four things that can move light, once.
 * Idempotent, and inert wherever a 2D context cannot be had — happy-dom returns
 * null from getContext, and a console that will not boot in the test
 * environment is a worse outcome than one with no bloom.
 */
export function lightingInit({ room: level } = {}) {
  if (typeof level === 'function') roomSource = level;
  if (canvas || typeof document === 'undefined') return;

  const c = document.createElement('canvas');
  c.id = 'lighting-canvas';
  c.setAttribute('aria-hidden', 'true');
  let cx = null;
  let e = null;
  let ex = null;
  try {
    cx = c.getContext('2d');
    e = document.createElement('canvas');
    ex = e.getContext('2d');
  } catch { cx = null; }
  if (!cx || !ex) return;

  canvas = c; ctx = cx; em = e; emx = ex;
  document.body.appendChild(canvas);

  // Reduced motion: the state, not the journey. Levels jump to their target.
  try {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = !!mq.matches;
    mq.addEventListener?.('change', (ev) => { reduced = !!ev.matches; });
  } catch { reduced = false; }

  // A resize can change what is sticky or fixed (a breakpoint), so the
  // held-in-place answers are dropped with it.
  addEventListener('resize', () => { held = new WeakMap(); resizePending = true; for (const [, L] of layers) if (L.spill) L.spill.rect = null; writeMembrane(); lightingRepaint(); }, { passive: true });
  // Capture, because the console scrolls inside .main and the rails inside
  // themselves — scroll does not bubble, but it does capture, so one listener
  // covers every scroller the console has and every one it grows.
  // A layer host's own scroll (K45) moves its light with it for free; only a
  // scroll somewhere else can move a FIXED emitter, and only the fixed canvas
  // needs that frame.
  // K49: a host's scroll costs one comparison — unless it nears the edge of
  // the window its layer lights, when the layer is re-windowed; and, since a
  // sticky emitter can move a little before it sticks, the fixed canvas gets
  // one frame once the scroll has settled (not one per scroll event: that was
  // the lag K45 removed).
  let settle = 0;
  document.addEventListener('scroll', (ev) => {
    const t = ev.target;
    if (t && t.nodeType === 1 && t.hasAttribute(LAYER_ATTR)) {
      // (The window's edges are watched by layerFor's markers, not here.)
      const L = layers.get(t);
      if (L && !L.io && layerNeedsWindow(t, L)) lightingRepaintLayers();
      spillOnScroll(t);   // K54: the light at the edge moved with the content
      clearTimeout(settle);
      settle = setTimeout(() => lightingRepaint(true), 120);
      return;
    }
    if (t && t.nodeType === 1 && t.closest(`[${LAYER_ATTR}]`)) return;
    lightingRepaint(true);
  }, { passive: true, capture: true });
  // Content the browser had been skipping (content-visibility: auto) comes
  // back into play as a scroll reaches it: its light has to be drawn now.
  // K58: only ITS light — the emitters in what came into range, as a region
  // of the layer (the same partial repaint a hover takes), not the whole
  // layer. A whole-layer repaint per element entering range made scrolling a
  // surface of such elements cost the light 2.2–2.9× (measured on a list
  // of cards). If the element's real height differs from its
  // placeholder the first time it is laid out, everything below it moves:
  // its view changes size, and the view's ResizeObserver (layerFor) repaints
  // the whole layer, as before.
  document.addEventListener('contentvisibilityautostatechange', (ev) => {
    const t = ev.target;
    if (ev.skipped || !t?.closest?.(`[${LAYER_ATTR}]`)) return;
    let any = false;
    if (t.matches?.(LICENCE)) { layerPartial.add(t); any = true; }
    for (const el of t.querySelectorAll?.(LICENCE) || []) { layerPartial.add(el); any = true; }
    if (any) schedule();
  }, { passive: true, capture: true });
  // A view ENTERING with an animation (a direct child of a layer host): the
  // layer enters with it — the same fade, so the light never shows before
  // the thing that makes it — and is redrawn once the view has landed,
  // because what it measured mid-flight was a few px off.
  // A view ARRIVING (K53): `console-arrive` on a direct child of a layer
  // host, sent by the router at the swap. It stamps the arrival the
  // exposure rule reads (setExposure: a surface brighter than it will
  // settle at jumps there instead of gliding down). The entrance animation
  // below used to be the only stamp, and inside a View Transition it starts
  // a crossfade AFTER the light first measures the new surface: the owner
  // saw the Archive fade up to the old exposure and then sink for 2.6s,
  // "a stutter … before a smooth ease up for the lighting". The event names
  // no surface; it says only that a child of a layer host arrived.
  document.addEventListener('console-arrive', (ev) => {
    const host = ev.target?.parentElement;
    if (!host || !host.hasAttribute?.(LAYER_ATTR)) return;
    const L = layers.get(host);
    if (L) L.entered = now();
  }, { passive: true, capture: true });
  document.addEventListener('animationstart', (ev) => {
    const t = ev.target, host = t?.parentElement;
    if (!host || !host.hasAttribute?.(LAYER_ATTR)) return;
    const L = layers.get(host);
    if (L) L.entered = now();   // K50: the exposure's arrival rule reads this
    const a = t.getAnimations?.().find((x) => x.animationName === ev.animationName);
    const tm = a?.effect?.getComputedTiming?.();
    if (L && tm && tm.duration > 0 && typeof L.canvas.animate === 'function') {
      // …to the exposure it sits at (K50), not to 1: an animation overrides
      // the element's own opacity while it runs, and the glide underneath
      // has barely started by the time a 180ms fade ends.
      L.canvas.animate([{ opacity: 0 }, { opacity: L.expo ? L.expo.level : 1 }], { duration: tm.duration, easing: tm.easing || 'ease-out' });
      L.spill?.canvas.animate([{ opacity: 0 }, { opacity: L.expo ? L.expo.level : 1 }], { duration: tm.duration, easing: tm.easing || 'ease-out' });
    }
  }, { passive: true, capture: true });
  for (const type of ['animationend', 'animationcancel']) {
    document.addEventListener(type, (ev) => {
      if (ev.target?.parentElement?.hasAttribute?.(LAYER_ATTR)) lightingRepaintLayers();
    }, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    // Clear the in-flight handle before asking for a frame. A rAF queued just
    // before the tab hid is PARKED, not cancelled — browsers resume it, so in
    // practice this is belt and braces; but if one were ever dropped instead,
    // `queued` would stay non-zero and every later repaint would return at the
    // coalescing guard. The bloom would simply stop, with nothing to see.
    queued = 0;
    lightingRepaint();
  });

  // The theme decides --bloom-gain and --lit-rgb both, and it changes by an
  // attribute write on <html> rather than an event. The ignition (K41b) is
  // the other root attribute the light answers to: its arrival starts the
  // frames, its removal paints the resting state once and lets the engine park.
  new MutationObserver(lightingRepaint)
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-ignition'] });

  // A seam's dial moving under a hand (see dialing()). Capture, like scroll:
  // transition events bubble, but one listener at the top hears them all.
  for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) {
    document.addEventListener(type, onDial, { passive: true, capture: true });
  }
  // …and the hand itself, for a dial that changes WITHOUT a transition
  // (reduced motion, where it should jump): one paint after the pointer or
  // the focus crosses into or out of a seam, so the pool is never stale.
  // K49: one emitter's region, not the whole content.
  // K56: and the facts of the emitter under the hand are read again.
  const touched = (ev) => { const el = ev.target?.closest?.('[data-seam], [data-backlit]'); if (el) { forget(el); lightingRepaintFor(el); } };
  for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout']) {
    document.addEventListener(type, touched, { passive: true, capture: true });
  }

  // The licence itself. Anything anywhere gaining or losing data-lit,
  // data-heat or data-seam is the only signal this module takes from the rest
  // of the console.
  // childList as well as the attribute: a surface that re-renders while one of
  // its children is lit (renderPublish() during a commit) replaces the element
  // rather than changing it, and the light would be left painted at the old
  // node's coordinates.
  // K74: a part that changes its own text where it stands says so with
  // `data-light-still` (the split-flap's turning letter, held at its final
  // width), and a change inside it moves no light. WebKit draws this canvas
  // on the CPU: a repaint per turned letter was a dropped frame per letter,
  // a headline's flip a dozen of them, where Chrome's GPU shrugged it off.
  new MutationObserver((records) => { if (records.some(movesLight)) lightingRepaint(); })
    .observe(document.body, {
      attributes: true, attributeFilter: ['data-lit', 'data-heat', 'data-seam', 'data-backlit'], subtree: true, childList: true,
    });

  // A lit surface that grows under its own content (the publish bar gains a log
  // as it commits) moves its own light, and neither scroll nor resize fires.
  if (typeof ResizeObserver === 'function') ro = new ResizeObserver(lightingRepaint);

  writeMembrane();
  lightingRepaint();
}

/**
 * Re-point the size observer at the emitters this frame found — by DIFF, never
 * by disconnect-and-rebuild (see the note in paint()). A newly lit control
 * costs one initial notification and so one extra paint; a control lit since
 * the last frame costs nothing at all.
 */
function observeSizes(lit) {
  if (!ro) return;
  const next = new Set(lit);
  for (const el of watched) if (!next.has(el)) ro.unobserve(el);
  for (const el of next) if (!watched.has(el)) ro.observe(el);
  watched = next;
}

// Test seam: the paint is pure DOM + canvas and has no other way in.
export const _lighting = {
  emitters, isLit, isBacklit, backlightSprite, spriteSize, sprites: () => sprites, SPRITE_CAP, SPRITE_PX_BUDGET,
  layerWindow, contentHeight, drawSpill, SPILL_ATTR, STILL_ATTR, movesLight, uiZoom, unzoomed, SPILL_SCALE, SPILL_FADE, heldInPlace, LAYER_WINDOW_BEFORE, LAYER_WINDOW_AFTER, LAYER_EDGE, substrateTileURL, substrateCell, substrateDpr, writeMembrane, layers: () => layers, LAYER_ATTR,
  layerExposure, layerMean, setExposure, ADAPT_REF, ADAPT_MIN, ADAPT_ARRIVE_MS, SUBSTRATE_CELL, SUBSTRATE_PORE, seamEdge, seamStrips, litRgb, litLevel, seamLevel, roomIgnite, igniting, dialing, onDial, bloomGain, hazeGain, hazeBoost, substrateGain,
  // A test's frame is a whole frame: the fixed canvas is redrawn as well.
  paint: () => { fixedDirty = true; resizePending = true; liveCache = null; settingsGen++; paint(); }, curve, bezierY, farRgb,
  levels: () => new Map([...thermal].map(([el, s]) => [el, s.level])),
  seamLevels: () => new Map([...seams].map(([el, s]) => [el, s.level])),
  inFlight: () => inFlight,
  EM_SCALE, EMIT_ALPHA, GAIN_MAX, DITHER_ALPHA, AREA_REF, AREA_FLOOR,
  SEAM_SRC, SEAM_POOL, SEAM_FAR, HAZE_REACH, HAZE_SPREAD, HAZE_ALPHA, HAZE_MAX, HAZE_MARGIN, CULL_MARGIN,
  SUBSTRATE_DEPTH, BACKLIGHT_ALPHA, BACKLIGHT_LAW, BACKLIGHT_DEFAULTS,
};
