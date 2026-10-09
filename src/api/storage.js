// ---- Storage, measured: GET /api/storage, POST /api/storage ----
//
// How full the site's storage is, for the console's Bridge (js/console/bridge.js).
// Until this, nothing measured it: the "10 GB" free tier appeared only in setup
// copy, and the first an owner heard of a full bucket would have been a bill.
//
// WHAT IS MEASURED
//   r2    every object in the CDN bucket, summed per top-level folder
//         (archive/, audio/, videos/, wallpaper/, meta/, bench/, …) — the one
//         tier with a free allowance a working creative can actually reach
//   d1    the database file (drafts, pulses), from D1's own `size_after`
//   repo  the GitHub repo (the site's text and data), from the repo record
// Each tier is allowed to be unknown (null) — a fork without a repo or a D1 is
// told nothing rather than told zero.
//
// WHEN
// Once a day, from the existing 11:00 cron, into ONE KV key — so opening the
// console costs no listing at all, and the readout says how old it is. The
// owner can ask for a fresh measure (POST), at most once per RE_MEASURE_MS:
// listing a bucket is a billed operation per thousand objects, and a button
// that can be mashed is a meter that can be run.
//
// ⚠️ ONE KV KEY, IN THE NAMESPACE THAT ALREADY EXISTS — the devfeed's reasoning
// (src/api/devfeed.js): `__`-prefixed and @-free, which the subscriber export
// filters out by construction.

import { verifyToken } from '../shared/auth.js';
import { jsonRes } from '../shared/http.js';
import { githubCreds } from './publish-key.js';

export const STORAGE_KV_KEY = '__storage';
export const R2_FREE_BYTES = 10e9;              // Cloudflare R2's free storage, 10 GB
const RE_MEASURE_MS = 10 * 60 * 1000;

const store = (env) => (env && env.SUBSCRIBERS) || null;

/** Pure: objects → { bytes, objects, folders: { name: { bytes, objects } } }. */
export function summarizeObjects(objects) {
  const out = { bytes: 0, objects: 0, folders: {} };
  for (const o of objects || []) {
    const size = Number(o && o.size) || 0;
    const key = String((o && o.key) || '');
    const slash = key.indexOf('/');
    const folder = slash > 0 ? key.slice(0, slash) : '(root)';
    const f = out.folders[folder] || (out.folders[folder] = { bytes: 0, objects: 0 });
    f.bytes += size; f.objects += 1;
    out.bytes += size; out.objects += 1;
  }
  return out;
}

async function measureR2(env) {
  if (!env || !env.CDN || typeof env.CDN.list !== 'function') return null;
  const all = [];
  let cursor;
  do {
    const listed = await env.CDN.list({ cursor, limit: 1000 });
    for (const o of listed.objects || []) all.push({ key: o.key, size: o.size });
    cursor = listed.truncated ? listed.cursor : null;
  } while (cursor);
  return summarizeObjects(all);
}

async function measureD1(env) {
  if (!env || !env.DB) return null;
  try {
    const r = await env.DB.prepare('SELECT 1').run();
    const size = r && r.meta && Number(r.meta.size_after);
    return Number.isFinite(size) && size > 0 ? { bytes: size } : null;
  } catch { return null; }
}

async function measureRepo(env) {
  const gh = env ? await githubCreds(env) : null;
  if (!gh) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${gh.repo}`, {
      headers: {
        Authorization: `token ${gh.token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'oaklens-worker/1.0',
      },
    });
    if (!res.ok) return null;
    const repo = await res.json();
    // GitHub reports `size` in kilobytes.
    return Number.isFinite(repo.size) ? { bytes: repo.size * 1024 } : null;
  } catch { return null; }
}

/** Measure every tier and keep the result. Never throws: a failed tier is null. */
export async function measureStorage(env, now = Date.now()) {
  const [r2, d1, repo] = await Promise.all([
    measureR2(env).catch(() => null), measureD1(env), measureRepo(env),
  ]);
  const summary = { measuredAt: now, r2, d1, repo, r2FreeBytes: R2_FREE_BYTES };
  const kv = store(env);
  if (kv) {
    try { await kv.put(STORAGE_KV_KEY, JSON.stringify(summary)); } catch { /* answer anyway */ }
  }
  return summary;
}

async function readKept(env) {
  const kv = store(env);
  if (!kv) return null;
  try {
    const v = await kv.get(STORAGE_KV_KEY);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

// GET: what was measured last; measured now only if never measured.
export async function handleGetStorage(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  const kept = await readKept(env);
  const summary = kept || await measureStorage(env);
  return jsonRes({ ok: true, ...summary }, 200);
}

// POST: measure again, unless the last measure is fresher than RE_MEASURE_MS —
// then the kept one, marked so the console can say why nothing moved.
export async function handleMeasureStorage(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  const kept = await readKept(env);
  if (kept && Date.now() - (kept.measuredAt || 0) < RE_MEASURE_MS) {
    return jsonRes({ ok: true, ...kept, held: true }, 200);
  }
  return jsonRes({ ok: true, ...await measureStorage(env) }, 200);
}
