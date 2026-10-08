// @vitest-environment happy-dom
//
// Frame numbers (f#N) are positional and permanent: a citation in a field
// note must point at the same frame in the console, on the live light table,
// and in the homepage's featured RAW card. Three implementations number the
// Buffer (K65 checked them against each other on the instance's own 729
// frames): the console's getBufferFrameNumbers (js/console/fn-editor.js),
// the public LightTable.assignFrameNumbers (js/lighttable.js, a classic
// script) and the server's _featuredRawFrames (src/api/site-meta.js). The
// clients read the device's day; the server reads the site's time zone. So
// this runs the clients in the site's zone: on a device in another zone, a
// frame shot near midnight can be numbered differently in the console than
// on the site. That is known and reported, not hidden.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import siteConfig from '../src/shared/config.js';

process.env.TZ = siteConfig.timezone || 'UTC';
const ROOT = join(import.meta.dirname, '..');
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const lightTable = () => {
  const src = readFileSync(join(ROOT, 'js', 'lighttable.js'), 'utf8');
  const win = { location: { origin: 'https://example.com' }, matchMedia: () => ({ matches: false }) };
  new Function('window', 'document', src)(win, { querySelector: () => null });
  return win.LightTable;
};

// The data the site publishes, when the checkout has it, plus the cases a
// real buffer does not happen to contain: the same day across midnight UTC,
// a dark tombstone, filename order within a day, an undated entry.
const sample = () => {
  const f = join(ROOT, 'data', 'buffer.json');
  const real = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  return [...(Array.isArray(real) ? real : []),
    { id: 'p1', filename: 'b.jpg', captured_at: '2026-03-02T07:30:00.000Z', featured: true },
    { id: 'p2', filename: 'a.jpg', captured_at: '2026-03-02T09:00:00.000Z', featured: true },
    { id: 'p3', filename: 'c.jpg', captured_at: '2026-03-01T23:59:00.000Z', featured: true, dark: true },
    { id: 'p4', filename: 'd.jpg', published_at: '2026-03-03T12:00:00.000Z', featured: true },
  ];
};

let F, S, M;
beforeAll(async () => {
  F = await import('../js/console/fn-editor.js');
  S = await import('../js/console-state.js');
  M = await import('../src/api/site-meta.js');
});

describe('one f# for every frame, wherever it is read', () => {
  it('the console and the live light table agree on every frame', () => {
    const frames = sample();
    S.STATE.buffer = frames;
    const con = F.getBufferFrameNumbers();
    const lt = lightTable().assignFrameNumbers(frames);
    const differ = frames.filter((e) => con.get(e.id) !== lt.get(e.id)).map((e) => e.id);
    expect(differ).toEqual([]);
    expect(con.size).toBe(frames.length);
  });

  it('…and the server\'s featured frames carry the same numbers', () => {
    const frames = sample().map((e) => ({ ...e, featured: true, dark: false, filename: e.filename || `${e.id}.jpg` }));
    S.STATE.buffer = frames;
    const con = F.getBufferFrameNumbers();
    const served = M._featuredRawFrames(frames, frames.length);
    expect(served.length).toBeGreaterThan(0);
    for (const f of served) expect(f.num, f.id).toBe(con.get(f.id));
  });

  it('an undated entry is day \'\' in the console as on the site (it sorted last as NaN)', () => {
    S.STATE.buffer = [
      { id: 'u', filename: 'z.jpg' },
      { id: 'd', filename: 'a.jpg', captured_at: '2026-01-01T12:00:00.000Z' },
    ];
    const con = F.getBufferFrameNumbers();
    const lt = lightTable().assignFrameNumbers(S.STATE.buffer);
    expect(con.get('u')).toBe(lt.get('u'));
    expect(con.get('u')).toBe(1);
  });

  it('the editor\'s preview resolves f# through the same numbering, not a copy of it', () => {
    const src = readFileSync(join(ROOT, 'js', 'console', 'fn-editor.js'), 'utf8');
    expect(src).toMatch(/const numToEntry = new Map\(\[\.\.\.getBufferFrameNumbers\(\)\]/);
  });
});
