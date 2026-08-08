// site.config.example.js — starter defaults for a fresh OAKLENS OS fork.
//
// Copy to site.config.js (scripts/setup.sh does this for you), then edit
// every field. Identity never lives in code: everything a fork changes is in
// this one file, and everything else derives from the request origin at
// runtime, so a fresh fork works on *.workers.dev with zero extra config.
export default Object.freeze({
  name: 'Your Studio',
  tagline: 'Photography portfolio',
  email: 'you@example.com',
  contactName: 'You',
  // The display wordmark: nav logo, footer, page <title>, console chrome.
  // Optionally split in two so the second half takes the theme's accent colour
  // — { stem: 'STUDIO', accent: '.COM' } renders STUDIO.COM with .COM in
  // accent. Leave `accent` empty for a single-colour wordmark, or delete the
  // line entirely to fall back to `name`.
  wordmark: { stem: 'YOUR STUDIO', accent: '' },
  location: {
    name: 'YOUR CITY',
    region: '',     // optional; joined as "YOUR CITY, ST" in the footer
    coords: [0, 0], // weather API (Open-Meteo) — your city's lat/lon
  },
  // Nav bar (desktop + mobile), injected at the edge. Items pointing at a
  // page disabled in pages{} below are filtered automatically.
  nav: [
    { label: 'Work', href: '/archive' },
    { label: 'Field Notes', href: '/field-notes' },
    { label: 'About', href: '/about' },
  ],
  // Starter look: 'aperture' (contemporary studio, cobalt) is the default.
  // 'passe-partout' (fine-art gallery, oxblood on warm paper) and 'noir'
  // (tech-noir terminal: black / white / red) are one-word swaps.
  // defaultMode: 'midnight' | 'daylight' | 'auto' (follows the visitor's OS).
  theme: { preset: 'aperture', defaultMode: 'midnight', toggle: true },
  // Featured image for the folio hero (the aperture/passe-partout homepage
  // hero, and noir's fallback). Ships pointing at a bundled CC0 sample frame so
  // a fresh fork renders immediately; swap for your own (a repo path or a
  // `/api/cdn/…` key once you've uploaded frames).
  folioHero: {
    image: '/assets/samples/sample-hero-2048w.webp',
    alt: 'Featured photograph',
  },
  // Homepage split hero — NOIR preset only (a two-panel tool/code + photo hero
  // instead of the folio hero). Omit it and noir falls back to the folio hero.
  // Uncomment and fill in to use it:
  // splitHero: {
  //   code:  { image: '/assets/samples/sample-01-2048w.webp', imagePosition: '50% 50%',
  //            headline: 'CODE THE TOOL.', cta: { href: '/os', label: 'OS', ariaLabel: 'Read more' } },
  //   photo: { image: '/assets/samples/sample-hero-2048w.webp',
  //            headline: 'SHOOT THE WORLD.', cta: { href: '/archive', label: 'view archive' } },
  // },
  // The support page (/support) — off by default in pages{} below, so this is
  // here ready for the day you turn it on. Every tier is edge-injected into the
  // page, which ships neutral placeholders: the payment links and the copy
  // around them are yours, never the engine's. `url` is whatever hosted
  // checkout you use — Stripe, Ko-fi, Liberapay, PayPal, anything with a link.
  // A tier with no `url` renders as a plain card; an empty `tiers` list (or no
  // `support` block at all) shows the page's empty state. `blurb` and
  // `disclaimer` take a string or a list of lines, joined with a line break.
  support: {
    blurb: [
      'This site is made by hand and paid for out of pocket.',
      'If it has been useful to you, here are a few ways to help keep it running.',
    ],
    tiers: [
      {
        icon: '☕', name: 'Coffee', price: 'OPEN / PWYW',
        desc: 'Whatever it is worth to you. Covers hosting for a week.',
        url: 'https://example.com/donate/coffee',
      },
      {
        icon: '🎞', name: 'Film', price: '15.00 USD',
        desc: 'A roll and the developing. Keeps new work coming.',
        url: 'https://example.com/donate/film',
      },
      {
        icon: '💽', name: 'Archive', price: '50.00 USD',
        desc: 'Storage and backups, so nothing published here disappears.',
        url: 'https://example.com/donate/archive',
      },
    ],
    note: 'Payments handled by your provider',
    disclaimer: '',
  },
  // Public-page switches — false turns a page off end to end (route 404s,
  // sitemap drops it, nav filters it). The starter ships the minimal trio;
  // theWall (wallpapers + Photo Lab), the /dev and /os pages, and the
  // support page are one-line enables when you want them.
  pages: {
    archive: true, fieldNotes: true, about: true,
    wall: false, dev: false, os: false, support: false,
  },
  // Field Console surfaces that are opt-in. Unlike pages{} above, a missing or
  // false key here means OFF — nothing in this block is needed for a working
  // console, and the whole block can stay as it is.
  //   bench — a RAW-processing worklist. It is off because the engine has no
  //   way to *fill* it yet: today's only feeder is a macOS command-line script
  //   that isn't part of the template. The in-browser version (pick RAWs on a
  //   memory card, no terminal, no extra storage account) is designed and
  //   waiting to be built — see docs/bench-decision.md. Leave this alone until
  //   then; switching it on just shows an empty tab.
  console: { bench: false },
  // Squarespace-era redirect table in worker.js — template forks have no
  // such history.
  legacyRedirects: false,
  // Cloudflare Web Analytics (privacy-friendly, no cookies). OFF by default:
  // the beacon is third-party JavaScript, and the published site's promise is
  // that public pages load none. Turning this on widens the public
  // Content-Security-Policy to allow Cloudflare's beacon — nothing else.
  // If you enable Web Analytics in the Cloudflare dashboard, set this too, or
  // the browser will block the auto-injected script.
  // webAnalytics: true,
  // Apple Music players in Field Notes. OFF by default for the same reason:
  // the player is a third-party iframe (embed.music.apple.com), and the
  // default policy is frame-src 'none'. Turning this on widens the
  // Content-Security-Policy to allow exactly that one host, and lets the
  // Field Notes renderer turn a pasted music.apple.com share link into a
  // player. Left off, a share link in a post renders as a plain link.
  // appleMusicEmbeds: true,
  // Demo mode: run this instance as a public, browse-only showcase. Everyone
  // can log in with the password you share and explore the whole console, but
  // every write — uploads, deletes, drafts, publish, even the subscribe form —
  // answers a polite "off in demo mode" instead of changing anything. It's a
  // config switch, not a login rule: to add or refresh content, run a second
  // deployment (or `npx wrangler dev`) WITHOUT this flag against the same
  // storage, using your own password. OFF by default — a normal site never
  // wants this.
  // demoMode: true,
  // Set this once you connect the repo to Cloudflare Builds (your Worker →
  // Settings → Build). It only changes what the console's publish card says:
  // connected instances see "Cloudflare rebuilds — live in about a minute",
  // unconnected ones keep the honest "run npx wrangler deploy" instruction.
  // The Worker can't detect the connection itself, so this flag carries it.
  // repoConnected: true,
  // Search-engine entity (Organization + WebSite JSON-LD on the homepage).
  // sameAs: only live, crawlable profile URLs — an empty list is fine.
  entity: {
    name: 'YOUR STUDIO',
    logo: '/favicon.svg',
    sameAs: [],
  },
});
