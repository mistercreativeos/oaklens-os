// @vitest-environment happy-dom
//
// The Bridge (js/console/bridge.js) — the console's front page.
//
// Held here: where a file goes (one table for drop, paste and the picker);
// what the drag preview can honestly say from MIME types alone; which state
// leads the page; the room-left sums that turn bytes into work; and the rule
// the whole page is built on — it says what happened and never grades it.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainUnits } from './helpers/units.js';

const ROOT = join(import.meta.dirname, '..');
const SRC_RAW = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
// Code only: the header quotes the rule it keeps.
const SRC = SRC_RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const html = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');

let B;
beforeAll(async () => {
  // The nav the labels are read from.
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
  B = await import('../js/console/bridge.js');
});

describe('routeOf — each file to the surface that owns its kind', () => {
  const f = (name, type = '') => ({ name, type });
  it.each([
    [f('IMG_0412.jpg', 'image/jpeg'), 'buffer'],
    [f('DSCF1234.RAF'), 'buffer'],           // RAWs arrive with no MIME type
    [f('L1000123.DNG', 'image/x-adobe-dng'), 'buffer'],
    [f('tide.wav', 'audio/wav'), 'audio'],
    [f('take-2.m4a'), 'audio'],
    [f('clip.mp4', 'video/mp4'), 'library'],
    [f('notes.md'), 'fn'],
    [f('notes.markdown', 'text/markdown'), 'fn'],
    [f('clip.mov', 'video/quicktime'), null], // the Library takes mp4/webm only
    [f('invoice.pdf', 'application/pdf'), null],
  ])('%o → %s', (file, dest) => {
    expect(B.routeOf(file)).toBe(dest);
  });
});

describe('routePreview — what the headline says mid-drag', () => {
  it('counts by destination, naming an audio file by its kind', () => {
    const items = [
      { kind: 'file', type: 'image/jpeg' }, { kind: 'file', type: 'image/jpeg' },
      { kind: 'file', type: 'image/png' }, { kind: 'file', type: 'audio/wav' },
    ];
    const p = B.routePreview(items);
    expect(p.text).toBe('3 PHOTOS → BUFFER · 1 WAV → AUDIO');
    expect(p.dests.sort()).toEqual(['audio', 'buffer']);
  });
  it('admits what a drag cannot know (no names until the drop)', () => {
    expect(B.routePreview([{ kind: 'file', type: '' }, { kind: 'file', type: '' }]).text)
      .toBe('2 FILES → SORTED ON DROP');
  });
  it('ignores dragged text and links', () => {
    expect(B.routePreview([{ kind: 'string', type: 'text/plain' }]).text).toBe('');
  });
});

describe('headlineOf — one state leads, in this order', () => {
  const base = { loggedIn: true, failed: 0, building: false, staged: 0 };
  it('says nothing is waiting, plainly, and calls it calm', () => {
    expect(B.headlineOf(base)).toEqual({ text: 'NOTHING WAITING', calm: true });
  });
  it('signed out beats everything', () => {
    expect(B.headlineOf({ ...base, loggedIn: false, failed: 3, staged: 4 }).text).toBe('SIGNED OUT');
  });
  it('failed uploads beat a build and staged edits', () => {
    expect(B.headlineOf({ ...base, failed: 1, building: true, staged: 4 })).toEqual({ text: '1 UPLOAD FAILED', needs: true });
  });
  it('a build in flight beats waiting edits, and is not a "needs you"', () => {
    expect(B.headlineOf({ ...base, building: true, staged: 2 })).toEqual({ text: 'GOING LIVE' });
  });
  it('counts waiting edits', () => {
    expect(B.headlineOf({ ...base, staged: 3 })).toEqual({ text: '3 EDITS WAITING', needs: true });
    expect(B.headlineOf({ ...base, staged: 1 }).text).toBe('1 EDIT WAITING');
  });
});

describe('roomLeft — bytes into work, from this site\'s own averages', () => {
  const storage = (bytes, folders = {}) => ({ r2FreeBytes: 10e9, r2: { bytes, objects: 1, folders } });
  it('uses what a photo and an hour of audio cost HERE', () => {
    const state = {
      buffer: Array.from({ length: 20 }, () => ({})), archive: [],
      audio: [{ duration: 1800 }, { duration: 1800 }],            // one hour
    };
    const r = B.roomLeft(storage(2e9, { archive: { bytes: 1e8 }, audio: { bytes: 6e7 } }), state);
    expect(r.share).toBeCloseTo(0.2);
    expect(r.photos).toBe(Math.floor(8e9 / (1e8 / 20)));          // 5 MB a photo here
    expect(r.hours).toBe(Math.floor(8e9 / 6e7));                  // 60 MB an hour here
    expect(r.over).toBe(0);
  });
  it('falls back to the setup page\'s rule of thumb with too little to average', () => {
    const r = B.roomLeft(storage(0), { buffer: [], archive: [], audio: [] });
    expect(r.photos).toBe(25_000);
    expect(r.hours).toBe(170);
  });
  it('past the free tier: no room, and how far over', () => {
    const r = B.roomLeft(storage(12e9), { buffer: [], archive: [], audio: [] });
    expect(r.share).toBe(1);
    expect(r.photos).toBe(0);
    expect(r.over).toBe(2e9);
  });
  it('says nothing without a measure', () => {
    expect(B.roomLeft(null)).toBeNull();
    expect(B.roomLeft({ r2: null })).toBeNull();
  });
});

describe('the small readers', () => {
  const now = Date.parse('2026-10-05T20:00:00');
  it('ago', () => {
    expect(B.ago(now - 30_000, now)).toBe('just now');
    expect(B.ago(now - 14 * 60_000, now)).toBe('14 min ago');
    expect(B.ago(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(B.ago(now - 30 * 3600_000, now)).toBe('yesterday');
    expect(B.ago(now - 4 * 86_400_000, now)).toBe('4 days ago');
  });
  it('left', () => {
    expect(B.left(6 * 3600_000 + 12 * 60_000)).toBe('6h 12m');
    expect(B.left(42 * 60_000)).toBe('42m');
    expect(B.left(20_000)).toBe('<1m');
  });
  it('bytesLabel', () => {
    expect(B.bytesLabel(4.83e9)).toBe('4.8 GB');
    expect(B.bytesLabel(12.4e9)).toBe('12 GB');
    expect(B.bytesLabel(38e6)).toBe('38 MB');
  });
});

describe('no opinions (docs/ideas/pulse-graph.md §7)', () => {
  // The Bridge shows what happened. A streak, a goal or a nag is a habit app,
  // which is a thing creatives already have and already resent.
  it.each(['streak', 'goal', 'you have not', "haven't posted", 'keep it up', 'behind'])('never says "%s"', (word) => {
    const strings = [...SRC.matchAll(/(['"`])((?:(?!\1).)*)\1/g)].map((m) => m[2].toLowerCase());
    expect(strings.filter((s) => s.includes(word))).toEqual([]);
  });
});

describe('the clock — a 5×7 dot matrix (js/console/matrix.js)', () => {
  let M;
  beforeAll(async () => { M = await import('../js/console/matrix.js'); });
  it('lights the right dots for a glyph, and draws the unlit ones', () => {
    const svg = M.matrixSVG('1');
    const on = svg.match(/class="matrix-on" d="([^"]*)"/)[1].match(/M/g).length;
    const off = svg.match(/class="matrix-off" d="([^"]*)"/)[1].match(/M/g).length;
    expect(on).toBe(10);            // the "1" glyph
    expect(on + off).toBe(35);
    expect(svg).toContain('viewBox="0 0 5 7"');
  });
  it('spaces characters one column apart and names itself for a screen reader', () => {
    const svg = M.matrixSVG('TUE 06 OCT · 05:19', 'Tuesday 6 October, 05:19');
    expect(svg).toContain(`viewBox="0 0 ${18 * 6 - 1} 7"`);
    expect(svg).toContain('aria-label="Tuesday 6 October, 05:19"');
  });
  it('draws an unknown character as a blank cell, not a wrong one', () => {
    const svg = M.matrixSVG('?');
    expect(svg.match(/class="matrix-on" d="([^"]*)"/)[1]).toBe('');
    expect(svg.match(/class="matrix-off" d="([^"]*)"/)[1].match(/M/g).length).toBe(35);
  });
  it('the Bridge draws its clock with it rather than a copy', () => {
    expect(SRC).toMatch(/import \{ matrixSVG \} from '\.\/matrix\.js'/);
    expect(SRC).not.toMatch(/GLYPHS/);
  });
});

describe('days since the last thing went live', () => {
  const now = Date.parse('2026-10-06T09:00:00');
  it('counts calendar days, so last night is 1 and this morning is 0', () => {
    expect(B.daysSince(Date.parse('2026-10-06T00:30:00'), now)).toBe(0);
    expect(B.daysSince(Date.parse('2026-10-05T23:50:00'), now)).toBe(1);
    expect(B.daysSince(Date.parse('2026-09-28T12:00:00'), now)).toBe(8);
  });
  it('reads only what is on main once anything is, and skips drafts', () => {
    const state = {
      posts: [
        { title: 'Money Talks', status: 'published', added_at: '2026-09-28T10:00:00Z', _imported: true },
        { title: 'Unpublished', status: 'published', added_at: '2026-10-05T10:00:00Z' },
        { title: 'Draft', status: 'draft', added_at: '2026-10-06T08:00:00Z', _imported: true },
      ],
      buffer: [{ published_at: '2026-09-20T10:00:00Z', _imported: true }],
    };
    const last = B.lastLive(state);
    expect(last.what).toBe('Field note');
    expect(last.title).toBe('Money Talks');
  });
  it('a pulse counts', () => {
    const at = Date.parse('2026-10-06T07:00:00Z');
    expect(B.lastLive({ posts: [{ title: 'x', added_at: '2026-09-01T00:00:00Z' }] }, at)).toEqual({ at, what: 'Pulse', title: '' });
  });
  it('is nothing when nothing has gone live', () => {
    expect(B.lastLive({})).toBeNull();
  });
});

describe('every word the Bridge paints has a text class (css/field-console.css, TYPE)', () => {
  // Painted for real, then walked: a text node with no classified ancestor is
  // a piece of the page whose light nobody decided. The keys (SEND ▲) are
  // controls with their own cap light, the bay is the console's standard one
  // with its own phosphor (.dropzone's glyph and legend), the clock is a
  // drawn tube, and what is aria-hidden is ornament riding on a classified
  // neighbour.
  it('has no unclassified text', () => {
    B.renderBridge();
    const root = document.querySelector('#view-bridge .bridge');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const bare = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || el.closest('[aria-hidden="true"], svg, .btn, .dropzone, script')) continue;
      if (!el.closest('[data-text]')) bare.push(n.textContent.trim());
    }
    expect(bare).toEqual([]);
    // And the painted regions did paint something to check.
    expect(root.querySelectorAll('#br-waiting [data-text="act"]').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('#br-headline [data-text="live"]').length).toBeGreaterThan(0);
  });

  it('the headline is word by word, so the update can travel through it', () => {
    B.renderBridge();
    const words = [...document.querySelectorAll('#br-headline > [data-text="live"]')].map((s) => s.textContent);
    expect(words.join(' ')).toBe(document.getElementById('br-headline').dataset.text);
    expect(words.length).toBeGreaterThan(1);
  });

  it('waiting on you carries no count: the lines are under it, and a total is not news', () => {
    expect(html).not.toMatch(/br-wait-count|br-h-count/);
    expect(SRC).not.toMatch(/br-wait-count/);
  });

  it('the room-left sentence is the one a touch screen drops, and the meter keeps saying it', () => {
    expect(SRC).toMatch(/say\.meta\(roomText, 'info', ' br-room'\)/);
    expect(SRC).toMatch(/aria-valuetext="\$\{escapeHTML\(valueText\)\}"/);
  });

  it('a pulse sent, or a publish from here landing, is the update — and nothing else is', () => {
    const calls = [...SRC.matchAll(/_announce\(\)/g)].length;
    expect(calls).toBe(3);   // its definition's name, bridgeSay, and the landing in renderBridge
    expect(SRC).toMatch(/await _readLive\(true\);\s*renderBridge\(\);\s*_announce\(\);/);
    expect(SRC).toMatch(/if \(_landed\) \{ _landed = false; if \(_isUp\(\)\) _announce\(\); \}/);
  });

  it('the status carries no light of its own, and the headline has none (pass six: "remove smd"; K85: the chip came off LIVE too)', () => {
    expect(SRC).toMatch(/<span class="br-stat" data-text="live">LIVE · DEPLOYED/);
    expect(SRC).not.toMatch(/lm-smd/);
    expect(html).not.toMatch(/br-calm-lamp|br-lamp/);
    expect(SRC).not.toMatch(/br-calm-lamp/);
  });
});

describe('the surface: no scroll on a tablet or a desk (2026-10-06)', () => {
  const CSS = plainUnits(readFileSync(join(ROOT, 'css/field-console.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
  const LOCK = '@media (min-width: 700px) and (min-height: 560px) {';

  it('is held to the pane and clipped wherever the screen is tablet-sized both ways', () => {
    const block = CSS.slice(CSS.indexOf(LOCK), CSS.indexOf('\n}', CSS.indexOf(LOCK)));
    expect(block).toMatch(/#view-bridge\.active \{[^}]*height: 100%;[^}]*overflow: hidden;/);
    // The channels take what their lines need; the spare height falls to the
    // floor, not into a band above the capture row (2026-10-06, the desk).
    expect(block).toMatch(/grid-template-rows: auto auto minmax\(0, max-content\) auto; align-content: start;/);
    expect(block).toMatch(/#view-bridge \.br-list \{[^}]*overflow: hidden;/);
  });

  it('ends above the tab bar where there is one', () => {
    expect(CSS).toMatch(/\(min-width: 700px\) and \(min-height: 560px\) and \(max-width: 1180px\),\s*\(min-width: 700px\) and \(min-height: 560px\) and \(pointer: coarse\) \{\s*#view-bridge\.active \{\s*padding-bottom: calc\(clamp\([^)]*\) \+ var\(--tabbar-rsv\)/);
  });

  it('a phone is not locked: nothing outside the tablet query clips the view', () => {
    const outside = CSS.replace(/@media \(min-width: 700px\) and \(min-height: 560px\)[^{]*\{[\s\S]*?\n\}/g, '');
    expect(outside).not.toMatch(/#view-bridge\.active \{[^}]*overflow: hidden/);
  });

  it('a short pane drops the explanations first', () => {
    expect(CSS).toMatch(/\(max-height: 879px\) \{\s*#view-bridge \.br-bay \.dz-hint,\s*#view-bridge \.br-room \{ display: none; \}/);
  });

  it('a list shows the lines that fit, whole, and counts the rest', () => {
    // happy-dom lays nothing out, so the list's heights are stated: each
    // shown line is 30 px, and the row gives the list 100.
    const ol = document.createElement('ol');
    ol.innerHTML = Array.from({ length: 5 }, (_, i) => `<li class="br-item">line ${i + 1}</li>`).join('');
    Object.defineProperty(ol, 'clientHeight', { get: () => 100 });
    Object.defineProperty(ol, 'scrollHeight', { get: () => [...ol.children].filter((li) => !li.hidden).length * 30 });
    expect(B._bridgeFit(ol)).toBe(3);
    const shown = [...ol.children].filter((li) => !li.hidden);
    expect(shown.map((li) => li.textContent.trim())).toEqual(['line 1', 'line 2', '+3 more']);
    expect(ol.querySelector('.br-more [data-text="live"]')).toBeTruthy();
    // Fitted again (the next paint, a resize), it starts from everything.
    expect(B._bridgeFit(ol)).toBe(3);
    expect(ol.querySelectorAll('.br-more')).toHaveLength(1);
  });

  it('holds nothing back where nothing overflows (a phone)', () => {
    const ol = document.createElement('ol');
    ol.innerHTML = '<li>a</li><li>b</li>';
    expect(B._bridgeFit(ol)).toBe(0);
    expect(ol.querySelector('[hidden], .br-more')).toBeNull();
  });
});

describe('it loads at once (2026-10-06: regions arrived at 15 s and 47 s)', () => {
  it('each live fact lands on its own; none waits for the slowest', () => {
    expect(SRC).not.toMatch(/await Promise\.all\(\[\s*cardsLiveInputs/);
    // Each lands on its own, and a failed one marks its fact failed (K68).
    expect(SRC).toMatch(/const land = \(read, take, fact\) => read\s*\.then\(take\)\s*\.catch\(\(\) => \{ _live\[fact \+ 'Read'\] = 'failed'; \}\)\s*\.then\(\(\) => \{ _remember\(\); _soon\(\); \}\);/);
  });

  it('signing in or out reads at once, rather than after the last read\'s TTL', () => {
    expect(SRC).toMatch(/const session = _live\.signedIn !== isLoggedIn\(\);\s*if \(!force && !session && Date\.now\(\) - _live\.at < LIVE_TTL\)/);
  });

  it('whatever the console saves repaints the Bridge on the next frame', async () => {
    // Up, the Bridge reads the live site; here nothing answers, at once.
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
    B.bridgeWire();   // what init() does at boot
    B.renderBridge();
    const view = document.getElementById('view-bridge');
    view.classList.add('active');
    try {
      const { STATE } = await import('../js/console-state.js');
      const before = STATE.posts;
      STATE.posts = [...(before || []), { id: 'saved-now', title: 'Arrived by save', status: 'draft', body: 'three words here', added_at: new Date().toISOString() }];
      document.dispatchEvent(new Event('console-saved'));
      await new Promise((r) => setTimeout(r, 60));
      expect(document.getElementById('br-waiting').textContent).toContain('Arrived by save');
      STATE.posts = before;
    } finally {
      view.classList.remove('active');
      vi.unstubAllGlobals();
    }
  });

  it('the save says so, from the module every change ends in', () => {
    const state = readFileSync(join(ROOT, 'js/console-state.js'), 'utf8');
    expect(state).toMatch(/document\.dispatchEvent\(new Event\('console-saved'\)\)/);
    expect(SRC).toMatch(/document\.addEventListener\('console-saved', _soon\)/);
  });

  it('remembers the last live facts, so the next open paints whole', () => {
    expect(SRC).toMatch(/const LIVE_KEY = 'oaklens_bridge_live';/);
    expect(SRC).toMatch(/_recall\(\);/);
    // What it keeps of a slot is what it draws: never the record it carries.
    expect(SRC).toMatch(/const _slim = \(s\) => s && \{ key: s\.key, kind: s\.kind \|\| '', kicker: s\.kicker \|\| '', title: s\.title \|\| '', thumb: s\.thumb \|\| '' \};/);
  });
});

describe('pass six: one grid, and the console\'s bay (2026-10-06)', () => {
  const CSS = plainUnits(readFileSync(join(ROOT, 'css/field-console.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));

  it('every row stands on the same three columns, so each piece starts on one of three lines', () => {
    expect(CSS).toMatch(/--br-cols: minmax\(0, [\d.]+fr\) minmax\(0, [\d.]+fr\) minmax\(0, [\d.]+fr\);/);
    for (const row of ['br-mast', 'br-top', 'br-channels', 'br-foot']) {
      expect(CSS, row).toMatch(new RegExp(`\\.${row} \\{[^}]*grid-template-columns: var\\(--br-cols\\);`));
    }
    // THIS DEVICE over storage (03); LIVE under storage (K85).
    // K95: THIS DEVICE and the day-or-night switch left the mast; they live in Settings.
    expect(CSS).not.toMatch(/\.br-device \{|\.br-theme \{/);
    expect(html).not.toMatch(/id="br-device"|class="br-theme"/);
    expect(html).toMatch(/<div class="br-store">\s*<div class="br-inst br-inst--storage" id="br-storage"><\/div>\s*<div class="br-status" id="br-status"><\/div>/);
    expect(CSS).toMatch(/grid-template-areas: "head since store" "resume since store" "bay since store";/);
  });

  it('a container query sets the columns on the rows, never on the container it queries', () => {
    const queries = CSS.match(/@container \(max-width: \d+px\) \{[\s\S]*?\n\}/g).join('\n');
    expect(queries).not.toMatch(/(^|\n)\s*\.bridge \{/);
    expect(queries).toMatch(/\.bridge > \* \{ --br-cols:/);
  });

  it('bring work in is the standard bay, backlit, with the Bridge\'s own routing', () => {
    // A strip under the headline (2026-10-06), in the headline's block.
    expect(html).toMatch(/<div class="dropzone br-bay br-bay--strip" data-seam="box" data-backlit id="br-dropzone"/);
    const top = html.slice(html.indexOf('id="br-top"'), html.indexOf('class="br-channels"'));
    expect(top).toContain('id="br-dropzone"');
    expect(SRC).toMatch(/wireDropzone\('br-dropzone', 'br-add-input', routeFiles\);/);
    expect(html).not.toMatch(/bridgePick|br-capture-input/);
  });

  it('a drop on the bay is added once: the page leaves it to the bay', () => {
    const drop = SRC.slice(SRC.indexOf("view.addEventListener('drop'"));
    expect(drop.indexOf("closest?.('#br-dropzone')")).toBeGreaterThan(-1);
    expect(drop.indexOf("closest?.('#br-dropzone')")).toBeLessThan(drop.indexOf('routeFiles(files)'));
  });

  it('a slot with no picture is a lit panel, not a grey square', () => {
    expect(SRC).toMatch(/class="br-thumb br-thumb--type" data-seam="box" data-backlit/);
  });
});

describe('five keys, and day/night on the Bridge (K63)', () => {
  const CSS = plainUnits(readFileSync(join(ROOT, 'css/field-console.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
  const CHROME = readFileSync(join(ROOT, 'js/console/chrome.js'), 'utf8');

  it('the top row is Bridge · Pulse · ? · settings · PUBLISH, and nothing else', () => {
    const bar = html.slice(html.indexOf('<header class="topbar">'), html.indexOf('</header>', html.indexOf('<header class="topbar">')));
    const keys = [...bar.matchAll(/<button class="(?:settings-btn|publish-btn)[^"]*" id="([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(['bridge-topbar-btn', 'pulse-topbar-btn', 'help-topbar-btn', 'settings-topbar-btn', 'publish-btn']);
    expect(html).not.toMatch(/id="theme-toggle"/);
  });

  it('the Bridge key stands down where the tab bar already holds the Bridge', () => {
    expect(CSS).toMatch(/@media \(max-width: 1180px\), \(pointer: coarse\) \{\s*\.topbar \.publish-btn \{ display: none; \}\s*\.topbar \.topbar-home \{ display: none; \}/);
  });

  it('day/night is a choice in Settings, driven by applyTheme (its switch left the mast in K95)', () => {
    expect(html).not.toMatch(/class="br-theme"/);
    expect(html).toMatch(/data-theme-choice="dark" onclick="themeSet\('dark'\)"/);
    expect(html).toMatch(/data-theme-choice="light" onclick="themeSet\('light'\)"/);
    expect(CHROME).toMatch(/querySelectorAll\("\[data-theme-switch\]"\)/);
    expect(CHROME).toMatch(/querySelectorAll\("\[data-theme-choice\]"\)/);
    expect(CHROME).toMatch(/export function themeSet\(mode\)/);
  });
});

describe('the board flips, and the count says what it counts (K64)', () => {
  it('the headline is set through the split-flap board, and said once to a screen reader', () => {
    expect(SRC).toMatch(/flapTo\(el, h\.text, \{ wordAttrs: 'data-text="live"', animate \}\);/);
    expect(html).toMatch(/<p class="br-said" id="br-said" aria-live="polite" data-text="info"><\/p>/);
    expect(html).not.toMatch(/id="br-headline" aria-live/);
  });

  it('names what the edits waiting are, biggest first, and never the Library', () => {
    expect(B.stagedBreakdown({ buffer: 5, posts: 2, library: 9 })).toBe('5 frames · 2 notes');
    expect(B.stagedBreakdown({ posts: 1 })).toBe('1 note');
    expect(B.stagedBreakdown({ buffer: 1, posts: 2, audio: 3, cards: 4, archive: 5 })).toBe('5 archive photos · 4 cards · 3 tracks · 2 more');
    expect(B.stagedBreakdown({})).toBe('');
  });
});

describe('regions from other modules (K65)', () => {
  it('a registered region is painted with the rest, after the built-in painters, once per id', () => {
    const calls = [];
    B.registerBridgeRegion({ id: 'test-region', paint: (now) => calls.push(typeof now) });
    B.registerBridgeRegion({ id: 'test-region', paint: () => calls.push('twice') });
    B.renderBridge();
    expect(calls).toEqual(['number']);
  });

  it('a region that throws is skipped, and the page still paints', () => {
    const err = console.error;
    console.error = () => {};
    B.registerBridgeRegion({ id: 'test-broken', paint: () => { throw new Error('boom'); } });
    expect(() => B.renderBridge()).not.toThrow();
    console.error = err;
    expect(document.getElementById('br-headline').dataset.text).toBeTruthy();
  });

  it('the kit is shared, so a region\'s words carry text classes like the rest', () => {
    expect(B.bridgeKit.say.figure('1')).toMatch(/data-text="stat"/);
    expect(B.bridgeKit.say.line('Go', 'onclick="x()"')).toMatch(/data-text="act"/);
    expect(SRC).toMatch(/const _fitIds = \(\) => \[\.\.\.FIT, \.\.\._regions\.map\(\(r\) => r\.fit\)\.filter\(Boolean\)\];/);
  });
});
