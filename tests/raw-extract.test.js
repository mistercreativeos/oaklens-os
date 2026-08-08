// raw-extract.js — structural extraction engine tests.
// Fixtures are synthetic byte-exact RAW containers (TIFF/RW2/CR2/NEF-style,
// RAF, CR3) small enough to hand-verify: each test builds the container,
// indexes it through the public API, and asserts the returned byte ranges.
import { describe, it, expect } from 'vitest';
import {
  indexRawFile, indexDeep, isRawFilename, parseExifDateString, groupBursts,
  RangeReader, readerFromBytes, parseEmbeddedJpegExif,
  formatExposure, formatAperture, formatFocal,
} from '../js/raw-extract.js';

// ---------- byte-building helpers ----------

function buf(size) {
  const b = new Uint8Array(size);
  return { b, dv: new DataView(b.buffer) };
}
const rangeOf = (bytes) => async (off, len) => bytes.subarray(off, off + len);
const index = (bytes, name) => indexRawFile(rangeOf(bytes), bytes.length, name);

// Minimal JPEG: SOI + APP0 header, zero filler, EOI. Passes signature
// validation and deep-scan SOI/EOI hunting.
function makeJpeg(len) {
  const j = new Uint8Array(len);
  j.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
  j[len - 2] = 0xff; j[len - 1] = 0xd9;
  return j;
}

// One IFD at `at`: entries [{tag,type,count,value}], then a next-IFD pointer.
function writeIfd({ dv }, at, le, entries, next = 0) {
  dv.setUint16(at, entries.length, le);
  entries.forEach((e, i) => {
    const p = at + 2 + i * 12;
    dv.setUint16(p, e.tag, le);
    dv.setUint16(p + 2, e.type, le);
    dv.setUint32(p + 4, e.count, le);
    dv.setUint32(p + 8, e.value, le);
  });
  dv.setUint32(at + 2 + entries.length * 12, next, le);
}

function writeAscii({ b }, at, s) {
  for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i);
}

// JPEG with an APP1/Exif segment carrying IFD0 (DateTime) → IFD1 (thumbnail
// JPEG embedded *inside* the APP1 payload) — the RW2 JpgFromRaw shape.
function makeExifJpeg({ totalLen, thumbLen, dateStr }) {
  const thumb = makeJpeg(thumbLen);
  // inner TIFF layout (offsets relative to TIFF base):
  //   0x00 header · 0x08 IFD0(1 entry) · 0x30 IFD1(2 entries) · 0x50 date · 0x70 thumb
  const tiffLen = 0x70 + thumbLen;
  const t = buf(tiffLen);
  t.b[0] = 0x49; t.b[1] = 0x49; t.dv.setUint16(2, 0x2a, true); t.dv.setUint32(4, 8, true);
  writeIfd(t, 8, true, [{ tag: 0x0132, type: 2, count: 20, value: 0x50 }], 0x30);
  writeIfd(t, 0x30, true, [
    { tag: 0x0201, type: 4, count: 1, value: 0x70 },
    { tag: 0x0202, type: 4, count: 1, value: thumbLen },
  ], 0);
  writeAscii(t, 0x50, dateStr);
  t.b.set(thumb, 0x70);

  const app1PayloadLen = 6 + tiffLen;            // 'Exif\0\0' + TIFF
  const app1SegLen = 2 + app1PayloadLen;         // length field includes itself
  const j = new Uint8Array(totalLen);
  let p = 0;
  j[p++] = 0xff; j[p++] = 0xd8;                  // SOI
  j[p++] = 0xff; j[p++] = 0xe1;                  // APP1
  j[p++] = app1SegLen >> 8; j[p++] = app1SegLen & 0xff;
  writeAscii({ b: j }, p, 'Exif'); p += 6;       // 'Exif\0\0'
  const tiffStartInJpeg = p;
  j.set(t.b, p); p += tiffLen;
  j[totalLen - 2] = 0xff; j[totalLen - 1] = 0xd9;
  return { jpeg: j, tiffStartInJpeg, thumbOffInJpeg: tiffStartInJpeg + 0x70 };
}

// ---------- fixtures ----------

// Panasonic RW2: II + magic 0x55, IFD0 { Model, JpgFromRaw, ExifIFD } with a
// full shooting-EXIF block (date, exposure, aperture, ISO, focal, lens).
// opts.makerLens adds Panasonic LensType (0x0051, IFD0); opts.noStdLens drops
// the standard LensModel so the maker-note fallback can be observed.
function makeRw2(opts = {}) {
  const { jpeg, thumbOffInJpeg } = makeExifJpeg({ totalLen: 2600, thumbLen: 620, dateStr: '2026:06:27 14:03:20' });
  const JPEG_OFF = 0x400;
  const f = buf(JPEG_OFF + jpeg.length + 64);
  f.b[0] = 0x49; f.b[1] = 0x49; f.dv.setUint16(2, 0x55, true); f.dv.setUint32(4, 0x18, true);
  const ifd0 = [
    { tag: 0x0110, type: 2, count: 10, value: 0x100 },              // Model
    { tag: 0x002e, type: 7, count: jpeg.length, value: JPEG_OFF },  // JpgFromRaw
    { tag: 0x8769, type: 4, count: 1, value: 0x200 },               // ExifIFD →
  ];
  if (opts.makerLens) {
    ifd0.splice(1, 0, { tag: 0x0051, type: 2, count: 21, value: 0x300 });   // LensType
    writeAscii(f, 0x300, 'LUMIX G VARIO 100-300');
  }
  writeIfd(f, 0x18, true, ifd0);
  writeAscii(f, 0x100, 'LUMIX G85');
  const exifIfd = [
    { tag: 0x829a, type: 5, count: 1, value: 0x2a0 },   // ExposureTime 1/500
    { tag: 0x829d, type: 5, count: 1, value: 0x2a8 },   // FNumber 2.8
    { tag: 0x8827, type: 3, count: 1, value: 200 },     // ISO (inline)
    { tag: 0x9003, type: 2, count: 20, value: 0x280 },  // DateTimeOriginal
    { tag: 0x920a, type: 5, count: 1, value: 0x2b0 },   // FocalLength 42mm
    { tag: 0xa405, type: 3, count: 1, value: 84 },      // 35mm equiv (inline)
  ];
  if (!opts.noStdLens) exifIfd.push({ tag: 0xa434, type: 2, count: 29, value: 0x2c0 });  // LensModel
  writeIfd(f, 0x200, true, exifIfd);
  writeAscii(f, 0x280, '2026:06:27 14:03:22');
  f.dv.setUint32(0x2a0, 1, true);   f.dv.setUint32(0x2a4, 500, true);
  f.dv.setUint32(0x2a8, 28, true);  f.dv.setUint32(0x2ac, 10, true);
  f.dv.setUint32(0x2b0, 420, true); f.dv.setUint32(0x2b4, 10, true);
  writeAscii(f, 0x2c0, 'LUMIX G VARIO 12-60/F3.5-5.6');
  f.b.set(jpeg, JPEG_OFF);
  return { bytes: f.b, JPEG_OFF, jpegLen: jpeg.length, thumbOff: JPEG_OFF + thumbOffInJpeg };
}

// Canon CR2 shape: classic TIFF, IFD0 single-strip full JPEG, IFD1 thumb.
function makeCr2() {
  const big = makeJpeg(3000), small = makeJpeg(700);
  const f = buf(0x1000 + big.length + 64);
  f.b[0] = 0x49; f.b[1] = 0x49; f.dv.setUint16(2, 0x2a, true); f.dv.setUint32(4, 0x10, true);
  writeIfd(f, 0x10, true, [
    { tag: 0x0111, type: 4, count: 1, value: 0x1000 },   // StripOffsets
    { tag: 0x0117, type: 4, count: 1, value: 3000 },     // StripByteCounts
  ], 0x80);
  writeIfd(f, 0x80, true, [
    { tag: 0x0201, type: 4, count: 1, value: 0x800 },
    { tag: 0x0202, type: 4, count: 1, value: 700 },
  ]);
  f.b.set(small, 0x800);
  f.b.set(big, 0x1000);
  return f.b;
}

// Nikon-style: BIG-endian TIFF, preview JPEG behind a SubIFDs pointer.
function makeNefBE() {
  const big = makeJpeg(2000);
  const f = buf(0x600 + big.length + 64);
  f.b[0] = 0x4d; f.b[1] = 0x4d; f.dv.setUint16(2, 0x2a, false); f.dv.setUint32(4, 8, false);
  writeIfd(f, 8, false, [{ tag: 0x014a, type: 4, count: 1, value: 0x40 }]);
  writeIfd(f, 0x40, false, [
    { tag: 0x0201, type: 4, count: 1, value: 0x600 },
    { tag: 0x0202, type: 4, count: 1, value: 2000 },
  ]);
  f.b.set(big, 0x600);
  return f.b;
}

function makeRaf() {
  const jpeg = makeJpeg(2500);
  const f = buf(0x200 + jpeg.length + 64);
  writeAscii(f, 0, 'FUJIFILMCCD-RAW ');
  f.dv.setUint32(84, 0x200, false);
  f.dv.setUint32(88, 2500, false);
  f.b.set(jpeg, 0x200);
  return f.b;
}

// Canon CR3: ftyp, then the preview uuid box → 8 reserved bytes → PRVW box.
function makeCr3() {
  const jpeg = makeJpeg(1500);
  const prvwBoxLen = 24 + jpeg.length;
  const uuidBoxLen = 8 + 16 + 8 + prvwBoxLen;
  const f = buf(16 + uuidBoxLen + 32);
  // ftyp
  f.dv.setUint32(0, 16, false); writeAscii(f, 4, 'ftypcrx ');
  // uuid box
  let p = 16;
  f.dv.setUint32(p, uuidBoxLen, false); writeAscii(f, p + 4, 'uuid');
  const uuid = 'eaf42b5e1c984b88b9fbb7dc406e4d16';
  for (let i = 0; i < 16; i++) f.b[p + 8 + i] = parseInt(uuid.slice(i * 2, i * 2 + 2), 16);
  // 8 reserved bytes, then PRVW
  let q = p + 8 + 16 + 8;
  f.dv.setUint32(q, prvwBoxLen, false); writeAscii(f, q + 4, 'PRVW');
  f.dv.setUint16(q + 14, 1620, false);            // width
  f.dv.setUint16(q + 16, 1080, false);            // height
  f.dv.setUint32(q + 20, jpeg.length, false);     // jpegSize
  f.b.set(jpeg, q + 24);
  return { bytes: f.b, jpegOff: q + 24, jpegLen: jpeg.length };
}

// ---------- tests ----------

describe('isRawFilename', () => {
  it('matches RAW extensions case-insensitively', () => {
    for (const n of ['P1050123.RW2', 'a.rw2', 'x.CR2', 'y.cr3', 'z.NEF', 'q.arw', 'w.dng', 'e.RAF', 'r.orf', 't.pef']) {
      expect(isRawFilename(n), n).toBe(true);
    }
  });
  it('rejects non-RAW names', () => {
    for (const n of ['photo.jpg', 'photo.jpeg', 'clip.mp4', 'x.webp', 'noext', '', null]) {
      expect(isRawFilename(n), String(n)).toBe(false);
    }
  });
});

describe('parseExifDateString', () => {
  it('parses EXIF wall time', () => {
    const d = parseExifDateString('2026:06:27 14:03:22');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(27);
    expect(d.getHours()).toBe(14);
    expect(d.getSeconds()).toBe(22);
  });
  it('rejects junk', () => {
    expect(parseExifDateString('')).toBeNull();
    expect(parseExifDateString('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDateString('not a date')).toBeNull();
  });
});

describe('RW2 (Panasonic)', () => {
  it('finds JpgFromRaw, EXIF thumb, date and camera', async () => {
    const { bytes, JPEG_OFF, jpegLen, thumbOff } = makeRw2();
    const out = await index(bytes, 'P1050123.RW2');
    expect(out.format).toBe('rw2');
    expect(out.preview).toMatchObject({ offset: JPEG_OFF, length: jpegLen, source: 'jpgfromraw' });
    expect(out.thumb).toMatchObject({ offset: thumbOff, length: 620 });
    expect(out.date.getFullYear()).toBe(2026);
    expect(out.date.getSeconds()).toBe(22);   // outer DateTimeOriginal wins over inner DateTime
    expect(out.camera).toBe('LUMIX G85');
  });
  it('reads the shooting EXIF (rationals, shorts, lens)', async () => {
    const out = await index(makeRw2().bytes, 'P1050123.RW2');
    expect(out.exif.exposure).toBeCloseTo(1 / 500);
    expect(out.exif.fnumber).toBeCloseTo(2.8);
    expect(out.exif.iso).toBe(200);
    expect(out.exif.focal).toBeCloseTo(42);
    expect(out.exif.focal35).toBe(84);
    expect(out.exif.lens).toBe('LUMIX G VARIO 12-60/F3.5-5.6');
  });
  it('falls back to Panasonic LensType (0x0051) when LensModel is absent', async () => {
    const out = await index(makeRw2({ makerLens: true, noStdLens: true }).bytes, 'P1190103.RW2');
    expect(out.exif.lens).toBe('LUMIX G VARIO 100-300');
  });
  it('prefers standard LensModel over the maker-note LensType', async () => {
    const out = await index(makeRw2({ makerLens: true }).bytes, 'P1050123.RW2');
    expect(out.exif.lens).toBe('LUMIX G VARIO 12-60/F3.5-5.6');
  });
});

describe('spec formatters', () => {
  it('formats shutter speed in photographer notation', () => {
    expect(formatExposure(1 / 500)).toBe('1/500');
    expect(formatExposure(1.6)).toBe('1.6s');
    expect(formatExposure(0)).toBe('');
    expect(formatExposure(null)).toBe('');
  });
  it('formats aperture and focal length', () => {
    expect(formatAperture(2.8)).toBe('ƒ/2.8');
    expect(formatAperture(0)).toBe('');
    expect(formatFocal(42, 84)).toBe('42mm · 84mm eq');
    expect(formatFocal(42, 42)).toBe('42mm');   // no redundant equivalent
    expect(formatFocal(0)).toBe('');
  });
});

describe('CR2 (Canon, strip JPEG + IFD1 thumb)', () => {
  it('picks the strip JPEG as preview and IFD1 as thumb', async () => {
    const out = await index(makeCr2(), 'IMG_0001.CR2');
    expect(out.preview).toMatchObject({ offset: 0x1000, length: 3000, source: 'strip' });
    expect(out.thumb).toMatchObject({ offset: 0x800, length: 700, source: 'jif' });
  });
});

describe('NEF-style (big-endian, SubIFD preview)', () => {
  it('walks MM byte order and SubIFDs', async () => {
    const out = await index(makeNefBE(), 'DSC_0001.NEF');
    expect(out.preview).toMatchObject({ offset: 0x600, length: 2000, source: 'jif' });
  });
});

describe('RAF (Fujifilm)', () => {
  it('reads the fixed big-endian header slots', async () => {
    const out = await index(makeRaf(), 'DSCF0001.RAF');
    expect(out.preview).toMatchObject({ offset: 0x200, length: 2500, source: 'raf' });
  });
});

describe('CR3 (Canon ISO-BMFF)', () => {
  it('finds the PRVW JPEG behind the preview uuid', async () => {
    const { bytes, jpegOff, jpegLen } = makeCr3();
    const out = await index(bytes, 'IMG_0001.CR3');
    expect(out.preview).toMatchObject({ offset: jpegOff, length: jpegLen, source: 'cr3-prvw' });
  });
});

describe('content sniffing (mangled picker names)', () => {
  it('parses a RW2 container regardless of its display name', async () => {
    const { bytes, JPEG_OFF, jpegLen } = makeRw2();
    const out = await index(bytes, '1000012345.bin');
    expect(out.preview).toMatchObject({ offset: JPEG_OFF, length: jpegLen });
  });
  it('detects RAF by header bytes and backfills the format', async () => {
    const out = await index(makeRaf(), 'content-uri-noname');
    expect(out.preview).toMatchObject({ offset: 0x200, length: 2500, source: 'raf' });
    expect(out.format).toBe('raf');
  });
  it('detects CR3 by ftyp box and backfills the format', async () => {
    const { bytes, jpegOff, jpegLen } = makeCr3();
    const out = await index(bytes, 'IMG_0001');
    expect(out.preview).toMatchObject({ offset: jpegOff, length: jpegLen, source: 'cr3-prvw' });
    expect(out.format).toBe('cr3');
  });
});

describe('graceful failure', () => {
  it('returns a null preview for unparseable bytes (no throw)', async () => {
    const junk = new Uint8Array(4096).fill(0x42);
    const out = await index(junk, 'mystery.x3f');
    expect(out.preview).toBeNull();
    expect(out.format).toBe('x3f');
  });
  it('ignores candidates that overrun the file', async () => {
    const { bytes } = makeRw2();
    const truncated = bytes.subarray(0, 0x500);   // cuts into the embedded JPEG
    const out = await index(truncated, 'P1050123.RW2');
    expect(out.preview).toBeNull();               // length check rejects the overrun
  });
});

describe('indexDeep (brute scan fallback)', () => {
  it('locates a large SOI…EOI segment inside opaque bytes', async () => {
    const jpeg = makeJpeg(56 * 1024);
    const bytes = new Uint8Array(100 * 1024 + jpeg.length + 4096);
    bytes.fill(0x11, 0, 100 * 1024);
    bytes.set(jpeg, 100 * 1024);
    const seg = await indexDeep(rangeOf(bytes), bytes.length);
    expect(seg).toMatchObject({ offset: 100 * 1024, length: jpeg.length, source: 'scan' });
  });
  it('returns null when only tiny segments exist', async () => {
    const jpeg = makeJpeg(2 * 1024);   // under the 50 KB floor
    const bytes = new Uint8Array(16 * 1024 + jpeg.length);
    bytes.set(jpeg, 16 * 1024);
    expect(await indexDeep(rangeOf(bytes), bytes.length)).toBeNull();
  });
});

describe('parseEmbeddedJpegExif', () => {
  it('translates inner thumbnail offsets into file space', async () => {
    const { jpeg, thumbOffInJpeg } = makeExifJpeg({ totalLen: 2600, thumbLen: 620, dateStr: '2025:01:02 03:04:05' });
    const FILE_OFF = 1000;
    const file = new Uint8Array(FILE_OFF + jpeg.length);
    file.set(jpeg, FILE_OFF);
    const rr = new RangeReader(rangeOf(file), file.length);
    const inner = await parseEmbeddedJpegExif(rr, FILE_OFF, jpeg.length);
    expect(inner.dateStr).toBe('2025:01:02 03:04:05');
    expect(inner.candidates[0]).toMatchObject({ offset: FILE_OFF + thumbOffInJpeg, length: 620 });
  });
});

describe('RangeReader', () => {
  it('serves exact ranges and clamps at EOF', async () => {
    const bytes = Uint8Array.from({ length: 100 }, (_, i) => i);
    const rr = new RangeReader(rangeOf(bytes), 100);
    expect([...(await rr.bytes(10, 5))]).toEqual([10, 11, 12, 13, 14]);
    expect((await rr.bytes(95, 50)).length).toBe(5);
    expect((await rr.bytes(200, 5)).length).toBe(0);
  });
});

describe('groupBursts', () => {
  const f = (id, dateMs) => ({ id, dateMs });
  it('stacks frames within the gap, splits on wider gaps', () => {
    const groups = groupBursts([f(1, 0), f(2, 900), f(3, 1800), f(4, 9000), f(5, 9500)], 2000);
    expect(groups.map(g => g.map(x => x.id))).toEqual([[1, 2, 3], [4, 5]]);
  });
  it('never groups undated frames', () => {
    const groups = groupBursts([f(1, null), f(2, null), f(3, 0), f(4, 500)], 2000);
    expect(groups.map(g => g.map(x => x.id))).toEqual([[1], [2], [3, 4]]);
  });
});
