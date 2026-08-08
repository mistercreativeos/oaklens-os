// Bundled CC0 sample frames — the template's zero-config demo imagery. A fresh
// fork renders these via the /api/cdn sample fallback (worker.js). These guards
// keep the wiring honest: the frames exist at the expected variant sizes, the
// example config points the folio hero at one, the fallback sample data carries
// no instance identity, and the worker fallback is present.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import exampleConfig from '../site.config.example.js';
import siteConfig from '../site.config.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SAMPLES = join(ROOT, 'assets', 'samples');

describe('sample frames are bundled at the expected sizes', () => {
  const files = readdirSync(SAMPLES);
  it('the hero exists in all three variant widths', () => {
    for (const w of [480, 1024, 2048]) {
      expect(files).toContain(`sample-hero-${w}w.webp`);
    }
  });
  it('ships a set of numbered archive/wall samples (each in 3 widths)', () => {
    const bases = new Set(files.filter((f) => /^sample-\d+-\d+w\.webp$/.test(f)).map((f) => f.replace(/-\d+w\.webp$/, '')));
    expect(bases.size).toBeGreaterThanOrEqual(6);
    for (const base of bases) {
      for (const w of [480, 1024, 2048]) expect(existsSync(join(SAMPLES, `${base}-${w}w.webp`))).toBe(true);
    }
  });
  it('the raw originals were removed (webp only)', () => {
    expect(files.some((f) => /\.(jpe?g|png)$/i.test(f))).toBe(false);
  });
});

describe('example config wires the folio hero to a sample', () => {
  it('folioHero.image points at a bundled sample', () => {
    const img = exampleConfig.folioHero.image;
    expect(img).toMatch(/^\/assets\/samples\/sample-hero-\d+w\.webp$/);
    expect(existsSync(join(ROOT, img.replace(/^\//, '')))).toBe(true);
  });
});

describe('fallback sample data carries no instance identity', () => {
  it.each(['js/page-archive.js', 'js/page-wall.js'].map((p) => [p]))('%s sample data is neutral + references sample- frames', (p) => {
    const src = read(p);
    const fnName = p.includes('wall') ? 'getSampleWallpapers' : 'getSampleData';
    const fn = src.slice(src.indexOf(`function ${fnName}`));
    const body = fn.slice(0, fn.indexOf('\n}') + 2);
    // Derived from the live config rather than a hardcoded list of this
    // instance's places: the check then means the same thing in a fork, and the
    // test file itself stops carrying the identity it is policing.
    const brand = siteConfig.name.toUpperCase().replace(/[^A-Z0-9]+/g, '');
    expect(body).not.toContain(`${brand}_`);      // no branded filenames
    expect(body.toLowerCase()).not.toContain(siteConfig.location.name.toLowerCase());
    expect(body).toContain('sample-');            // references the bundled frames
  });
});

describe('worker serves samples on an /api/cdn R2 miss', () => {
  it('the CDN handler has the /assets/samples fallback', () => {
    // handleCdnProxy lives in src/api/assets.js (decomposition, manual §6.7).
    const w = read('src/api/assets.js');
    expect(w).toContain('/assets/samples/');
    expect(w).toMatch(/env\.ASSETS/);
  });
});
