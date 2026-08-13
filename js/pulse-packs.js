/* ============================================================
   PULSE-PACKS.JS — the starter pack, six disciplines, shipped whole
   ------------------------------------------------------------
   Bundled starter CONTENT, not instance identity — the same category as the
   sample field note and the sample frames the engine already ships, and the
   reason these live in engine code rather than in site.config.js. Every fork
   gets all six disciplines on first boot: nothing to uncomment, nothing to
   delete, and no "photography default with the rest as an upgrade."

   WHY THEY ARE SPECIFIC. A neutral pack named by feeling ("focused", "tired")
   sparks nothing and gets deleted without being replaced. "Eight bar loop. Send
   help." tells you what a pulse IS, and gets your brain running on the ones you
   would write yourself. The set deliberately mixes struggle and win — roughly
   two-thirds "it is going badly" to one-third "it landed" — because a system
   that only celebrates the grind is exhausting and nobody posts to it twice.

   WHY ALL SIX SHOW TO EVERYONE. Photographers write. Musicians ship code.
   Filmmakers record podcasts. Lanes are a starting point, not a category the
   software puts someone in.

   Copy is owner-authored and canonical — docs/pulse-card-vision.md, appendix.
   Do not "improve" a line here without the owner.

   An ES MODULE, not a classic script. The console is a module surface with an
   import map and carries no <script src> tags at all — the first cut of this
   file shipped as an IIFE hanging a global off window, which meant it was never
   loaded and the composer rendered its "starter packs" heading above nothing.
   ============================================================ */

// One palette per discipline — a starting colour, not a rule. The author can
// switch any pulse to any of the six (src/shared/pulse.js PULSE_STATES).
//
// `tray` is the GLYPH PICKER for that lane: twelve, of which the first six are
// the glyphs already on that lane's own starter lines. It is a separate list
// rather than being derived from `pulses` because six was not enough to write
// with (owner, 2026-08-13) — and because a picker and a set of example lines are
// two different jobs, even though they overlap. Keeping the lane's own six at
// the front means the tray still visibly belongs to the lane you tapped.
//
// Repeats ACROSS lanes are fine and expected (🎧 belongs to music and to
// podcasting). Repeats WITHIN a lane are not — they waste one of twelve slots,
// and tests/pulse-console.test.js fails on them.
export const PACKS = [
  {
    key: 'photography', label: 'Photography', state: 'ember',
    tray: ['🌫️', '🎛️', '😵‍💫', '📸', '✨', '🎞️', '🌅', '🖼️', '🔦', '🌓', '🧪', '🏞️'],
    pulses: [
      { glyphs: '🌫️', text: 'Chasing light. Losing my mind.' },
      { glyphs: '🎛️', text: 'Pushing pixels. Tones are singing.' },
      { glyphs: '😵‍💫', text: '500 frames. Zero open eyes.' },
      { glyphs: '📸', text: 'Lens cap on. Best shot.' },
      { glyphs: '✨', text: 'Client approved. Zero revisions needed.' },
      { glyphs: '🎞️', text: 'Final edit done. Looks incredible.' },
    ],
  },
  {
    key: 'writing', label: 'Writing', state: 'velvet',
    tray: ['🖱️', '🚆', '☕', '🕯️', '🌊', '🖋️', '📓', '✏️', '🗑️', '💡', '📖', '🌙'],
    pulses: [
      { glyphs: '🖱️', text: 'Blinking cursor. It is winning.' },
      { glyphs: '🚆', text: 'Plot holes everywhere. Fixing later.' },
      { glyphs: '☕', text: 'Coffee in. Yesterday’s draft deleted.' },
      { glyphs: '🕯️', text: 'Drafting genius. Do not perceive me.' },
      { glyphs: '🌊', text: 'Flow state activated. Words pouring.' },
      { glyphs: '🖋️', text: 'Chapter finished. It actually works.' },
    ],
  },
  {
    key: 'music', label: 'Music', state: 'flow',
    tray: ['🎧', '🥁', '🎚️', '🎷', '🚗', '🕺', '🎹', '🎸', '🎤', '🔊', '🎵', '🔁'],
    pulses: [
      { glyphs: '🎧', text: 'Eight bar loop. Send help.' },
      { glyphs: '🥁', text: 'Tweaking snare. Sounds like cardboard.' },
      { glyphs: '🎚️', text: 'Vocals muted. Track sounds better.' },
      { glyphs: '🎷', text: 'Laying stems. Neighbors hate me.' },
      { glyphs: '🚗', text: 'Car test passed. Mix bumps.' },
      { glyphs: '🕺', text: 'Groove locked. Found the pocket.' },
    ],
  },
  {
    key: 'filmmaking', label: 'Filmmaking', state: 'dawn',
    tray: ['🖥️', '🎬', '📼', '✂️', '🍿', '🎥', '🎦', '💡', '🎟️', '📀', '🔊', '🌆'],
    pulses: [
      { glyphs: '🖥️', text: 'Timeline rendering. Afraid to breathe.' },
      { glyphs: '🎬', text: 'Minor cinematic crisis. Send snacks.' },
      { glyphs: '📼', text: 'Soft B-roll. Calling it art.' },
      { glyphs: '✂️', text: 'Scrubbing timeline. Pacing is dead.' },
      { glyphs: '🍿', text: 'Render finished. Colors are popping.' },
      { glyphs: '🎥', text: 'One take wonder. Moving on.' },
    ],
  },
  {
    key: 'tech', label: 'Tech / Dev', state: 'tide',
    tray: ['🦆', '🚀', '⏳', '🐛', '✅', '🟢', '💻', '🔥', '🧠', '☕', '🔧', '🌙'],
    pulses: [
      { glyphs: '🦆', text: 'Explaining logic. Duck is confused.' },
      { glyphs: '🚀', text: 'Friday deploy. Pray for miracles.' },
      { glyphs: '⏳', text: 'Installing dependencies. See you tomorrow.' },
      { glyphs: '🐛', text: 'One bug fixed. Three emerged.' },
      { glyphs: '✅', text: 'Compiled first try. Zero errors.' },
      { glyphs: '🟢', text: 'All tests passed. Deploying now.' },
    ],
  },
  {
    key: 'podcasting', label: 'Podcasting', state: 'signal',
    tray: ['🎙️', '🗣️', '⏱️', '🔴', '🔥', '🎧', '🎚️', '📻', '✂️', '🔇', '💬', '⭐'],
    pulses: [
      { glyphs: '🎙️', text: 'Editing breaths. Sounding like Vader.' },
      { glyphs: '🗣️', text: 'Built-in mic used. Currently crying.' },
      { glyphs: '⏱️', text: 'Ten minute intro. Cut it.' },
      { glyphs: '🔴', text: 'Forgot to record. Pure tragedy.' },
      { glyphs: '🔥', text: 'Amazing guest. Conversation flowed perfectly.' },
      { glyphs: '🎧', text: 'Audio is crisp. Sounding flawless.' },
    ],
  },
];

// A pack entry → a full pulse ready to post.
//
// NO TITLE COMES BACK FROM HERE, and that is the point. The first cut returned
// `kicker: pack.label.toUpperCase()`, so tapping a starter stamped the
// discipline onto the card and the same feature introduced itself as
// PHOTOGRAPHY on one post and TECH / DEV on the next. The card names itself now
// (src/shared/pulse.js PULSE_LABEL) and a lane seeds a LINE, not an identity.
//
// BOTH footer cells stay empty: they are free text for whatever the author's
// discipline calls for, never a named slot for one discipline's metadata.
export function pulseFrom(packKey, index) {
  const pack = PACKS.find((p) => p.key === packKey);
  if (!pack) return null;
  const m = pack.pulses[Number(index)];
  if (!m) return null;
  return {
    text: m.text,
    glyphs: m.glyphs,
    state: m.state || pack.state,
    footLeft: '',
    footRight: '',
  };
}

export function allPulses() {
  return PACKS.reduce((acc, p) => acc.concat(p.pulses.map((_m, i) => pulseFrom(p.key, i))), []);
}

// The glyph picker for a lane. Returns [] for an unknown key rather than
// throwing — the tray is a shortcut, and a missing one should cost the author a
// shortcut, not the composer.
export function trayGlyphs(packKey) {
  const pack = PACKS.find((p) => p.key === packKey);
  return pack && Array.isArray(pack.tray) ? pack.tray : [];
}
