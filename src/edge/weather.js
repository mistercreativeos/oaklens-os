// ---- Weather (stale-while-revalidate; never blocks the response) ----
//
// The footer temp used to be `await`-ed on the hot path of every HTML response,
// so a cache miss stalled TTFB on the Open-Meteo round-trip. Now the request
// path only ever reads cache (instant); a stale/cold entry triggers a
// background refresh via ctx.waitUntil. The cache entry carries a long max-age
// so it stays servable, and our own `ts` field drives the 90-min freshness.
//
// Extracted from worker.js (decomposition, manual §6.7). Coordinates come from
// site.config.js → location.coords, so nothing here is instance-hardcoded.

import siteConfig from '../shared/config.js';

const wxCacheKey = (origin) => `${origin}/__wx_cache`;
const WX_FRESH_MS = 90 * 60 * 1000; // revalidate in the background after 90 min

// Read the cached temp without ever touching the upstream API.
// Returns { temp, stale } or null when the cache is cold.
export async function readCachedTemp(origin) {
  const cached = await caches.default.match(new Request(wxCacheKey(origin)));
  if (!cached) return null;
  try {
    const { temp, ts } = await cached.json();
    if (typeof temp !== 'number') return null;
    return { temp, stale: !ts || (Date.now() - ts) > WX_FRESH_MS };
  } catch {
    return null;
  }
}

// Fetch Open-Meteo and refresh the cache. Safe to run inside ctx.waitUntil.
export async function refreshLocalTemp(origin) {
  try {
    const [lat, lon] = siteConfig.location.coords;
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=fahrenheit`
    );
    if (!res.ok) {
      console.error(`[wx] Open-Meteo responded ${res.status}`);
      return;
    }
    const json = await res.json();
    const temp = Math.round(json.current_weather.temperature);
    await caches.default.put(wxCacheKey(origin), new Response(
      JSON.stringify({ temp, ts: Date.now() }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } }
    ));
  } catch (err) {
    console.error('[wx] refresh failed:', err.message);
  }
}
