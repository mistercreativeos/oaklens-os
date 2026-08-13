// The console side of Pulse — written after two bugs shipped past a green suite.
//
// Both were the same shape: code that is fine in isolation and never actually
// reached at runtime. Nothing in 1353 passing tests noticed, because every one
// of them tested a function directly rather than asking "can the console load
// this, and does it have rules to draw it with?"
//
//   1. THE PACKS NEVER LOADED. js/pulse-packs.js shipped as a classic script
//      hanging window.MoodPacks, but dev/field-console.html carries no
//      <script src> tags at all — it is an ES-module surface with an import
//      map. So the composer rendered its "starter packs" heading above nothing.
//   2. THE CARD HAD NO STYLES. The card markup uses .wk-pulse/.wk-p-*, which
//      live in css/main.css, and the console loads only css/field-console.css.
//      It came out as two lines of unstyled text.
//
// So these check REACHABILITY, not behaviour.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKS, pulseFrom, allPulses, trayGlyphs } from '../js/pulse-packs.js';
import { PULSE_LABEL } from '../src/shared/pulse.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const consoleHtml = read('dev/field-console.html');
const consoleCss = read('css/field-console.css');
const pulseModule = read('js/console/pulse.js');
const packsSrc = read('js/pulse-packs.js');

describe('the packs are reachable from the console', () => {
  it('js/pulse-packs.js is an ES MODULE, not a global-hanging classic script', () => {
    expect(packsSrc).toMatch(/^export /m);
    // The console has no <script src> tags, so a global would never be defined.
    expect(packsSrc).not.toMatch(/globalThis\.(Mood|Pulse)Packs|window\.(Mood|Pulse)Packs/);
  });

  it('the console has no <script src> tags at all — the reason above', () => {
    // If this ever stops being true the rule changes, and whoever changes it
    // should have to update this test on purpose.
    expect(consoleHtml).not.toMatch(/<script\s+src=/i);
  });

  it('every js/ file the pulse module imports is listed in the import map', () => {
    const imports = [...pulseModule.matchAll(/^import\s[\s\S]*?from\s+['"]([^'"]+)['"];?$/gm)]
      .map((m) => m[1])
      .filter((s) => s.startsWith('.'));
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      // '../pulse-packs.js' → '/js/pulse-packs.js'; './chrome.js' → '/js/console/chrome.js'
      const path = spec.startsWith('../')
        ? `/js/${spec.slice(3)}`
        : `/js/console/${spec.replace('./', '')}`;
      expect(
        consoleHtml,
        `${spec} is imported by js/console/pulse.js but has no import-map entry — `
        + 'it will load unversioned and never cache-bust.',
      ).toContain(`"${path}"`);
    }
  });

  it('the pulse module is registered in the barrel and the service worker', () => {
    expect(read('js/console-ui.js')).toContain('./console/pulse.js');
    const sw = read('dev/sw.js');
    expect(sw).toMatch(/\/js\/console\/pulse\.js\?v=\d+/);
    expect(sw).toMatch(/\/js\/pulse-packs\.js\?v=\d+/);
  });

  it('nothing still points at the pre-rename paths', () => {
    // The rename moved five files at once. A leftover /js/console/mood.js in the
    // import map or the service worker is a 404 on a surface that caches
    // aggressively — it would fail quietly and only for people who already had
    // the console installed.
    for (const [label, src] of [['import map / shell', consoleHtml], ['service worker', read('dev/sw.js')]]) {
      expect(src, `${label} still references a mood-era path`).not.toMatch(/js\/(console\/)?mood/);
    }
  });

  it('Pulse has a topbar chip, not just a More-sheet entry', () => {
    // The one-handed path. Pulse is a secondary surface like the Wall, but it is
    // the only one you reach for standing up and in a hurry — two taps through
    // a sheet is fine for "edit the wall", not for "post what I am doing now".
    // The chip lives in the same cluster as the lamp and the settings pair and
    // uses the same class, so it matches them by construction rather than by
    // someone remembering to.
    expect(consoleHtml).toMatch(/class="settings-btn"[^>]*id="pulse-topbar-btn"/);
    expect(consoleHtml).toMatch(/id="pulse-topbar-btn"[^>]*onclick="showView\('pulse'\)"/);
  });

  it('the topbar chip and the More-sheet entry wear the SAME glyph', () => {
    // Finger memory only works if the two places Pulse appears look like one
    // thing. If someone changes one glyph, this fails rather than quietly
    // leaving a smiley up top and something else in the sheet.
    const chip = consoleHtml.match(/id="pulse-topbar-btn"[^>]*>([^<]+)</);
    const sheet = consoleHtml.match(/<span class="sheet-icon">([^<]+)<\/span>\s*Pulse/);
    expect(chip, 'the Pulse topbar chip is missing').toBeTruthy();
    expect(sheet, 'the Pulse More-sheet entry is missing').toBeTruthy();
    expect(chip[1].trim()).toBe(sheet[1].trim());
  });

  it('the composer view exists in the console markup and is in the nav', () => {
    expect(consoleHtml).toContain('id="view-pulse"');
    expect(consoleHtml).toContain('id="pulse-body"');
    expect(consoleHtml).toContain('data-view="pulse"');
    expect(read('js/console/chrome.js')).toMatch(/MORE_VIEWS\s*=\s*\[[^\]]*"pulse"/);
  });
});

describe('the card can actually be drawn', () => {
  // The console does not load css/main.css, so every class the card emits needs
  // a rule in the console's own stylesheet.
  it.each(['.wk-pulse', '.wk-p-kicker', '.wk-p-led', '.wk-p-center', '.wk-p-glyph', '.wk-p-text', '.wk-p-foot'])(
    '%s is styled in css/field-console.css',
    (cls) => {
      expect(
        consoleCss,
        `${cls} is emitted by the composer but has no rule in the console stylesheet — `
        + 'it will render unstyled, which is exactly what shipped.',
      ).toContain(cls);
    },
  );

  it('the card carries all six palettes, like the public card', () => {
    for (const s of ['ember', 'dawn', 'flow', 'velvet', 'tide']) {
      expect(consoleCss).toContain(`[data-state="${s}"]`);
    }
  });

  it('the card styles every tier the tier function can return', () => {
    for (const t of ['statement', 'feature', 'standard', 'glyph']) {
      expect(consoleCss).toContain(`[data-tier="${t}"]`);
    }
  });

  it('the tier function does not depend on a global the console never defines', () => {
    // The first cut called globalThis.RecentIndex, which is a classic script
    // loaded only on public pages — so every card silently read `statement`.
    // Comments are stripped first: this module explains that bug in prose, and
    // a guard that cannot tell an explanation from the mistake is not a guard.
    const code = pulseModule.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/globalThis\.RecentIndex/);
  });
});

describe('the SMD indicator', () => {
  const mainCss = read('css/main.css');

  it.each([['css/main.css', mainCss], ['css/field-console.css', consoleCss]])(
    '%s draws the LED from tokens, never a hardcoded colour',
    (_label, css) => {
      // The snippet this came from hardcoded #fff and rgba(0,0,0,0.9). Both are
      // wrong in Daylight — a blown highlight and a hard black ring on paper —
      // so the housing is a token that flips with the theme, like the veil.
      expect(css.includes('--led-bezel'), 'the LED housing is not a token').toBe(true);
      expect(css.includes('--led-spec'), 'the LED specular is not a token').toBe(true);
    },
  );

  it('the card LED and the SYS lamp both keep the inset specular at the trough', () => {
    // The snippet set `box-shadow: none` at rest, which drops the inset
    // highlight along with the glow and flattens the part to a painted square
    // between beats. Only the outer glow should go.
    for (const [label, css, frames] of [
      ['card', mainCss, /@keyframes wk-p-led \{[\s\S]*?\n\}/],
      ['sys lamp', consoleCss, /@keyframes lamp-smd \{[\s\S]*?\n\}/],
    ]) {
      const block = css.match(frames);
      expect(block, `the ${label} LED has no SMD keyframes`).toBeTruthy();
      expect(block[0], `the ${label} LED drops its inset specular at rest`).not.toMatch(/box-shadow:\s*none/);
      expect(block[0]).toContain('inset 0 0 2px');
    }
  });

  it('both LEDs have a reduced-motion escape', () => {
    // A permanently blinking indicator is exactly what prefers-reduced-motion
    // exists for, and this one sits on a homepage.
    expect(mainCss).toMatch(/prefers-reduced-motion[\s\S]{0,400}\.wk-p-led\s*\{[^}]*animation:\s*none/);
    expect(consoleCss).toMatch(/prefers-reduced-motion[\s\S]{0,600}\.sys-lamp-led[^}]*animation:\s*none/);
  });

  it('the SYS lamp keeps a distinct animation per state', () => {
    // Only `idle` took the SMD stutter. `busy` is HDD chatter and `error` is a
    // double-blink; both carry meaning that one uniform blink would erase.
    for (const [state, anim] of [['idle', 'lamp-smd'], ['busy', 'lamp-flicker'], ['error', 'lamp-error'], ['offline', 'lamp-offline']]) {
      const rule = consoleCss.match(new RegExp(`#sys-lamp\\[data-state="${state}"\\] \\.sys-lamp-led \\{[^}]*\\}`));
      expect(rule, `the SYS lamp has no ${state} rule`).toBeTruthy();
      expect(rule[0], `${state} lost its own animation`).toContain(anim);
    }
  });
});

describe('the studio is bounded, not a scrolling form', () => {
  // The redesign's whole claim. The old view was three screens tall on a phone
  // and over 100vh on desktop, and it compensated with a sticky preview and a
  // sticky action bar that covered the inputs underneath it.
  it('the view is a bounded flex column, not a scrolling document', () => {
    expect(consoleHtml).toContain('class="view view--bounded"');
    const rule = consoleCss.match(/\.view--bounded\.active \{[^}]*\}/);
    expect(rule, '.view--bounded.active has no rule').toBeTruthy();
    expect(rule[0]).toMatch(/height:\s*100%/);
    expect(rule[0]).toMatch(/overflow:\s*hidden/);
  });

  it('the rails own the overflow, so the page never scrolls', () => {
    const rule = consoleCss.match(/\.pulse-rail-body \{[^}]*\}/);
    expect(rule, '.pulse-rail-body has no rule').toBeTruthy();
    expect(rule[0]).toMatch(/overflow-y:\s*auto/);
  });

  it('nothing in the studio is sticky or floating over the content', () => {
    // The specific defect: `.pulse-actions { position: sticky; bottom: … }` with
    // 190px of view padding underneath to claw back the space it covered. A
    // bounded column does not need the trick, and the dock is in flow.
    //
    // This forbids `sticky`, not `fixed`, and that is the distinction and not an
    // oversight: the recent-pulses bottom sheet is `position: fixed` and is
    // legitimate. A sheet the author OPENS, and closes, is a different thing
    // from a bar that permanently sits over the controls underneath it.
    const block = consoleCss.slice(consoleCss.indexOf('PULSE STUDIO (view-pulse)'));
    expect(block, 'something in the pulse studio went back to position: sticky').not.toMatch(/\.pulse-[\w-]*\s*\{[^}]*position:\s*sticky/);
    expect(block).not.toMatch(/padding-bottom:\s*190px/);
  });

  it('the hidden footer is actually hidden', () => {
    // The composer sets `foot.hidden = true` when both cells are empty, matching
    // the public card, which drops the row entirely. But the card's own
    // `display: flex` (0,2,0) outranks the user-agent's `[hidden]` (0,1,0), so
    // the attribute alone does nothing and the empty row renders on every card.
    // Caught by hand, not by a test — hence this one.
    expect(pulseModule).toMatch(/foot\.hidden = /);
    expect(
      consoleCss,
      'the composer hides the empty footer with [hidden], but no rule makes that stick',
    ).toMatch(/\.wk-p-foot\[hidden\]\s*\{[^}]*display:\s*none/);
  });

  it('the line is a real labelled field, not an unlabelled box in a card', () => {
    // You type INTO the card now, which is the point — but a textarea whose only
    // visible context is a decorative kicker still needs a programmatic label.
    expect(pulseModule).toMatch(/<label class="pulse-sr" for="pulse-line">/);
    expect(pulseModule).toMatch(/id="pulse-line"/);
    expect(consoleCss).toContain('.pulse-sr');
  });
});

describe('the composer only touches DOM that exists', () => {
  // The surgical-update handlers reach for elements by id instead of rebuilding
  // the view. That is the right trade — it keeps focus, scroll and the keyboard,
  // and here it is load-bearing rather than an optimisation, because the line
  // you are typing lives INSIDE the card that would be rebuilt. But it fails
  // SILENTLY when an id is renamed in the markup and not in the handler: the
  // control just stops working and nothing errors. Same failure family as the
  // two bugs that shipped, so it gets the same guard.
  const ids = [...pulseModule.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]);

  it('finds the handlers reaching for ids (scanner sanity)', () => {
    expect(new Set(ids).size).toBeGreaterThan(5);
  });

  it.each([...new Set(ids)])('#%s is rendered by the module or the console shell', (id) => {
    const rendered = pulseModule.includes(`id="${id}"`) || consoleHtml.includes(`id="${id}"`);
    expect(
      rendered,
      `js/console/pulse.js reaches for #${id} but nothing renders that id — `
      + 'the control it belongs to will silently do nothing.',
    ).toBe(true);
  });

  it('rebuilds the whole view only when the view is opened', () => {
    // Every other path updates in place. A stray renderPulse() in a chip handler
    // would destroy the textarea the author is typing into — focus, caret and
    // the soft keyboard, mid-sentence.
    // Strip comments (this module explains the old behaviour in prose) and match
    // only call sites — the declaration ends in `{`, a call ends in `;`.
    const code = pulseModule.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const calls = [...code.matchAll(/(?<![\w.])renderPulse\(\);/g)];
    expect(calls).toHaveLength(1);
    expect(pulseModule).toMatch(/render\(\)\s*\{\s*renderPulse\(\);/);
  });

  it('the card repaint never writes the line back into the textarea', () => {
    // paintCard() runs on every keystroke. If it ever set #pulse-line's value,
    // it would fight the author's own typing — caret jumps to the end, IME
    // composition breaks. The value is written only by syncFields(), which runs
    // when something OTHER than typing changed it.
    const paint = pulseModule.match(/function paintCard\(\) \{[\s\S]*?\n\}/);
    expect(paint, 'paintCard() is gone — check this guard still means something').toBeTruthy();
    expect(paint[0]).not.toContain('pulse-line');
    expect(paint[0]).not.toContain('syncFields');
  });
});

describe('the starter pack itself', () => {
  it('ships all six disciplines with six pulses each — 36, live, to every fork', () => {
    expect(PACKS).toHaveLength(6);
    expect(PACKS.map((p) => p.key)).toEqual(
      ['photography', 'writing', 'music', 'filmmaking', 'tech', 'podcasting'],
    );
    for (const p of PACKS) expect(p.pulses, p.key).toHaveLength(6);
    expect(allPulses()).toHaveLength(36);
  });

  it('every pulse carries a glyph and a line', () => {
    for (const m of allPulses()) {
      expect(m.glyphs.trim(), m.text).not.toBe('');
      expect(m.text.trim()).not.toBe('');
    }
  });

  it('a lane seeds a LINE, never a title — the card names itself', () => {
    // This is the inverse of the assertion that used to live here, which read
    // `expect(m.kicker).toBe('MUSIC')`. That behaviour is the defect: tapping a
    // starter stamped the discipline onto the card, so the same feature
    // introduced itself as PHOTOGRAPHY on one post and TECH / DEV on the next.
    for (const m of allPulses()) {
      expect(Object.keys(m), 'a starter is seeding a card title again').not.toContain('kicker');
    }
    const m = pulseFrom('music', 0);
    expect(m.text).toBe('Eight bar loop. Send help.');
    // No gear slot, no take number, no seeded metadata — free text or nothing.
    expect(m.footLeft).toBe('');
    expect(m.footRight).toBe('');
  });

  it('the composer prints the same constant the public card does', () => {
    // js/console/pulse.js cannot import from src/ either, so it holds its own
    // literal. Three copies of one word is two too many to trust to memory.
    const m = pulseModule.match(/const PULSE_LABEL = '([^']+)';/);
    expect(m, 'js/console/pulse.js no longer declares PULSE_LABEL').toBeTruthy();
    expect(m[1]).toBe(PULSE_LABEL);
    expect(pulseModule, 'the composer stopped rendering the constant').toContain('</span>${PULSE_LABEL}<');
  });

  it('there is no label input left to type a category into', () => {
    expect(pulseModule).not.toContain('id="pulse-kicker"');
    expect(pulseModule).not.toMatch(/_pulseSetField\('kicker'/);
  });

  it('every pack palette is one the server will accept', () => {
    const valid = ['ember', 'dawn', 'flow', 'velvet', 'tide', 'signal'];
    for (const m of allPulses()) expect(valid).toContain(m.state);
  });

  it('an unknown pack or index returns null rather than throwing', () => {
    expect(pulseFrom('astrology', 0)).toBeNull();
    expect(pulseFrom('music', 99)).toBeNull();
  });
});

describe('the glyph tray', () => {
  // Six came free by mapping the lane's starter lines. It was tidy and it was
  // not enough to write with (owner, 2026-08-13), so each lane carries its own
  // list of twelve.
  it.each(PACKS.map((p) => [p.key]))('%s offers twelve', (key) => {
    expect(trayGlyphs(key)).toHaveLength(12);
  });

  it('every lane leads with its own starter glyphs, in order', () => {
    // This is what keeps "the tray follows the lane you tapped" true. Without
    // it the extra six could drift into a generic set and the lane would stop
    // meaning anything to the picker.
    for (const p of PACKS) {
      expect(trayGlyphs(p.key).slice(0, 6), p.key).toEqual(p.pulses.map((m) => m.glyphs));
    }
  });

  it('no lane repeats a glyph — a duplicate wastes one of twelve slots', () => {
    for (const p of PACKS) {
      const tray = trayGlyphs(p.key);
      expect(new Set(tray).size, `${p.key} repeats a glyph`).toBe(tray.length);
      expect(tray.every((g) => g && g.trim()), `${p.key} has a blank slot`).toBe(true);
    }
  });

  it('an unknown lane returns [] rather than throwing', () => {
    // The tray is a shortcut. Losing it should cost a shortcut, not the composer.
    expect(trayGlyphs('astrology')).toEqual([]);
  });

  it('the tray reads the list and does not re-derive six from the lines', () => {
    const code = pulseModule.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toContain('trayGlyphs(activePack)');
    expect(code, 'the tray is back to mapping the starter lines').not.toMatch(/pulses\.map\(\(m\) => m\.glyphs\)/);
  });

  it('the tray clear says NO GLYPH, so only one control on screen says "clear"', () => {
    // The dock's RESET CARD sits a thumb away. Two buttons both saying CLEAR
    // while meaning "drop one emoji" and "empty the whole card" is how a
    // mis-tap becomes a lost draft.
    expect(pulseModule).toContain('>NO GLYPH<');
    expect(pulseModule, 'a second CLEAR came back to this surface').not.toMatch(/>CLEAR</);
  });
});

describe('the starter strip truncates instead of clipping', () => {
  // `text-overflow: ellipsis` applies to a BLOCK CONTAINER's inline content. A
  // flex container's children are flex items, so the property on the .pulse-chip
  // button did nothing and `overflow: hidden` cut mid-word — "Tones are sing".
  // The rule has to be on the span, which is what this asserts: a guard that
  // accepted it on the button would pass on the exact bug.
  it('the chip renders a text span that can be truncated', () => {
    expect(pulseModule).toContain('class="pulse-chip-text"');
  });

  it('.pulse-chip-text truncates, and can shrink enough to need to', () => {
    const rule = consoleCss.match(/\.pulse-chip-text \{[^}]*\}/);
    expect(rule, '.pulse-chip-text has no rule').toBeTruthy();
    expect(rule[0]).toMatch(/text-overflow:\s*ellipsis/);
    // Without min-width:0 a flex item never shrinks below its content, so it
    // never overflows and the ellipsis never appears.
    expect(rule[0], 'min-width: 0 is missing, so the ellipsis can never trigger').toMatch(/min-width:\s*0/);
  });

  it.each([
    ['.pulse-lanes', /\.pulse-lanes \{[^}]*\}/g],
    ['.pulse-strip', /\.pulse-strip \{[^}]*\}/g],
  ])('%s contains its overscroll', (label, re) => {
    // A sideways swipe must not chain into the page or trip the browser's back
    // gesture. The console sets this posture for its shells; these two are newer.
    //
    // Both selectors carry more than one rule (a desktop `display: none` and the
    // real one inside the 900px block), so this looks for the rule that actually
    // scrolls rather than whichever comes first.
    const rules = [...consoleCss.matchAll(re)].map((m) => m[0]);
    expect(rules.length, `${label} has no rule`).toBeGreaterThan(0);
    const scroller = rules.find((r) => /overflow-x:\s*auto/.test(r));
    expect(scroller, `${label} no longer scrolls horizontally — recheck this guard`).toBeTruthy();
    expect(scroller, `${label} can chain its scroll into the page`).toMatch(/overscroll-behavior-x:\s*contain/);
  });
});

describe('the dock says what it does', () => {
  it('the two destructive-sounding buttons name their blast radius', () => {
    // Reported as "the clear button does not seem wired up… does not affect the
    // live site". It never was meant to — but nothing said so. One touches the
    // site, one touches the draft, and now the words carry that.
    expect(pulseModule).toContain('>TAKE DOWN<');
    expect(pulseModule).toContain('>RESET CARD<');
    expect(pulseModule, 'RETIRE/CLEAR came back — they do not say what they touch').not.toMatch(/>RETIRE<|>CLEAR</);
  });

  it('RESET CARD reports what it did', () => {
    const fn = pulseModule.match(/export function _pulseReset\(\) \{[\s\S]*?\n\}/);
    expect(fn, '_pulseReset is gone — recheck this guard').toBeTruthy();
    expect(fn[0], 'the reset is silent again, which is what read as a dead button').toContain('toast(');
  });

  it('RESET CARD is disabled when there is nothing to reset', () => {
    expect(pulseModule).toContain('id="pulse-reset-btn"');
    const fn = pulseModule.match(/function syncDockState\(\) \{[\s\S]*?\n\}/);
    expect(fn, 'syncDockState is gone').toBeTruthy();
    expect(fn[0]).toMatch(/disabled = draftIsEmpty\(\)/);
    // It has to run on every repaint or the button goes stale mid-typing.
    const paint = pulseModule.match(/function paintCard\(\) \{[\s\S]*?\n\}/);
    expect(paint[0]).toContain('syncDockState()');
  });
});

describe('the recent list is reachable on a phone', () => {
  it('the sheet exists and rides the console\'s own sheet pattern', () => {
    expect(consoleHtml).toContain('id="pulse-log-sheet"');
    expect(consoleHtml).toMatch(/class="sheet-overlay hidden" id="pulse-log-sheet"/);
    expect(consoleHtml).toContain('id="pulse-log-mobile"');
  });

  it('the trigger exists and is gated to where the desktop rail disappears', () => {
    expect(pulseModule).toContain('id="pulse-log-btn"');
    // Hidden by default; the 900px block that kills .pulse-rail turns it on.
    expect(consoleCss).toMatch(/\.pulse-log-btn \{[^}]*display:\s*none/);
    const mobile = consoleCss.slice(consoleCss.indexOf('@media (max-width: 900px)'));
    expect(mobile).toMatch(/\.pulse-rail \{ display: none; \}/);
    expect(mobile, 'the trigger does not appear where the rail vanishes').toMatch(/\.pulse-log-btn \{ display: inline-flex/);
  });

  it('the log renders into BOTH hosts, so neither frame goes stale', () => {
    const fn = pulseModule.match(/export function renderPulseLog\(\) \{[\s\S]*?\n\}/);
    expect(fn, 'renderPulseLog is gone').toBeTruthy();
    expect(fn[0]).toContain("'pulse-log'");
    expect(fn[0]).toContain("'pulse-log-mobile'");
  });

  it('the sheet closes on Escape and on a grabber drag, like every other one', () => {
    const init = read('js/console/init.js');
    expect(init, 'the sheet is not in the Escape ladder').toContain('pulse-log-sheet")?.classList.contains("hidden")');
    expect(init, 'the sheet cannot be swiped shut').toContain('_wireSheetDrag("pulse-log-sheet"');
  });

  it('loading a past pulse closes the sheet it was tapped from', () => {
    const fn = pulseModule.match(/export function _pulseReuse\(id\) \{[\s\S]*?\n\}/);
    expect(fn, '_pulseReuse is gone').toBeTruthy();
    expect(fn[0], 'the sheet stays open over the card it just loaded').toContain('_pulseCloseLog()');
  });
});

describe('the warn toast severity is fully implemented', () => {
  // Pulse introduced `warn` and owns every call site in the repo, including the
  // one a new fork owner is most likely to see first. Both halves or neither:
  // a duration with no colour still looks like an unstyled info toast.
  it('has a duration of its own, not the info fallback', () => {
    expect(read('js/console-telemetry.js')).toMatch(/TOAST_MS = \{[^}]*warn:\s*\d+/);
  });

  it('has a border colour, like success and error', () => {
    expect(consoleCss).toMatch(/\.toast\.warn \{[^}]*border-left-color/);
  });
});
