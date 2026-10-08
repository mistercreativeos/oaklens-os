// @vitest-environment happy-dom
//
// The view seam (K65, docs/ideas/spark-to-post.md): `showView(name, seed)`
// hands the arriving view structured state, after its render, inside the same
// swap, through the view's own `onEnter(seed)`. It replaced hand-offs that
// guessed at timing: buffer → archive on a setTimeout(80), and the Bridge
// loading a draft before the editor had rendered.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let C;
beforeAll(async () => {
  document.body.innerHTML = '<section class="view active" id="view-a"></section><section class="view" id="view-b"></section>';
  C = await import('../js/console/chrome.js');
});

describe('showView(name, seed)', () => {
  it('renders, then hands the seed to onEnter, in that order and at once', () => {
    const log = [];
    C.registerView('b', { render: () => log.push('render'), onEnter: (seed) => log.push(['enter', seed]) });
    C.showView('b', { load: 'x' });
    expect(log).toEqual(['render', ['enter', { load: 'x' }]]);
    expect(document.getElementById('view-b').classList.contains('active')).toBe(true);
  });

  it('a view already up still takes a new seed; no seed, no onEnter', () => {
    const seen = [];
    C.registerView('b', { render() {}, onEnter: (seed) => seen.push(seed) });
    C.showView('b', { load: 'y' });
    C.showView('b');
    expect(seen).toEqual([{ load: 'y' }]);
  });

  it('a seed asking for focus never waits for a View Transition (iOS raises the keyboard only inside the tap)', () => {
    const chrome = read('js/console/chrome.js');
    expect(chrome).toMatch(/if \(arriving && _crossfades\(\) && !\(seed && seed\.focus\)\)/);
  });

  it('the old timing guess is gone: the archive fills its form on arrival', () => {
    const buffer = read('js/console/buffer.js');
    expect(buffer).toMatch(/showView\("archive", \{ fromBuffer: item \}\);/);
    expect(buffer).not.toMatch(/\}, 80\);/);
    expect(read('js/console/init.js')).toMatch(/registerView\("archive", \{ render: renderArchive, onEnter: archiveEnter \}\);/);
  });
});
