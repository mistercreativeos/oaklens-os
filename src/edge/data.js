// Edge-cached data-JSON loader. Extracted from worker.js (decomposition,
// manual §6.7). Used by OG resolution (chrome.js) and the feed/buffer-summary
// endpoints (site-meta.js) so buffer.json (~134 KB) / archive.json aren't
// re-fetched and re-parsed on every crawler hit. Short TTL — social unfurls and
// feeds tolerate a few minutes of staleness after a publish.

const _DATA_CACHE_TTL = 300; // seconds

export async function loadDataJson(origin, env, path) {
  const cache = caches.default;
  const cacheKey = new Request(`${origin}/__datacache/${path}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();
  const res = await env.ASSETS.fetch(new Request(`${origin}/${path}`));
  if (!res.ok) {
    // Carry the status so callers can tell a MISSING file (404 — an un-seeded
    // fork ships without some data/*.json, see manual §5.21) from a transient
    // read failure. The feed maps 404 to an empty feed rather than a 503.
    const err = new Error(`fetch ${path} ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.text();
  await cache.put(cacheKey, new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${_DATA_CACHE_TTL}` },
  }));
  return JSON.parse(body);
}
