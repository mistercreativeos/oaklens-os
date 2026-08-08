// ANALOGS.NETWORK membership — the pure half.
//
// Everything here takes its config as a parameter (the _supportTiersHtml
// posture), so on/off/half-filled are all drivable against frozen objects with
// no vi.mock and no module-registry games. The two route-level files
// (webring-route / webring-off) carry the mocked halves.
//
// The assertion this file exists for is the falsy-zero one. The ring numbers
// seats from 0 — analogs.network/nodes/000-oaklens-art.json is the founding
// node — so `if (!node)` silently un-joins seat zero, and it would do it only
// for the one instance nobody tests against a fresh fork.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';

import {
  webringNode, ringNodeId, analogsToken, ringHref,
  RING_DISCIPLINES, RING_JOIN_MAILBOX, RING_HOST,
} from '../src/shared/webring.js';
import { _footerChipsHtml } from '../src/edge/chrome.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('webringNode() — the seat guard', () => {
  it('accepts node 0, which is a real seat AND falsy', () => {
    expect(webringNode({ node: 0, slug: 'oaklens-art' })).toEqual({ node: 0, slug: 'oaklens-art' });
  });

  it('accepts an ordinary seat', () => {
    expect(webringNode({ node: 7, slug: 'your-slug' })).toEqual({ node: 7, slug: 'your-slug' });
  });

  it.each([
    ['no block at all', undefined],
    ['null', null],
    ['empty object', {}],
    ['a number, not an object', 7],
    ['number with no slug', { node: 7 }],
    ['slug with no number', { slug: 'your-slug' }],
    ['a stringified number', { node: '7', slug: 'your-slug' }],
    ['a float', { node: 7.5, slug: 'your-slug' }],
    ['a negative seat', { node: -1, slug: 'your-slug' }],
    ['an uppercase slug', { node: 7, slug: 'Your-Slug' }],
    ['a slug with underscores', { node: 7, slug: 'your_slug' }],
    ['a leading hyphen', { node: 7, slug: '-your-slug' }],
    ['a slug over 40 chars', { node: 7, slug: 'a'.repeat(41) }],
  ])('is off for %s — a half-filled block never renders someone else\'s seat', (_label, config) => {
    expect(webringNode(config)).toBeNull();
  });
});

describe('the ring identifiers', () => {
  it('pads seats to three digits, matching the registry filenames', () => {
    expect(ringNodeId(0)).toBe('000');
    expect(ringNodeId(7)).toBe('007');
    expect(ringNodeId(123)).toBe('123');
  });

  it('builds the ownership token in the exact shape nodes/README.md specifies', () => {
    expect(analogsToken({ node: 0, slug: 'oaklens-art' })).toBe('analogs.network//node-000//oaklens-art');
    expect(analogsToken({ node: 7, slug: 'your-slug' })).toBe('analogs.network//node-007//your-slug');
  });

  it('deep-links to the node on the ring, not the ring index', () => {
    expect(ringHref({ node: 7, slug: 'your-slug' })).toBe('https://analogs.network/#/your-slug');
  });

  it('answers null rather than a malformed claim when there is no seat', () => {
    expect(analogsToken(null)).toBeNull();
    expect(ringHref(null)).toBeNull();
  });
});

describe('the footer chips', () => {
  const OS_CHIP = /class="powered-chip"[^>]*>OS</;

  it('ships the OS chip by default — poweredBy unset means on', () => {
    const html = _footerChipsHtml({});
    expect(html).toMatch(OS_CHIP);
    expect(html).toContain('aria-label="Built with Oaklens OS"');
    expect(html).toContain('title="Built with Oaklens OS"');
    expect(html).not.toContain('ANALOGS');
  });

  it('renders nothing at all when a fork opts out and is not on the ring', () => {
    expect(_footerChipsHtml({ poweredBy: false })).toBe('');
  });

  it('renders the ring chip alone when a fork opts out but IS a member', () => {
    const html = _footerChipsHtml({ poweredBy: false, webring: { node: 7, slug: 'your-slug' } });
    expect(html).not.toMatch(OS_CHIP);
    expect(html).toContain('ANALOGS <strong>//007</strong>');
  });

  it('renders both as the same chip object so the footer reads as one system', () => {
    const html = _footerChipsHtml({ webring: { node: 0, slug: 'oaklens-art' } });
    expect(html.match(/class="powered-chip"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener"/g)).toHaveLength(2);
    // Seat zero renders as //000, not //0 — same width as the token.
    expect(html).toContain('ANALOGS <strong>//000</strong>');
    expect(html).toContain('href="https://analogs.network/#/oaklens-art"');
    expect(html).toContain('aria-label="Member of the ANALOGS network — node 000"');
  });

  it('drops the ring chip for a half-filled block rather than guessing', () => {
    expect(_footerChipsHtml({ webring: { node: 7 } })).not.toContain('ANALOGS');
  });
});

describe('what a fork actually installs', () => {
  // site.config.example.js IS the fork's site.config.js (os-extract cpSyncs it
  // over). Both keys must ship commented out: a fork inherits no link into
  // someone else's ring, and the attribution chip defaults on.
  const example = read('site.config.example.js');

  it('enables no webring — no fork ships a seat it did not earn', () => {
    expect(example).not.toMatch(/^\s*webring:/m);
    expect(example).toMatch(/^\s*\/\/ webring: \{ node: 7, slug: 'your-slug' \},$/m);
  });

  it('leaves poweredBy unset, so the chip is on and removable', () => {
    expect(example).not.toMatch(/^\s*poweredBy:/m);
    expect(example).toMatch(/^\s*\/\/ poweredBy: false,$/m);
  });

  it('names no page in pages{} that the fork does not receive', () => {
    // /dev and /os are stripped from PAGE_ROUTES by the extractor, so a key for
    // either is a switch that does nothing — the exact drift that shipped once.
    const block = example.match(/pages: \{([^}]*)\}/)[1];
    expect(block).not.toContain('dev:');
    expect(block).not.toContain('os:');
  });
});

describe('the console ring card', () => {
  const shell = read('dev/field-console.html');
  const session = read('js/console/session.js');

  it('ships the CTA with NO href — the edge would rewrite a literal mailto', () => {
    // injectSiteChrome rewrites every a[href^="mailto:"] to siteConfig.email,
    // and the console document goes through that same rewriter. A literal ring
    // address in this markup becomes the owner's own address in production
    // only — which is why the href is set at runtime instead.
    const anchor = shell.match(/<a[^>]*id="ring-join-cta"[^>]*>/)[0];
    expect(anchor).not.toContain('href');
    expect(shell).not.toContain('mailto:themonitor');
  });

  it('carries no inline handler on the card (strict-CSP posture)', () => {
    const card = shell.match(/<div class="entry-form-card" id="ring-card">[\s\S]*?<\/div>\s*<div class="entry-form-card">/)[0];
    expect(card).not.toMatch(/\son\w+=/);
  });

  it('keeps its duplicated discipline list byte-identical to the shared one', () => {
    // session.js is browser code and cannot import from src/, so the list is
    // duplicated. This is the pin that stops the two drifting — the join email
    // asks people to choose BY NUMBER, so order is part of the contract.
    const listed = session.match(/const RING_DISCIPLINES = \[([\s\S]*?)\];/)[1]
      .match(/'([^']+)'/g).map((s) => s.slice(1, -1));
    expect(listed).toEqual([...RING_DISCIPLINES]);
  });

  it('builds a join mailto to the ring naming all seven disciplines', async () => {
    // session.js pulls in the console's module graph, which touches document,
    // location and localStorage at import time — so the globals go up before
    // the dynamic import, not after. (Node 26 defines its own `localStorage`
    // getter that throws unless --localstorage-file is passed, so it is
    // redefined rather than assigned.)
    const window = new Window({ url: 'https://example.com/dev/field-console' });
    window.document.body.innerHTML = '<a id="ring-join-cta"></a>';
    const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true });
    for (const k of ['document', 'location', 'localStorage', 'matchMedia', 'navigator']) {
      define(k, window[k]);
    }
    try {
      const { _wireRingJoin } = await import('../js/console/session.js');
      _wireRingJoin();
      const href = window.document.getElementById('ring-join-cta').getAttribute('href');
      expect(href.startsWith(`mailto:${RING_JOIN_MAILBOX}?`)).toBe(true);
      expect(href).toContain(`@${RING_HOST}`);
      const body = decodeURIComponent(new URL(href).searchParams.get('body'));
      for (const [i, d] of RING_DISCIPLINES.entries()) {
        expect(body).toContain(`[${i + 1}] ${d.toLowerCase()}`);
      }
      expect(body).toContain('my site: ');
    } finally {
      await window.happyDOM.close();
    }
  });
});
