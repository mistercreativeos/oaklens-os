// OAKLENS // FIELD CONSOLE — JPEG privacy scrub (ES module).
//
// Strips metadata segments that can carry location or device identity from a
// JPEG **without re-encoding** — the entropy-coded image data is copied
// byte-for-byte, so the picture is pixel-identical. This exists for the one
// console path that ships a user's *original bytes* to the public CDN: the
// wallpaper full-res download (`wallpaper/full/<original>.jpg`). Every other
// ingest path is safe by construction (canvas re-encode to WebP drops EXIF).
// A phone-shot original can carry GPS coordinates of the photographer's home
// in its EXIF — secure-by-default means those never reach the CDN.
//
// Dropped:  APP1 (EXIF incl. GPS IFD, and XMP), APP13 (Photoshop/IPTC),
//           COM comments, and all other APPn vendor segments except below.
// Kept:     APP0 (JFIF header), APP2 "ICC_PROFILE" (color fidelity),
//           APP14 (Adobe color-transform — dropping it can wreck color
//           interpretation), and every structural segment (DQT/DHT/SOF/SOS…).
//
// Fail-safe: anything that doesn't parse cleanly as a complete JPEG is
// returned unchanged — never corrupt a user's original. DOM-free and
// dependency-free; unit-tested in tests/jpeg-privacy.test.js.

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;

const ICC_ID = 'ICC_PROFILE\0';

function _isIccApp2(bytes, off, len) {
  if (len < 2 + ICC_ID.length) return false;
  for (let i = 0; i < ICC_ID.length; i++) {
    if (bytes[off + 4 + i] !== ICC_ID.charCodeAt(i)) return false;
  }
  return true;
}

function _keepApp(bytes, off, marker, len) {
  const n = marker - 0xe0;
  if (n === 0) return true;                       // APP0  — JFIF/JFXX
  if (n === 14) return true;                      // APP14 — Adobe transform
  if (n === 2) return _isIccApp2(bytes, off, len); // APP2 — ICC only
  return false;                                   // APP1/EXIF/XMP, APP13/IPTC, vendor APPn
}

function _removedLabel(marker) {
  if (marker === COM) return 'COM';
  if (marker === 0xe1) return 'APP1/EXIF-XMP';
  if (marker === 0xed) return 'APP13/IPTC';
  return `APP${marker - 0xe0}`;
}

// buffer: ArrayBuffer | Uint8Array.
// Returns { bytes: Uint8Array, removed: string[] } — `removed` is empty when
// nothing was stripped (including non-JPEG or unparseable input, in which
// case `bytes` is the input unchanged).
export function stripJpegPrivacyMetadata(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const asIs = { bytes, removed: [] };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return asIs;

  const keep = [[0, 2]]; // SOI
  const removed = [];
  let complete = false;
  let off = 2;

  while (off + 2 <= bytes.length) {
    if (bytes[off] !== 0xff) return asIs;        // lost marker sync — bail unchanged
    const marker = bytes[off + 1];
    if (marker === 0xff) { off++; continue; }    // fill byte

    if (marker === SOS || marker === EOI) {
      // Entropy-coded data (or the end) — keep everything from here verbatim.
      keep.push([off, bytes.length]);
      complete = true;
      break;
    }

    if (off + 4 > bytes.length) return asIs;     // truncated segment header
    const len = (bytes[off + 2] << 8) | bytes[off + 3];
    if (len < 2 || off + 2 + len > bytes.length) return asIs;
    const segEnd = off + 2 + len;

    if (marker >= 0xe0 && marker <= 0xef) {
      if (_keepApp(bytes, off, marker, len)) keep.push([off, segEnd]);
      else removed.push(_removedLabel(marker));
    } else if (marker === COM) {
      removed.push(_removedLabel(marker));
    } else {
      keep.push([off, segEnd]);                  // tables / frame headers / DRI …
    }
    off = segEnd;
  }

  // Only rebuild a file we walked end-to-end AND actually changed.
  if (!complete || removed.length === 0) return asIs;

  const total = keep.reduce((n, [a, b]) => n + (b - a), 0);
  const out = new Uint8Array(total);
  let w = 0;
  for (const [a, b] of keep) {
    out.set(bytes.subarray(a, b), w);
    w += b - a;
  }
  return { bytes: out, removed };
}
