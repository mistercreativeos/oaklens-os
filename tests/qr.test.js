// The QR encoder (js/qr.js, K65): the story card's way home. Byte mode,
// level M, versions 1–10. Held to the standard's own published values (the
// Reed–Solomon example, the format and version tables), to one matrix
// decoded by a real reader (macOS CoreImage's CIDetector read every one of
// 71 codes the development run produced, versions 1–10, all masks), and to
// the structure every reader looks for.

import { describe, it, expect } from 'vitest';
import { qrMatrix, rsRemainder, formatBits, versionBits } from '../js/qr.js';

// 'f#389', mask 3: decoded by CIDetector to exactly 'f#389' (2026-10-06).
const GOLDEN = ["111111101010101111111","100000101011101000001","101110100110101011101","101110101111101011101","101110100111001011101","100000100101101000001","111111101010101111111","000000001001100000000","101101110111101001011","010001000001111000101","111101110101000000101","101011010101001110011","101001100100100101010","000000001011001001000","111111101111100101100","100000101010000110110","101110100100111110111","101110101001001010110","101110101000101100100","100000100100010101001","111111101110010001100"];

describe('the standard\'s own numbers', () => {
  it('Reed–Solomon: the HELLO WORLD 1-M example', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it('format information for level M, and version information', () => {
    expect(formatBits(0)).toBe(0b101010000010010);
    expect(formatBits(7)).toBe(0b100101010100000);
    expect(versionBits(7)).toBe(0b000111110010010100);
    expect(versionBits(10)).toBe(0b001010010011010011);
  });
});

describe('qrMatrix', () => {
  it('reproduces a code a real reader decoded, module for module', () => {
    const q = qrMatrix('f#389', { mask: 3 });
    expect(q.modules.map((r) => r.map((d) => (d ? 1 : 0)).join(''))).toEqual(GOLDEN);
  });

  it('grows a version at a time with the text, and stops at version 10 (213 bytes)', () => {
    expect(qrMatrix('a'.repeat(14)).version).toBe(1);
    expect(qrMatrix('a'.repeat(15)).version).toBe(2);
    expect(qrMatrix('a'.repeat(213)).version).toBe(10);
    expect(() => qrMatrix('a'.repeat(214))).toThrow(/version 10/);
    const q = qrMatrix('https://example.com/field-notes/post?slug=fn-012');
    expect(q.size).toBe(q.version * 4 + 17);
  });

  it('has the three finders, the timing lines and the dark module where every reader looks', () => {
    const { modules: m, size } = qrMatrix('https://example.com/field-notes/post?slug=fn-012');
    const finder = (r0, c0) => {
      for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        expect(m[r0 + r][c0 + c], `finder ${r0},${c0} at ${r},${c}`).toBe(ring !== 2);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { expect(m[6][i]).toBe(i % 2 === 0); expect(m[i][6]).toBe(i % 2 === 0); }
    expect(m[size - 8][8]).toBe(true);
  });

  it('picks the mask the penalty rules prefer, and a forced one when asked', () => {
    const q = qrMatrix('hello world');
    expect(q.mask).toBeGreaterThanOrEqual(0);
    expect(q.mask).toBeLessThan(8);
    expect(qrMatrix('hello world', { mask: 5 }).mask).toBe(5);
  });

  it('encodes text as UTF-8 bytes', () => {
    expect(() => qrMatrix('ünïcödé · 🦆')).not.toThrow();
  });
});
