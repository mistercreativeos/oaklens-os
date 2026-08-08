import { describe, it, expect } from 'vitest';
import { stripJpegPrivacyMetadata } from '../js/jpeg-privacy.js?v=1';

// The wallpaper full-res privacy scrub: EXIF (GPS), XMP, IPTC, comments and
// vendor APPn segments must not survive to the public CDN; JFIF, the ICC
// color profile, Adobe's transform marker, and — critically — the image data
// itself must pass through byte-identical. Fail-safe contract: anything that
// isn't a cleanly parseable JPEG comes back unchanged.

const str = (s) => [...s].map((c) => c.charCodeAt(0));

// Build a segment: FF <marker> <len-hi> <len-lo> <payload…>
function seg(marker, payload) {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}

const SOI = [0xff, 0xd8];
const APP0_JFIF = seg(0xe0, [...str('JFIF\0'), 1, 2, 0, 0, 1, 0, 1, 0, 0]);
const APP1_EXIF = seg(0xe1, [...str('Exif\0\0'), ...str('FAKE-TIFF-WITH-GPS-COORDS')]);
const APP1_XMP = seg(0xe1, [...str('http://ns.adobe.com/xap/1.0/\0'), ...str('<x:xmpmeta/>')]);
const APP2_ICC = seg(0xe2, [...str('ICC_PROFILE\0'), 1, 1, ...str('icc-color-data')]);
const APP5_VENDOR = seg(0xe5, str('vendor-junk'));
const APP13_IPTC = seg(0xed, [...str('Photoshop 3.0\0'), ...str('iptc-location')]);
const APP14_ADOBE = seg(0xee, [...str('Adobe\0'), 0, 100, 0, 0, 0]);
const COM = seg(0xfe, str('shot from my apartment'));
const DQT = seg(0xdb, [0, ...Array(64).fill(16)]);
const SOF0 = seg(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]);
// SOS header + entropy data + EOI (everything after SOS is copied verbatim).
const SOS_AND_DATA = [...seg(0xda, [1, 1, 0, 0, 63, 0]), 0xab, 0xcd, 0xef, 0x01, 0xff, 0x00, 0xff, 0xd9];

const fullJpeg = () => new Uint8Array([
  ...SOI, ...APP0_JFIF, ...APP1_EXIF, ...APP1_XMP, ...APP2_ICC,
  ...APP5_VENDOR, ...APP13_IPTC, ...APP14_ADOBE, ...COM, ...DQT, ...SOF0,
  ...SOS_AND_DATA,
]);

const asText = (bytes) => new TextDecoder('latin1').decode(bytes);

describe('stripJpegPrivacyMetadata', () => {
  it('removes EXIF, XMP, IPTC, vendor APPn, and comments', () => {
    const { bytes, removed } = stripJpegPrivacyMetadata(fullJpeg());
    const text = asText(bytes);
    expect(text).not.toContain('FAKE-TIFF-WITH-GPS-COORDS');
    expect(text).not.toContain('xmpmeta');
    expect(text).not.toContain('iptc-location');
    expect(text).not.toContain('vendor-junk');
    expect(text).not.toContain('shot from my apartment');
    expect(removed).toContain('APP1/EXIF-XMP');
    expect(removed).toContain('APP13/IPTC');
    expect(removed).toContain('APP5');
    expect(removed).toContain('COM');
  });

  it('keeps JFIF, the ICC profile, Adobe APP14, and structural segments', () => {
    const { bytes } = stripJpegPrivacyMetadata(fullJpeg());
    const text = asText(bytes);
    expect(text).toContain('JFIF');
    expect(text).toContain('ICC_PROFILE');
    expect(text).toContain('icc-color-data');
    expect(text).toContain('Adobe');
  });

  it('copies the entropy-coded image data byte-for-byte', () => {
    const { bytes } = stripJpegPrivacyMetadata(fullJpeg());
    const tail = bytes.subarray(bytes.length - SOS_AND_DATA.length);
    expect([...tail]).toEqual(SOS_AND_DATA);
    // Still a JPEG: starts SOI, ends EOI.
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect([bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0xff, 0xd9]);
  });

  it('returns a clean JPEG (nothing to strip) unchanged', () => {
    const clean = new Uint8Array([...SOI, ...APP0_JFIF, ...DQT, ...SOF0, ...SOS_AND_DATA]);
    const { bytes, removed } = stripJpegPrivacyMetadata(clean);
    expect(removed).toEqual([]);
    expect(bytes).toBe(clean);
  });

  it('returns non-JPEG input unchanged (fail-safe)', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { bytes, removed } = stripJpegPrivacyMetadata(png);
    expect(removed).toEqual([]);
    expect(bytes).toBe(png);
  });

  it('returns a truncated JPEG unchanged rather than emitting a corrupt file', () => {
    const truncated = fullJpeg().subarray(0, 40); // cut mid-APP1, no SOS reached
    const { bytes, removed } = stripJpegPrivacyMetadata(truncated);
    expect(removed).toEqual([]);
    expect(bytes).toBe(truncated);
  });

  it('bails unchanged on lost marker sync (garbage between segments)', () => {
    const bad = new Uint8Array([...SOI, ...APP1_EXIF, 0x00, 0x01, 0x02]);
    const { bytes, removed } = stripJpegPrivacyMetadata(bad);
    expect(removed).toEqual([]);
    expect(bytes).toBe(bad);
  });

  it('accepts an ArrayBuffer as input', () => {
    const src = fullJpeg();
    const { removed } = stripJpegPrivacyMetadata(src.buffer.slice(0));
    expect(removed.length).toBeGreaterThan(0);
  });
});
