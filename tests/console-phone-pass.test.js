// THE PHONE PASS (K49, 2026-10-04). The owner, on a phone: the console is
// "extremely slow", light "gets ghosted or misaligned", the FN bar is not on
// the new key standard, and the content needs its own, dimmer light on a
// phone — "clean so if we need mobile specific settings that we can cleanly
// tweak in the future". The engine half is in tests/console-lighting.test.js
// ("the phone pass"); this file pins the stylesheet and the templates.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...p) => readFileSync(join(process.cwd(), ...p), 'utf8');
const CSS = read('css', 'field-console.css');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const BUFFER = read('js', 'console', 'buffer.js');
const ASSETS = read('js', 'console', 'assets.js');
const CHROME = read('js', 'console', 'chrome.js');
const studio = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')));

describe('the phone has a light profile of its own, in one place', () => {
  it('the desk is 1 on both dials, declared on the root', () => {
    expect(studio).toMatch(/--light-content-backlight: 1;/);
    expect(studio).toMatch(/--light-content-haze: 1;/);
  });

  it('a phone dims the content\'s backlight and haze by at least 40%, the Darkroom only', () => {
    const block = RULES.match(/@media \(max-width: 760px\), \(pointer: coarse\) and \(max-height: 500px\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/);
    expect(block, 'the phone profile block').toBeTruthy();
    const dial = (n) => Number(block[1].match(new RegExp(`${n}: ([\\d.]+);`))[1]);
    expect(dial('--light-content-backlight')).toBeLessThanOrEqual(0.6);
    expect(dial('--light-content-haze')).toBeLessThanOrEqual(0.6);
  });
});

describe('the buffer scales with its frames, not against them', () => {
  it('thumbs are lazy, decoded off the main thread, and only as big as the cell', () => {
    expect(BUFFER).toMatch(/srcset="\$\{set\}" sizes="\(max-width: 600px\) 92vw, 280px"/);
    expect(BUFFER).toMatch(/loading="lazy" decoding="async"/);
    expect(ASSETS).toMatch(/export function cdnSrcset\(entry, folder = 'archive'\)/);
    expect(ASSETS).toMatch(/-480w\.webp 480w, \$\{CDN_BASE\}\/\$\{folder\}\/\$\{base\}-1024w\.webp 1024w/);
  });

  it('a day far from the screen is not laid out or painted', () => {
    expect(RULES).toMatch(/\n\.buffer-day \{[^}]*content-visibility: auto;[^}]*contain-intrinsic-size: auto \d+px;/);
  });

  it('renders the first screenful now and the rest on demand, cancelling a stale tail (K50c)', () => {
    expect(BUFFER).toMatch(/export const BUFFER_FIRST_FRAMES = \d+;/);
    expect(BUFFER).toMatch(/export const BUFFER_CHUNK_FRAMES = \d+;/);
    expect(BUFFER).toMatch(/export const BUFFER_AHEAD = "\d+% 0px";/);
    expect(BUFFER).toMatch(/const token = \+\+_bufferRenderToken;/);
    expect(BUFFER).toMatch(/if \(token !== _bufferRenderToken\) return;/);
    // A chunk lands before the sentinel, which an observer rooted at the
    // scroller watches — nothing on the scroll path, nothing in the background.
    expect(BUFFER).toMatch(/sentinel\.insertAdjacentHTML\("beforebegin", chunk\)/);
    expect(BUFFER).toMatch(/new IntersectionObserver\(\(entries\) => \{[\s\S]*?\}, \{ root: display\.closest\("\[data-light-layer\]"\), rootMargin: BUFFER_AHEAD \}\)/);
    // A day's HTML is generated only when its chunk is.
    expect(BUFFER).toMatch(/const htmlOf = \(idx\) => \(html\[idx\] \?\?= build\(days\[idx\]\)\);/);
    // …and where the observer is missing, the chunks follow as tasks (K49).
    expect(BUFFER).toMatch(/if \(typeof IntersectionObserver !== "function"\)/);
  });
});

describe('FN is on the key standard', () => {
  it('its bar\'s buttons and the cover bay\'s chips are keys, licensed for the room\'s light', () => {
    expect(CHROME).toMatch(/const FLOAT_SEL = "\.btn, \.fn-btn, \.fn-chip:not\(\.fn-chip--onmedia\)";/);
    expect(RULES).toMatch(/\n\.btn, \.publish-btn, \.buffer-link-fab, \.fn-btn, \.fn-chip,\n:is\(/);   // K90: the sweep's list follows
    expect(RULES).toMatch(/\n\.btn-stage, \.publish-btn, \.fn-btn--stage \{/);
    // A chip on a photograph keeps its frosted clothes.
    expect(RULES).toMatch(/\n\.fn-chip\.fn-chip--onmedia::before \{ content: none; \}/);
  });

  it('the DRAFT stamp is a lit readout, and the draft underline a lit filament', () => {
    const stamp = RULES.match(/\n\.fn-meta-state \{([^}]*)\}/g).pop();
    expect(stamp).toMatch(/text-shadow: 0 0 6px rgba\(var\(--lit-rgb\)/);
    const draft = RULES.match(/\n\.fn-studio\.is-draft \.fn-bar \{([^}]*)\}/)[1];
    expect(draft).toMatch(/0 2px 12px -2px rgba\(var\(--lit-rgb\), 0\.55\)/);
    expect(draft).not.toMatch(/box-shadow: inset 0 -2px 0 var\(--accent\);/);
  });
});
