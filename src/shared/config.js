// The engine's view of site.config.js: the fork's own file, laid over a
// complete set of engine defaults. Every server module reads config through
// here rather than importing site.config.js directly.
//
// WHY THIS EXISTS. A fork takes engine updates with `git merge upstream/main`,
// and the one file that merge deliberately never touches is `site.config.js` —
// it holds their identity, so setup.md tells them to always keep their own
// copy. Which means every config key the engine adds is a key that every
// existing fork's config does not have. Read straight, that is a TypeError on
// the path that renders every page, delivered by a merge that reported no
// conflicts at all. `siteConfig.location.name` in site.js was exactly that
// shape: two call sites guarded `location` with `|| {}` and a third read
// `.name` off it directly.
//
// THE RULE WHEN YOU ADD A KEY: give it a default here, in the same change.
// Never make the engine require a key that a fork's existing file cannot
// contain, and never rename one — add the new name and keep reading the old
// until you are willing to break somebody's site.
//
// TWO CATEGORIES, and the difference between them is load-bearing:
//
//   BACKFILL — absence is a bug. Nothing in the engine treats a missing `name`
//   or `location` as a decision, so these are filled in whether the fork
//   mentioned them or not.
//
//   SHAPE — absence is a SIGNAL the engine already honours, and overruling it
//   would undo a deliberate deletion. No `wordmark` means "fall back to name".
//   No `entity` means "emit no JSON-LD". No `support` means "show the page's
//   empty state". No `pages` means "nothing is disabled". These are merged
//   only when the fork supplied the key at all — and then their sub-keys ARE
//   filled in, so a new page or a new console surface added upstream arrives
//   with the engine's default instead of `undefined`.

import userConfig from '../../site.config.js';

/** Absence is a bug: always present after resolution. */
export const BACKFILL = Object.freeze({
  name: 'Untitled Site',
  tagline: '',
  email: '',
  contactName: '',
  // The crash this whole module exists to prevent. `coords` must be a
  // two-number array: weather.js destructures it without looking.
  location: { name: '', region: '', coords: [0, 0] },
  // Filtered against pages{} before render, so an empty nav is a valid site.
  nav: [],
  theme: { preset: 'aperture', defaultMode: 'midnight', toggle: true },
  // Every one of these is already read with an explicit `=== true` or
  // `!== false`, so they need no protection. They are written out anyway:
  // BACKFILL plus SHAPE is meant to be a complete, readable statement of the
  // config shape, and a flag that only exists in a comment gets forgotten.
  legacyRedirects: false,
  webAnalytics: false,
  appleMusicEmbeds: false,
  demoMode: false,
  repoConnected: false,
  poweredBy: true,
});

/** Absence is a signal: filled in only when the fork supplied the key. */
export const SHAPE = Object.freeze({
  wordmark: { stem: '', accent: '' },
  folioHero: { image: '', alt: '' },
  pages: { archive: true, fieldNotes: true, about: true, wall: false, support: false },
  console: { bench: false },
  entity: { name: '', logo: '/favicon.svg', sameAs: [] },
  support: { blurb: '', tiers: [], note: '', disclaimer: '' },
  webring: { node: null, slug: '' },
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Arrays replace wholesale rather than merging, in both directions: a fork's
// three-item `nav` is the whole nav, not an addition to ours, and the same
// goes for `coords`, `sameAs` and `tiers`.
function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Exported for the test suite, which resolves configs this module never sees. */
export function resolveConfig(user) {
  const src = isPlainObject(user) ? user : {};
  const merged = deepMerge(BACKFILL, src);
  for (const [key, shape] of Object.entries(SHAPE)) {
    if (isPlainObject(src[key])) merged[key] = deepMerge(shape, src[key]);
  }
  return merged;
}

// Frozen at the top level, matching what site.config.js itself does.
export default Object.freeze(resolveConfig(userConfig));
