// OAKLENS Field Console — the dot-matrix readout.
//
// A 5×7 matrix, unlit dots included, drawn rather than set, so it reads as an
// instrument in every preset whatever its faces are. The Bridge's clock is its
// first reader (js/console/bridge.js); it lives on its own because a readout
// is a part, not a page — anything that wants a vacuum-fluorescent line can
// draw one without reaching into the Bridge.
//
// The colour is the reader's: the dots fill with `currentColor`, the unlit
// ones at a tenth of it, and `.matrix` takes its phosphor glow from
// `--matrix-glow` (css/field-console.css, THE DOT MATRIX). English
// abbreviations on purpose: the matrix has the 26 letters, the digits, a colon
// and a middle dot, nothing else, and an unknown character draws as a blank
// cell rather than a wrong one.

import { escapeHTML } from './chrome.js';

// Row-major, 5 wide by 7 tall: '1' is a lit dot.
const GLYPHS = {
  0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110',
  2: '01110100010000100010001000100011111', 3: '11111000100010000010000011000101110',
  4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110',
  6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000',
  8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100',
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110', D: '11100100101000110001100011001011100',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001',
  O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100011000101010001000010000100', Z: '11111000010001000100010001000011111',
  ':': '00000011000110000000011000110000000', '·': '00000000000000001100011000000000000',
};

/** The text as an SVG dot matrix; `label` is what a screen reader hears. */
export function matrixSVG(text, label = text) {
  const on = [], off = [];
  [...String(text).toUpperCase()].forEach((ch, c) => {
    const g = GLYPHS[ch] || '';
    for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) {
      (g[r * 5 + k] === '1' ? on : off).push(`M${c * 6 + k + 0.1} ${r + 0.1}h.8v.8h-.8z`);
    }
  });
  const w = Math.max(1, [...String(text)].length * 6 - 1);
  return `<svg class="matrix" viewBox="0 0 ${w} 7" role="img" aria-label="${escapeHTML(label)}" preserveAspectRatio="xMinYMid meet">` +
    `<path class="matrix-off" d="${off.join('')}"/><path class="matrix-on" d="${on.join('')}"/></svg>`;
}
