// @vitest-environment happy-dom
// EVERY KEY GETS THE ROOM'S OWN LIGHT (K48). The owner, on K47's CSS-only
// buttons: they "are still reading as almost drawn on … the code for the look
// of the top header floating buttons should be there." The top row's depth is
// the engine's light behind the key, so every button in the content is now
// licensed the way the top row is (data-backlit) — by chrome.js, once, for
// whatever any surface renders — and wears the top row's light and edge. A
// key in a plane, or held in place over scrolling content, keeps the CSS light.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const INIT = readFileSync(join(process.cwd(), 'js', 'console', 'init.js'), 'utf8');

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });
const { licenseFloats } = await import('../js/console-ui.js');
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('licenseFloats()', () => {
  it('lights every button in the content, now and as surfaces render, but not one held in place', async () => {
    document.body.innerHTML = `
      <main class="main" data-light-layer>
        <section class="view"><button class="btn btn-ghost" id="a">A</button></section>
        <div style="position: fixed"><button class="btn" id="held">HELD</button></div>
        <div id="later"></div>
      </main>
      <div class="modal-overlay"><button class="btn" id="plane">PLANE</button></div>`;
    licenseFloats();
    expect(document.getElementById('a').hasAttribute('data-backlit')).toBe(true);
    expect(document.getElementById('held').hasAttribute('data-backlit')).toBe(false);
    expect(document.getElementById('plane').hasAttribute('data-backlit')).toBe(false);
    document.getElementById('later').innerHTML = '<div><button class="btn btn-stage" id="b">B</button></div>';
    await tick();
    expect(document.getElementById('b').hasAttribute('data-backlit')).toBe(true);
  });

  it('runs at start-up', () => {
    expect(INIT).toMatch(/\n  licenseFloats\(\);\n/);
  });
});

describe('a licensed key wears the top row\'s light and edge', () => {
  const rule = (sel) => (RULES.match(new RegExp(`\\n${sel} \\{([^}]*)\\}`)) || [])[1];
  const top = RULES.match(/\n\.topbar \[data-backlit\] \{([^}]*)\}/)[1];

  it('the same tight light as the top row, at a level that reads on a lit ground', () => {
    const key = rule(':is\\(\\.btn, \\.fn-btn, \\.fn-chip\\)\\[data-backlit\\]');
    for (const p of ['--backlight-overhang', '--backlight-soft', '--backlight-haze']) {
      expect(key.match(new RegExp(`${p}: ([^;]*);`))[1], p).toBe(top.match(new RegExp(`${p}: ([^;]*);`))[1]);
    }
    expect(key).toMatch(/--backlight: var\(--backlight-float-key\)/);
    expect(rule(':is\\(\\.btn, \\.fn-btn, \\.fn-chip\\)\\[data-backlit\\]::before')).toMatch(/content: none/);
  });

  it('the same edge as the top row, at class weight so focus and press still win', () => {
    const edge = rule(':where\\(\\.btn, \\.fn-btn, \\.fn-chip\\)\\[data-backlit\\]');
    const topEdge = RULES.match(/\n\.topbar :is\(\.settings-btn, \.sidebar-toggle\) \{([^}]*)\}/)[1];
    expect(edge.match(/box-shadow: ([^;]*);/)[1]).toBe(topEdge.match(/box-shadow: ([^;]*);/)[1]);
  });

  it('its light rises under a hand on the float curve, and the engine follows it', () => {
    expect(RULES).toMatch(/:is\(\.btn, \.fn-btn, \.fn-chip\)\[data-backlit\]:hover, :is\(\.btn, \.fn-btn, \.fn-chip\)\[data-backlit\]:focus-visible \{ --backlight: var\(--backlight-float-warm\); \}/);
    expect(RULES).toMatch(/--backlight var\(--float-rise\)/);
    expect(RULES).toMatch(/--backlight var\(--float-fall\)/);
  });
});
