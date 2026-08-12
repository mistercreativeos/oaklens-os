// The filename ⇄ R2-key contract, and the player's duty to admit failure.
//
// WHY THIS FILE EXISTS
// A track uploaded from the console travels through two sanitizers that never
// see each other: the console records `filename` in data/audio.json, and the
// Worker derives the R2 object key from the uploaded file's name. If those two
// disagree by even one character, the object is stored under one name and
// requested under another — and because the proxy validates the key shape
// before it ever consults R2, the visitor gets a 400, not a 404.
//
// That is not hypothetical. `\w` (ASCII-only without the `u` flag) meant every
// non-Latin filename diverged: `シルエット 日暮れ 04 街路灯.mp3` was stored as
// `audio/04 .mp3`, the registry kept the real name, and the player — which
// swallowed both the media error and the play() rejection — simply looked
// idle. A beautiful player that will not start, with nothing in the console to
// say why.
//
// So two things are pinned here: the two charsets agree, and the player is
// incapable of failing silently again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanFilename } from '../js/console/utils.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('the console and the Worker agree on what an R2 key may hold', () => {
  it('declares the same character set on both sides', () => {
    // Compared as sorted character sets rather than as strings: the two are
    // written in different syntaxes (a regex-source fragment on the server, a
    // literal class in the console), and the contract is the membership, not
    // the spelling.
    const server = /const R2_KEY_CHARS = '([^']+)'/.exec(read('src/api/assets.js'));
    const client = /const R2_SAFE_CHARS = \/\[\^([^\]]+)\]\/gu/.exec(read('js/console/utils.js'));
    expect(server, 'R2_KEY_CHARS not found in src/api/assets.js').toBeTruthy();
    expect(client, 'R2_SAFE_CHARS not found in js/console/utils.js').toBeTruthy();

    const norm = (s) => s.replace(/\\\\/g, '\\').split('').sort().join('');
    expect(norm(client[1])).toBe(norm(server[1]));
  });

  it('keeps a non-Latin filename intact, so it matches the key that gets stored', () => {
    expect(cleanFilename('シルエット 日暮れ 04 街路灯.mp3'))
      .toBe('シルエット 日暮れ 04 街路灯.mp3');
    expect(cleanFilename('Ελλάδα.mp3')).toBe('Ελλάδα.mp3');
    expect(cleanFilename('café-münchen.wav')).toBe('café-münchen.wav');
  });

  it('still strips what an R2 key cannot carry', () => {
    expect(cleanFilename('a?b#c%d&e.mp3')).toBe('abcde.mp3');
    expect(cleanFilename('quote"back\\slash.mp3')).toBe('quotebackslash.mp3');
  });

  it('keeps the behaviour it already had', () => {
    expect(cleanFilename('shot-1024w.webp')).toBe('shot.webp');
    expect(cleanFilename('Earpiece .jpg')).toBe('Earpiece.jpg');
    expect(cleanFilename('  padded.mp3  ')).toBe('padded.mp3');
    expect(cleanFilename('')).toBe('');
    expect(cleanFilename(null)).toBe('');
  });
});

describe('the player cannot fail silently', () => {
  const src = read('js/audio-player.js');

  it('has no empty catch swallowing a play() rejection', () => {
    // The exact shape of the original bug. An empty catch here is why a broken
    // track was indistinguishable from an untouched one. Scoped to play():
    // the share-sheet and clipboard catches nearby are correctly silent, since
    // a visitor dismissing a share sheet has not hit an error.
    expect(src).not.toMatch(/audio\.play\(\)\s*\.catch\(function \(\) \{\}\)/);
    expect(src).not.toMatch(/play\(\)\.catch\(function \(\) \{\}\)/);
  });

  it('listens for media errors and paints an error state', () => {
    expect(src).toContain("audio.addEventListener('error'");
    expect(src).toContain("root.classList.add('is-error')");
  });

  it('does not blame the file for an autoplay block', () => {
    // A programmatic start refused by the autoplay policy is the browser's
    // choice, not a missing file — painting it as unavailable would be a lie.
    expect(src).toContain('NotAllowedError');
  });

  it('has a style for the error state, or the class paints nothing', () => {
    expect(read('css/main.css')).toContain('.ap.is-error');
  });
});
