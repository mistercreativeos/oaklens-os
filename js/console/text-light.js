// OAKLENS Field Console — the text classes' one moving part.
//
// What a piece of type IS decides whether it gives light, and that is the
// stylesheet's job (css/field-console.css, TYPE): four classes on `data-text`,
// chosen by four questions asked in order —
//
//   stat  a measured number set as a figure           lit
//   act   its job is to be tapped                     a legend; lit under a hand
//   live  it reports the state of the site right now  low
//   info  it names, explains or gives context         flat, always
//
// — one recipe, one dial (`--text-emit`). Nothing here lights a text at rest.
//
// What CSS cannot do alone is the UPDATE: when the live site changes (a pulse
// goes out, a deploy lands), light runs through the readouts in reading order,
// each flaring hot and settling back to its class (the owner, on the iPad:
// hitting SEND "should 'pulse' light through the header text"). That is
// `sweep()`. It names no surface: hand it a root and it finds its own texts.
// Only READOUTS take part — an update is news about the site, and an action
// is not news — and info never flares, because info never emits.
//
// The flare's shape is the stylesheet's (`@keyframes text-flare`, on the
// console's thermal pair); this module only says when, and where in the wave.

export const TEXT_CLASSES = Object.freeze(['stat', 'act', 'live', 'info']);
export const READOUTS = Object.freeze(['stat', 'live']);

const STEP_MS = 90;     // the wave's pace from one readout to the next…
const SPAN_MS = 600;    // …and the most it takes, however many there are

const _flaring = new WeakMap();

/** One text flares: hot, then back to its own class on the cool curve. */
export function flare(el, at = 0) {
  const cls = el && el.getAttribute('data-text');
  if (!cls || cls === 'info' || !TEXT_CLASSES.includes(cls)) return false;
  el.style.setProperty('--flare-at', `${Math.max(0, Math.round(at))}ms`);
  // Restart, not stack: drop the attribute and settle the style (not the
  // layout — K56) so the animation begins again from cold.
  el.removeAttribute('data-flare');
  void getComputedStyle(el).animationName;
  el.setAttribute('data-flare', '');
  // Released when it has run. Only on `animationend`: the restart above
  // cancels the flare it replaces, and that cancel arrives after the new one
  // has begun — listening for it would put the new flare out.
  if (!_flaring.has(el)) {
    const done = (e) => {
      // Its own flare only: a nested text's end bubbles up through it.
      if (e && (e.target !== el || (e.animationName && e.animationName !== 'text-flare'))) return;
      el.removeAttribute('data-flare');
      el.removeEventListener('animationend', done);
      _flaring.delete(el);
    };
    el.addEventListener('animationend', done);
    _flaring.set(el, done);
  }
  return true;
}

/** The update: every readout under `root` flares, in reading (document) order. */
export function sweep(root) {
  if (!root || !root.querySelectorAll) return 0;
  const texts = [...root.querySelectorAll(READOUTS.map((c) => `[data-text="${c}"]`).join(', '))]
    .filter((el) => !el.closest('[hidden]'));
  const step = texts.length > 1 ? Math.min(STEP_MS, SPAN_MS / (texts.length - 1)) : 0;
  texts.forEach((el, i) => flare(el, i * step));
  return texts.length;
}
