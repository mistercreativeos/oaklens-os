// CUSTOMIZE.md is the guide an owner — or a small free AI model acting for
// them — reads before changing anything. It names settings, files and
// placeholders by their exact spelling, and a guide that names a setting the
// engine renamed sends a model to edit something that no longer exists.
// Nothing else would notice, because nothing executes a Markdown file.
//
// So every name it gives is checked against the engine here: config keys
// against site.config.example.js, placeholders and nav hooks against the edge
// rewriter, theme names against the preset table, paths against the tree.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const guide = read('CUSTOMIZE.md');
const example = read('site.config.example.js');
const chrome = read('src/edge/chrome.js');

describe('CUSTOMIZE.md names only things that exist', () => {
  it('every site.config.js setting it names is in the example config', () => {
    // "`site.config.js` → `name`", "→ add `poweredBy: false`", "→ `theme.preset`"
    const named = [...guide.matchAll(/site\.config\.js` → (?:add )?`([A-Za-z.]+)/g)]
      .map((m) => m[1].split('.'));
    expect(named.length).toBeGreaterThan(10);
    for (const path of named) {
      for (const key of path) {
        // Active or commented-out (`timezone`, `poweredBy` ship commented).
        expect(example, `site.config.example.js has no "${key}"`)
          .toMatch(new RegExp(`(^|[\\s{,])${key}:`, 'm'));
      }
    }
  });

  it('every theme it lists is a real preset', () => {
    const table = chrome.match(/PRESET_DISPLAY_FONT\s*=\s*\{([\s\S]*?)\}/);
    expect(table, 'PRESET_DISPLAY_FONT moved').not.toBeNull();
    const presets = [...table[1].matchAll(/'([a-z-]+)'\s*:/g)].map((m) => m[1]);
    const line = guide.split('\n').find((l) => l.includes('theme.preset'));
    const listed = [...line.matchAll(/`([a-z-]+)`/g)].map((m) => m[1])
      .filter((n) => !['midnight', 'daylight', 'auto', 'defaultMode'].includes(n));
    expect(listed.sort()).toEqual([...presets].sort());
  });

  it('every placeholder it warns about is one the edge actually fills', () => {
    const attrs = [...new Set(guide.match(/data-site-[a-z]+/g))];
    expect(attrs.length).toBeGreaterThanOrEqual(6);
    for (const a of attrs) expect(chrome, `${a} is not rewritten`).toContain(`[${a}`);
    // The two menu blocks are REPLACED from `nav` — the trap the guide exists
    // to prevent is a model editing the HTML menu and seeing nothing change.
    expect(chrome).toContain("rewriter.on('.nav-links'");
    expect(chrome).toContain("rewriter.on('.nav-mobile'");
    expect(chrome).toContain(`rewriter.on('a[href^="mailto:"]'`);
    expect(chrome).toMatch(/\[data-support-/);
  });

  it('every file and folder it points at exists', () => {
    for (const p of ['about/index.html', 'css', 'js', 'src', 'worker.js',
      'CLAUDE.md', 'setup.md', 'site.config.example.js']) {
      expect(existsSync(join(ROOT, p)), `${p} is gone`).toBe(true);
    }
    // The About slot it sends people to is the text inside <main>.
    expect(read('about/index.html')).toMatch(/<main[\s>]/);
    expect(read('setup.md')).toMatch(/^## Keeping your site up to date with the engine$/m);
  });

  it('keeps the three kinds and the ask-first rule', () => {
    // The part that matters most to a non-developer owner: being told before
    // a change that the next update might undo.
    for (const kind of ['**Safe**', '**Watch**', '**Yours to maintain**']) {
      expect(guide).toContain(kind);
    }
    expect(guide).toMatch(/## Rules for AI helpers/);
    expect(guide).toMatch(/wait for a yes/i);
    expect(guide).toContain('MY-CHANGES.md');
  });

  it('is never served as a page, and neither is the owner\'s log', () => {
    const ignored = read('.assetsignore').split('\n');
    expect(ignored).toContain('CUSTOMIZE.md');
    expect(ignored).toContain('MY-CHANGES.md');
  });

  it('is where every agent entry point sends a customizing agent', () => {
    expect(read('AGENTS.md')).toContain('(CUSTOMIZE.md)');
    expect(read('CLAUDE.md').slice(0, 600)).toContain('(CUSTOMIZE.md)');
    // The engine's README is authored at docs/fork-readme.md and written out as
    // README.md in a fork; docs/ never travels, so derive which one this is.
    const readme = existsSync(join(ROOT, 'docs/fork-readme.md')) ? 'docs/fork-readme.md' : 'README.md';
    expect(read(readme)).toContain('(CUSTOMIZE.md)');
  });
});
