// lighttable.js — frame numbering + dark-frame (tombstone) rendering.
//
// The permanence contract (manual §5.20): frame numbers are positional —
// assignFrameNumbers sorts by day + filename and numbers 1..N — so a retired
// frame must keep its buffer.json slot (dark:true, captured_at + filename
// retained) or every frame after it renumbers and every citation breaks.
//
// lighttable.js is a classic window-namespace script (not an ES module); the
// suite evaluates it with stubbed window/document, the same trick the export
// tests use for classicized modules.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, '..', 'js', 'lighttable.js'), 'utf8');
const windowStub = {
  location: { origin: 'https://example.com' },
  matchMedia: () => ({ matches: false }),
};
const documentStub = { querySelector: () => null };
new Function('window', 'document', src)(windowStub, documentStub);
const LT = windowStub.LightTable;

const entry = (id, day, filename, extra = {}) => ({
  id,
  filename,
  captured_at: `${day}T12:00:00.000Z`,
  ...extra,
});

const FRAMES = [
  entry('a1', '2026-05-30', 'P100.webp'),
  entry('b2', '2026-05-31', 'P200.webp'),
  entry('c3', '2026-05-31', 'P300.webp'),
  entry('d4', '2026-06-01', 'P400.webp'),
];

describe('assignFrameNumbers + dark frames', () => {
  it('numbers frames positionally by day + filename', () => {
    const nums = LT.assignFrameNumbers(FRAMES);
    expect(nums.get('a1')).toBe(1);
    expect(nums.get('b2')).toBe(2);
    expect(nums.get('c3')).toBe(3);
    expect(nums.get('d4')).toBe(4);
  });

  it('a dark entry keeps every number stable (the tombstone holds the slot)', () => {
    const withDark = FRAMES.map(e =>
      e.id === 'b2'
        ? { id: e.id, filename: e.filename, captured_at: e.captured_at, dark: true, darked_at: 'x' }
        : e
    );
    const nums = LT.assignFrameNumbers(withDark);
    // Identical to the pre-retirement numbering — including the dark slot.
    expect([...nums.entries()].sort()).toEqual([...LT.assignFrameNumbers(FRAMES).entries()].sort());
  });

  it('deleting the entry outright WOULD renumber — which is why retire exists', () => {
    const deleted = FRAMES.filter(e => e.id !== 'b2');
    const nums = LT.assignFrameNumbers(deleted);
    expect(nums.get('c3')).toBe(2); // shifted — citations to 3 now point elsewhere
    expect(nums.get('d4')).toBe(3);
  });
});

describe('dark-frame rendering', () => {
  const dark = { id: 'b2', filename: 'P200.webp', captured_at: '2026-05-31T12:00:00.000Z', dark: true };
  const day = [dark, entry('c3', '2026-05-31', 'P300.webp')];
  const nums = LT.assignFrameNumbers([...day, entry('a1', '2026-05-30', 'P100.webp')]);

  it('renders a .frame-dark cell: no <img>, zero network, number + a11y label kept', () => {
    const html = LT.renderDayBlock(day, nums);
    const darkCell = html.match(/<figure class="frame frame-dark"[\s\S]*?<\/figure>/)[0];
    expect(darkCell).not.toContain('<img');
    expect(darkCell).not.toContain('http');
    expect(darkCell).toContain('dark-glyph');
    expect(darkCell).toContain(`data-frame="${String(nums.get('b2')).padStart(3, '0')}"`);
    expect(darkCell).toContain('aria-label="Frame 002 — dark frame (retired)"');
    // The live frame in the same day still renders normally.
    expect(html).toContain('<img');
    expect(html).toContain('P300');
  });

  it('renders dark cells in inline frame strips too', () => {
    const html = LT.renderFrameStrip(day, nums);
    expect(html).toContain('frame frame-dark');
    expect(html.match(/<img/g).length).toBe(1); // only the live frame loads media
  });

  it('keeps a dark frame’s slot inside a burst strip (counts stay honest)', () => {
    const burst = [
      entry('x1', '2026-06-02', 'B1.webp', { burst_id: 'bb' }),
      { id: 'x2', filename: 'B2.webp', captured_at: '2026-06-02T12:00:01.000Z', dark: true, burst_id: 'bb' },
      entry('x3', '2026-06-02', 'B3.webp', { burst_id: 'bb' }),
    ];
    const bNums = LT.assignFrameNumbers(burst);
    const html = LT.renderDayBlock(burst, bNums);
    expect(html).toContain('BURST // 3');             // full count, dark included
    expect(html).toContain('strip-frame-dark');       // the tombstone slot
    expect(html).toContain('data-burst-globals="1,3"'); // cycling set skips the dark frame
    expect(html).not.toContain('B2.webp');            // its media is never requested
  });

  it('collapses an all-dark burst into a single dark cell', () => {
    const burst = [
      { id: 'y1', filename: 'C1.webp', captured_at: '2026-06-03T12:00:00.000Z', dark: true, burst_id: 'cc' },
      { id: 'y2', filename: 'C2.webp', captured_at: '2026-06-03T12:00:01.000Z', dark: true, burst_id: 'cc' },
    ];
    const html = LT.renderDayBlock(burst, LT.assignFrameNumbers(burst));
    expect(html).toContain('frame frame-dark');
    expect(html).not.toContain('burst-cell');
    expect(html).not.toContain('<img');
  });
});
