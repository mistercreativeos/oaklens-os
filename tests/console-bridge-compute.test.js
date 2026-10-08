// @vitest-environment happy-dom
//
// What the Bridge costs left open (K69). Measured 2026-10-06 under the
// capture rig (docs/maintenance/2026-10-06-bridge-field-probe.md): at rest
// one LED was 3.5% of a core (a box-shadow animation the compositor can't
// run); the live read went out every 45 s, eleven Worker requests a time,
// hidden or not; a cold open pulled ~40 MB of pictures for views nobody was
// looking at; and each paint sorted every frame three times. Held here.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const code = (f) => readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const BRIDGE = code('js/console/bridge.js');
const CSS = code('css/field-console.css');
const html = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
const BODY = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, '');

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// A @keyframes block, braces balanced (some are written on one line).
function keyframes(name) {
  const at = CSS.indexOf(`@keyframes ${name} {`);
  if (at < 0) return null;
  let depth = 0;
  for (let i = CSS.indexOf('{', at); i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(at, i + 1);
  }
  return null;
}

describe('at rest, nothing animates off the compositor', () => {
  it('the SYS lamp\'s idle beat moves opacity only, on the LED and its glow layer', () => {
    for (const name of ['lamp-smd', 'lamp-smd-glow', 'lamp-flicker', 'lamp-error', 'lamp-offline']) {
      const block = keyframes(name);
      expect(block, name).toBeTruthy();
      const props = [...block.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(new Set(props), name).toEqual(new Set(['opacity']));
    }
  });
});

describe('the live read rests', () => {
  it('reads at most every five minutes with nothing in flight, and has no 15 s tick', () => {
    expect(BRIDGE).toMatch(/const LIVE_TTL = 5 \* 60_000;/);
    expect(BRIDGE).not.toMatch(/setInterval\(/);
    expect(BRIDGE).toMatch(/_minute = setTimeout\(\(\) => \{ if \(_isUp\(\)\) renderBridge\(\); \}, 60_000 - \(now % 60_000\) \+ 50\);/);
  });

  it('a hidden page reads nothing and keeps no timers; coming back or the signal returning reads', () => {
    expect(BRIDGE).toMatch(/if \(_isUp\(\) && !document\.hidden\) \{\s*_readLive\(\);/);
    expect(BRIDGE).toMatch(/if \(document\.visibilityState === 'hidden'\) \{ away\(\); _rest\(\); \}/);
    expect(BRIDGE).toMatch(/window\.addEventListener\('online', \(\) => \{ if \(_isUp\(\) && !document\.hidden\) _readLive\(true\); \}\);/);
    expect(BRIDGE).toMatch(/if \(building && _isUp\(\) && !document\.hidden\)/);
  });

  it('painted while hidden, it asks the network nothing', async () => {
    vi.resetModules();
    document.body.innerHTML = BODY;
    localStorage.clear();
    let calls = 0;
    vi.stubGlobal('fetch', async () => { calls++; return new Response('null', { headers: { 'Content-Type': 'application/json' } }); });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    try {
      document.getElementById('view-bridge').classList.add('active');
      const B = await import('../js/console/bridge.js');
      B.renderBridge();
      await new Promise((r) => setTimeout(r, 20));
      expect(calls).toBe(0);
    } finally {
      delete document.hidden;
    }
  });
});

describe('a cold open downloads what is on screen', () => {
  const MORE = readFileSync(join(ROOT, 'js/console/more-views.js'), 'utf8');
  it('the Wall\'s and the Library\'s pictures load lazily', () => {
    expect(MORE).toMatch(/<img class="list-thumb" src="\$\{w\.src \|\| cdnThumb\(w, 'wallpaper'\)\}" alt="" loading="lazy" decoding="async"/);
    expect(MORE).toMatch(/<div class="thumb"><img src="\$\{thumbSrc\}" alt="" loading="lazy" decoding="async"/);
  });
  it('a synced Library item keeps one address, so a repaint never downloads it again', () => {
    expect(MORE).toMatch(/raw \+ '\?v=' \+ \(item\._uploaded \|\| item\._imported \? '1' : Date\.now\(\)\)/);
  });
  it('the front page\'s 42 px thumbs take the 480w variant, and fall back to the full one once', async () => {
    vi.resetModules();
    document.body.innerHTML = BODY;
    const B = await import('../js/console/bridge.js');
    expect(B.smallThumb('https://cdn.x/archive/a-1024w.webp')).toBe('https://cdn.x/archive/a-480w.webp');
    expect(B.smallThumb('https://cdn.x/archive/a-1024w.webp?v=2')).toBe('https://cdn.x/archive/a-480w.webp?v=2');
    expect(B.smallThumb('https://cdn.x/videos/posters/p.webp')).toBe('https://cdn.x/videos/posters/p.webp');
    const li = document.createElement('li');
    li.innerHTML = '<img class="br-thumb" src="https://cdn.x/a-480w.webp" data-full="https://cdn.x/a-1024w.webp" data-kind="A">';
    document.body.append(li);
    B.bridgeThumbFailed(li.firstChild);
    expect(li.firstChild.tagName).toBe('IMG');
    expect(li.firstChild.getAttribute('src')).toBe('https://cdn.x/a-1024w.webp');
    B.bridgeThumbFailed(li.firstChild);
    expect(li.firstChild.tagName).toBe('SPAN');
  });
});

describe('a paint sorts nothing it sorted last time', () => {
  it('frame numbers are computed once per change to the Buffer, and an edit in place is a change', async () => {
    vi.resetModules();
    const { STATE } = await import('../js/console-state.js');
    const { getBufferFrameNumbers } = await import('../js/console/fn-editor.js');
    STATE.buffer = [
      { id: 'b', filename: 'B.jpg', captured_at: '2026-10-02T10:00:00' },
      { id: 'a', filename: 'A.jpg', captured_at: '2026-10-01T10:00:00' },
    ];
    const one = getBufferFrameNumbers();
    expect(getBufferFrameNumbers()).toBe(one);
    expect([...one]).toEqual([['a', 1], ['b', 2]]);
    STATE.buffer[1].captured_at = '2026-10-03T10:00:00';   // edited where it lies
    const two = getBufferFrameNumbers();
    expect(two).not.toBe(one);
    expect([...two]).toEqual([['b', 1], ['a', 2]]);
    STATE.buffer = [...STATE.buffer, { id: 'c', filename: 'C.jpg', captured_at: '2026-10-04T10:00:00' }];
    expect(getBufferFrameNumbers().get('c')).toBe(3);
  });

  it('the latest roll dates only recent frames, and an undated frame no longer hides it', async () => {
    vi.resetModules();
    document.body.innerHTML = BODY;
    const { STATE } = await import('../js/console-state.js');
    const B = await import('../js/console/bridge.js');
    const now = Date.parse('2026-10-06T15:00:00');
    STATE.buffer = [
      { id: 'u', filename: 'U.jpg' },   // undated
      { id: 'o', filename: 'O.jpg', captured_at: '2025-01-01T10:00:00' },
      { id: 'r1', filename: 'R1.jpg', captured_at: '2026-10-05T09:00:00' },
      { id: 'r2', filename: 'R2.jpg', captured_at: '2026-10-05T11:00:00' },
    ];
    const roll = B.waitingLines(now).find((l) => l.act === 'buffer');
    expect(roll, 'the roll line').toBeTruthy();
    expect(roll.whisper).toMatch(/2 frames$/);
  });
});
