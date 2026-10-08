// @vitest-environment happy-dom
//
// K79 (2026-10-06, the owner: "every page transition has some jitter and it
// needs to be rock solid appliance like"). Measured in real Safari through
// safaridriver: the transition captured the whole page, masks and all, and
// re-rendered it for the length of the crossfade (30 fps); and the Buffer
// rebuilt its first screenful on every visit (160–195 ms of script). The
// crossfade's scope is held in console-touch-polish; the Buffer's here.
import { describe, it, expect, beforeEach } from 'vitest';

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE } = await import('../js/console-state.js');
const { renderBuffer, _bufferForget } = await import('../js/console/buffer.js');
const { _addOgCard, _removeOgCard } = await import('../js/console/assets.js');

const frame = (id, over) => ({
  id, filename: `OAKLENS_${id}.webp`,
  captured_at: `2026-08-1${id.slice(-1)}T12:00:00Z`, published_at: '',
  added_at: '2026-08-20', archived: false, hash: 'sha256:0000', ...over,
});

beforeEach(() => {
  document.body.innerHTML = `
    <div id="buffer-display"></div>
    <span id="buffer-count"></span>
    <span id="buffer-stats"></span>
  `;
  _bufferForget();
  STATE.buffer = [frame('a1'), frame('a2'), frame('a3')];
});

describe('the Buffer builds its grid only when what it shows has changed', () => {
  it('a second showing of the same frames keeps the grid it built', () => {
    renderBuffer();
    const cell = document.querySelector('.buffer-frame[data-id="a2"]');
    expect(cell).toBeTruthy();
    renderBuffer();
    expect(document.querySelector('.buffer-frame[data-id="a2"]')).toBe(cell);
  });

  it('a frame changed where it lies, a new frame, a live stamp or the link selection builds it again', () => {
    renderBuffer();
    let cell = document.querySelector('.buffer-frame[data-id="a2"]');
    STATE.buffer[1].archived = true;                         // edited in place
    renderBuffer();
    expect(document.querySelector('.buffer-frame[data-id="a2"]')).not.toBe(cell);
    expect(document.querySelector('.buffer-frame[data-id="a2"]').classList.contains('selected')).toBe(true);

    cell = document.querySelector('.buffer-frame[data-id="a2"]');
    STATE.buffer = [...STATE.buffer, frame('a4')];
    renderBuffer();
    expect(document.querySelector('.buffer-frame[data-id="a4"]')).toBeTruthy();

    cell = document.querySelector('.buffer-frame[data-id="a2"]');
    _addOgCard('OAKLENS_a2');
    renderBuffer();
    expect(document.querySelector('.buffer-frame[data-id="a2"] .ogc-badge')).toBeTruthy();
    _removeOgCard('OAKLENS_a2');
    renderBuffer();
    expect(document.querySelector('.buffer-frame[data-id="a2"] .ogc-badge')).toBeNull();
  });

  it('an emptied grid, or one emptied by someone else, is built again', () => {
    renderBuffer();
    document.getElementById('buffer-display').innerHTML = '';
    renderBuffer();
    expect(document.querySelector('.buffer-frame[data-id="a1"]')).toBeTruthy();
    STATE.buffer = [];
    renderBuffer();
    expect(document.querySelector('.empty')).toBeTruthy();
    STATE.buffer = [frame('a1')];
    renderBuffer();
    expect(document.querySelector('.buffer-frame[data-id="a1"]')).toBeTruthy();
  });
});
