// @vitest-environment happy-dom
//
// The console's relationship with the viewport it is handed — the part that
// only misbehaves on a real installed tablet, which is exactly why it needs
// tests that do not require one.
//
// Written after an owner report from an iPad Mini on iPadOS 26: the Pulse
// studio's dock and both rail tails sat UNDER the glass tab bar, and the whole
// shell looked like it stopped short of the bottom of its window. Two separate
// causes, both invisible to the existing suite:
//
//   1. THE 900/1180 DESYNC. The tab bar turns on at `(max-width: 1180px),
//      (pointer: coarse)`. Pulse's own mobile rules start at 900px. An iPad
//      Mini in landscape is 1133px and coarse — it got the bar and none of the
//      clearance, and because a BOUNDED view never scrolls, the covered rows
//      were simply unreachable rather than merely below the fold.
//   2. THE PHANTOM KEYBOARD INSET. iPadOS 26 reports a visual viewport
//      persistently shorter than the layout viewport with no keyboard present,
//      so the raw difference is a standing offset, not the keys. Published
//      as --kb-inset it shortens every height-bound surface for the session.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const css = read('css/field-console.css');

// The band — where the tab bar exists. The stylesheet opens that query in
// several places (it is a band, not a section), so collect every block and
// brace-match each one: slicing to the first `}` would stop inside the first
// rule, and taking only the first block would miss the rule under test.
const BAND_OPEN = '@media (max-width: 1180px), (pointer: coarse) {';
const band = (() => {
  const blocks = [];
  for (let at = css.indexOf(BAND_OPEN); at >= 0; at = css.indexOf(BAND_OPEN, at + 1)) {
    let depth = 0;
    for (let i = at + BAND_OPEN.length - 1; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) { blocks.push(css.slice(at, i + 1)); break; }
    }
  }
  return blocks.join('\n');
})();

describe('a bounded view reserves the tab bar out of its HEIGHT', () => {
  it('the band query exists and was found', () => {
    expect(band, 'the tab-bar band query moved or was renamed').not.toBe('');
  });

  it('the clearance lives in THE BAND, not only in the 900px block', () => {
    // This is the regression. The clearance used to live only under
    // `max-width: 900px`, which every tablet in landscape sails straight past.
    expect(band).toMatch(/\.view--bounded\.active \{[^}]*--bounded-pad-b/);
  });

  it('the clearance counts the bar, the safe area AND the keyboard', () => {
    const rule = band.match(/\.view--bounded\.active \{[^}]*\}/)[0];
    expect(rule).toContain('--tabbar-rsv');
    expect(rule).toContain('--safe-bottom');
    expect(rule, 'the keys bury the dock without this').toContain('--kb-inset');
  });

  it('the bounded shell READS the variable instead of hardcoding a gutter', () => {
    // The shell's own rule is later in the file at equal specificity, so a
    // plain `padding-bottom` in the band would lose to its `padding`
    // shorthand — silently, and only on the devices that need it.
    // The shell's rule is the unindented one — the band's and the mobile
    // block's both sit inside a media query.
    const shell = css.match(/^\.view--bounded\.active \{[\s\S]*?\n\}/m)[0];
    expect(shell).toMatch(/padding:[^;]*var\(--bounded-pad-b/);
  });

  it('the shorthand that could clobber it is gone from the mobile block', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 900px)'));
    const rule = mobile.match(/^ {2}\.view--bounded\.active \{[\s\S]*?\n {2}\}/m)[0];
    expect(rule).toContain('--bounded-pad-b');
    expect(rule, 'a padding shorthand here overwrites the band again')
      .not.toMatch(/padding:\s/);
  });
});

describe('the no-scroll claim has a floor, and it is narrow', () => {
  const backstop = css.slice(css.indexOf('@media (max-height: 460px)'));

  it('a phone in landscape scrolls rather than clipping the dock', () => {
    // 390px tall leaves the stage ~120px for a card, a palette, three buttons
    // and a footer row. Reachable-below-the-fold beats unreachable-under-glass.
    expect(css).toContain('@media (max-height: 460px)');
    expect(backstop).toMatch(/\.view--bounded\.active \{[^}]*overflow-y: auto/);
  });

  it('the floor is under every device the studio was designed for', () => {
    // An iPad Mini in landscape is 744px tall and a phone in portrait ~844 —
    // both stay bounded. Raising this cliff would quietly give the whole
    // redesign's claim away.
    const cliff = Number(css.match(/@media \(max-height: (\d+)px\)/)[1]);
    expect(cliff).toBeLessThan(744);
  });
});

describe('the short-landscape stage turns sideways instead of squashing', () => {
  // A tablet in landscape keeps the three-rail canvas but not the height. The
  // card is the only flexible row, so it absorbed the whole shortfall and came
  // out a letterbox — a 4:5 preview that no longer matched what it previews.
  const sideways = css.slice(css.indexOf('(min-width: 901px) and (max-width: 1180px) and (max-height: 880px)'));

  it('is scoped to where the tab bar is, in both of the band\'s arms', () => {
    expect(css).toContain('(min-width: 901px) and (max-width: 1180px) and (max-height: 880px)');
    expect(css, 'a coarse tablet wider than 1180px has the bar too')
      .toContain('(min-width: 901px) and (pointer: coarse) and (max-height: 880px)');
  });

  it('gives the card every row of the stage', () => {
    expect(sideways).toMatch(/\.pulse-card-slot \{[^}]*grid-row: 1 \/ -1/);
  });

  it('keeps the DOM order — the grid places the rows, it does not reorder them', () => {
    // Screen-reader order is the source order; explicit placement must follow it.
    const rowOf = (sel) =>
      Number(sideways.match(new RegExp(`\\${sel}\\s*\\{ grid-column: 2; grid-row: (\\d)`))[1]);
    expect(rowOf('.pulse-stage-status')).toBeLessThan(rowOf('.pulse-palette'));
    expect(rowOf('.pulse-palette')).toBeLessThan(rowOf('.pulse-dock'));
    expect(rowOf('.pulse-dock')).toBeLessThan(rowOf('.pulse-more'));
  });

  it('stacks the dock — three buttons do not fit a 230px column', () => {
    expect(sideways).toMatch(/\.pulse-dock \{[^}]*flex-direction: column/);
  });
});

describe('the keyboard inset ignores a standing offset', () => {
  let chrome;

  beforeEach(async () => {
    document.body.innerHTML = '';
    chrome = await import('../js/console/chrome.js');
  });
  afterEach(() => {
    delete window.visualViewport;
    vi.restoreAllMocks();
  });

  const runWith = (visualHeight) => {
    const listeners = {};
    window.visualViewport = {
      height: visualHeight,
      width: 1133,
      offsetTop: 0,
      addEventListener: (ev, fn) => { listeners[ev] = fn; },
    };
    window.innerHeight = 744;
    chrome._initKeyboardInsets();
    return document.documentElement.style.getPropertyValue('--kb-inset');
  };

  it('publishes zero for the iPadOS 26 standing offset, not a fake keyboard', () => {
    // 744 - 705 = 39px with no keyboard anywhere. Published, it would shorten
    // the FN compose and the Pulse studio for the whole session.
    expect(runWith(705)).toBe('0px');
    expect(document.body.classList.contains('kb-open')).toBe(false);
  });

  it('still publishes a real keyboard in full', () => {
    expect(runWith(744 - 320)).toBe('320px');
    expect(document.body.classList.contains('kb-open')).toBe(true);
  });

  it('the deadband is the same threshold that already gated kb-open', () => {
    // One number, one meaning — a value that does not open the bar's duck must
    // not shorten the surfaces either.
    expect(chrome.KB_MIN).toBe(80);
    expect(runWith(744 - chrome.KB_MIN)).toBe('0px');
    expect(runWith(744 - chrome.KB_MIN - 1)).toBe(`${chrome.KB_MIN + 1}px`);
  });
});

describe('the bottom inset is not paid twice', () => {
  // Real numbers, iPad Mini (A17 Pro) / iPadOS 26.5.2 / installed to the Home
  // Screen, read off the console's own Display panel:
  //
  //   mode standalone · layout 744x1101 · screen 744x1133 · safe area t32 b20
  //
  // layout + safe-top == screen exactly, and the topbar's geometry confirms the
  // canvas starts at screen y=0 — so the 32px the system reserved for the
  // status bar is stranded BELOW the canvas. The device then also asks for a
  // 20px bottom inset for a home indicator that is already outside us.
  let chrome, __D;

  const device = ({ layoutH = 1101, layoutW = 744, screenW = 744, screenH = 1133,
                    safeBottom = 20, mode = 'standalone' } = {}) => ({
    safe: { top: 32, right: 0, bottom: safeBottom, left: 0 },
    layout: { w: layoutW, h: layoutH },
    visual: { w: layoutW, h: layoutH, offsetTop: 0 },
    screen: { w: screenW, h: screenH },
    dpr: 2,
    mode,
  });

  beforeEach(async () => {
    document.documentElement.style.removeProperty('--safe-bottom');
    chrome = await import('../js/console/chrome.js');
  });
  afterEach(() => vi.restoreAllMocks());

  it('pays nothing extra when the system already held more than the inset', () => {
    expect(chrome._correctSafeBottom(device())).toEqual({ held: 32, pad: 0 });
  });

  it('pays only the remainder when the system held less than the inset', () => {
    __D = device({ layoutH: 1125, safeBottom: 20 });   // held 8, inset 20
    expect(chrome._correctSafeBottom(__D)).toEqual({ held: 8, pad: 12 });
  });

  it('leaves a well-behaved device alone — the canvas reaches the floor', () => {
    __D = device({ layoutH: 1133, safeBottom: 20 });   // held 0
    expect(chrome._correctSafeBottom(__D)).toEqual({ held: 0, pad: 20 });
  });

  it('takes the screen axis by SIZE, so landscape is not compared to portrait', () => {
    // Same device turned sideways: screen still reports 744x1133 on some
    // engines, and comparing 1101 against 1133 there would invent a shortfall.
    __D = device({ layoutW: 1133, layoutH: 712, screenW: 744, screenH: 1133, safeBottom: 20 });
    expect(chrome._correctSafeBottom(__D)).toEqual({ held: 32, pad: 0 });
  });

  it('never ADDS padding — the correction can only ever reduce', () => {
    // held 233, far past the inset
    expect(chrome._correctSafeBottom(device({ layoutH: 900 })).pad).toBe(0);
  });

  it('leaves a browser tab alone — that gap is a window, not an inset', () => {
    __D = device({ mode: 'browser' });
    expect(chrome._correctSafeBottom(__D)).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--safe-bottom')).toBe('');
  });

  it('runs before the keyboard watcher, and re-runs when the device turns', () => {
    const init = read('js/console/init.js');
    expect(init).toContain('_initViewportFrame()');
    expect(init.indexOf('_initViewportFrame()'))
      .toBeLessThan(init.indexOf('_initKeyboardInsets()'));
    const fn = read('js/console/chrome.js')
      .match(/export function _initViewportFrame\(\) \{[\s\S]*?\n\}/)[0];
    expect(fn).toContain('orientationchange');
  });
});

describe('the console can report the viewport it was handed', () => {
  // An installed web app is a black box from the outside. A wrong safe-area
  // inset and a viewport shorter than its window produce an identical gap at
  // the bottom of the screen and want opposite fixes; these are the numbers
  // that tell them apart.
  it('the Settings panel has somewhere to put it', () => {
    expect(read('dev/field-console.html')).toContain('id="settings-display"');
  });

  it('opening Settings fills it, like the build stamp beside it', () => {
    const session = read('js/console/session.js');
    expect(session).toMatch(/import \{[^}]*renderViewportStamp[^}]*\} from '\.\/chrome\.js'/);
    const open = session.match(/export function openSettings\(\) \{[\s\S]*?\n\}/)[0];
    expect(open).toContain('renderViewportStamp()');
  });

  it('reads the safe-area insets back off a probe rather than assuming them', () => {
    // env() resolves only in CSS — JS has no other way to see what the device
    // actually reported, and assuming is what put us here.
    const src = read('js/console/chrome.js');
    const fn = src.match(/export function _viewportReadout\(\) \{[\s\S]*?\n\}/)[0];
    expect(fn).toContain('env(safe-area-inset-top');
    expect(fn).toContain('getComputedStyle');
    expect(fn, 'the probe is left in the document').toContain('probe.remove()');
  });

  it('reports every value needed to tell the two causes apart', async () => {
    const chrome = await import('../js/console/chrome.js');
    const r = chrome._viewportReadout();
    expect(r).toHaveProperty('safe.bottom');
    expect(r).toHaveProperty('layout.h');
    expect(r).toHaveProperty('screen.h');
    expect(r).toHaveProperty('mode');
  });
});

describe('the tablet pass — a wide, short screen spends width, not height', () => {
  // Reported from an iPad Mini in Safari (≈1133×620 of page): Archive ran
  // 2188px tall with 1620px of scroll under it, Publish 1242px, and both
  // pushed sideways. The cause was one expired rule, not a hundred small ones.
  // Assertions must read the RULES, not the prose. These comment blocks quote
  // the very declarations they warn against ("an unqualified
  // `#view-publish { display: grid }` would…"), so a raw text match finds the
  // warning and calls it the bug.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const tablet = strip(css.slice(css.indexOf('THE TABLET PASS')));

  it('the compose forms no longer collapse to one column at tablet width', () => {
    // THE REGRESSION. `@media (min-width: 921px) and (max-width: 1180px)` set
    // `.archive-compose, .fn-compose { grid-template-columns: 1fr }` because
    // the sidebar was assumed to still be on screen there. The tab-bar band
    // hides it, so the main column is ~1085px — and stacking put a full-width
    // 3:2 photo well (713px tall) above the form.
    const legacy = strip(css.slice(
      css.indexOf('@media (min-width: 921px) and (max-width: 1180px)'),
      css.indexOf('THE TABLET PASS')));
    expect(legacy).not.toMatch(/\.archive-compose[^{]*\{[^}]*grid-template-columns:\s*1fr/);
    expect(legacy).not.toMatch(/--sidebar-w/);
  });

  it('the photo well is capped, so it cannot grow with the window', () => {
    expect(tablet).toMatch(/\.compose-photo \.preview-wrap \{[^}]*max-height/);
  });

  it('the archive form pairs its fields instead of one per row', () => {
    expect(tablet).toMatch(/\.compose-form \{[^}]*grid-template-columns: 1fr 1fr/);
    // The rows that are already grids must still span, or the 3-up
    // camera/lens/medium row would be squeezed into half the form.
    expect(tablet).toContain('.compose-form > .field-row');
    // .field's own margin plus the parent gap was double-spacing every row.
    expect(tablet).toMatch(/\.compose-form \.field \{ margin-bottom: 0/);
  });

  it('publish lays its cards out two-up, and stays hidden when inactive', () => {
    expect(tablet).toMatch(/#view-publish\.active \{[^}]*display: grid/);
    // `.view { display: none }` hides inactive views — an unqualified
    // `#view-publish` would out-specify that and show it over every other view.
    expect(tablet, 'the grid rule must be scoped to .active')
      .not.toMatch(/#view-publish \{[^}]*display: grid/);
  });

  it('the archive action row shares its width instead of overflowing', () => {
    // `.btn-full` is width:100%, so Stage + Clear asked for 100% + a button.
    expect(tablet).toMatch(/\.compose-form \.btn-row \.btn-full \{[^}]*width: auto/);
  });

  it('is scoped to tablets, in both arms of the band', () => {
    expect(css).toContain('@media (min-width: 901px) and (max-width: 1180px),\n       (min-width: 901px) and (pointer: coarse) {');
  });
});

describe('the preview pane wears no caption', () => {
  // Markup minus its HTML comments — the comment above the pane names the
  // caption it removed, and a raw match reads that explanation as the bug.
  const html = read('dev/field-console.html').replace(/<!--[\s\S]*?-->/g, '');

  it('the "RENDERED PREVIEW" label is gone from the screen', () => {
    // A pane you cannot type into, beside one you can, explains itself the
    // moment you type — and that caption was spending the width that cut
    // ▲ STAGE POST in half on a tablet.
    expect(html).not.toContain('RENDERED PREVIEW');
  });

  it('but the name survives for screen readers, where it costs no pixels', () => {
    expect(html).toMatch(/class="preview-pane"[^>]*role="region"[^>]*aria-label="Rendered preview"/);
  });

  it('the action group still sits at the trailing edge', () => {
    // `justify-content: space-between` needs two children to mean anything;
    // with the caption gone it would park the buttons on the left.
    expect(html).toContain('fn-pane-hdr fn-pane-hdr--actions');
    expect(css).toMatch(/\.fn-pane-hdr--actions \{[^}]*justify-content: flex-end/);
  });

  it('portrait drops the whole row, not just its buttons', () => {
    // The portrait action bar carries these buttons, so the row would be an
    // empty strip — and rows are the scarce thing on a phone.
    expect(css).toMatch(/#view-fn \.preview-pane \.fn-pane-hdr \{ display: none/);
  });
});
