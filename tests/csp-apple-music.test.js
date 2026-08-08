// The opt-in Apple Music widening: site.config.js → appleMusicEmbeds: true
// swaps frame-src 'none' for exactly https://embed.music.apple.com, and
// NOTHING else. Isolated in its own file for the same reason as
// tests/csp-analytics.test.js: vi.mock is hoisted per-file, and
// tests/csp.test.js needs the flag off to prove the shipped default names no
// third-party host in any directive.
//
// The pairing matters: the default-off assertion is only meaningful if turning
// the flag on demonstrably changes the header, and the flag is only safe if it
// widens frame-src by exactly one host.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: Object.freeze({ ...actual.default, webAnalytics: false, appleMusicEmbeds: true }) };
});

const { buildCsp } = await import('../src/shared/csp.js');

const ORIGIN = 'https://example.com';
const directive = (policy, name) =>
  policy.split('; ').find((d) => d.startsWith(`${name} `)) || '';

describe('site.config.js → appleMusicEmbeds: true', () => {
  it('allows exactly the Apple Music embed host in frame-src, both surfaces', () => {
    for (const strict of [true, false]) {
      expect(directive(buildCsp(ORIGIN, strict), 'frame-src'), `strict=${strict}`)
        .toBe('frame-src https://embed.music.apple.com');
    }
  });

  it('widens nothing else — every other directive matches the flag-off policy', () => {
    // Rebuild the off policy by hand: same header with frame-src swapped back.
    const on = buildCsp(ORIGIN, true);
    const offEquivalent = on.replace(
      'frame-src https://embed.music.apple.com', "frame-src 'none'");
    expect(offEquivalent).not.toBe(on); // the flag demonstrably changed the header
    for (const name of ['script-src', 'connect-src', 'img-src', 'media-src', 'worker-src', 'object-src']) {
      expect(directive(on, name), `${name} must not carry the embed host`)
        .not.toContain('music.apple.com');
    }
  });

  it('does not weaken the strict policy in any other way', () => {
    const policy = buildCsp(ORIGIN, true);
    expect(directive(policy, 'script-src')).not.toContain('unsafe-inline');
    expect(policy).toContain("object-src 'none'");
  });
});
