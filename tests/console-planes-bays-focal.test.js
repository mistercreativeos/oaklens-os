// K55 (2026-10-05 — the owner): the focal point modal's buttons "are kinda
// messy and not in a nice layout, proportionally scaled"; every plane should
// be "the same style window as the pop up to insert items in the field notes
// surface … that bottom up lighting look"; and the drop zones "at rest …
// look like they go completely black … they should still have a low volume
// of ambient light filling up from the bottom".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = readFileSync(join(process.cwd(), 'dev', 'field-console.html'), 'utf8');

describe('every plane is the same bottom-lit window', () => {
  it('modals and sheets wear one body: frosted glass with the hue entering its foot', () => {
    expect(RULES).toMatch(/:root \{ --plane-body:\s*linear-gradient\(0deg, rgba\(var\(--lit-rgb\), calc\([\d.]+ \* var\(--float-k\)\)\) 0%,[^;]*var\(--glass\); \}/);
    expect(RULES).toMatch(/\.modal-overlay \.modal, \.sheet-overlay \.sheet, \.sheet-overlay \.welcome \{\s*background: var\(--plane-body\);\s*-webkit-backdrop-filter: blur\(24px\) saturate\(1\.3\);/);
  });
  it('on paper a plane is the printed card it was, with no blur', () => {
    expect(RULES).toMatch(/:root\[data-theme="light"\] \{ --plane-body: var\(--bg-elev-1\); \}/);
    expect(RULES).toMatch(/:root\[data-theme="light"\] :is\(\.modal-overlay \.modal, \.sheet-overlay \.sheet, \.sheet-overlay \.welcome\) \{\s*-webkit-backdrop-filter: none;/);
  });
});

describe('the bays are backlit glass at rest', () => {
  it('every bay in the console carries data-backlit beside its seam', () => {
    const bays = HTML.match(/<div class="dropzone[^"]*"[^>]*>/g);
    expect(bays.length).toBe(6);   // Buffer, Archive, Wall, Library, Audio, and the Bridge's
    for (const b of bays) expect(b).toMatch(/data-seam="box" data-backlit/);
  });
  it('a panel\'s level at rest, the panel\'s warm level while hot, on the bay\'s own heat and cool curves', () => {
    expect(RULES).toMatch(/\.dropzone\[data-backlit\] \{\s*--backlight: var\(--backlight-panel\);/);
    expect(RULES).toMatch(/\.dropzone\[data-backlit\]\.over, \.dropzone\[data-backlit\]\[data-heat="hot"\] \{ --backlight: var\(--backlight-panel-warm\); \}/);
    const sec = RULES.slice(RULES.indexOf('\n.dropzone {'), RULES.indexOf('\n.dropzone {') + 4000);
    expect(sec.match(/--backlight var\(--arm-cool\)/g).length).toBeGreaterThanOrEqual(2);
    expect(sec.match(/--backlight var\(--arm-heat\)/g).length).toBeGreaterThanOrEqual(2);
  });

  // K80 (the owner, on the iPad and the phone: a level of the glow "drops
  // out" before it fades all the way down). The hot ground was a colour and
  // a backlit bay's resting ground its glass, a gradient: a gradient does not
  // interpolate with a colour, so the glass came back in one frame at the
  // first frame of the cool (measured on video: a step of 23-34% of the
  // wake's rise). The ground is the glass in both states; only its two
  // alphas move, registered so they transition.
  it('the glass is the ground hot and cold alike, and only its alphas move, on the bay\'s curves', () => {
    for (const p of ['--bay-near', '--bay-far']) {
      expect(RULES, p).toMatch(new RegExp(`@property ${p} \\{\\s*syntax: '<number>';\\s*inherits: false;`));
    }
    expect(RULES).toMatch(/\.dropzone\[data-backlit\] \{[^}]*--glass-body: linear-gradient\(0deg, rgba\(4, 4, 5, var\(--bay-near\)\), rgba\(4, 4, 5, var\(--bay-far\)\)\);/);
    const base = RULES.slice(RULES.indexOf('\n.dropzone {'), RULES.indexOf('}', RULES.indexOf('\n.dropzone {')));
    expect(base).toMatch(/--bay-near: var\(--glass-near\);\s*--bay-far: var\(--glass-far\);/);
    const hot = RULES.match(/\n\.dropzone\.over, \.dropzone\[data-heat="hot"\] \{([^}]*)\}/)[1];
    expect(hot).toMatch(/--bay-near: 0\.45;\s*--bay-far: 0\.45;/);
    expect(hot).not.toMatch(/(^|\s)background:/);   // no colour for the glass to snap from
    const sec = RULES.slice(RULES.indexOf('\n.dropzone {'), RULES.indexOf('\n.dropzone {') + 4000);
    expect(sec.match(/--bay-near var\(--arm-cool\), --bay-far var\(--arm-cool\)/g).length).toBeGreaterThanOrEqual(2);
    expect(sec.match(/--bay-near var\(--arm-heat\), --bay-far var\(--arm-heat\)/g).length).toBeGreaterThanOrEqual(2);
    // On paper the glass is a solid tier, and its hot ground a colour: a colour to a colour.
    expect(RULES).toMatch(/:root\[data-theme="light"\] :is\(\.dropzone\.over, \.dropzone\[data-heat="hot"\]\) \{ background: var\(--frost-0\); \}/);
  });
});

describe('the focal footer: two rows, one height', () => {
  it('the share actions are one equal-width group on top, whatever subset shows', () => {
    expect(RULES).toMatch(/#focal-card-actions \{\s*order: -1;\s*flex: 1 1 100%;\s*display: flex;\s*flex-wrap: wrap;/);
    expect(RULES).toMatch(/#focal-card-actions > \.btn \{ flex: 1 1 \d+px; \}/);
    // focal.js hides the group with an inline display:none; the stylesheet must not undo it.
    expect(RULES).toMatch(/#focal-card-actions\[style\*="none"\] \{ display: none; \}/);
  });
  it('every key is one height; Center left, the answer right, the row on a phone', () => {
    expect(RULES).toMatch(/#focal-modal \.modal-footer \.btn \{\s*min-height: 44px;/);
    expect(RULES).toMatch(/#focal-modal \.modal-footer > \.btn-stage \{ flex: 0 1 \d+px; margin-left: auto; \}/);
    expect(RULES).toMatch(/@media \(max-width: 640px\) \{\s*#focal-modal \.modal-footer > \.btn-stage \{ flex: 1 1 auto; \}/);
  });
  it('on a phone the readout gets its own line under the card', () => {
    expect(RULES).toMatch(/\.focal-side \{ width: 100%; flex-direction: row; flex-wrap: wrap;/);
    expect(RULES).toMatch(/\.focal-cardwrap \{ flex: 1 1 100%; \}/);
  });
});
