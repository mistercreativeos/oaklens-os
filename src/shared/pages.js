// ---- Public page list + config-driven page gating ----
//
// Extracted from worker.js (decomposition, manual §6.7). Shared by the router,
// the sitemap, the nav injector, and the daily Wayback-archive cron — all of
// which need to know which public pages exist and which are switched off in
// site.config.js. worker.js re-exports pageDisabled/publicPages so the public
// contract (and tests/page-gate.test.js) is unchanged.

import siteConfig from '../../site.config.js';

// Every public page. Shared by the sitemap and the daily Wayback-archive cron.
export const PUBLIC_PAGES = ['/', '/about', '/archive', '/field-notes', '/support', '/wall'];

// pages[key] === false turns a public page off end to end: the route 404s,
// the sitemap and Wayback cron drop it, and nav items pointing at it are
// filtered. A missing key means enabled, so existing configs change nothing.
export const PAGE_ROUTES = {
  archive: '/archive', fieldNotes: '/field-notes', wall: '/wall',
  about: '/about', support: '/support',
};

// Console infrastructure under /dev/ that must never be gated — disabling the
// public /dev page must not lock the owner out of their own console.
export const CONSOLE_PATHS = [
  '/dev/field-console', '/dev/console-gate.html', '/dev/sw.js',
  '/dev/manifest.webmanifest', '/dev/icon-180.png', '/dev/icon.svg',
];

export function pageDisabled(pathname) {
  const pages = siteConfig.pages;
  if (!pages) return false;
  if (CONSOLE_PATHS.some((p) => pathname === p || pathname.startsWith(p))) return false;
  for (const [key, root] of Object.entries(PAGE_ROUTES)) {
    if (pages[key] === false && (pathname === root || pathname.startsWith(root + '/'))) return true;
  }
  return false;
}

export function publicPages() {
  return PUBLIC_PAGES.filter((p) => !pageDisabled(p));
}
