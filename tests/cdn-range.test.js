// /api/cdn HTTP Range handling (worker.js). Safari refuses to play media from
// a server that ignores Range, so the proxy passes bytes=… through to R2 and
// answers 206 with a correct Content-Range. This pins the offset/suffix/
// open-ended math, the unsatisfiable-range fallback to a full read, and the
// content-type derivation — the range path was Miniflare-only before.
import { describe, it, expect } from 'vitest';
import worker from '../worker.js';

const SESSION_SECRET = 'test-secret-please-ignore';
const SIZE = 500;

// R2 stub for one media object. get() with a {range} echoes the requested
// range and reports the FULL object size (R2 semantics), and throws when the
// offset is past the object — the "unsatisfiable range" the worker recovers
// from with a full read.
function makeMedia(key, { size = SIZE, contentType } = {}) {
  const full = () => ({
    size,
    httpMetadata: contentType ? { contentType } : {},
    body: 'DATA',
  });
  return {
    async get(k, opts) {
      if (k !== key) return null;
      if (opts && opts.range) {
        const r = opts.range;
        const offset = r.offset != null
          ? r.offset
          : r.suffix != null ? Math.max(0, size - r.suffix) : 0;
        if (offset >= size) throw new Error('range not satisfiable');
        return { ...full(), range: r };
      }
      return full();
    },
  };
}

const KEY = 'archive/clip.mp4';
const get = (cdn, key = KEY, range) =>
  worker.fetch(
    new Request(`https://example.com/api/cdn/${key}`, range ? { headers: { Range: range } } : undefined),
    { SESSION_SECRET, CDN: cdn }
  );

describe('/api/cdn full (no Range)', () => {
  it('200s with Accept-Ranges and the full Content-Length, no Content-Range', async () => {
    const res = await get(makeMedia(KEY));
    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Length')).toBe(String(SIZE));
    expect(res.headers.get('Content-Range')).toBeNull();
  });
});

describe('/api/cdn Range → 206', () => {
  it('offset+end: bytes=0-99', async () => {
    const res = await get(makeMedia(KEY), KEY, 'bytes=0-99');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-99/${SIZE}`);
    expect(res.headers.get('Content-Length')).toBe('100');
  });

  it('offset+end mid-object: bytes=100-199', async () => {
    const res = await get(makeMedia(KEY), KEY, 'bytes=100-199');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 100-199/${SIZE}`);
    expect(res.headers.get('Content-Length')).toBe('100');
  });

  it('open-ended: bytes=100- runs to the last byte', async () => {
    const res = await get(makeMedia(KEY), KEY, 'bytes=100-');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 100-${SIZE - 1}/${SIZE}`);
    expect(res.headers.get('Content-Length')).toBe(String(SIZE - 100));
  });

  it('suffix: bytes=-100 returns the last 100 bytes', async () => {
    const res = await get(makeMedia(KEY), KEY, 'bytes=-100');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes ${SIZE - 100}-${SIZE - 1}/${SIZE}`);
    expect(res.headers.get('Content-Length')).toBe('100');
  });

  it('suffix larger than the object clamps to the whole object', async () => {
    const res = await get(makeMedia(KEY), KEY, 'bytes=-9999');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-${SIZE - 1}/${SIZE}`);
    expect(res.headers.get('Content-Length')).toBe(String(SIZE));
  });
});

describe('/api/cdn Range fallbacks', () => {
  it('an unsatisfiable offset falls through to a full 200', async () => {
    const res = await get(makeMedia(KEY), KEY, 'bytes=99999-');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Range')).toBeNull();
    expect(res.headers.get('Content-Length')).toBe(String(SIZE));
  });

  it('a malformed Range header is ignored (full 200)', async () => {
    const res = await get(makeMedia(KEY), KEY, 'bytes=abc');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Range')).toBeNull();
  });

  it('an empty Range (bytes=-) is ignored (full 200)', async () => {
    const res = await get(makeMedia(KEY), KEY, 'bytes=-');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Range')).toBeNull();
  });

  it('404s a missing key even with a Range header', async () => {
    const res = await get(makeMedia(KEY), 'archive/missing.mp4', 'bytes=0-99');
    expect(res.status).toBe(404);
  });
});

describe('/api/cdn content-type derivation', () => {
  it('R2 httpMetadata contentType wins when present', async () => {
    const res = await get(makeMedia(KEY, { contentType: 'video/quicktime' }));
    expect(res.headers.get('Content-Type')).toBe('video/quicktime');
  });

  it('falls back to video/mp4 for .mp4 with no stored type', async () => {
    const res = await get(makeMedia('archive/clip.mp4'), 'archive/clip.mp4');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
  });

  it('falls back to video/webm for .webm', async () => {
    const res = await get(makeMedia('archive/clip.webm'), 'archive/clip.webm');
    expect(res.headers.get('Content-Type')).toBe('video/webm');
  });

  it('falls back to image/webp otherwise', async () => {
    const res = await get(makeMedia('archive/frame-480w.webp'), 'archive/frame-480w.webp');
    expect(res.headers.get('Content-Type')).toBe('image/webp');
  });
});
