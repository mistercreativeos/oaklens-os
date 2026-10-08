// THE MOTION VOCABULARY (K50, 2026-10-04). The owner's craft pass asked for
// "smooth ramp ups and ramp downs across the board", and the audit found the
// board was not one board: the thermal pair, the tiers' fall, the keys' fall
// and a sidebar row's fall each carried their own literal cubic-bezier, two of
// them copies of each other that could drift apart with one edit. Now every
// curve in the console stylesheet is one of a handful of NAMED easings on
// :root, and this file holds the file to that:
//
//   • every cubic-bezier literal in the stylesheet is either the declaration
//     of a named easing (--ease-*) or a copy of one inside a @keyframes block
//     (a keyframe's timing function cannot read a custom property);
//   • the thermal pair is perceptual: the eye sees the cube root of the
//     light, so --ease-heat rises and --ease-cool falls on a smooth S in
//     perceived lightness — a slow start to the heat (no jump) and a soft
//     leave from the crest with a long tail (Newton's cooling, to the eye);
//   • everything that moves light slowly rides the pair: the coil's two
//     curves, a tier's fall, a key's fall, a row's fall.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const studio = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')));

/** The named easings on :root: name → literal. */
const named = Object.fromEntries([...studio.matchAll(/(--ease-[a-z]+):\s*(cubic-bezier\([^)]*\));/g)].map((m) => [m[1], m[2]]));

/** y for x on a CSS cubic-bezier (the engine's own solver, inlined). */
function bezierY([x1, y1, x2, y2], x) {
  const ax = 1 - 3 * x2 + 3 * x1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 40; i++) { t = (lo + hi) / 2; if (sx(t) < x) lo = t; else hi = t; }
  return sy(t);
}
const parse = (lit) => lit.match(/cubic-bezier\(([^)]*)\)/)[1].split(',').map(Number);
const smoothstep = (p) => p * p * (3 - 2 * p);

describe('every curve in the console is a named easing', () => {
  it('names the vocabulary on :root', () => {
    for (const n of ['--ease-out', '--ease-spring', '--ease-pop', '--ease-heat', '--ease-cool']) expect(named[n], n).toBeTruthy();
  });

  it('a cubic-bezier literal appears only as a named easing, or as a keyframe copy of one', () => {
    const values = new Set(Object.values(named));
    // Outside @keyframes blocks, strip the declarations themselves and look for what is left.
    const outside = RULES.replace(/@keyframes [\w-]+\s*\{[\s\S]*?\n\}/g, '').replace(/--ease-[a-z]+:\s*cubic-bezier\([^)]*\);/g, '');
    const stray = [...outside.matchAll(/cubic-bezier\([^)]*\)/g)].map((m) => m[0]);
    expect(stray, 'a transition or animation names its easing by token, never by literal').toEqual([]);
    // Inside @keyframes, every literal is a copy of a named easing.
    for (const kf of RULES.matchAll(/@keyframes ([\w-]+)\s*\{([\s\S]*?)\n\}/g)) {
      for (const m of kf[2].matchAll(/cubic-bezier\([^)]*\)/g)) {
        expect(values.has(m[0]), `@keyframes ${kf[1]} carries ${m[0]}, which is no named easing`).toBe(true);
      }
    }
  });

  it('the thermal pair, the tiers, the keys and the rows ride --ease-heat / --ease-cool', () => {
    expect(studio).toMatch(/--arm-heat:\s*[\d.]+s var\(--ease-heat\);/);
    expect(studio).toMatch(/--arm-cool:\s*[\d.]+s var\(--ease-cool\);/);
    expect(studio).toMatch(/--tier-fall:\s*[\d.]+s var\(--ease-cool\);/);
    expect(RULES).toMatch(/--float-glow var\(--float-fall\) var\(--ease-cool\)/);
    expect(RULES).toMatch(/--backlight var\(--float-fall\) var\(--ease-cool\)/);
    // (The sidebar row's --row-warm rode the pair until K91, when the row's letters took TYPE's tier curves instead.)
    // The ignition's curve is the pair, read off the root (K78: chrome.js
    // keeps it; it was two keyframes here): the heat from black, then the
    // cool through the rubber band's dip and back.
    const chromeSrc = readFileSync(join(process.cwd(), 'js', 'console', 'chrome.js'), 'utf8');
    expect(chromeSrc).toMatch(/const heatCurve = easeToken\('--ease-heat'\), coolCurve = easeToken\('--ease-cool'\);/);
    expect(chromeSrc).toMatch(/const ease = i === 1 \? heat : cool;/);
  });
});

describe('the thermal pair is perceptual: smooth to an eye that sees the cube root of the light', () => {
  const heat = parse(named['--ease-heat']);
  const cool = parse(named['--ease-cool']);
  const xs = [0.1, 0.25, 0.5, 0.75, 0.9];

  it('--ease-heat: the perceived rise tracks a smooth S — no jump at the start, no velocity at the crest', () => {
    for (const x of xs) expect(Math.abs(Math.cbrt(bezierY(heat, x)) - smoothstep(x)), `at ${x}`).toBeLessThan(0.2);
    // A tenth of the way in, the eye sees under a fifth of the light (the old
    // pair showed it 28%: the "sudden jump, then it starts fading up").
    expect(Math.cbrt(bezierY(heat, 0.1))).toBeLessThan(0.2);
    // It arrives at the crest with no velocity: the end tangent is flat.
    expect(heat[3]).toBe(1);
    expect(heat[2]).toBeLessThan(1);
  });

  it('--ease-cool: the perceived fall leaves the crest softly and tails out — Newton\'s cooling, to the eye', () => {
    for (const x of xs) expect(Math.abs(Math.cbrt(1 - bezierY(cool, x)) - (1 - smoothstep(x))), `at ${x}`).toBeLessThan(0.2);
    // Soft leave: a tenth of the way out, the eye still sees nearly all of it.
    expect(Math.cbrt(1 - bezierY(cool, 0.1))).toBeGreaterThan(0.95);
    // The start tangent is flat (y1 = 0), so nothing snaps away from the crest.
    expect(cool[1]).toBe(0);
    // The light itself is mostly gone by the middle: the eye sees a fall, not a hold.
    expect(bezierY(cool, 0.5)).toBeGreaterThan(0.8);
  });

  it('the pair is not the UI curve: a short answer keeps --ease-out, a journey takes the pair', () => {
    expect(named['--ease-heat']).not.toBe(named['--ease-out']);
    expect(named['--ease-cool']).not.toBe(named['--ease-out']);
    expect(studio).toMatch(/--tier-rise:\s*\d+ms var\(--ease-out\);/);
  });
});
