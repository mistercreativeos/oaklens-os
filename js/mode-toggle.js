/* Visitor Midnight/Daylight toggle. The worker renders .mode-toggle buttons
   into the nav when site.config.js → theme.toggle is enabled; this wires
   them. The pre-paint script in each page's <head> already resolved the
   initial mode, so this file only handles the click-and-persist side.
   localStorage 'ol-theme' (visitor override) beats data-theme-default. */
document.querySelectorAll('.mode-toggle').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var d = document.documentElement;
    var light = d.getAttribute('data-theme') !== 'light';
    if (light) d.setAttribute('data-theme', 'light');
    else d.removeAttribute('data-theme');
    try { localStorage.setItem('ol-theme', light ? 'light' : 'dark'); } catch (e) {}
  });
});
