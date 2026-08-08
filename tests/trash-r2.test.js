// Guards the fix for the "trash offers to restore permanently-deleted R2 files"
// bug. When a publish commit (or the manual purge) PERMANENTLY deletes an item's
// R2 variants, its sessionTrash row must lose its ↩ RESTORE affordance — the
// media is gone and the removal is committed to main, so a restore can't work.
// dropTrashForDeletedR2() is the surgical drop, keyed off the deletes that
// actually fired (so a deferred library delete keeps its still-valid restore).
import { describe, it, expect, beforeEach } from 'vitest';

// console-state.js calls renderTrash() through the global scope (the console
// mirrors UI renderers onto window at runtime); stub it before importing.
let renderCalls = 0;
globalThis.renderTrash = () => { renderCalls++; };

const { sessionTrash, dropTrashForDeletedR2 } = await import('../js/console-state.js');

function seedTrash(entries) {
  sessionTrash.length = 0;
  sessionTrash.push(...entries);
}

describe('dropTrashForDeletedR2', () => {
  beforeEach(() => { renderCalls = 0; sessionTrash.length = 0; });

  it('drops the trash row whose R2 objects were just deleted', () => {
    seedTrash([
      { surface: 'buffer', item: { id: 'f1' }, label: 'f1' },
      { surface: 'archive', item: { id: 'f2' }, label: 'f2' },
    ]);
    const dropped = dropTrashForDeletedR2([{ entryId: 'f1', keys: ['archive/f1-480w.webp'] }]);
    expect(dropped).toBe(1);
    expect(sessionTrash.map((t) => t.item.id)).toEqual(['f2']);
    expect(renderCalls).toBe(1);
  });

  it('keeps rows whose deletes did NOT fire (e.g. deferred library)', () => {
    seedTrash([
      { surface: 'library', item: { id: 'lib1' }, label: 'lib1' },
    ]);
    // Publish fires only the non-library deletes; the library one stays queued.
    const dropped = dropTrashForDeletedR2([{ entryId: 'f9' }]);
    expect(dropped).toBe(0);
    expect(sessionTrash.map((t) => t.item.id)).toEqual(['lib1']);
    expect(renderCalls).toBe(0);
  });

  it('drops several rows and re-renders once', () => {
    seedTrash([
      { surface: 'buffer', item: { id: 'a' }, label: 'a' },
      { surface: 'buffer', item: { id: 'b' }, label: 'b' },
      { surface: 'buffer', item: { id: 'c' }, label: 'c' },
    ]);
    const dropped = dropTrashForDeletedR2([{ entryId: 'a' }, { entryId: 'c' }]);
    expect(dropped).toBe(2);
    expect(sessionTrash.map((t) => t.item.id)).toEqual(['b']);
    expect(renderCalls).toBe(1);
  });

  it('is a no-op for empty inputs (no render, no throw)', () => {
    seedTrash([{ surface: 'buffer', item: { id: 'x' }, label: 'x' }]);
    expect(dropTrashForDeletedR2([])).toBe(0);
    expect(dropTrashForDeletedR2(undefined)).toBe(0);
    expect(dropTrashForDeletedR2([{ keys: ['k'] }])).toBe(0); // no entryId
    expect(sessionTrash).toHaveLength(1);
    expect(renderCalls).toBe(0);
  });
});
