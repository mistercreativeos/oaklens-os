// @vitest-environment happy-dom
//
// The glyph menu, DRIVEN rather than read.
//
// Every other guard on this surface (tests/pulse-console.test.js) reads the
// module and the stylesheet as text, which is the right shape for the bugs that
// suite was written after — a file that never loads, a class with no rule. It
// cannot see whether the markup those strings produce actually works.
//
// This one can, and it exists because the menu stopped being a flat list of
// twelve on 2026-08-24 and became six labelled sections plus a keyboard
// doorway, rendered once and updated by class. Rendered-once-updated-by-class is
// exactly the arrangement that fails silently: a selector that matches nothing
// leaves a control that simply does nothing, and no test reading source text
// would notice.
//
// Report: docs/maintenance/2026-08-24-pulse-mobile-keyboard-and-glyph-menu.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PACKS } from '../js/pulse-packs.js';

// The module's three neighbours, stubbed to what this surface actually uses.
// escapeHTML/escapeAttrJS are the REAL shapes rather than identity functions —
// a stub that does not escape would hide an unescaped glyph in the markup.
vi.mock('../js/console-telemetry.js', () => ({ logEvent: vi.fn(), toast: vi.fn() }));
vi.mock('../js/console-api.js', () => ({
  postPulse: vi.fn(),
  retirePulse: vi.fn(),
  fetchPulseLog: vi.fn(async () => ({ pulses: [] })),
  isNotConfigured: () => false,
}));
vi.mock('../js/console/chrome.js', () => ({
  toast: vi.fn(),
  escapeHTML: (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  escapeAttrJS: (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
  registerView: vi.fn(),
  openSheet: vi.fn(),
  closeSheet: vi.fn(),
}));

const pulse = await import('../js/console/pulse.js');

const groups = () => [...document.querySelectorAll('.pulse-glyph-group')];
const slot = () => document.getElementById('pulse-glyph-slot');
const tray = () => document.getElementById('pulse-tray');

beforeEach(() => {
  document.body.innerHTML = '<div id="pulse-body"></div>';
  pulse.renderPulse();
  pulse._pulseReset();
  pulse._pulseSetPack('photography');
});

describe('the menu holds every discipline at once', () => {
  it('renders one labelled section per pack, in PACKS order', () => {
    expect(groups().map((g) => g.dataset.lane)).toEqual(PACKS.map((p) => p.key));
    expect([...document.querySelectorAll('.pulse-glyph-head')].map((h) => h.textContent))
      .toEqual(PACKS.map((p) => p.label));
  });

  it('every curated glyph is reachable without changing lane', () => {
    // The defect this replaced: choosing a lane narrowed the vocabulary to
    // twelve, so a photographer writing about a late edit had to leave the lane
    // seeding their line to reach a coffee cup.
    expect(document.querySelectorAll('.pulse-glyph').length)
      .toBe(PACKS.reduce((n, p) => n + p.tray.length, 0));
  });

  it('the open lane is marked, and marking it moves nothing else', () => {
    const before = document.getElementById('pulse-tray-body').innerHTML.length;
    expect(groups().find((g) => g.classList.contains('is-lane')).dataset.lane).toBe('photography');

    pulse._pulseSetPack('music');

    expect(groups().find((g) => g.classList.contains('is-lane')).dataset.lane).toBe('music');
    expect(groups().filter((g) => g.classList.contains('is-lane'))).toHaveLength(1);
    // Same order, same size: a lane tap must not rebuild the panel under a
    // thumb that is mid-scroll.
    expect(groups().map((g) => g.dataset.lane)).toEqual(PACKS.map((p) => p.key));
    expect(document.getElementById('pulse-tray-body').innerHTML.length).toBe(before);
  });
});

describe('picking a glyph', () => {
  it('opens and closes, and says so to a screen reader', () => {
    expect(tray().classList.contains('open')).toBe(false);
    pulse._pulseToggleTray();
    expect(tray().classList.contains('open')).toBe(true);
    expect(slot().getAttribute('aria-expanded')).toBe('true');
    pulse._pulseCloseTray();
    expect(tray().classList.contains('open')).toBe(false);
    expect(slot().getAttribute('aria-expanded')).toBe('false');
  });

  it('a curated tile TOGGLES and leaves the panel open', () => {
    // The owner asked to "try out different glyphs … remove and add them
    // quickly without losing context" — so a tile is a toggle, not a fire-once,
    // and the menu no longer closes under the tap. Closing on every tap made
    // trying three glyphs cost three reopens.
    pulse._pulseToggleTray();
    pulse._pulseSetGlyph('🎧');
    expect(slot().textContent).toBe('🎧');
    expect(tray().classList.contains('open')).toBe(true);
    // second tap on the same tile removes it
    pulse._pulseSetGlyph('🎧');
    expect(slot().textContent).toBe('');
    expect(tray().classList.contains('open')).toBe(true);
  });

  it('the tile shows whether its glyph is currently on the card', () => {
    // A toggle has to look toggled, or you cannot tell what a second tap will do.
    const tile = () => [...document.querySelectorAll('.pulse-glyph')]
      .find((b) => b.dataset.glyph === '🎧');
    expect(tile().classList.contains('is-on')).toBe(false);
    expect(tile().getAttribute('aria-pressed')).toBe('false');
    pulse._pulseSetGlyph('🎧');
    expect(tile().classList.contains('is-on')).toBe(true);
    expect(tile().getAttribute('aria-pressed')).toBe('true');
  });

  it('the same glyph cannot be added twice', () => {
    // Two identical glyphs on one card is nothing anyone wants, and it would
    // make "tap again to remove" ambiguous about which one it removed.
    pulse._pulseSetGlyph('🎧');
    pulse._pulseSetGlyph('🎧');   // toggles OFF, not a second copy
    pulse._pulseSetGlyph('🎧');   // back on — still one
    expect(slot().textContent).toBe('🎧');
  });

  it('NO GLYPH empties the slot without touching the line', () => {
    // Read through the TIER, not the textarea: paintCard() deliberately never
    // writes that field's value (it would fight the author's own typing), so
    // the tier readout is the composer's honest witness to draft.text.
    pulse._pulseSetField('text', 'Eight bar loop. Send help.');
    pulse._pulseSetGlyph('🥁');
    expect(document.getElementById('pulse-tier').textContent).toBe('STATEMENT');

    pulse._pulseClearGlyphs();

    expect(slot().textContent).toBe('');
    expect(document.getElementById('pulse-tier').textContent, 'the line went with the glyph')
      .toBe('STATEMENT');
  });
});

describe('the keyboard doorway — the whole emoji set, for zero bytes', () => {
  it('puts what you typed on the card and empties itself', () => {
    // It is a doorway to the platform's own picker, not a second place the
    // glyph lives: holding the value would leave two elements both claiming to
    // be the glyph, and a stale one behind after RESET CARD.
    const box = document.getElementById('pulse-glyph-any');
    box.value = '🦄';
    pulse._pulseSetGlyphAny(box.value);
    expect(slot().textContent).toBe('🦄');
    expect(box.value).toBe('');
  });

  it('adds to a curated pick rather than replacing it', () => {
    pulse._pulseSetGlyph('🎧');
    pulse._pulseSetGlyphAny('🌙');
    expect(slot().textContent).toBe('🎧 🌙');
  });

  it('leaves the panel open — the keyboard it opened is still up', () => {
    pulse._pulseToggleTray();
    pulse._pulseSetGlyphAny('🌙');
    expect(tray().classList.contains('open')).toBe(true);
  });

  it('an empty or whitespace value is a no-op, not a blank glyph', () => {
    pulse._pulseSetGlyph('🎧');
    pulse._pulseSetGlyphAny('   ');
    expect(slot().textContent).toBe('🎧');
  });

  it('will not add an emoji already on the card', () => {
    // Same single-membership rule the tiles keep, so the chips row never carries
    // two of anything.
    pulse._pulseSetGlyphAny('🦄');
    pulse._pulseSetGlyphAny('🦄');
    expect(slot().textContent).toBe('🦄');
  });

  it('a paste of several emoji adds each once', () => {
    pulse._pulseSetGlyphAny('🦄 🌙 🦄');
    expect(slot().textContent).toBe('🦄 🌙');
  });
});

describe('taking a glyph back off — the whole point of the second pass', () => {
  const chips = () => [...document.querySelectorAll('.pulse-tray-picked .pulse-picked-g')]
    .map((e) => e.textContent);
  const pickedRow = () => document.getElementById('pulse-tray-picked');

  it('every glyph on the card is a removable chip', () => {
    pulse._pulseSetGlyph('🎧');
    pulse._pulseSetGlyph('🥁');
    expect(chips()).toEqual(['🎧', '🥁']);
    expect(pickedRow().hidden).toBe(false);
  });

  it('a chip removes exactly its own glyph, by position', () => {
    pulse._pulseSetGlyph('🎧');
    pulse._pulseSetGlyph('🥁');
    pulse._pulseSetGlyph('🎚️');
    pulse._pulseRemoveGlyph(1);          // the middle one
    expect(slot().textContent).toBe('🎧 🎚️');
    expect(chips()).toEqual(['🎧', '🎚️']);
  });

  it('removes a KEYBOARD emoji that has no curated tile — the case RESET CARD used to be the only answer to', () => {
    // The line lives in the textarea; the user types it, so set the value the
    // way the DOM would have it, not through _pulseSetField (which paints the
    // card but never writes the field back — see the paintCard guard).
    document.getElementById('pulse-line').value = 'Groove locked. Found the pocket.';
    pulse._pulseSetField('text', 'Groove locked. Found the pocket.');
    pulse._pulseSetGlyphAny('🦄');
    expect(chips()).toEqual(['🦄']);
    pulse._pulseRemoveGlyph(0);
    expect(slot().textContent).toBe('');
    // and the line the owner wrote is untouched — the whole complaint about
    // RESET CARD being the only way out. Removing a glyph must not go near it.
    expect(document.getElementById('pulse-line').value).toBe('Groove locked. Found the pocket.');
  });

  it('the chips row hides itself when the card has no glyphs', () => {
    expect(pickedRow().hidden).toBe(true);
    pulse._pulseSetGlyph('🎧');
    expect(pickedRow().hidden).toBe(false);
    pulse._pulseClearGlyphs();
    expect(pickedRow().hidden).toBe(true);
  });

  it('an out-of-range index is a no-op, not a crash', () => {
    pulse._pulseSetGlyph('🎧');
    pulse._pulseRemoveGlyph(9);
    pulse._pulseRemoveGlyph(-1);
    expect(slot().textContent).toBe('🎧');
  });
});
