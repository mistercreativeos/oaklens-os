// @vitest-environment happy-dom
//
// The Bridge's light and its method, held (K86, 2026-10-07). The owner: a
// later session "wasn't doing the hardcore test … opening the real
// browser … checking against the contract and previous performance
// baseline". Two kinds of boundary live here:
//
//   1. A CONTRACT OF THE CODE (every tree, forks included): a light source on
//      the Bridge is never hidden in the markup. K82 and K83 tuned the
//      station's lamps while the station itself was `hidden` until the sync
//      delivered something to send; on a device that keeps nothing that is a
//      second or more into the cold start, and the unit appeared late,
//      already lit (K84). Hardware stays in its slot; only words wait.
//   2. THE METHOD (this instance: `docs/` does not ship to forks): the perf
//      bench exists, every tool is documented and generic, compare.mjs knows
//      them all, and CLAUDE.md still sends a session to the field guide
//      before it changes light, motion or layout.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('a light source on the Bridge is never hidden in the markup', () => {
  it('nothing that emits, or holds a lamp, sits under a [hidden] in #view-bridge', () => {
    const doc = new DOMParser().parseFromString(read('dev/field-console.html'), 'text/html');
    const view = doc.getElementById('view-bridge');
    expect(view).toBeTruthy();
    const lit = [...view.querySelectorAll('[data-seam], [data-backlit], [data-lit], .br-ship-lamp')];
    expect(lit.length).toBeGreaterThan(5);
    const hidden = lit.filter((el) => el.closest('[hidden]') && view.contains(el.closest('[hidden]')))
      .map((el) => el.id || el.className);
    expect(hidden, 'light sources hidden at load (they would arrive late, already lit)').toEqual([]);
  });
  it('the station\'s painter only names what it sends; it never shows or hides the unit', () => {
    const src = read('js/console/bridge.js');
    const ship = src.slice(src.indexOf('function _paintShip() {'), src.indexOf('function _lineHTML'));
    expect(ship).not.toMatch(/\.hidden\b|toggleAttribute\('hidden'|style\.display/);
  });
});

const PERF = join(ROOT, 'docs/capture/perf');
const TOOLS = ['cold-start', 'switches', 'appear', 'luminance', 'geometry', 'open-cost'];

describe.skipIf(!existsSync(PERF))('the perf bench is in the repo, documented and generic (instance)', () => {
  it('every tool is there, says how to run it, and builds on common.js', () => {
    for (const t of TOOLS) {
      const f = join(PERF, `${t}.mjs`);
      expect(existsSync(f), t).toBe(true);
      const src = readFileSync(f, 'utf8');
      expect(src, `${t}: a usage line in its header`).toMatch(new RegExp(`^//[^\\n]*\\n(//[^\\n]*\\n)*?//\\s+node perf/${t}\\.mjs`, 'm'));
      expect(src, `${t}: shared parts`).toMatch(/from '\.\/common\.js'/);
    }
  });
  it('compare.mjs knows every tool, and real Safari', () => {
    const src = readFileSync(join(PERF, 'compare.mjs'), 'utf8');
    const m = src.match(/const TOOLS = \[([^\]]+)\]/);
    const listed = m[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect([...listed].sort()).toEqual([...TOOLS, 'safari'].sort());
    const files = readdirSync(PERF).filter((f) => f.endsWith('.mjs') && f !== 'compare.mjs').map((f) => f.replace(/\.mjs$/, ''));
    expect(files.sort()).toEqual([...TOOLS].sort());
  });
  it('no tool names a person\'s machine: no home paths', () => {
    for (const f of readdirSync(PERF)) {
      expect(readFileSync(join(PERF, f), 'utf8'), f).not.toMatch(/\/Users\/|\/home\/[a-z]/);
    }
  });
  it('the capture README and the field guide document every tool', () => {
    const readme = read('docs/capture/README.md');
    const guide = read('docs/bridge-lighting-field-guide.md');
    for (const t of [...TOOLS, 'compare']) {
      expect(readme, `README: ${t}`).toContain(`${t}.mjs`);
      expect(guide, `guide: ${t}`).toContain(t);
    }
  });
  it('the field guide keeps the rule, the owner\'s conditions and the baselines', () => {
    const guide = read('docs/bridge-lighting-field-guide.md');
    expect(guide).toMatch(/## 0\. The one rule/);
    expect(guide).toMatch(/THIS DEVICE 0%/);
    expect(guide).toMatch(/### Baselines/);
    expect(guide).toMatch(/--empty --slow-sync/);
  });
  it('CLAUDE.md sends a session to the guide and the bench before light, motion or layout work', () => {
    const md = read('CLAUDE.md');
    expect(md).toMatch(/Touched light, motion, the cold start, or the Bridge's layout\?/);
    expect(md).toContain('docs/bridge-lighting-field-guide.md');
    expect(md).toContain('docs/capture/perf/');
    expect(existsSync(join(ROOT, 'docs/maintenance/2026-10-07-bridge-lighting-postmortem.md'))).toBe(true);
  });
});
