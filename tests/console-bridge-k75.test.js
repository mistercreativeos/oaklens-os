// @vitest-environment happy-dom
//
// K75 (2026-10-06): the storage gauge, after the owner's HUD references ("the
// design still isn't reading right … largely the middle core. We can remove
// it … mimic the dense light emitting object vibe … simplify and make it a
// gradient of values") and spoolr's tachometer ("it has the perfect timing
// for the rubber banding at the beginning seq"). Measured in Chrome and
// WebKit: the sweep runs 0 → 20 → hold → the reading, inside the ignition.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainUnits } from './helpers/units.js';

const ROOT = join(import.meta.dirname, '..');
const RAW = readFileSync(join(ROOT, 'css/field-console.css'), 'utf8');
const CSS = plainUnits(RAW.replace(/\/\*[\s\S]*?\*\//g, ''));
const SRC = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
const rule = (sel) => (CSS.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';
const kf = (name) => { const at = CSS.indexOf(`@keyframes ${name} {`); return at < 0 ? '' : CSS.slice(at, CSS.indexOf('\n}', at) + 2); };

describe('a bar of light, no core', () => {
  it('a bar is a slanted slab: faint dark, solid lit, and nothing down its middle', () => {
    expect(rule('.br-tube')).toMatch(/transform: skewX\(-20deg\);/);
    expect(rule('.br-tube')).not.toMatch(/border:/);
    expect(rule('.br-tube::before')).toMatch(/inset: 0;/);
    expect(CSS).not.toMatch(/calc\(50% - 0\.5px\)/);
  });

  it('the lit run has a light behind it, a soft halo, and none on paper (K77)', () => {
    expect(rule('.br-tubes-lit')).toMatch(/--backlight: 0\.45; --backlight-overhang: 8px; --backlight-soft: 30px;/);
    expect(CSS).toMatch(/:root\[data-theme="light"\] \.br-tubes-lit \{ --backlight: 0; \}/);
    expect(SRC).toMatch(/<span class="br-tubes-lit" data-backlit>/);
  });
});

describe('a gradient of values, read off one number', () => {
  it('the gauge carries how many bars are lit; the sheet reads every bar\'s light off it', () => {
    expect(SRC).toMatch(/style="--share:\$\{room\.share\.toFixed\(4\)\};--gauge-lit:\$\{gaugeLit\(room\.share\)\}"/);
    expect(rule('.br-gauge')).toMatch(/--gauge-n: var\(--gauge-lit\);/);
    expect(CSS).toMatch(/\.br-inst--storage\[data-sweep\] \.br-gauge \{ --gauge-n: var\(--gauge-sweep\); \}/);
    expect(CSS).toMatch(/@property --gauge-n \{\s*syntax: '<number>';\s*inherits: true;\s*initial-value: 0;\s*\}/);
    const b = rule('.br-tube::before');
    expect(b).toMatch(/--a: clamp\(0, var\(--gauge-n\) - var\(--i\), 1\);/);
    expect(b).toMatch(/--v: clamp\(0, \(var\(--i\) \+ 1\) \/ max\(var\(--gauge-n\), 1\), 1\);/);
    expect(b).toMatch(/opacity: var\(--a\);/);
  });

  it('dim where the run starts, brightest at its leading edge, which runs toward white', () => {
    const b = rule('.br-tube::before');
    expect(b).toMatch(/color-mix\(in srgb, var\(--lit-hot\) calc\(var\(--v\) \* var\(--v\) \* 45%\), rgba\(var\(--lit-rgb\), calc\(0\.3 \+ 0\.7 \* var\(--v\)\)\)\)/);
    // The values a run of 3 takes: a third, two thirds, all.
    const v = (i, n) => Math.min(1, Math.max(0, (i + 1) / Math.max(n, 1)));
    expect([0, 1, 2].map((i) => +v(i, 3).toFixed(2))).toEqual([0.33, 0.67, 1]);
  });
});

describe('the sweep: a tachometer on a cold load, on the ignition\'s clock (K77)', () => {
  it('up to redline on --ease-pop, held, then settled to the reading on --ease-settle', async () => {
    const B = await import('../js/console/bridge.js');
    expect(B.SWEEP).toEqual({ at: 880, up: 560, hold: 750, down: 990 });
    const pop = B.bezier(0.16, 1, 0.3, 1), settle = B.bezier(0.65, 0, 0.35, 1);
    const at = (t) => B.sweepLevel(t, 3, pop, settle);
    expect(at(0)).toBe(0);
    expect(at(879)).toBe(0);
    expect(at(880 + 280)).toBeGreaterThan(18);          // out-expo: most of the way at half time
    expect(at(880 + 560)).toBe(20);                     // redline
    expect(at(880 + 560 + 749)).toBe(20);               // held through the crest
    expect(at(880 + 560 + 750 + 495)).toBeCloseTo(11.5, 1);   // in-out: half way at half time
    expect(at(880 + 560 + 750 + 990)).toBe(3);          // the reading
    expect(at(9999)).toBe(3);
    expect(CSS).toMatch(/--ease-pop: +cubic-bezier\(0\.16, 1, 0\.3, 1\);/);
    expect(CSS).toMatch(/--ease-settle: cubic-bezier\(0\.65, 0, 0\.35, 1\);/);
  });

  it('the curves are the console\'s named easings, read off the root, and the bezier is right', async () => {
    const B = await import('../js/console/bridge.js');
    expect(SRC).toMatch(/pop = _ease\('--ease-pop'\); settle = _ease\('--ease-settle'\);/);
    const lin = B.bezier(0, 0, 1, 1);
    for (const x of [0.1, 0.5, 0.9]) expect(lin(x)).toBeCloseTo(x, 3);
    const io = B.bezier(0.65, 0, 0.35, 1);
    expect(io(0.5)).toBeCloseTo(0.5, 3);
    expect(io(0.25)).toBeLessThan(0.1);
  });

  it('reads the ignition\'s own clock (which stalls with the page) and writes onto the container no repaint replaces', () => {
    expect(SRC).toMatch(/const t = Math\.max\(0, ignitionTime\(\)\);/);
    expect(SRC).toMatch(/box\?\.style\.setProperty\('--gauge-sweep', sweepLevel\(t, lit, pop, settle\)\.toFixed\(3\)\);/);
    expect(SRC).toMatch(/const box = \$\('br-storage'\);/);
    expect(SRC).toMatch(/_sweeping = requestAnimationFrame\(tick\);/);
  });

  it('ends inside the ignition, redline near the crest, and leaves no animation in the sheet', async () => {
    const B = await import('../js/console/bridge.js');
    const { IGNITE_ROW_AT_MS, IGNITE_HOLD_MS } = await import('../js/console/chrome.js');
    const { at, up, hold, down } = B.SWEEP;
    expect(Math.abs(at + up - IGNITE_ROW_AT_MS)).toBeLessThan(100);
    expect(at + up + hold + down).toBeLessThanOrEqual(IGNITE_HOLD_MS);
    expect(CSS).not.toMatch(/gauge-sweep \d+ms|@keyframes gauge-sweep/);
  });

  it('redline is every bar', async () => {
    const B = await import('../js/console/bridge.js');
    expect(B.sweepLevel(880 + 600, 0)).toBe(B.GAUGE_TUBES);
  });
});
