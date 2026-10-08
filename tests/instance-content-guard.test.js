// A test that reads one of THIS instance's posts off disk must skip in a fork.
//
// HAS_CONTENT / hasPosts() (./helpers/instance-content.js) say "there are
// posts here", which is true in any fork that has published. A test that then
// reads `fn-004.md` by name, or counts this site's 1,200 frames, fails there on
// somebody else's facts: `npm test` went red on a healthy fork (found on a
// standby fork, 2026-10-07). Such a test also needs IS_INSTANCE
// (./helpers/instance.js). Synthetic fixtures that only NAME a post path are
// fine; this looks for a named post being read.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TESTS = import.meta.dirname;
const READS_NAMED_POST = /\b(?:bodyOf|read|readFileSync)\(\s*(?:join\([^)]*,\s*)?['"`](?:posts\/)?fn-\d{3}\.md/;

describe('instance-content guard', () => {
  const files = readdirSync(TESTS).filter((f) => f.endsWith('.test.js'));

  it('finds the tests it is meant to watch', () => {
    expect(files.filter((f) => READS_NAMED_POST.test(readFileSync(join(TESTS, f), 'utf8'))).length)
      .toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f]))('%s gates any named post on IS_INSTANCE', (f) => {
    const src = readFileSync(join(TESTS, f), 'utf8');
    if (!READS_NAMED_POST.test(src)) return;
    expect(src, `${f} reads a named post; gate it on IS_INSTANCE`).toMatch(/skipIf\([^)]*IS_INSTANCE/);
  });
});
