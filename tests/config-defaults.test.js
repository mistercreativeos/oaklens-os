// The forward-compatibility gate for site.config.js.
//
// A fork takes engine updates with `git merge upstream/main`, and that merge
// never touches their `site.config.js` — setup.md tells them to always keep
// their own. So every key the engine adds is a key that every existing fork's
// config lacks. src/shared/config.js is what makes such a key additive; these
// tests are what keep it that way, and the last one is the point of the file:
// it fails when a new `siteConfig.something` is read without a default, which
// is the only version of this rule that survives contact with a busy week.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BACKFILL, SHAPE, resolveConfig } from '../src/shared/config.js';
import exampleConfig from '../site.config.example.js';

const ROOT = join(import.meta.dirname, '..');

describe('config defaults', () => {
  it("fills in a key the fork's config has never heard of", () => {
    // The worked example: `location` is read as `location.name` on the path
    // that renders every page, so a config without it took the whole site
    // down rather than degrading.
    const resolved = resolveConfig({ name: 'A Fork' });
    expect(resolved.location.name).toBe('');
    expect(resolved.location.coords).toEqual([0, 0]);
    expect(() => `${resolved.location.name}`).not.toThrow();
  });

  it("never overrides a value the fork did set", () => {
    const resolved = resolveConfig({
      name: 'A Fork',
      location: { name: 'Somewhere', coords: [1, 2] },
      theme: { preset: 'noir' },
    });
    expect(resolved.name).toBe('A Fork');
    expect(resolved.location.name).toBe('Somewhere');
    expect(resolved.location.coords).toEqual([1, 2]);
    // ...while still gaining the sub-keys it never mentioned.
    expect(resolved.location.region).toBe('');
    expect(resolved.theme.preset).toBe('noir');
    expect(resolved.theme.toggle).toBe(true);
  });

  it('replaces arrays instead of merging them', () => {
    // A fork's three-item nav is the whole nav. Merging would append ours to
    // theirs and put pages they removed back in the bar.
    const resolved = resolveConfig({ nav: [{ label: 'Only', href: '/only' }] });
    expect(resolved.nav).toEqual([{ label: 'Only', href: '/only' }]);
  });

  it('leaves an absent SHAPE key absent, because absence is the signal', () => {
    // No wordmark means "fall back to name"; no entity means "emit no
    // JSON-LD"; no pages means "nothing is disabled". Backfilling any of
    // those would silently overrule a deliberate deletion.
    const resolved = resolveConfig({ name: 'A Fork' });
    for (const key of Object.keys(SHAPE)) {
      expect(resolved[key], `${key} must stay absent`).toBeUndefined();
    }
  });

  it('fills in sub-keys of a SHAPE block the fork DID supply', () => {
    // The forward-compat case: upstream adds a page, and a fork whose pages{}
    // predates it gets the engine's default rather than `undefined`.
    const resolved = resolveConfig({ pages: { archive: false } });
    expect(resolved.pages.archive).toBe(false);
    expect(resolved.pages.fieldNotes).toBe(true);
    expect(resolved.pages.wall).toBe(false);
  });

  it('resolves a null or missing config instead of throwing', () => {
    for (const input of [null, undefined, {}]) {
      expect(() => resolveConfig(input)).not.toThrow();
      expect(resolveConfig(input).name).toBe(BACKFILL.name);
    }
  });

  it('leaves the shipped example config unchanged', () => {
    // The example is what a fresh fork starts from, so resolution must be a
    // no-op on it. A difference here means a default disagrees with the file
    // it is supposed to be describing.
    const resolved = resolveConfig(exampleConfig);
    for (const [key, value] of Object.entries(exampleConfig)) {
      expect(resolved[key], `${key} was altered by resolution`).toEqual(value);
    }
  });

  // ---- the gate -----------------------------------------------------------

  // Read defensively at their call sites, where absence is meaningful and
  // already handled: an unset `url`/`cdnBase` falls back to the request origin
  // (that is what makes a fresh fork work on *.workers.dev with no config),
  // `consoleShellPublic` is checked with `!== true`, and `splitHero` is a noir
  // -only block whose absence falls back to the folio hero. If you add to this
  // list, the call site must already handle the key being undefined.
  const GUARDED_AT_CALL_SITE = new Set([
    'cdnBase', 'url', 'consoleShellPublic', 'splitHero',
  ]);

  function serverSources(dir, out = []) {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) serverSources(abs, out);
      else if (name.endsWith('.js')) out.push(abs);
    }
    return out;
  }

  it('every config key the engine reads has a default or is guarded', () => {
    const files = [...serverSources(join(ROOT, 'src')), join(ROOT, 'worker.js')];
    const known = new Set([...Object.keys(BACKFILL), ...Object.keys(SHAPE), ...GUARDED_AT_CALL_SITE]);
    const offenders = [];

    for (const abs of files) {
      // config.js is where the defaults live; it reads the raw file by design.
      if (relative(ROOT, abs) === join('src', 'shared', 'config.js')) continue;
      const body = readFileSync(abs, 'utf8');
      for (const line of body.split('\n')) {
        // Comments describe keys as often as code reads them.
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
        for (const m of line.matchAll(/\bsiteConfig(?:\?)?\.([a-zA-Z_$][\w$]*)/g)) {
          if (!known.has(m[1])) offenders.push(`${relative(ROOT, abs)}: siteConfig.${m[1]}`);
        }
      }
    }

    expect(
      [...new Set(offenders)],
      'Add the key to BACKFILL or SHAPE in src/shared/config.js — a fork\'s '
      + 'existing site.config.js will not have it',
    ).toEqual([]);
  });
});
