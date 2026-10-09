// ---- The first-run welcome, once per site: GET /api/welcome, POST /api/welcome ----
//
// The console's welcome card (dev/field-console.html #welcome-card) is for an
// owner of about ninety seconds, and it ends "This won't show again." It used
// to decide from the browser alone: one localStorage key, and "is this
// device's copy of the site empty?". Both were wrong in the same direction:
//   · every new device, home-screen app (iOS gives it its own storage),
//     private window or cleared browser got the card again;
//   · a device that keeps nothing (THIS DEVICE 0%, the owner's own setup)
//     looked empty until the sync landed, so an established site with 729
//     frames was welcomed as brand new (measured 2026-10-08 in the rig).
// So the site decides, here, once:
//   show  only if the site has never been welcomed AND has published nothing
//         (its own data files, not any device's copy of them);
//   a site with published work is marked welcomed the first time anyone asks,
//   so an existing site never sees the card, now or the day its buffer empties.
//
// ⚠️ ONE KV KEY, IN THE NAMESPACE THAT ALREADY EXISTS — `__`-prefixed and
// @-free, as src/api/storage.js and src/api/devfeed.js do, so the subscriber
// export filters it out by construction.

import siteConfig from '../shared/config.js';
import { verifyToken } from '../shared/auth.js';
import { jsonRes } from '../shared/http.js';
import { loadDataJson } from '../edge/data.js';

export const WELCOME_KV_KEY = '__welcomed';
// The published surfaces that make a site "not new". The same five the
// console used to check on its own copy.
export const WELCOME_CONTENT_FILES = ['posts', 'buffer', 'archive', 'wallpapers', 'library'];

const store = (env) => (env && env.SUBSCRIBERS) || null;

/** Has this site published anything? A missing file (an un-seeded fork) is empty. */
export async function siteHasContent(origin, env) {
  for (const name of WELCOME_CONTENT_FILES) {
    try {
      const data = await loadDataJson(origin, env, `data/${name}.json`);
      if (Array.isArray(data) && data.length) return true;
    } catch (err) {
      if (err && err.status === 404) continue;
      throw err;   // a read that failed is not "empty": the caller says don't show
    }
  }
  return false;
}

async function markWelcomed(env, reason, now = Date.now()) {
  const kv = store(env);
  if (!kv) return false;
  try {
    await kv.put(WELCOME_KV_KEY, JSON.stringify({ at: now, reason }));
    return true;
  } catch { return false; }
}

// GET: should this console show the welcome? Anything uncertain answers no.
export async function handleGetWelcome(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (siteConfig.demoMode) return jsonRes({ ok: true, show: false, reason: 'demo' }, 200);
  const kv = store(env);
  if (kv) {
    try {
      if (await kv.get(WELCOME_KV_KEY)) return jsonRes({ ok: true, show: false, reason: 'welcomed' }, 200);
    } catch {
      return jsonRes({ ok: true, show: false, reason: 'unknown' }, 200);
    }
  }
  let content;
  try {
    content = await siteHasContent(new URL(request.url).origin, env);
  } catch {
    return jsonRes({ ok: true, show: false, reason: 'unknown' }, 200);
  }
  if (content) {
    await markWelcomed(env, 'has-content');
    return jsonRes({ ok: true, show: false, reason: 'has-content' }, 200);
  }
  return jsonRes({ ok: true, show: true }, 200);
}

// POST: the owner has seen it. Recorded for the site, so no device shows it again.
export async function handlePostWelcome(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  const saved = await markWelcomed(env, 'dismissed');
  return jsonRes({ ok: saved }, saved ? 200 : 503);
}
