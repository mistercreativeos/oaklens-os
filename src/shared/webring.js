// ---- ANALOGS.NETWORK webring membership ----
//
// A webring for independent, creative-run sites. Membership is opt-in per
// instance via `site.config.js` → `webring: { node, slug }`, the same shape
// `appleMusicEmbeds` and `webAnalytics` use — OFF is the shipped default, and
// off means the footer renders no chip and /.well-known/analogs.txt 404s.
//
// The default matters more here than for the other flags: a fork must never
// inherit a link into someone else's ring. It has to actually join (email the
// monitor, or open a PR on the registry) and get its own permanent number
// before anything renders.
//
// Deliberately NOT here: the ring's 88x31 button. It is hotlinked from
// analogs.network, so displaying it would widen the strict img-src policy for
// every fork and render as a broken image in the offline site export. The
// footer chip is the handshake instead — it links back all the same.
//
// Everything below is pure and config-driven so both the edge injector and the
// site-meta route can share it without a cycle (site-meta already imports from
// edge/chrome.js).

import siteConfig from '../../site.config.js';

export const RING_HOST = 'analogs.network';
export const RING_URL = `https://${RING_HOST}`;

// Assembled, never written as a literal. Two independent reasons:
//   1. injectSiteChrome rewrites every `a[href^="mailto:"]` on every HTML
//      response to siteConfig.email — and the console document goes through
//      that same rewriter, so a literal address there becomes the owner's own.
//   2. Cloudflare's email obfuscation mangles literal addresses in served HTML.
// analogs.network's own join overlay assembles it at runtime for the same reason.
export const RING_JOIN_MAILBOX = ['themonitor', RING_HOST].join('@');

// The ring's canonical discipline list — nodes/node.schema.json → disciplines
// enum, in palette order (the first one a node claims sets its light colour).
// The join email asks people to pick by number, so ORDER IS PART OF THE
// CONTRACT: renumbering these silently changes what an applicant is asking for.
export const RING_DISCIPLINES = Object.freeze([
  'Photography', 'Digital Art', 'Writing', 'Code', 'Music', 'Design', 'Architecture',
]);

// The registry's slug rule (node.schema.json): lowercase kebab, max 40.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The configured ring seat, or null when this instance is not a member.
 *
 * ⚠️ NODE 0 IS A VALID SEAT AND IS FALSY. The ring numbers from zero
 * (nodes/000-oaklens-art.json is the founding node), so `if (!node)` would
 * silently un-join seat zero. Every check here is an explicit integer test —
 * keep it that way.
 *
 * Read exact-shaped, like consoleFeatureOn: a half-filled block (a number with
 * no slug, a slug with no number, a stringified number) falls to the safe side,
 * which for an opt-in is OFF.
 *
 * ⚠️ NO DEFAULT PARAMETER, deliberately. It had one — `config = siteConfig.webring`
 * — and that meant `webringNode(someConfig.webring)` on a config with no webring
 * block passed `undefined`, triggered the default, and read THIS instance's seat
 * instead. A fork would have rendered a chip pointing at someone else's node.
 * Callers name the config they mean; `siteConfig.webring` is spelled out below.
 *
 * @param {{node?: unknown, slug?: unknown}} config the `webring` block
 * @returns {{node: number, slug: string} | null}
 */
export function webringNode(config) {
  if (!config || typeof config !== 'object') return null;
  const { node, slug } = config;
  if (!Number.isInteger(node) || node < 0) return null;
  if (typeof slug !== 'string' || slug.length > 40 || !SLUG_RE.test(slug)) return null;
  return { node, slug };
}

// Seats are written three digits wide everywhere the ring displays one — the
// registry filenames (000-oaklens-art.json) and the ownership token
// (node-007). The footer chip follows so the whole system reads the same.
export function ringNodeId(node) {
  return String(node).padStart(3, '0');
}

/**
 * The ownership claim served at /.well-known/analogs.txt — one line, exactly
 * the shape the ring's nodes/README.md specifies:
 *   analogs.network//node-007//your-slug
 * The ring does not read this yet (the domain-control sweep is still on its
 * backlog); serving it now means a fork is verification-ready the day it does.
 */
export function analogsToken(node = configuredNode()) {
  if (!node) return null;
  return `${RING_HOST}//node-${ringNodeId(node.node)}//${node.slug}`;
}

// Deep link to this node on the ring — analogs.network's own hash route
// (`applyHash` matches ^#\/([a-z0-9-]+)), which focuses the node in the ring
// visualisation rather than dropping the visitor on the index.
export function ringHref(node = configuredNode()) {
  if (!node) return null;
  return `${RING_URL}/#/${node.slug}`;
}

// This instance's own seat — the one place siteConfig is read, so every other
// caller is explicit about which config it means.
export function configuredNode() {
  return webringNode(siteConfig.webring);
}
