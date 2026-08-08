// Field Notes has to be usable the second it opens (2026-08-08 cold run).
//
// The report, verbatim: "you have to click new draft to start writing AND you
// have to write a title for it to actually save the draft… could be a bad
// impression since the cursor is blinking."
//
// Both halves were real, and they compounded. Every save path in fn-editor.js
// opens `if (!fnCurrentId) return`, and nothing created a draft on arrival — so
// the editor accepted typing and kept none of it. Then `fnStage` refused
// outright without a title, on a surface whose own header advertises AUTO-SAVE.
//
// The pure helpers are unit-tested; the wiring is asserted against the source,
// because the alternative is booting the whole console to prove a one-line
// guard exists. Both matter: the helpers decide what a nameless note is called,
// and the wiring decides whether it is ever saved at all.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(import.meta.dirname, '..', 'js', 'console', 'fn-editor.js'), 'utf8');

// The module reaches for `document` at import time through its siblings, so
// pull the two pure helpers out of the source rather than importing the world.
const { _draftStamp: draftStamp, _isPlaceholderTitle: isPlaceholderTitle } =
  await (async () => {
    const start = SRC.indexOf('function draftStamp()');
    const end = SRC.indexOf('export function fnStage');
    const body = SRC.slice(start, end)
      .replace(/export const /g, 'const ')
      + '\nreturn { _draftStamp: draftStamp, _isPlaceholderTitle: isPlaceholderTitle };';
    return new Function(body)();
  })();

describe('an untitled draft still gets a name', () => {
  it('stamps the date and time, so the drafts picker stays navigable', () => {
    expect(draftStamp()).toMatch(/^Draft \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('zero-pads, or the list sorts wrong and reads worse', () => {
    // Not cosmetic: "Draft 2026-8-8 9:5" both sorts and scans badly next to
    // its neighbours, and this string is the only handle on the draft.
    const parts = draftStamp().split(' ');
    expect(parts[1].split('-').every((n) => n.length >= 2)).toBe(true);
    expect(parts[2].split(':').every((n) => n.length === 2)).toBe(true);
  });

  it('recognises its own stamp later, so publish can still ask for a real one', () => {
    expect(isPlaceholderTitle(draftStamp())).toBe(true);
    expect(isPlaceholderTitle('')).toBe(true);
    expect(isPlaceholderTitle(undefined)).toBe(true);
  });

  it('does not mistake a real title for a placeholder', () => {
    // Including titles that merely start with the word, which a person writing
    // about their own drafts would plausibly type.
    for (const t of ['Draft season', 'Drafts, 2026', 'A draft 2026-08-08 15:42 note', 'Untitled']) {
      expect(isPlaceholderTitle(t), `"${t}" is a real title`).toBe(false);
    }
  });
});

describe('the editor is live on arrival', () => {
  it('renderFN creates a draft when none is open', () => {
    // Placed in renderFN rather than the view switch so every way in is
    // covered: boot, sidebar, tab bar, and coming back after a publish.
    const fn = SRC.slice(SRC.indexOf('export function renderFN'));
    expect(fn.slice(0, fn.indexOf('const drafts')))
      .toMatch(/if \(!fnCurrentId\) fnNewPost\(\);/);
  });

  it('saving a draft no longer requires a title', () => {
    expect(SRC, 'the bare refusal is what made the editor feel broken')
      .not.toMatch(/if \(!title\) return toast\("title required"/);
  });

  it('publishing still requires one, and gates on the RESOLVED status', () => {
    // `fnStage()` with no argument inherits the post's existing status, so a
    // check against the ARGUMENT would let an edit to an already-published post
    // go out named "Draft 2026-08-08 15:42".
    const stage = SRC.slice(SRC.indexOf('export function fnStage'));
    const gate = stage.indexOf('isPlaceholderTitle(title)');
    const resolved = stage.indexOf('finalStatus === "published"');
    expect(gate, 'publish must still ask for a title').toBeGreaterThan(-1);
    expect(resolved, 'the gate must key off finalStatus').toBeGreaterThan(-1);
    expect(resolved).toBeLessThan(gate);
    expect(stage.slice(0, gate)).toMatch(/finalStatus = /);
  });
});
