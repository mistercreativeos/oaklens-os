// @vitest-environment happy-dom
//
// A SURFACE THAT HAS NOT CHANGED IS NOT REBUILT.
//
// The router calls a surface's render on every arrival, inside the switch,
// while the screen is frozen. Archive and Wall rebuilt their whole grid each
// time even with nothing changed: 20–26ms at phone speed (CPU 4×, the real
// data), and Wall re-created and re-decoded every thumbnail. Now a container's
// HTML is written only when the render's own output differs from what that
// element last received (utils.js paintHTML), so ANY input that changes what
// is drawn rebuilds it, and nothing has to be traced by hand. Pinned here:
// that an unchanged arrival keeps the very same nodes, that every kind of
// change still reaches the screen, and that Wall's drag wiring is not doubled.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/console-api.js', () => ({
  getToken: () => 'test-token',
  uploadFiles: async () => {},
  uploadFilesWithRetry: async () => {},
  fetchOgCards: async () => ({ ok: true, cards: [] }),
}));

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE } = await import('../js/console-state.js');
const { _setOgCardSet } = await import('../js/console/assets.js');
const { paintHTML, setText } = await import('../js/console/utils.js');
const { renderArchive } = await import('../js/console/archive.js');
const { renderWall } = await import('../js/console/more-views.js');

const FRAME = { id: 'a1', slug: 'evening-light', filename: 'SAMPLE_Evening.webp', title: 'Evening Light', sub: 'A Sub' };
const PAPER = { id: 'w1', filename: 'SAMPLE_Wall.webp', title: 'Wall One', desc: '' };

beforeEach(() => {
  document.body.innerHTML = `
    <div id="archive-display"></div><div id="archive-count"></div><div id="archive-stats"></div>
    <div id="wall-list"></div><div id="wall-stats"></div><div id="toast-host"></div>`;
  STATE.archive = [FRAME, { ...FRAME, id: 'a2', filename: 'SAMPLE_Two.webp', title: 'Two' }];
  STATE.wallpapers = [PAPER, { ...PAPER, id: 'w2', title: 'Wall Two' }];
  _setOgCardSet([]);
});

const card = () => document.querySelector('#archive-display .archive-card');

describe('paintHTML writes only what changed', () => {
  it('writes the first time, skips the same HTML, writes a change', () => {
    const el = document.getElementById('archive-display');
    expect(paintHTML(el, '<p>a</p>')).toBe(true);
    const p = el.firstChild;
    expect(paintHTML(el, '<p>a</p>')).toBe(false);
    expect(el.firstChild, 'the same node, untouched').toBe(p);
    expect(paintHTML(el, '<p>b</p>')).toBe(true);
    expect(el.innerHTML).toBe('<p>b</p>');
  });

  it('remembers per element: a replaced container is always written', () => {
    const a = document.getElementById('archive-display');
    paintHTML(a, '<p>a</p>');
    document.body.innerHTML = '<div id="archive-display"></div>';
    const b = document.getElementById('archive-display');
    expect(paintHTML(b, '<p>a</p>')).toBe(true);
    expect(b.innerHTML).toBe('<p>a</p>');
  });

  it('an identical text is not rewritten (the light engine hears a rewrite as a change)', async () => {
    const el = document.getElementById('archive-count');
    setText(el, 2);
    const seen = [];
    const mo = new MutationObserver((r) => seen.push(...r));
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    setText(el, 2);
    await Promise.resolve();
    expect(seen).toHaveLength(0);
    setText(el, 3);
    await Promise.resolve();
    expect(el.textContent).toBe('3');
    mo.disconnect();
  });
});

describe('the Archive keeps its grid when nothing changed', () => {
  it('an arrival with nothing changed keeps the same cards and their loaded thumbnails', () => {
    renderArchive();
    const first = card();
    first.querySelector('img')?.classList.add('is-loaded');
    renderArchive();
    expect(card()).toBe(first);
    expect(card().querySelector('img')?.classList.contains('is-loaded')).toBe(true);
  });

  it('every kind of change still reaches the screen', () => {
    renderArchive();
    const first = card();
    STATE.archive[0] = { ...STATE.archive[0], title: 'Renamed' };
    renderArchive();
    expect(card()).not.toBe(first);
    expect(card().querySelector('.title').textContent).toBe('Renamed');
    // a stamp landing on R2 (an input that is not the frame itself)
    _setOgCardSet(['SAMPLE_Evening']);
    renderArchive();
    expect(card().innerHTML).toContain('ogc-badge');
    // an upload failing
    STATE.archive[0] = { ...STATE.archive[0], _uploadError: 'upload failed' };
    renderArchive();
    expect(card().innerHTML).toContain('✕ FAILED');
    // the count follows, and emptying the archive empties the grid
    STATE.archive = [];
    renderArchive();
    expect(document.getElementById('archive-count').textContent).toBe('0');
    expect(document.getElementById('archive-display').textContent).toContain('ARCHIVE EMPTY');
  });
});

describe('the Wall keeps its rows, and wires a row once', () => {
  it('drag listeners are added only to rows it just wrote', () => {
    const real = Element.prototype.addEventListener;
    let drags = 0;
    Element.prototype.addEventListener = function (type, ...rest) { if (type === 'dragstart') drags++; return real.call(this, type, ...rest); };
    try {
      renderWall();
      expect(drags).toBe(2);
      const row = document.querySelector('#wall-list .list-row');
      renderWall();
      expect(drags, 'unchanged: no second set of listeners').toBe(2);
      expect(document.querySelector('#wall-list .list-row')).toBe(row);
      STATE.wallpapers.reverse();   // what a drop does, before it renders
      renderWall();
      expect(drags, 'reordered: the new rows are wired').toBe(4);
      expect(document.querySelector('#wall-list .list-row').dataset.id).toBe('w2');
    } finally {
      Element.prototype.addEventListener = real;
    }
  });
});
