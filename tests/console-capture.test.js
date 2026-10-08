// @vitest-environment happy-dom
//
// Capture on the Bridge (js/console/capture.js, K66): the spark, a quick
// draft that keeps itself privately and EXPANDs into the full editor, and the
// shelf of frames to cite. The owner, 2026-10-06: capture "the raw thought on
// the curb or train, and when you're ready, it blooms into an essay with zero
// copy-pasting."

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

let C, S;
beforeAll(async () => {
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
  S = await import('../js/console-state.js');
  C = await import('../js/console/capture.js');
});

const field = () => document.getElementById('br-spark');

describe('the spark', () => {
  it('keeps what is typed as a private draft of its own kind', () => {
    field().value = 'the light on the water';
    const post = C.sparkSave();
    expect(post).toMatchObject({ kind: 'spark', status: 'draft', body: 'the light on the water' });
    expect(localStorage.getItem('oaklens_spark_current')).toBe(post.id);
    // Typed again, the same spark, not a second one.
    field().value = 'the light on the water at six';
    expect(C.sparkSave().id).toBe(post.id);
    expect(S.STATE.posts.filter((p) => p.kind === 'spark')).toHaveLength(1);
  });

  it('an emptied spark is not kept', () => {
    field().value = 'gone soon';
    const id = C.sparkSave().id;
    field().value = '   ';
    expect(C.sparkSave()).toBeNull();
    expect(S.STATE.posts.some((p) => p.id === id)).toBe(false);
    expect(localStorage.getItem('oaklens_spark_current')).toBeNull();
  });

  it('EXPAND makes it a note, empties the field and opens the editor on it, cursor at the end', async () => {
    const chrome = await import('../js/console/chrome.js');
    const seen = [];
    chrome.registerView('fn', { render() {}, onEnter: (seed) => seen.push(seed) });
    field().value = 'it blooms';
    C.sparkExpand();
    const note = S.STATE.posts.find((p) => p.body === 'it blooms');
    expect(note.kind).toBe('note');
    expect(field().value).toBe('');
    expect(seen.at(-1)).toEqual({ load: note.id, caret: 'end', focus: true });
  });

  it('⇧↵ expands; a plain ↵ is a new line', () => {
    const spy = vi.fn();
    const e = (shiftKey) => ({ key: 'Enter', shiftKey, preventDefault: spy });
    field().value = '';
    C.sparkKey(e(false));
    expect(spy).not.toHaveBeenCalled();
    C.sparkKey(e(true));
    expect(spy).toHaveBeenCalled();
  });

  it('is static markup, so the Bridge\'s repaints never take focus from it', () => {
    expect(html).toMatch(/<textarea id="br-spark" class="br-spark-input"/);
    const bridge = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    expect(bridge).not.toMatch(/br-spark-input|paintHTML\(\$\('br-spark'\)/);
  });

  it('sparks stay out of "waiting on you" and get their own group in the editor\'s picker', () => {
    const bridge = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    expect(bridge).toMatch(/p\.kind !== 'spark'/);
    const fn = readFileSync(join(ROOT, 'js/console/fn-editor.js'), 'utf8');
    expect(fn).toMatch(/group\(`SPARKS \(\$\{sparks\.length\}\)`/);
  });
});

describe('the frames to cite', () => {
  it('the newest frames, newest first, with their f#; dark frames never', () => {
    S.STATE.buffer = [
      { id: 'a', filename: 'a.jpg', captured_at: '2026-10-01T10:00:00Z', added_at: '2026-10-01T10:00:00Z', _imported: true },
      { id: 'b', filename: 'b.jpg', captured_at: '2026-10-02T10:00:00Z', added_at: '2026-10-05T10:00:00Z' },
      { id: 'c', filename: 'c.jpg', captured_at: '2026-10-03T10:00:00Z', added_at: '2026-10-03T10:00:00Z', dark: true },
    ];
    const shelf = C.shelfFrames();
    expect(shelf.map((x) => x.f.id)).toEqual(['b', 'a']);
    expect(shelf.map((x) => x.n)).toEqual([2, 1]);
    expect(shelf.map((x) => x.live)).toEqual([false, true]);
  });

  it('a tap cites at the cursor, spaced, and the spark keeps focus', () => {
    field().value = 'the light';
    field().setSelectionRange(9, 9);
    C.sparkCite(389);
    expect(field().value).toBe('the light f#389 ');
    field().value = 'see and then';
    field().setSelectionRange(3, 3);
    C.sparkCite(12);
    expect(field().value).toBe('see f#12 and then');
  });

  it('a frame not yet published wears its number provisionally', () => {
    const src = readFileSync(join(ROOT, 'js/console/capture.js'), 'utf8');
    expect(src).toMatch(/is-provisional/);
    expect(src).toMatch(/may change until this frame is published/);
    expect(src).toMatch(/onpointerdown="event\.preventDefault\(\)"/);
  });
});
