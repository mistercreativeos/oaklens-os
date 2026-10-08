// @vitest-environment happy-dom
//
// The Field Notes studio's three invariants, and the DOM contract underneath
// them. Written alongside the 2026-08-23 rewrite — see
// docs/maintenance/2026-08-23-field-notes-studio.md.
//
// WHY THIS FILE EXISTS. The editor it replaced was not broken in ways a test
// could see. Every individual patch on it was correct and several were pinned
// by tests. What was wrong was the SHAPE: a two-pane grid that only worked at
// desktop width, taken apart again by four more media queries, so a fix had to
// be made in four places and one was always missed. "This surface has five
// layouts" is not a failing assertion — it is a design smell, and the suite
// happily guarded the patches instead.
//
// So these tests do not check that the studio looks a particular way. They
// check the three properties the owner's three complaints reduce to, each of
// which is falsifiable from the source:
//
//   1. NO BUTTON ROW WRAPS       ("buttons on multiple lines")
//   2. THE LIVE READOUT MOVES NOTHING
//                                ("the save update messing up the layout")
//   3. ONE SCROLLER              ("the editor expanding to the full view")
//
// If a future change needs to break one of these, it needs to change the log
// first — that is the point of writing them down here rather than in a comment.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainUnits } from './helpers/units.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const css = plainUnits(read('css/field-console.css'));
const html = read('dev/field-console.html');
const js = read('js/console/fn-editor.js');

/** The consolidated section, comments stripped — assertions read RULES, not
 *  the prose, which quotes the very declarations it warns against. */
const SECTION = (() => {
  const start = css.indexOf('   FIELD NOTES STUDIO');
  const end = css.indexOf('.fn-render .fn-hero-rendered {', start);
  expect(start, 'the FIELD NOTES STUDIO section was renamed or removed').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
})();

/** The declaration block for a selector inside the studio section. */
function rule(selector, from = SECTION) {
  const re = new RegExp(`(^|[,{}]\\s*)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,{]`, 'm');
  const m = from.match(re);
  if (!m) return null;
  const open = from.indexOf('{', m.index + m[0].length - 1);
  return from.slice(open + 1, from.indexOf('}', open));
}

describe('invariant 1 — no row of buttons wraps', () => {
  // Every one of these holds two or more controls side by side. A wrap here is
  // the reported bug, verbatim: "buttons on multiple lines".
  const BUTTON_ROWS = [
    '.fn-bar',                 // the header itself
    '.fn-bar-doc',             // picker + NEW
    '.fn-bar-telemetry',       // the live readout
    '.fn-bar-actions',         // preview / save / stage / ⋯
    '.fn-dock',                // the six insert tools
    '.fn-hero-tools',          // focal / hero card / remove, on the cover
    '.fn-hero-controls',       // filename + those tools
    '.fn-hero-empty-alt',      // library / raw, on the empty cover
    '.fn-drawer-hdr',          // tabs + close
    '.fn-drawer-tabs',
    '.fn-preview-hdr',
    '.fn-preview-hdr-tools',
  ];

  for (const sel of BUTTON_ROWS) {
    it(`${sel} is nowrap`, () => {
      const body = rule(sel);
      expect(body, `${sel} is missing from the studio section`).toBeTruthy();
      expect(body, `${sel} may wrap — that is the reported bug`).toMatch(/flex-wrap:\s*nowrap/);
    });
  }

  it('a label never breaks mid-word either', () => {
    // Wrapping INSIDE a chip made buttons unequal heights and shoved the row
    // around — the same symptom one level down.
    expect(rule('.fn-btn,\n.fn-tool,\n.fn-chip') ?? rule('.fn-btn'))
      .toMatch(/white-space:\s*nowrap/);
  });

  it('the only wrap in the section is on rows that hold no buttons', () => {
    // Two deliberate exceptions, both labelled text rather than controls: the
    // empty-cover prompt and the note's meta row. Anything else that gains a
    // `flex-wrap: wrap` here should have to justify itself.
    const wrappers = [...SECTION.matchAll(/([^{}]+)\{[^}]*flex-wrap:\s*wrap[^}]*\}/g)]
      .map((m) => m[1].trim().split('\n').pop().trim());
    expect(wrappers.sort()).toEqual(['.fn-hero-empty', '.fn-meta']);
  });
});

describe('invariant 2 — the live readout cannot move anything', () => {
  // The complaint was precise: "the save update messing up the layout every
  // time it updates — i like to see the updates but the integration wasn't
  // done right." The readout was in the same wrapping flex row as the buttons,
  // so writing a longer string into it tipped the wrap threshold.
  it('each slot has a fixed width, in ch', () => {
    // Matched against its OWN rule, not the grouped one above it — the point is
    // that a reserved width exists somewhere for each slot.
    for (const sel of ['fn-sync', 'fn-count', 'fn-read']) {
      const re = new RegExp(`\\.${sel}\\s*\\{[^}]*width:\\s*\\d+ch`);
      expect(SECTION, `.${sel} must reserve its width, not take it from its text`).toMatch(re);
    }
  });

  it('a slot clips rather than grows', () => {
    expect(rule('.fn-sync, .fn-count, .fn-read')).toMatch(/overflow:\s*hidden/);
  });

  it('the numbers are tabular, so a digit change is not a width change', () => {
    expect(rule('.fn-bar-telemetry')).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('local save and cloud sync share ONE element', () => {
    // They used to own a span each, side by side. Two live readouts in one row
    // is two chances to reflow it.
    expect(js).toContain('_fnSyncPill');
    expect(js, 'the old two-span readout is back').not.toContain('fn-save-status');
    expect(js, 'the old two-span readout is back').not.toContain('fn-cloud-status');
    expect(html.match(/id="fn-sync"/g) || [], 'exactly one readout element').toHaveLength(1);
  });

  it('a stale fade cannot wipe a fresher status', () => {
    // The local save schedules a clear 2s out; a cloud push can land inside
    // that window. Whoever wrote last owns the slot.
    expect(js).toMatch(/_fnSyncClearLater[\s\S]{0,240}seq !== _fnSyncSeq/);
  });
});

describe('invariant 3 — one scroller', () => {
  it('the canvas scrolls', () => {
    expect(rule('.fn-canvas')).toMatch(/overflow-y:\s*auto/);
  });

  it('the textarea does not — it grows instead', () => {
    // A box that scrolls inside a box that scrolls is what makes a tablet pick
    // the wrong one, and what buries a caret under the on-screen keyboard.
    const body = rule('.fn-body');
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body, 'a fixed height would bring the inner scrollbar back').not.toMatch(/[^-]height:\s*(?!auto)/);
    expect(js, 'nothing grows the textarea to fit its content').toContain('_fnAutoGrow');
  });

  it('the view itself never becomes a second scroller — not even when short', () => {
    // The generic short-viewport rule flips a bounded view to `overflow-y:
    // auto`. The studio has to opt back out, or a 460px-tall landscape phone
    // gets two scrollers.
    const short = css.slice(css.indexOf('@media (max-height: 460px)'));
    expect(short).toMatch(/#view-fn\.view--bounded\.active \{[^}]*overflow:\s*hidden/);
  });

  it('the frame browser stands its own scroller down inside the drawer', () => {
    expect(SECTION).toMatch(/#fn-frame-browser \.fb-scroll \{[^}]*overflow:\s*visible/);
  });
});

describe('the shape: one layout, one band', () => {
  it('the studio owns exactly three responsive queries, each asking one thing', () => {
    // The build this replaced was reached by FIVE, three of which redefined the
    // same grid. These three ask three different questions — is there a bottom
    // nav, is the screen narrow, is the screen short — and each answers only
    // its own. Adding a fourth is the smell this whole rewrite was about.
    const bands = [...SECTION.matchAll(/@media[^{]+/g)].map((m) => m[0].trim());
    expect(bands).toEqual([
      '@media (max-width: 1180px), (pointer: coarse)',                              // is there a tab bar
      '@media (max-width: 860px), ((max-width: 1180px) and (orientation: portrait))', // is it narrow
      '@media (max-height: 460px)',                                                  // is it short
    ]);
  });

  it('nothing at the foot of the studio hardcodes its offset', () => {
    // THE REGRESSION THIS CLASS OF BUG KEEPS PRODUCING. The tab bar turns on at
    // 1180px-or-coarse; the studio's compact band starts at 860px-or-portrait.
    // An iPad Mini in landscape (1133px, coarse) falls between them, and the
    // first cut of this section put the floating dock at a flat `bottom: 18px`
    // — underneath the glass bar, unreachable. One variable, read by all three.
    expect(rule('.fn-dock')).toMatch(/bottom:\s*calc\([^)]*var\(--fn-foot\)/);
    expect(SECTION).toMatch(/--fn-dock-clear: calc\([^;]*var\(--fn-foot\)/);
    const band = SECTION.slice(SECTION.indexOf('@media (max-width: 860px)'));
    expect(band).toMatch(/\.fn-bar-actions \{[^}]*bottom:\s*var\(--fn-foot\)/);
    // …and --fn-foot itself is zero only where there is genuinely no bar.
    expect(SECTION).toMatch(/@media \(max-width: 1180px\), \(pointer: coarse\) \{\s*#view-fn \{ --fn-foot: calc\(var\(--tabbar-rsv\) \+ var\(--safe-bottom\)\); \}/);
  });

  it('the insert drawer lives OUTSIDE the view, with the console\u2019s other sheets', () => {
    // `.layout` carries a z-index, which makes it a stacking context: a sheet
    // rendered inside it is trapped below the tab bar (z-index 300) no matter
    // what z-index the sheet itself claims. Measured, not guessed — the first
    // cut had the drawer inside #view-fn and the tab bar ate its bottom rows.
    expect(css).toMatch(/\.layout \{[^}]*z-index:\s*1/);
    const view = html.slice(html.indexOf('id="view-fn"'), html.indexOf('id="view-wall"'));
    expect(view, 'the drawer is back inside the view, under the tab bar').not.toContain('id="fn-drawer"');
    expect(html, 'the drawer went missing entirely').toContain('id="fn-drawer"');
    // …so something has to shut it when you navigate away.
    expect(read('js/console/init.js')).toMatch(/registerView\("fn",[\s\S]{0,400}onLeave: [^\n]*fnCloseDrawer\(\)/);
  });

  it('no FN layout rule survives outside the section', () => {
    const outside = css.slice(0, css.indexOf('   FIELD NOTES STUDIO'))
      + css.slice(css.indexOf('.fn-render .fn-hero-rendered {'));
    for (const dead of ['.fn-compose', '.fn-frontmatter', '.fn-pane-hdr', '.fn-hdr-tools',
                        '.fn-hdr-stats', '.fn-panel-btn', '.fn-portrait-bar', '.fn-editor-area',
                        '.fn-preview-area', '.fn-collapse-btn', '.fn-focus-btn', '.fn-save-status']) {
      expect(outside, `${dead} — an FN layout rule outside the section`).not.toContain(dead);
    }
  });

  it('the compact band moves zones; it does not rebuild them', () => {
    const band = SECTION.slice(SECTION.indexOf('@media (max-width: 860px)'));
    // The one relocation: the bar's actions become the foot dock. Same DOM.
    expect(band).toMatch(/\.fn-bar-actions \{[^}]*position:\s*absolute/);
    expect(band).toMatch(/\.fn-dock \{ display: none; \}/);
    expect(band).toMatch(/\.fn-btn--insert \{ display: inline-flex; \}/);
    // Nothing in the band may re-declare the studio's structure.
    expect(band, 'the band is redefining the layout again').not.toMatch(/grid-template-columns/);
  });

  it('the foot dock is absolute, not fixed', () => {
    // `.view.active` runs a transform animation on entry, and a fixed child of
    // a transformed ancestor is positioned against THAT — a 180ms jump on every
    // visit to the view.
    const band = SECTION.slice(SECTION.indexOf('@media (max-width: 860px)'));
    expect(band).not.toMatch(/\.fn-bar-actions \{[^}]*position:\s*fixed/);
    expect(rule('.fn-dock')).toMatch(/position:\s*absolute/);
  });

  it('the foot dock clears the tab bar, the notch and the keys', () => {
    // Via --fn-foot, which is the tab bar plus the home indicator wherever the
    // bar exists (see the test above) — not a second copy of that sum.
    const band = SECTION.slice(SECTION.indexOf('@media (max-width: 860px)'));
    expect(band.match(/\.fn-bar-actions \{[^}]*\}/)[0]).toContain('var(--fn-foot)');
    // The keyboard is subtracted ONCE, on the view — the dock rides inside it.
    expect(SECTION).toMatch(/#view-fn\.view--bounded\.active \{[^}]*height: calc\(100% - var\(--kb-inset\)\)/);
  });

  it('the canvas leaves room for whichever dock is on screen', () => {
    // The floating capsule and the taller foot dock are different heights, so
    // the clearance changes — but both spend it through the same variable.
    expect(rule('.fn-canvas')).toContain('var(--fn-dock-clear)');
    const band = SECTION.slice(SECTION.indexOf('@media (max-width: 860px)'));
    expect(band).toMatch(/--fn-dock-clear: calc\(\d+px \+ var\(--fn-foot\)\)/);
  });

  it('focus mode never becomes a room you can only leave with a keystroke', () => {
    // The actions are a CHILD of the bar, and a child cannot outlive its
    // parent's display — `display: none` on the bar took SAVE, ▲ STAGE and ⋯
    // with it. The bar flattens instead.
    expect(SECTION, 'the bar is being hidden outright again')
      .not.toMatch(/body\.fn-focus[^{]*\.fn-bar[^-][^{]*\{[^}]*display:\s*none/);
    expect(SECTION).toMatch(/body\.fn-focus \.fn-bar-actions \{[^}]*position:\s*absolute/);
    expect(SECTION).toMatch(/body\.fn-focus \.fn-dock \{ opacity/);
  });

  it('the writing is the whole surface under the rail: a Pencil target, not a band (K62)', () => {
    // The owner, on the iPad mini: the layout "just isn't expanding to its
    // full capacity". The canvas is a column, the manuscript fills it, and
    // the writing fills the manuscript — no fraction of the screen height.
    expect(rule('.fn-canvas')).toMatch(/display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*container-type:\s*inline-size/);
    expect(rule('.fn-manuscript')).toMatch(/flex:\s*1 0 auto/);
    const body = rule('.fn-body');
    expect(body).toMatch(/flex:\s*1 0 auto/);
    expect(SECTION, 'a vh floor on the writing is back').not.toMatch(/\.fn-body \{[^}]*min-height:\s*\d+vh/);
    // Full width as a field, 760px as a measure: the bleed out, the padding in.
    expect(body).toMatch(/--fn-bleed: max\(0px, \(100cqi - 100%\) \/ 2\)/);
    expect(body).toMatch(/margin-inline: calc\(-1 \* var\(--fn-bleed\)\)/);
    expect(body).toMatch(/padding: 4px var\(--fn-bleed\) 0/);
  });

  it('focus mode is only the writing: the cover goes, and the keys rest readable on touch (K62)', () => {
    expect(SECTION).toMatch(/body\.fn-focus #fn-hero-slot \{ display: none; \}/);
    const touch = SECTION.slice(SECTION.indexOf('@media (max-width: 1180px), (pointer: coarse)'));
    expect(touch).toMatch(/body\.fn-focus #view-fn \.fn-bar-actions \{ opacity: 0\.\d+; \}/);
  });

  it('leaving the view leaves focus mode and lands a pending save (K62)', () => {
    expect(js).toMatch(/export function fnExitFocus\(\)/);
    expect(js).toMatch(/export function fnFlushSave\(\)/);
    const init = read('js/console/init.js');
    expect(init).toMatch(/registerView\("fn", \{[\s\S]*?onLeave: \(\) => \{ fnFlushSave\(\); fnCloseDrawer\(\); fnExitFocus\(\); \}/);
  });

  it('the draft marker is on the bar, not down the left edge', () => {
    // It was a full-height rule on the editor CARD. Once the card became the
    // whole pane, that rule sat flush against the sidebar and read as a
    // divider rather than as state.
    expect(css, 'the full-height elastic band is back').not.toContain('.fn-studio.is-draft::before');
    expect(rule('.fn-studio.is-draft .fn-bar')).toMatch(/box-shadow:\s*inset/);
  });

  it('the preview covers the writing, not the controls', () => {
    // Positioned against .fn-stage (the manuscript) rather than the view, so
    // SAVE / ▲ STAGE stay reachable while you look at the render — you decide
    // it reads right and stage it, without closing anything first.
    expect(rule('.fn-stage')).toMatch(/position:\s*relative/);
    const view = html.slice(html.indexOf('id="view-fn"'), html.indexOf('id="view-wall"'));
    const stage = view.slice(view.indexOf('class="fn-stage"'));
    expect(stage, 'the preview panel left the stage').toContain('id="fn-preview-panel"');
    expect(view.indexOf('class="fn-bar"'), 'the bar must sit outside the stage')
      .toBeLessThan(view.indexOf('class="fn-stage"'));
  });
});

describe('the studio at runtime', () => {
  let mod;

  beforeAll(async () => {
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
    document.getElementById('view-fn').classList.add('active');
    mod = await import('../js/console/fn-editor.js');
    mod.fnNewPost();
  });

  it('the preview is an overlay that starts shut', () => {
    expect(document.getElementById('fn-preview-panel').hidden).toBe(true);
  });

  it('opening it renders, closing it stops rendering', () => {
    document.getElementById('fn-body').value = 'Fog over the water.';
    mod.fnRender();
    // Shut: the counter moved, the render did not.
    expect(document.getElementById('fn-word-count').textContent).toBe('4 words');
    expect(document.getElementById('fn-preview').innerHTML).toBe('');

    mod.fnOpenPreview();
    expect(document.getElementById('fn-preview-panel').hidden).toBe(false);
    expect(document.getElementById('fn-preview').innerHTML).toContain('Fog over the water.');
    expect(document.getElementById('fn-preview-btn').getAttribute('aria-expanded')).toBe('true');

    mod.fnClosePreview();
    expect(document.getElementById('fn-preview-btn').getAttribute('aria-expanded')).toBe('false');
  });

  it('the drawer shows one pane at a time and marks its tab', () => {
    mod.fnDrawerTab('days');
    expect(document.getElementById('fn-buffer-dates-panel').hidden).toBe(false);
    expect(document.getElementById('fn-frame-browser').hidden).toBe(true);
    expect(document.getElementById('fn-media-pane').hidden).toBe(true);
    expect(document.getElementById('fn-tab-days').getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('fn-tab-frames').getAttribute('aria-selected')).toBe('false');

    mod.fnDrawerTab('media');
    expect(document.getElementById('fn-media-pane').hidden).toBe(false);
    expect(document.getElementById('fn-buffer-dates-panel').hidden).toBe(true);
  });

  it('the ⋯ menu opens, closes, and says which it is', () => {
    const menu = document.getElementById('fn-menu');
    const btn = document.getElementById('fn-menu-btn');
    expect(menu.hidden).toBe(true);
    mod.fnToggleMenu();
    expect(menu.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    mod.fnToggleMenu(false);
    expect(menu.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('the cover switches the slot between dropzone and banner', () => {
    const slot = document.getElementById('fn-hero-slot');
    expect(slot.classList.contains('has-cover')).toBe(false);
    mod.fnHeroSet('', 'a-frame.webp');
    expect(slot.classList.contains('has-cover')).toBe(true);
    expect(document.getElementById('fn-hero-focal').style.display).toBe('inline-flex');
    mod.fnHeroClear();
    expect(slot.classList.contains('has-cover')).toBe(false);
    expect(document.getElementById('fn-hero-clear').style.display).toBe('none');
  });

  it('one picker carries both kinds of note, grouped', () => {
    return import('../js/console-state.js').then(({ STATE }) => {
      STATE.posts.length = 0;
      STATE.posts.push(
        { id: 'a', title: 'Half-written', status: 'draft', date: '2026-08-23' },
        { id: 'b', title: 'Out there', fn_id: 'fn-011', status: 'published', date: '2026-08-01' },
      );
      mod.renderFN();
      const sel = document.getElementById('fn-doc-select');
      const groups = [...sel.querySelectorAll('optgroup')].map((g) => g.label);
      expect(groups).toEqual(['DRAFTS (1)', 'PUBLISHED (1)']);
      expect(sel.querySelectorAll('option')).toHaveLength(3);   // the two + the prompt
    });
  });

  it('the note on screen is the note the picker names', () => {
    // The two-select build could not say this at all: neither picker knew what
    // was open, so both sat on their placeholder while you typed.
    return import('../js/console-state.js').then(() => {
      mod.fnLoadPost('b');
      expect(document.getElementById('fn-doc-select').value).toBe('b');
      expect(document.getElementById('fn-status-badge').textContent).toBe('LIVE');
      expect(document.querySelector('.fn-studio').classList.contains('is-draft')).toBe(false);

      mod.fnLoadPost('a');
      expect(document.getElementById('fn-doc-select').value).toBe('a');
      expect(document.getElementById('fn-status-badge').textContent).toBe('DRAFT');
      expect(document.querySelector('.fn-studio').classList.contains('is-draft')).toBe(true);
    });
  });
});
