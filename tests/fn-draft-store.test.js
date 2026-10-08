// @vitest-environment happy-dom
//
// The draft store (K65, js/console/fn-editor.js fnUpsertDraft): one way a
// note is written to STATE, whoever writes it. Fields are written OVER what
// is kept, so a key the writer does not know about survives an edit (a
// spark's kind, the cloud watermark, _imported), and writing one note never
// touches the editor (the Bridge's .md drop used to swap out the open note).

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

let F, S;
beforeAll(async () => {
  F = await import('../js/console/fn-editor.js');
  S = await import('../js/console-state.js');
});

describe('fnUpsertDraft', () => {
  it('a new note is a draft of kind "note", at the front', () => {
    const post = F.fnUpsertDraft('t-new', { title: 'Fog', body: 'over the water' });
    expect(post).toMatchObject({ id: 't-new', title: 'Fog', body: 'over the water', status: 'draft', kind: 'note' });
    expect(S.STATE.posts[0].id).toBe('t-new');
  });

  it('an edit keeps every field it does not name', () => {
    S.STATE.posts.unshift({ id: 't-keep', title: 'a', body: 'b', status: 'draft', kind: 'spark', _cloud_updated: 42, _imported: true });
    F.fnUpsertDraft('t-keep', { body: 'b, longer' });
    const kept = S.STATE.posts.find((p) => p.id === 't-keep');
    expect(kept).toMatchObject({ body: 'b, longer', kind: 'spark', _cloud_updated: 42, _imported: true, title: 'a' });
  });

  it('writes no field of the editor', () => {
    const src = readFileSync(join(ROOT, 'js/console/fn-editor.js'), 'utf8');
    const store = src.slice(src.indexOf('function _fnWritePost('), src.indexOf('// ============== CLOUD DRAFTS'));
    expect(store).not.toMatch(/getElementById|document\./);
  });

  it('the editor\'s own saves go through it, and the Bridge\'s .md drop no longer opens a note in the editor', () => {
    const src = readFileSync(join(ROOT, 'js/console/fn-editor.js'), 'utf8');
    const auto = src.slice(src.indexOf('export function fnAutoSave('), src.indexOf('export function fnDebouncedSave('));
    expect(auto).toMatch(/fnUpsertDraft\(fnCurrentId, \{/);
    const bridge = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(bridge).toMatch(/fnUpsertDraft\(uid\(\), \{ title: title \|\| 'Untitled', body \}\);/);
    expect(bridge).not.toMatch(/fnNewPost/);
  });
});
