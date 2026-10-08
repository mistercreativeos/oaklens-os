// Storage, measured (src/api/storage.js) — the numbers behind the Bridge's gauge.
//
// Three things are held: the per-folder sums are right across a paged bucket
// listing; a tier that cannot be read is null, never zero; and the endpoint
// answers from the kept measure without listing the bucket, re-measuring only
// when asked and not more than once per ten minutes.

import { describe, it, expect } from 'vitest';
import { summarizeObjects, measureStorage, handleGetStorage, handleMeasureStorage, STORAGE_KV_KEY, R2_FREE_BYTES } from '../src/api/storage.js';
import { createToken } from '../src/shared/auth.js';

function fakeBucket(objects, page = 2) {
  const calls = [];
  return {
    calls,
    async list({ cursor, limit } = {}) {
      calls.push({ cursor, limit });
      const start = cursor ? Number(cursor) : 0;
      const slice = objects.slice(start, start + page);
      const next = start + page;
      return { objects: slice, truncated: next < objects.length, cursor: next < objects.length ? String(next) : undefined };
    },
  };
}
function fakeKv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); } };
}
const OBJECTS = [
  { key: 'archive/a-1600.webp', size: 400_000 },
  { key: 'archive/a-800.webp', size: 120_000 },
  { key: 'audio/tide.mp3', size: 3_000_000 },
  { key: 'meta/fn-1-og.webp', size: 90_000 },
  { key: 'loose.txt', size: 10 },
];

describe('summarizeObjects', () => {
  it('sums bytes and counts per top-level folder, and overall', () => {
    const s = summarizeObjects(OBJECTS);
    expect(s.bytes).toBe(3_610_010);
    expect(s.objects).toBe(5);
    expect(s.folders.archive).toEqual({ bytes: 520_000, objects: 2 });
    expect(s.folders.audio).toEqual({ bytes: 3_000_000, objects: 1 });
    expect(s.folders['(root)']).toEqual({ bytes: 10, objects: 1 });
  });
  it('is empty, not broken, for nothing', () => {
    expect(summarizeObjects([])).toEqual({ bytes: 0, objects: 0, folders: {} });
    expect(summarizeObjects(undefined).bytes).toBe(0);
  });
});

describe('measureStorage', () => {
  it('walks every page of the bucket and keeps the result in one KV key', async () => {
    const CDN = fakeBucket(OBJECTS, 2);
    const SUBSCRIBERS = fakeKv();
    const s = await measureStorage({ CDN, SUBSCRIBERS }, 1000);
    expect(CDN.calls.length).toBe(3);
    expect(s.r2.bytes).toBe(3_610_010);
    expect(s.r2FreeBytes).toBe(R2_FREE_BYTES);
    expect(s.measuredAt).toBe(1000);
    expect(JSON.parse(SUBSCRIBERS.m.get(STORAGE_KV_KEY)).r2.objects).toBe(5);
    // Internal-key convention: the subscriber export skips `__` keys with no @.
    expect(STORAGE_KV_KEY.startsWith('__') && !STORAGE_KV_KEY.includes('@')).toBe(true);
  });
  it('says nothing about a tier it cannot read', async () => {
    const s = await measureStorage({});
    expect(s.r2).toBeNull();
    expect(s.d1).toBeNull();
    expect(s.repo).toBeNull();
    const broken = await measureStorage({ CDN: { list: async () => { throw new Error('down'); } } });
    expect(broken.r2).toBeNull();
  });
  it('reads the database size D1 reports', async () => {
    const DB = { prepare: () => ({ run: async () => ({ meta: { size_after: 1_843_200 } }) }) };
    expect((await measureStorage({ DB })).d1).toEqual({ bytes: 1_843_200 });
  });
});

describe('the endpoint', () => {
  async function authed(method, env) {
    const token = await createToken(env);
    return new Request('https://example.com/api/storage', { method, headers: { Authorization: `Bearer ${token}` } });
  }
  const base = () => ({ SESSION_SECRET: 's'.repeat(48), CDN: fakeBucket(OBJECTS, 10), SUBSCRIBERS: fakeKv() });

  it('refuses without a console session', async () => {
    const res = await handleGetStorage(new Request('https://example.com/api/storage'), base());
    expect(res.status).toBe(401);
  });

  it('answers from the kept measure without listing the bucket', async () => {
    const env = base();
    env.SUBSCRIBERS.m.set(STORAGE_KV_KEY, JSON.stringify({ measuredAt: 5, r2: { bytes: 42, objects: 1, folders: {} } }));
    const body = await (await handleGetStorage(await authed('GET', env), env)).json();
    expect(body.ok).toBe(true);
    expect(body.r2.bytes).toBe(42);
    expect(env.CDN.calls.length, 'a kept measure must not cost a listing').toBe(0);
  });

  it('measures on first ask when nothing is kept', async () => {
    const env = base();
    const body = await (await handleGetStorage(await authed('GET', env), env)).json();
    expect(body.r2.bytes).toBe(3_610_010);
    expect(env.CDN.calls.length).toBe(1);
  });

  it('re-measures on POST, but not twice inside ten minutes', async () => {
    const env = base();
    env.SUBSCRIBERS.m.set(STORAGE_KV_KEY, JSON.stringify({ measuredAt: Date.now(), r2: { bytes: 1, objects: 1, folders: {} } }));
    const held = await (await handleMeasureStorage(await authed('POST', env), env)).json();
    expect(held.held).toBe(true);
    expect(env.CDN.calls.length).toBe(0);

    env.SUBSCRIBERS.m.set(STORAGE_KV_KEY, JSON.stringify({ measuredAt: Date.now() - 11 * 60_000, r2: { bytes: 1, objects: 1, folders: {} } }));
    const fresh = await (await handleMeasureStorage(await authed('POST', env), env)).json();
    expect(fresh.held).toBeUndefined();
    expect(fresh.r2.bytes).toBe(3_610_010);
  });
});
