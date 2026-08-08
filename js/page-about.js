/* page-about.js — About page control wiring.
   ============================================================================
   The About page is pure markup except for one interaction: the contact
   block's "The Drop" subscribe panel. This lives in an external module (not an
   inline block or on* attributes) because public pages run a strict
   script-src with no 'unsafe-inline' — the one allowed inline script is the
   pre-paint mode block in <head>, pinned by a sha256 hash (tests/csp.test.js).

   submitGTD() comes from site-common.js, which is loaded synchronously just
   before this file; this one is `defer`red, so the helper and the DOM are both
   ready by the time anything below runs. Every lookup is optional-chained so
   the module is inert on a page (or a fork) that ships no contact block. */

const btn = document.getElementById('gtd-about-btn');
const panel = document.getElementById('gtd-about-panel');
const email = document.getElementById('gtd-about-email');

/* Reveal the panel and hand focus straight to the field, so the button reads
   as one step rather than two. aria-expanded keeps the state announced. */
function toggleAboutGTD() {
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  btn?.setAttribute('aria-expanded', String(!open));
  if (!open) email?.focus();
}

function submitAboutGTD() {
  // ids: input, form, ok, err, source — the source tags the subscriber row.
  submitGTD('gtd-about-email', 'gtd-about-form', 'gtd-about-ok', 'gtd-about-err', 'about');
}

btn?.addEventListener('click', toggleAboutGTD);
document.querySelector('#gtd-about-form .gtd-submit')
  ?.addEventListener('click', submitAboutGTD);

/* Enter submits, and never submits an enclosing form (there isn't one today,
   but the panel is a likely place for a fork to add one). */
email?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitAboutGTD(); }
});
