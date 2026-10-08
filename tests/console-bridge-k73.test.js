// @vitest-environment happy-dom
//
// K73 (2026-10-06, the owner's notes from the desk): the top strip floats, so
// the clock's light rolls off under it; the gauge is a small companion object
// whose lit run is an emitter; the bay stands on the row's floor; the spark's
// name turns red as it lights; the pulse's glyph is quiet.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainUnits } from './helpers/units.js';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
const BODY = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
const CSS = plainUnits(readFileSync(join(ROOT, 'css/field-console.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
const rule = (sel) => (CSS.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the gauge is a small companion object', () => {
  it('has no frame: no corner brackets in the markup or the sheet', () => {
    const src = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    expect(src).not.toMatch(/br-gauge-frame/);
    expect(CSS).not.toMatch(/br-gauge-frame|--gauge-wire/);
  });

  // K75: the filament is gone ("remove [the middle core]"); a bar is a slab.
  it('its bars are half the old scale', () => {
    expect(rule('.br-tubes')).toMatch(/height: clamp\(11px, 1\.3dvh, 16px\);/);
    expect(rule('.br-tube')).toMatch(/flex: 0 0 4px;/);
  });

  // K77: a light behind it (data-backlit), where a lit pool read as a box.
  it('the lit run is one light source, and only when something is lit', async () => {
    vi.resetModules();
    document.body.innerHTML = BODY;
    const B = await import('../js/console/bridge.js');
    const box = document.createElement('div');
    box.innerHTML = B.gaugeTubes(0.12);
    const run = box.querySelector('.br-tubes-lit');
    expect(run.hasAttribute('data-backlit')).toBe(true);
    expect(run.querySelectorAll('.br-tube.is-lit')).toHaveLength(3);
    expect(box.querySelectorAll('.br-tube')).toHaveLength(20);
    expect([...box.querySelectorAll('.br-tube')].map((t) => t.style.getPropertyValue('--i'))).toEqual(Array.from({ length: 20 }, (_, i) => String(i)));
    box.innerHTML = B.gaugeTubes(0);
    expect(box.querySelector('[data-backlit], [data-lit]')).toBeNull();
  });

  it('keeps its element while it reads the same, so its light does not heat from black each minute', () => {
    const src = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    expect(src).toMatch(/const was = box\?\.querySelector\('\.br-gauge'\);/);
    expect(src).toMatch(/if \(is && is\.outerHTML === was\.outerHTML\) is\.replaceWith\(was\);/);
  });
});

describe('the rest of the notes', () => {
  it('the bay stands on the floor of its row', () => {
    expect(rule('.br-top > .br-bay')).toMatch(/align-self: end;/);
  });

  it('the spark\'s name turns to the accent as it lights', () => {
    expect(CSS).toMatch(/\.br-intake:has\(\.br-spark-input:not\(:placeholder-shown\)\) \.br-h--lead \{ color: var\(--accent-text\); \}/);
  });

  it('the pulse\'s glyph rests a touch above the bay', () => {
    const t = rule('.br-thumb--type');
    expect(t).toMatch(/--seam-level: calc\(var\(--emit-panel\) \* 0\.5\); --backlight: calc\(var\(--backlight-panel\) \* 0\.45\);/);
    expect(CSS).toMatch(/--seam-level: calc\(var\(--emit-panel\) \* 0\.4\);\s*--backlight: calc\(var\(--backlight-panel\) \* 0\.35\);/);
  });
});
