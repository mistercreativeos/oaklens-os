// OAKLENS — a QR code encoder, dependency-free (K65).
//
// The story card's way home (docs/pulse-card-vision.md §9: "the one new
// machine"). Byte mode, error correction M (about 15% of the code can be
// covered, by a thumb or a sticker, and it still reads), versions 1–10, so up
// to 213 bytes: any page address this site makes. It returns the matrix only;
// drawing it is the caller's (a canvas, an SVG), so the same code serves the
// story card and anything after it.
//
//   qrMatrix(text) → { size, modules }   modules[row][col] is true when dark
//
// The steps are the standard's (ISO/IEC 18004), in its order: encode the
// bytes, pad to the version's capacity, split into blocks, add Reed–Solomon
// error correction per block, interleave, place the bits around the function
// patterns, then try all eight masks and keep the one the standard's penalty
// rules score lowest. A plain ES module with no imports, like the markdown
// engine, so the console and a public page can both use it.

// Per version (1–10) at level M: [total codewords, ecc per block, [[blocks, data codewords], …]].
const M_BLOCKS = [
  null,
  [26, 10, [[1, 16]]],
  [44, 16, [[1, 28]]],
  [70, 26, [[1, 44]]],
  [100, 18, [[2, 32]]],
  [134, 24, [[2, 43]]],
  [172, 16, [[4, 27]]],
  [196, 18, [[4, 31]]],
  [242, 22, [[2, 38], [2, 39]]],
  [292, 22, [[3, 36], [2, 37]]],
  [346, 26, [[4, 43], [1, 44]]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const ECC_BITS_M = 0b00;

// ---- GF(256), the field the error correction is computed in (x^8+x^4+x^3+x^2+1) ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** The generator polynomial of degree n, highest term first (its leading 1 dropped). */
function generator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gmul(g[j], EXP[i]);
    }
    g = next;
  }
  return g.slice(1);
}

/** Reed–Solomon: the n error-correction codewords for one block of data. */
export function rsRemainder(data, n) {
  const gen = generator(n);
  const rem = new Array(n).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= gmul(gen[i], factor);
  }
  return rem;
}

const utf8 = (text) => Array.from(new TextEncoder().encode(String(text)));

function pickVersion(len) {
  for (let v = 1; v <= 10; v++) {
    const [total, ecc, groups] = M_BLOCKS[v];
    const dataCw = groups.reduce((s, [b, d]) => s + b * d, 0);
    const countBits = v < 10 ? 8 : 16;
    if (4 + countBits + len * 8 <= dataCw * 8) return { v, total, ecc, groups, dataCw, countBits };
  }
  throw new Error(`qr: ${len} bytes is more than version 10-M holds (213)`);
}

/** The data codewords: mode, count, bytes, terminator, then the pad pattern. */
function dataCodewords(bytes, { dataCw, countBits }) {
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);                       // byte mode
  put(bytes.length, countBits);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataCw * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < dataCw; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Blocks with their error correction, interleaved into the final codeword order. */
function interleave(data, { ecc, groups }) {
  const blocks = [];
  let at = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const d = data.slice(at, at + size);
      at += size;
      blocks.push({ d, e: rsRemainder(d, ecc) });
    }
  }
  const out = [];
  const longest = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecc; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

// ---- the matrix ----

function bch(value, poly, shift) {
  let v = value << shift;
  const top = 31 - Math.clz32(poly);
  for (let i = 31 - Math.clz32(v); i >= top; i--) if ((v >>> i) & 1) v ^= poly << (i - top);
  return (value << shift) | v;
}
export const formatBits = (mask) => bch((ECC_BITS_M << 3) | mask, 0x537, 10) ^ 0x5412;
export const versionBits = (v) => bch(v, 0x1f25, 12);

function base(v) {
  const size = v * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, dark) => { m[r][c] = dark; fn[r][c] = true; };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(rr, cc, ring !== 2 && ring !== 4);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[v];
  const last = al.length - 1;
  al.forEach((r, i) => al.forEach((c, j) => {
    // The three corners hold finders; every other place gets one, including
    // those on the timing lines (version 7 up), which it overwrites.
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }));
  // Reserve the format areas (written per mask), and the dark module.
  for (let i = 0; i < 9; i++) { fn[8][i] = true; fn[i][8] = true; }
  for (let i = 0; i < 8; i++) { fn[8][size - 1 - i] = true; fn[size - 1 - i][8] = true; }
  set(size - 8, 8, true);
  if (v >= 7) {
    const bits = versionBits(v);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = Math.floor(i / 3), b = size - 11 + (i % 3);
      set(a, b, dark); set(b, a, dark);
    }
  }
  return { size, m, fn };
}

function placeData({ size, m, fn }, codewords) {
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;   // the vertical timing column is skipped
    const upward = ((size - 1 - right) >> 1) % 2 === 0;
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (fn[r][c]) continue;
        m[r][c] = k < bits.length ? bits[k] === 1 : false;
        k++;
      }
    }
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function withMask({ size, m, fn }, mask) {
  const out = m.map((row, r) => row.map((dark, c) => (fn[r][c] ? dark : dark !== MASKS[mask](r, c))));
  const bits = formatBits(mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  // The first copy around the top-left finder, the second split between the
  // other two (row-major: out[row][col]).
  for (let i = 0; i <= 5; i++) out[i][8] = bit(i);
  out[7][8] = bit(6); out[8][8] = bit(7); out[8][7] = bit(8);
  for (let i = 9; i < 15; i++) out[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) out[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) out[size - 15 + i][8] = bit(i);
  out[size - 8][8] = true;
  return out;
}

/** The standard's four penalty rules; the lowest-scoring mask is the one used. */
export function penalty(mx) {
  const n = mx.length;
  let score = 0;
  const lines = (get) => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) {
        if (get(a, b) === get(a, b - 1)) { run++; if (b === n - 1 && run >= 5) score += run - 2; }
        else { if (run >= 5) score += run - 2; run = 1; }
      }
    }
  };
  lines((a, b) => mx[a][b]);
  lines((a, b) => mx[b][a]);
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const d = mx[r][c];
    if (d === mx[r][c + 1] && d === mx[r + 1][c] && d === mx[r + 1][c + 1]) score += 3;
  }
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const match = (get, p) => p.every((x, i) => get(i) === (x === 1));
  for (let a = 0; a < n; a++) for (let b = 0; b + 11 <= n; b++) {
    for (const p of [P1, P2]) {
      if (match((i) => mx[a][b + i], p)) score += 40;
      if (match((i) => mx[b + i][a], p)) score += 40;
    }
  }
  const dark = mx.reduce((s, row) => s + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

/**
 * The QR code for `text`: `{ size, modules, version, mask }`, where
 * modules[row][col] is true for a dark module. Draw it with a quiet zone of
 * four modules on every side. `mask` forces a mask (tests); otherwise the
 * best-scoring one is chosen.
 */
export function qrMatrix(text, { mask } = {}) {
  const bytes = utf8(text);
  const spec = pickVersion(bytes.length);
  const codewords = interleave(dataCodewords(bytes, spec), spec);
  const grid = base(spec.v);
  placeData(grid, codewords);
  let best = null;
  for (let k = 0; k < 8; k++) {
    if (mask !== undefined && k !== mask) continue;
    const mx = withMask(grid, k);
    const score = mask !== undefined ? 0 : penalty(mx);
    if (!best || score < best.score) best = { mx, k, score };
  }
  return { size: grid.size, modules: best.mx, version: spec.v, mask: best.k };
}
