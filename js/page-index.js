// Homepage-specific behaviour. Loaded deferred, after site-common.js (which
// auto-wires the mobile nav). Externalized from
// an inline <script> so the page satisfies a strict script-src (no
// 'unsafe-inline'); see docs/os-launch-plan.md.

// ---- Split hero (noir): show the OS CTA inside the photo panel on mobile,
//      where the CODE panel is hidden. No-op when the folio hero is active. ----
function syncMobileTerminalCta() {
  const show = window.innerWidth <= 900;
  document.querySelectorAll('.hero-panel--photo .hero-cta--os').forEach(el => {
    el.style.display = show ? 'inline-flex' : 'none';
  });
}
syncMobileTerminalCta();
window.addEventListener('resize', syncMobileTerminalCta);

// The recent-work grid is rendered by js/recent-index.js (loaded in <head>).
