// /api/cdn key validation + /api/upload key sanitization.
//
// The proxy and the upload path share one key charset (R2_KEY_CHARS in
// worker.js): anything the console can store, the proxy can serve. This
// matters on a zero-config fork, where all media serves through the proxy —
// real library objects carry spaces, '=' and '+' (camera exports,
// pre-console migrations), and the live custom CDN domain masks any
// mismatch. Found by a real site export: 'archive/OAKLENS_SF-two
// cyclist-blur-1024w.webp' 400'd through the proxy while serving fine from
// cdn.example.com.
import { describe, it, expect } from 'vitest';
import worker from '../worker.js';
import { createToken } from '../src/shared/auth.js';

const SESSION_SECRET = 'test-secret-please-ignore';

// R2 stub: get() answers for the listed keys, put() records what was stored.
function makeCdn(keys = []) {
  const objects = new Map(keys.map((k) => [k, 'bytes']));
  const stored = [];
  return {
    stored,
    async get(key) {
      if (!objects.has(key)) return null;
      return { body: objects.get(key), size: 5, httpMetadata: { contentType: 'image/webp' } };
    },
    async put(key) { stored.push(key); objects.set(key, 'bytes'); },
  };
}

const env = (cdn) => ({ SESSION_SECRET, CDN: cdn });

// Keys travel URL-encoded, exactly as the pages and the exporter build them.
const proxyGet = (key, cdn) =>
  worker.fetch(
    new Request(`https://example.com/api/cdn/${encodeURIComponent(key).replace(/%2F/gi, '/')}`),
    env(cdn)
  );

describe('/api/cdn key validation', () => {
  // The two real-library shapes that used to 400 (masked on the live site by
  // the custom CDN domain; fatal on a zero-config fork).
  it('serves decoded keys containing spaces', async () => {
    const key = 'archive/OAKLENS_SF-two cyclist-blur-1024w.webp';
    const res = await proxyGet(key, makeCdn([key]));
    expect(res.status).toBe(200);
  });

  it('serves a base name with a space before the size suffix', async () => {
    const key = 'archive/Earpiece -480w.webp';
    const res = await proxyGet(key, makeCdn([key]));
    expect(res.status).toBe(200);
  });

  it("serves keys containing '=', '+' and parens", async () => {
    for (const key of [
      'archive/frame=005-480w.webp',
      'archive/shot+one-1024w.webp',
      'archive/roll (2)-480w.webp',
    ]) {
      const res = await proxyGet(key, makeCdn([key]));
      expect(res.status, key).toBe(200);
    }
  });

  it('still 404s (not 400s) a well-formed key that is not in R2', async () => {
    const res = await proxyGet('archive/missing-480w.webp', makeCdn([]));
    expect(res.status).toBe(404);
  });

  it('serves keys under dev/ prefix', async () => {
    const key = 'dev/it_belongs_in_an_archive_FINAL_yellow_subs.jpg';
    const res = await proxyGet(key, makeCdn([key]));
    expect(res.status).toBe(200);
  });

  // The anchors the wider charset must not loosen.
  it('keeps prefix anchoring: non-public prefixes are rejected', async () => {
    for (const key of ['data/buffer.json.webp', 'secrets/x.webp', 'x.webp']) {
      const res = await proxyGet(key, makeCdn([key]));
      expect(res.status, key).toBe(400);
    }
  });

  it('keeps extension anchoring: non-media extensions are rejected', async () => {
    for (const key of ['archive/x.txt', 'archive/x.webp.html', 'archive/x']) {
      const res = await proxyGet(key, makeCdn([key]));
      expect(res.status, key).toBe(400);
    }
  });

  it("keeps '..' safety even though '.' and '/' are in the charset", async () => {
    const key = 'archive/../data/x.webp';
    const res = await proxyGet(key, makeCdn([key]));
    expect(res.status).toBe(400);
  });
});

describe('/api/upload key sanitization', () => {
  async function upload(name, cdn) {
    const token = await createToken(env(cdn));
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(8)], name, { type: 'image/webp' }));
    return worker.fetch(
      new Request('https://example.com/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      }),
      env(cdn)
    );
  }

  it('preserves spaces, = and + instead of silently stripping them', async () => {
    // The old sanitizer deleted these characters, so the stored key diverged
    // from the filename the console records in buffer.json.
    const cdn = makeCdn();
    const res = await upload('archive/two cyclist=x+y-480w.webp', cdn);
    expect(res.status).toBe(200);
    expect(cdn.stored).toEqual(['archive/two cyclist=x+y-480w.webp']);
  });

  it('trims leading/trailing whitespace off every key segment', async () => {
    const cdn = makeCdn();
    const res = await upload('archive/ frame-480w.webp ', cdn);
    expect(res.status).toBe(200);
    expect(cdn.stored).toEqual(['archive/frame-480w.webp']);
  });

  it('round-trips: what upload stores, the proxy serves', async () => {
    const cdn = makeCdn();
    await upload('archive/OAKLENS_SF-two cyclist-blur-1024w.webp', cdn);
    expect(cdn.stored).toHaveLength(1);
    const res = await proxyGet(cdn.stored[0], cdn);
    expect(res.status).toBe(200);
  });

  it('still rejects keys outside the allowed prefixes and ..', async () => {
    for (const name of ['data/buffer.json', 'meta/../data/x.webp', 'nope/x.webp']) {
      const cdn = makeCdn();
      const res = await upload(name, cdn);
      expect(res.status, name).toBe(500); // per-file error path: nothing stored
      expect(cdn.stored).toEqual([]);
    }
  });
});
