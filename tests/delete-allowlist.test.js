// POST /api/delete-assets — deletes are restricted to the same R2 key prefixes
// the upload path may write (archive/, videos/, meta/, wallpaper/, bench/).
// Before this, uploads were prefix-restricted but deletes accepted ANY key, so
// an authed session (or a leaked bearer token, or a console bug building a bad
// key) could clear app state under data/ or the bucket root. No console
// workflow ever deletes outside the upload prefixes — every queued R2 delete
// is a variant key the console itself wrote — so the wall costs nothing.
import { describe, it, expect } from 'vitest';
import { handleDeleteAssets } from '../src/api/assets.js';
import { createToken } from '../src/shared/auth.js';

function fakeCDN() {
  const deleted = [];
  return {
    deleted,
    async delete(key) { deleted.push(key); },
  };
}

async function deleteReq(env, files) {
  const token = await createToken(env);
  return handleDeleteAssets(new Request('https://example.com/api/delete-assets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  }), env);
}

describe('POST /api/delete-assets — prefix allowlist', () => {
  it('deletes keys under the upload prefixes (incl. nested wallpaper/full/)', async () => {
    const cdn = fakeCDN();
    const env = { SESSION_SECRET: 'test-secret', CDN: cdn };
    const res = await deleteReq(env, [
      'archive/frame-480w.webp',
      'wallpaper/full/original.jpg',
      'meta/frame-og.webp',
      'bench/id-preview.jpg',
    ]);
    expect(res.status).toBe(200);
    expect(cdn.deleted).toEqual([
      'archive/frame-480w.webp',
      'wallpaper/full/original.jpg',
      'meta/frame-og.webp',
      'bench/id-preview.jpg',
    ]);
  });

  it('refuses data/, root, and traversal keys without touching R2', async () => {
    const cdn = fakeCDN();
    const env = { SESSION_SECRET: 'test-secret', CDN: cdn };
    const res = await deleteReq(env, [
      'data/posts.json',          // app state — the wall exists for this
      'some-root-key.webp',       // bucket root
      'archive/../data/x.json',   // traversal
      'archive/legit-480w.webp',  // the one allowed key in the batch
    ]);
    const body = await res.json();
    expect(res.status).toBe(500); // "some deletes failed" shape, unchanged
    expect(cdn.deleted).toEqual(['archive/legit-480w.webp']);
    expect(body.errors.sort()).toEqual([
      'archive/../data/x.json', 'data/posts.json', 'some-root-key.webp',
    ]);
    expect(body.deleted).toEqual(['archive/legit-480w.webp']);
  });
});
