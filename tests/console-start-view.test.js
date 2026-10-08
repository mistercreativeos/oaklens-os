// @vitest-environment happy-dom
//
// Which surface the console opens to (js/console/chrome.js, START VIEW).
//
// It used to be the Buffer because the markup shipped #view-buffer marked
// .active, and nothing else decided. Now the markup marks nothing and init()
// seats the first of: a ?view= link, this device's choice, the site's
// console.startView (stamped by the edge), the Buffer. Three things are held
// here: the order, the edge stamp, and a real boot that honours a device
// choice — because "the setting is saved" is worthless if the console still
// opens on the camera roll.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectConsoleFeatures, consoleStartView, CONSOLE_START_VIEW } from '../src/edge/chrome.js';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');

describe('resolveStartView: link, then device, then site, then the Bridge', () => {
  let resolveStartView;
  beforeAll(async () => { ({ resolveStartView } = await import('../js/console/chrome.js')); });
  const available = ['bridge', 'buffer', 'archive', 'fn', 'audio', 'pulse'];

  it('takes a link over everything', () => {
    expect(resolveStartView({ link: 'pulse', device: 'fn', last: 'audio', site: 'archive', available })).toBe('pulse');
  });
  it('takes the device choice over the site', () => {
    expect(resolveStartView({ device: 'fn', site: 'archive', available })).toBe('fn');
  });
  it('"last" opens the last surface used, and falls through when there is none', () => {
    expect(resolveStartView({ device: 'last', last: 'audio', site: 'archive', available })).toBe('audio');
    expect(resolveStartView({ device: 'last', last: null, site: 'archive', available })).toBe('archive');
  });
  it('takes the site default when the device has none', () => {
    expect(resolveStartView({ site: 'audio', available })).toBe('audio');
  });
  it('lands on the Bridge when nothing else names a surface it has', () => {
    expect(resolveStartView({ available })).toBe('bridge');
    // A gated surface (bench, off) or a typo must not win — it would seat nothing.
    expect(resolveStartView({ link: 'bench', device: 'nope', last: 'bench', site: 'fnn', available })).toBe('bridge');
  });
  it('still lands somewhere if the Bridge is missing', () => {
    expect(resolveStartView({ available: ['fn', 'audio'] })).toBe('fn');
  });
});

describe('the edge stamps the site default', () => {
  it('reads console.startView exact-shaped, defaulting to the engine', () => {
    expect(consoleStartView({})).toBe(CONSOLE_START_VIEW);
    expect(consoleStartView(undefined)).toBe(CONSOLE_START_VIEW);
    expect(consoleStartView({ startView: 'fn' })).toBe('fn');
    for (const bad of ['', 'FN', 'f n', '"><script>', 42, true, null]) {
      expect(consoleStartView({ startView: bad }), JSON.stringify(bad)).toBe(CONSOLE_START_VIEW);
    }
  });

  it('writes it onto the console\'s meta hook', () => {
    const handlers = [];
    injectConsoleFeatures({ on: (selector, h) => handlers.push({ selector, h }) }, { startView: 'audio' });
    const meta = handlers.find((x) => x.selector === 'meta[name="console-start-view"]');
    expect(meta, 'no handler for the start-view meta').toBeTruthy();
    const attrs = {};
    meta.h.element({ setAttribute: (k, v) => { attrs[k] = v; } });
    expect(attrs.content).toBe('audio');
  });

  it('the shell carries the hook, and marks no surface as already showing', () => {
    expect(html).toContain('<meta name="console-start-view" content="">');
    expect(html, 'a view shipped .active would flash before the start view is seated')
      .not.toMatch(/class="view active"/);
    expect(html).not.toMatch(/class="(nav|tab)-btn active"/);
  });
});

describe('a real boot opens where this device asked', () => {
  beforeAll(async () => {
    globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
    // The site says FN; this device says Audio. The device wins.
    const meta = document.createElement('meta');
    meta.name = 'console-start-view';
    meta.content = 'fn';
    document.head.append(meta);
    localStorage.setItem('oaklens_start_view', 'audio');

    const script = html.match(/<script\s+type=["']module["'][^>]*>([\s\S]*?)<\/script>/i)[1];
    const specs = [...script.matchAll(/import\s+\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const mods = [];
    for (const spec of specs) mods.push(await import(/* @vite-ignore */ `..${spec}`));
    Object.assign(window, ...mods);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((r) => setTimeout(r, 0));
  });

  it('seats the chosen surface, its nav row and its resting lamp', () => {
    expect(document.querySelectorAll('.view.active').length).toBe(1);
    expect(document.querySelector('.view.active')?.id).toBe('view-audio');
    const row = document.querySelector('.nav-btn[data-view="audio"]');
    expect(row.classList.contains('active')).toBe(true);
    expect(row.getAttribute('data-lit')).toBe('accent');
    // Audio lives behind More on the touch band, so More stands in for it.
    expect(document.getElementById('tab-more-btn').classList.contains('active')).toBe(true);
  });

  it('remembers the last surface used, for "last used"', () => {
    window.showView('archive');
    expect(localStorage.getItem('oaklens_last_view')).toBe('archive');
    window.registerView('__probe', () => {});
    window.showView('__probe');
    expect(localStorage.getItem('oaklens_last_view'), 'a surface with no container must not be remembered').toBe('archive');
  });

  it('Settings lists every surface it can open to, and keeps the choice', () => {
    window.openSettings();
    const keys = [...document.querySelectorAll('#settings-start-view [data-start]')];
    const values = keys.map((b) => b.dataset.start);
    expect(values[0]).toBe('');            // site default
    expect(values.at(-1)).toBe('last');
    expect(values).toEqual(expect.arrayContaining(['bridge', 'buffer', 'fn', 'audio', 'pulse', 'publish']));
    expect(values[1], 'the nav order, Bridge first').toBe('bridge');
    expect(keys[0].textContent).toBe('Site default · FN//');
    expect(keys.find((b) => b.dataset.start === 'audio').getAttribute('aria-checked')).toBe('true');

    keys.find((b) => b.dataset.start === 'pulse').click();
    expect(localStorage.getItem('oaklens_start_view')).toBe('pulse');
    document.querySelector('#settings-start-view [data-start=""]').click();
    expect(localStorage.getItem('oaklens_start_view')).toBeNull();
    expect(window.startView(), 'with no device choice, the site default decides').toBe('fn');
  });
});
