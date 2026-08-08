// OAKLENS // FIELD CONSOLE — raw-extract.js (ES module, DOM-free).
//
// Client-side RAW *preview* engine: every camera RAW ships with one or more
// camera-rendered JPEGs inside it (Panasonic's JpgFromRaw is full-resolution).
// This module locates those JPEGs by structure and returns their byte ranges —
// it never demosaics, never decodes RAW data, and never reads more of the file
// than it has to. On a 2000-frame card that's ~64–128 KB of reads per file for
// the index, and one ranged read per on-demand preview pull.
//
// Zero dependencies, zero DOM: everything operates on a caller-supplied
//   readRange(offset, length) -> Promise<Uint8Array>
// so the same code runs against a browser File (raw-lens.js) or a Node Buffer
// (tests). raw-lens.js is the only UI consumer.
//
// Format coverage:
//   TIFF family  RW2/RWL (Panasonic, magic 0x55 + JpgFromRaw tag 0x002E),
//                CR2 (Canon, IFD0 strip JPEG), NEF/NRW (Nikon, SubIFD previews),
//                ARW/SRF/SR2 (Sony), DNG, ORF (Olympus magics "RO"/"SR"),
//                PEF (Pentax), SRW (Samsung) — one shared IFD walker.
//   RAF          Fujifilm — JPEG offset/length at fixed BE header slots.
//   CR3          Canon ISO-BMFF — THMB / PRVW boxes (uuid-scoped), tolerant of
//                layout drift (validates FF D8, falls back to bounded scan).
//   anything     deepScanForJpeg(): bounded chunked scan for SOI…EOI segments —
//                the safety net when structure parsing comes up empty.

// ============== FORMAT DETECTION ==============

// Extensions we open the RAW LENS for. Formats beyond the structured parsers
// still get the deep-scan fallback (some, like CRW/X3F, may hold no JPEG and
// are skipped gracefully at index time).
export const RAW_EXT_RE = /\.(rw2|rwl|raw|cr2|cr3|crw|nef|nrw|arw|srf|sr2|dng|raf|orf|ori|pef|srw|3fr|fff|iiq|x3f)$/i;

export function isRawFilename(name) {
  return RAW_EXT_RE.test(name || '');
}

const TIFF_MAGICS = new Set([
  0x002a,  // classic TIFF — CR2/NEF/ARW/DNG/PEF/SRW
  0x0055,  // Panasonic RW2/RWL
  0x4f52,  // Olympus ORF "RO"
  0x5352,  // Olympus ORF "SR"
]);

// ============== RANGED READER (windowed, tiny cache) ==============
// Wraps readRange with a small window cache so IFD hops near each other don't
// re-hit the disk/OTG bus. Windows are capped and few — this never grows into
// "the whole file in memory".
const WIN_MIN = 4096;
const WIN_MAX_CACHE = 8;

export class RangeReader {
  constructor(readRange, size) {
    this._read = readRange;
    this.size = size;
    this._wins = [];   // [{ off, bytes }] MRU-last
  }
  async bytes(offset, length) {
    if (offset < 0 || length <= 0 || offset >= this.size) return new Uint8Array(0);
    const end = Math.min(offset + length, this.size);
    length = end - offset;
    for (let i = this._wins.length - 1; i >= 0; i--) {
      const w = this._wins[i];
      if (offset >= w.off && end <= w.off + w.bytes.length) {
        return w.bytes.subarray(offset - w.off, offset - w.off + length);
      }
    }
    const winLen = Math.min(Math.max(length, WIN_MIN), this.size - offset);
    const bytes = await this._read(offset, winLen);
    // Only cache small windows — a multi-MB preview pull must not pin memory.
    if (bytes.length <= 512 * 1024) {
      this._wins.push({ off: offset, bytes });
      if (this._wins.length > WIN_MAX_CACHE) this._wins.shift();
    }
    return bytes.subarray(0, length);
  }
  async view(offset, length) {
    const b = await this.bytes(offset, length);
    return new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
}

// Reader over an in-memory byte array (embedded-JPEG parsing, tests).
export function readerFromBytes(bytes) {
  return new RangeReader(async (off, len) => bytes.subarray(off, off + len), bytes.length);
}

// ============== TIFF / IFD WALKER ==============
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

function u16(dv, off, le) { return dv.getUint16(off, le); }
function u32(dv, off, le) { return dv.getUint32(off, le); }

// Read a tag's value as an array of numbers (SHORT/LONG) or a string (ASCII).
async function readTagValue(rr, base, le, entry) {
  const { type, count, valueOff, inline } = entry;
  const unit = TYPE_SIZE[type] || 1;
  const byteLen = unit * count;
  let dv;
  if (byteLen <= 4) {
    dv = inline;                       // value packed into the entry itself
  } else {
    dv = await rr.view(base + valueOff, byteLen);
    if (dv.byteLength < byteLen) return null;
  }
  if (type === 2) {                    // ASCII
    let s = '';
    for (let i = 0; i < count && i < dv.byteLength; i++) {
      const c = dv.getUint8(i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    if (type === 5 || type === 10) {   // RATIONAL / SRATIONAL → float
      const num = type === 5 ? u32(dv, i * 8, le) : dv.getInt32(i * 8, le);
      const den = type === 5 ? u32(dv, i * 8 + 4, le) : dv.getInt32(i * 8 + 4, le);
      out.push(den ? num / den : 0);
    }
    else if (unit === 2) out.push(u16(dv, i * 2, le));
    else if (unit === 4) out.push(u32(dv, i * 4, le));
    else out.push(dv.getUint8(i));
  }
  return out;
}

// Walk one IFD; collect JPEG candidates + metadata into ctx; recurse into
// SubIFDs / Exif IFD; follow the next-IFD chain. All offsets are relative to
// `base` (0 for a bare RAW, the TIFF header position for JPEG-embedded EXIF).
async function walkIfd(rr, base, le, ifdOff, ctx, depth) {
  if (depth > 4 || ctx.ifdsVisited.size > 32) return;
  const key = base + ':' + ifdOff;
  if (ctx.ifdsVisited.has(key)) return;
  ctx.ifdsVisited.add(key);

  const head = await rr.view(base + ifdOff, 2);
  if (head.byteLength < 2) return;
  const n = u16(head, 0, le);
  if (n === 0 || n > 512) return;

  const body = await rr.view(base + ifdOff + 2, n * 12 + 4);
  if (body.byteLength < n * 12) return;

  // Per-IFD scratch for tag pairs that only mean something together.
  let jif = null, jifLen = null, strips = null, stripLens = null;
  const subIfds = [];
  let exifIfd = null;

  for (let i = 0; i < n; i++) {
    const e = i * 12;
    const tag = u16(body, e, le);
    const type = u16(body, e + 2, le);
    const count = u32(body, e + 4, le);
    const valueOff = u32(body, e + 8, le);
    const inline = new DataView(body.buffer, body.byteOffset + e + 8, 4);
    const entry = { tag, type, count, valueOff, inline };

    switch (tag) {
      case 0x002e: {  // JpgFromRaw (Panasonic RW2) — the whole JPEG, inline
        if (count > 4) ctx.candidates.push({ offset: base + valueOff, length: count, source: 'jpgfromraw' });
        break;
      }
      case 0x0201: jif = entry; break;      // JPEGInterchangeFormat
      case 0x0202: jifLen = entry; break;   // JPEGInterchangeFormatLength
      case 0x0111: strips = entry; break;   // StripOffsets
      case 0x0117: stripLens = entry; break;// StripByteCounts
      case 0x014a: {  // SubIFDs
        const v = await readTagValue(rr, base, le, entry);
        if (Array.isArray(v)) subIfds.push(...v);
        break;
      }
      case 0x8769: exifIfd = valueOff; break;
      case 0x0110: {  // Model
        if (!ctx.camera) {
          const v = await readTagValue(rr, base, le, entry);
          if (typeof v === 'string') ctx.camera = v.trim();
        }
        break;
      }
      case 0x0132:    // DateTime (fallback)
      case 0x9003:    // DateTimeOriginal (wins)
      case 0x9004: {  // CreateDate (fallback)
        const v = await readTagValue(rr, base, le, entry);
        if (typeof v === 'string' && v) {
          if (tag === 0x9003) { ctx.dateStr = v; ctx.dateIsOriginal = true; }
          else if (!ctx.dateIsOriginal && !ctx.dateStr) ctx.dateStr = v;
        }
        break;
      }
      case 0x0112: {  // Orientation
        if (ctx.orientation == null && count === 1) ctx.orientation = type === 3 ? u16(inline, 0, le) : valueOff;
        break;
      }
      // ---- shooting EXIF (assess-view spec readout) ----
      case 0x829a:    // ExposureTime (s)
      case 0x829d:    // FNumber
      case 0x920a:    // FocalLength (mm)
      case 0x8827:    // ISO
      case 0xa405: {  // FocalLengthIn35mmFilm
        const key = { 0x829a: 'exposure', 0x829d: 'fnumber', 0x920a: 'focal', 0x8827: 'iso', 0xa405: 'focal35' }[tag];
        if (ctx.exif[key] == null) {
          const v = await readTagValue(rr, base, le, entry);
          if (Array.isArray(v) && v.length && v[0] > 0) ctx.exif[key] = v[0];
        }
        break;
      }
      case 0xa434: {  // LensModel
        if (!ctx.exif.lens) {
          const v = await readTagValue(rr, base, le, entry);
          if (typeof v === 'string' && v.trim()) ctx.exif.lens = v.trim();
        }
        break;
      }
      case 0x0051: {  // Panasonic RW2 LensType (IFD0) — G-series cameras put
        // the lens name here, not in the standard 0xA434 slot. Kept separate
        // so a real LensModel still wins if both exist.
        if (type === 2 && !ctx.exif.lensMaker) {
          const v = await readTagValue(rr, base, le, entry);
          if (typeof v === 'string' && v.trim()) ctx.exif.lensMaker = v.trim();
        }
        break;
      }
    }
  }

  if (jif && jifLen && jifLen.count === 1) {
    ctx.candidates.push({ offset: base + jif.valueOff, length: jifLen.valueOff, source: 'jif' });
  }
  // Single-strip images are sometimes whole JPEGs (CR2 IFD0 full-size, DNG
  // previews). Multi-strip = real raster data — never a JPEG, skip.
  if (strips && stripLens && strips.count === 1 && stripLens.count === 1) {
    ctx.candidates.push({ offset: base + strips.valueOff, length: stripLens.valueOff, source: 'strip' });
  }

  for (const s of subIfds) await walkIfd(rr, base, le, s, ctx, depth + 1);
  if (exifIfd) await walkIfd(rr, base, le, exifIfd, ctx, depth + 1);

  if (body.byteLength >= n * 12 + 4) {
    const next = u32(body, n * 12, le);
    if (next) await walkIfd(rr, base, le, next, ctx, depth);
  }
}

// Parse a TIFF structure at `base`. Returns ctx or null if no TIFF header.
async function parseTiff(rr, base) {
  const hdr = await rr.view(base, 8);
  if (hdr.byteLength < 8) return null;
  const bom = u16(hdr, 0, false);
  let le;
  if (bom === 0x4949) le = true;        // 'II'
  else if (bom === 0x4d4d) le = false;  // 'MM'
  else return null;
  const magic = u16(hdr, 2, le);
  if (!TIFF_MAGICS.has(magic)) return null;
  const ctx = {
    candidates: [], ifdsVisited: new Set(),
    dateStr: null, dateIsOriginal: false, camera: null, orientation: null,
    exif: { exposure: null, fnumber: null, iso: null, focal: null, focal35: null, lens: null, lensMaker: null },
  };
  await walkIfd(rr, base, le, u32(hdr, 4, le), ctx, 0);
  return ctx;
}

// ============== EMBEDDED-JPEG EXIF (thumb + date inside a JPEG we found) ==============
// Walks the JPEG's APP1/Exif segment: yields the EXIF thumbnail (IFD1) as a
// candidate plus DateTimeOriginal — RW2/RAF grid thumbs come from here.
// `jpegFileOffset` translates in-JPEG offsets back to whole-file offsets.
export async function parseEmbeddedJpegExif(rr, jpegFileOffset, jpegLength) {
  const headLen = Math.min(jpegLength || 70000, 70000);   // APP1 caps at 64 KB
  const head = await rr.bytes(jpegFileOffset, headLen);
  if (head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= head.length) {
    if (head[p] !== 0xff) break;
    const marker = head[p + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { p += 2; continue; }
    const segLen = (head[p + 2] << 8) | head[p + 3];
    if (segLen < 2) break;
    if (marker === 0xe1 && segLen > 8) {
      const tag = String.fromCharCode(head[p + 4], head[p + 5], head[p + 6], head[p + 7]);
      if (tag === 'Exif') {
        const tiffStart = p + 10;   // 'Exif\0\0' then TIFF header
        const seg = head.subarray(tiffStart, Math.min(p + 2 + segLen, head.length));
        const ctx = await parseTiff(readerFromBytes(seg), 0);
        if (!ctx) return null;
        // Translate candidate offsets (relative to embedded TIFF) → file space.
        for (const c of ctx.candidates) c.offset += jpegFileOffset + tiffStart;
        return ctx;
      }
    }
    if (marker === 0xda) break;   // start of scan — no more headers
    p += 2 + segLen;
  }
  return null;
}

// ============== FUJIFILM RAF ==============
async function parseRaf(rr) {
  const hdr = await rr.bytes(0, 96);
  if (hdr.length < 92) return null;
  const magic = String.fromCharCode(...hdr.subarray(0, 15));
  if (magic !== 'FUJIFILMCCD-RAW') return null;
  const dv = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
  const off = dv.getUint32(84, false);   // big-endian header slots
  const len = dv.getUint32(88, false);
  if (!off || !len || off + len > rr.size) return null;
  return { candidates: [{ offset: off, length: len, source: 'raf' }] };
}

// ============== CANON CR3 (ISO BMFF) ==============
const CR3_PRVW_UUID = 'eaf42b5e1c984b88b9fbb7dc406e4d16';

function hexOf(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

// Given the file position of a THMB/PRVW fourcc, resolve the JPEG range.
// Canon has shifted these layouts between firmware generations, so instead of
// trusting one fixed slot we try the known size slots and demand FF D8 at the
// data start; failing that, scan inside the box bounds.
async function cr3JpegFromBox(rr, boxStart, boxSize, source) {
  const head = await rr.bytes(boxStart, Math.min(boxSize, 64));
  if (head.length < 28) return null;
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  for (const sizeSlot of [20, 16]) {
    const jlen = dv.getUint32(sizeSlot, false);
    if (jlen > 16 && boxStart + 24 + jlen <= boxStart + boxSize) {
      const sig = await rr.bytes(boxStart + 24, 3);
      if (sig.length === 3 && sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff) {
        return { offset: boxStart + 24, length: jlen, source };
      }
    }
  }
  // Layout drift — bounded scan inside the box.
  const seg = await scanRegionForJpeg(rr, boxStart, Math.min(boxSize, 8 * 1024 * 1024));
  return seg ? { ...seg, source } : null;
}

async function parseCr3(rr) {
  const probe = await rr.bytes(4, 8);
  if (String.fromCharCode(...probe.subarray(0, 4)) !== 'ftyp') return null;
  const ctx = { candidates: [] };

  // THMB lives early (inside moov's Canon uuid) — one 128 KB read finds it.
  const head = await rr.bytes(0, 128 * 1024);
  const thmbAt = findFourcc(head, 'THMB');
  if (thmbAt >= 4) {
    const dv = new DataView(head.buffer, head.byteOffset + thmbAt - 4, 4);
    const c = await cr3JpegFromBox(rr, thmbAt - 4, dv.getUint32(0, false) || 65536, 'cr3-thmb');
    if (c) ctx.candidates.push(c);
  }

  // Walk top-level boxes for the preview uuid (usually right after moov).
  let pos = 0, hops = 0;
  while (pos + 16 <= rr.size && hops++ < 64) {
    const bh = await rr.bytes(pos, 32);
    if (bh.length < 16) break;
    const dv = new DataView(bh.buffer, bh.byteOffset, bh.byteLength);
    let size = dv.getUint32(0, false);
    const type = String.fromCharCode(...bh.subarray(4, 8));
    let payload = pos + 8;
    if (size === 1) {   // 64-bit largesize
      size = Number(dv.getBigUint64(8, false));
      payload = pos + 16;
    }
    if (size < 8) break;
    if (type === 'uuid' && hexOf(bh.subarray(payload - pos, payload - pos + 16)) === CR3_PRVW_UUID) {
      // uuid payload: 8 reserved bytes, then the PRVW box.
      const w = await rr.bytes(payload + 16, 64);
      const prvwAt = findFourcc(w, 'PRVW');
      if (prvwAt >= 4) {
        const boxStart = payload + 16 + prvwAt - 4;
        const bdv = new DataView(w.buffer, w.byteOffset + prvwAt - 4, 4);
        const c = await cr3JpegFromBox(rr, boxStart, bdv.getUint32(0, false) || (size - 24), 'cr3-prvw');
        if (c) ctx.candidates.push(c);
      }
      break;
    }
    pos += size;
  }
  return ctx.candidates.length ? ctx : null;
}

function findFourcc(bytes, cc) {
  const a = cc.charCodeAt(0), b = cc.charCodeAt(1), c = cc.charCodeAt(2), d = cc.charCodeAt(3);
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === a && bytes[i + 1] === b && bytes[i + 2] === c && bytes[i + 3] === d) return i;
  }
  return -1;
}

// ============== DEEP SCAN FALLBACK ==============
// Chunked SOI→EOI hunt across a region. The safety net for oddball formats and
// structure-parse misses. Bounded: chunk reads with a 4-byte overlap, hard cap
// on bytes examined, early exit once a big segment is in hand.
const SCAN_CHUNK = 1024 * 1024;

async function scanRegionForJpeg(rr, regionOff, regionLen) {
  const end = Math.min(regionOff + regionLen, rr.size);
  let best = null;
  let pos = regionOff;
  while (pos + 4 <= end) {
    const chunk = await rr.bytes(pos, Math.min(SCAN_CHUNK, end - pos));
    if (chunk.length < 4) break;
    let nextPos = pos + chunk.length - 4;   // default: advance with SOI-straddle overlap
    for (let i = 0; i + 3 < chunk.length; i++) {
      if (chunk[i] !== 0xff || chunk[i + 1] !== 0xd8 || chunk[i + 2] !== 0xff) continue;
      const m = chunk[i + 3];
      if (!(m === 0xe0 || m === 0xe1 || m === 0xdb || m === 0xee)) continue;
      const soi = pos + i;
      const eoi = await findEoi(rr, soi + 4, end);
      if (eoi > soi) {
        const seg = { offset: soi, length: eoi - soi + 2 };
        if (!best || seg.length > best.length) best = seg;
        nextPos = eoi + 2;   // resume scanning after this segment
      } else {
        nextPos = end;       // no EOI anywhere ahead — nothing more to find
      }
      break;                 // outer loop continues from nextPos
    }
    if (best && best.length > 1024 * 1024) break;   // big preview found — done
    if (nextPos <= pos) break;
    pos = nextPos;
  }
  return best;
}

async function findEoi(rr, from, end) {
  let pos = from;
  while (pos < end) {
    const chunk = await rr.bytes(pos, Math.min(SCAN_CHUNK, end - pos));
    if (chunk.length < 2) return -1;
    for (let i = 0; i + 1 < chunk.length; i++) {
      if (chunk[i] === 0xff && chunk[i + 1] === 0xd9) return pos + i;
    }
    pos += chunk.length - 1;   // 1-byte overlap for a boundary-straddling EOI
  }
  return -1;
}

export async function deepScanForJpeg(rr, { maxBytes = 24 * 1024 * 1024 } = {}) {
  return scanRegionForJpeg(rr, 0, Math.min(maxBytes, rr.size));
}

// ============== CANDIDATE VALIDATION / SELECTION ==============
async function validateCandidates(rr, candidates) {
  const valid = [];
  const seen = new Set();
  for (const c of candidates) {
    if (!c || c.length < 512 || c.offset + c.length > rr.size) continue;
    const key = c.offset + ':' + c.length;
    if (seen.has(key)) continue;
    seen.add(key);
    const sig = await rr.bytes(c.offset, 3);
    if (sig.length === 3 && sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff) valid.push(c);
  }
  return valid.sort((a, b) => b.length - a.length);   // largest first
}

// ============== DATE HELPERS ==============
// EXIF "YYYY:MM:DD HH:MM:SS" (camera-local wall time) → Date, or null.
export function parseExifDateString(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  // Cameras with an unset clock write "0000:00:00 00:00:00" — that's no date.
  if (+m[1] === 0 || +m[2] === 0 || +m[3] === 0) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return isNaN(d.getTime()) ? null : d;
}

// ============== PUBLIC: INDEX ONE RAW FILE ==============
// Cheap structural pass — a few small ranged reads. Returns:
//   { format, preview, thumb, date, camera, size }
// preview/thumb are { offset, length, source } byte ranges (thumb may be null;
// preview may be null → caller can offer indexDeep()). Throws only on reader
// errors; unparseable files return { format, preview: null, ... }.
export async function indexRawFile(readRange, size, name) {
  const rr = new RangeReader(readRange, size);
  let format = ((name || '').match(RAW_EXT_RE)?.[1] || '').toLowerCase();
  const out = {
    format, preview: null, thumb: null, date: null, camera: null, orientation: null, size,
    exif: { exposure: null, fnumber: null, iso: null, focal: null, focal35: null, lens: null, lensMaker: null },
  };

  // Content-driven, not name-driven: Android pickers can hand back files with
  // mangled display names, so probe bytes. Each probe is one cheap header
  // read that nulls out fast on a mismatch.
  let ctx = await parseTiff(rr, 0);
  if (!ctx) { ctx = await parseRaf(rr); if (ctx) format = out.format = format || 'raf'; }
  if (!ctx) { ctx = await parseCr3(rr); if (ctx) format = out.format = format || 'cr3'; }
  if (!ctx) return out;

  if (ctx.camera) out.camera = ctx.camera;
  if (ctx.orientation != null) out.orientation = ctx.orientation;
  if (ctx.dateStr) out.date = parseExifDateString(ctx.dateStr);
  if (ctx.exif) Object.assign(out.exif, ctx.exif);

  const valid = await validateCandidates(rr, ctx.candidates);
  if (!valid.length) return out;

  out.preview = valid[0];
  // Thumb = smallest validated candidate that isn't the preview itself.
  const small = valid[valid.length - 1];
  if (small !== out.preview && small.length < out.preview.length / 2) out.thumb = small;

  // No separate thumb (RW2/RAF ship exactly one big JPEG), or gaps in the
  // shooting EXIF (some cameras only write LensModel into the embedded
  // JPEG): pull from inside that JPEG — one more small read.
  const exifGaps = !out.exif.lens || !out.exif.fnumber || !out.exif.exposure;
  if (!out.thumb || !out.date || exifGaps) {
    try {
      const inner = await parseEmbeddedJpegExif(rr, out.preview.offset, out.preview.length);
      if (inner) {
        if (!out.date && inner.dateStr) out.date = parseExifDateString(inner.dateStr);
        if (!out.camera && inner.camera) out.camera = inner.camera;
        if (inner.exif) {
          for (const k of Object.keys(out.exif)) {
            if (out.exif[k] == null && inner.exif[k] != null) out.exif[k] = inner.exif[k];
          }
        }
        if (!out.thumb) {
          const innerValid = await validateCandidates(rr, inner.candidates);
          if (innerValid.length) out.thumb = innerValid[innerValid.length - 1];
        }
      }
    } catch { /* thumb/date/exif are best-effort — the preview still stands */ }
  }
  // Resolve the lens: standard LensModel wins, Panasonic LensType fills in.
  if (!out.exif.lens && out.exif.lensMaker) out.exif.lens = out.exif.lensMaker;
  delete out.exif.lensMaker;
  return out;
}

// Expensive last resort for files indexRawFile() couldn't parse — bounded
// brute scan. Separate call so the bulk index stays fast; the UI invokes it
// only when the user actually opens an unparsed frame.
export async function indexDeep(readRange, size) {
  const rr = new RangeReader(readRange, size);
  const seg = await deepScanForJpeg(rr);
  return seg && seg.length >= 50 * 1024 ? { ...seg, source: 'scan' } : null;
}

// ============== SPEC FORMATTERS ==============
// Photographer-notation formatting for the assess-view spec readout (and any
// downstream consumer — exported so the open-source stack gets them free).
export function formatExposure(sec) {
  if (!sec || sec <= 0) return '';
  if (sec >= 1) return (Math.round(sec * 10) / 10) + 's';
  return '1/' + Math.round(1 / sec);
}

export function formatAperture(f) {
  return f > 0 ? 'ƒ/' + (Math.round(f * 10) / 10) : '';
}

export function formatFocal(mm, mm35) {
  if (!mm || mm <= 0) return '';
  let s = Math.round(mm) + 'mm';
  if (mm35 > 0 && Math.round(mm35) !== Math.round(mm)) s += ' · ' + Math.round(mm35) + 'mm eq';
  return s;
}

// ============== BURSTS ==============
// Group consecutive frames whose capture times sit within `gapMs` — dense
// bursts collapse into stacks in the grid. Items must be pre-sorted by the
// caller (date, then filename). Undated frames never group.
export function groupBursts(items, gapMs = 2000) {
  const groups = [];
  let cur = null;
  for (const it of items) {
    const t = it.dateMs;
    if (cur && t != null && cur.lastMs != null && t - cur.lastMs <= gapMs) {
      cur.items.push(it);
      cur.lastMs = t;
    } else {
      cur = { items: [it], lastMs: t ?? null };
      groups.push(cur);
    }
  }
  return groups.map(g => g.items);
}
