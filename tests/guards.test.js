// Structural guards — cheap tests that keep three standing promises true:
//
//  1. The published site is dependency-free: no public page loads a script
//     from a third-party origin. The Field Console is the one exemption, for
//     exactly its two pinned, SRI'd libs (exifr + jszip).
//  2. Every nav destination in site.config.js is a page the site-in-a-ZIP
//     export carries (js/export-manifest.js), so exported nav links resolve
//     offline. `/dev` is the documented exception — the console needs the
//     live API and is deliberately not exported.
//  3. Cache discipline (manual §5): a js/css module is referenced with ONE
//     ?v= everywhere — the console bridge, dev/sw.js SHELL_ASSETS, cross-
//     module imports, public pages — so a bump can never be partial.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import siteConfig from '../site.config.js';
import { EXPORT_MANIFEST } from '../js/export-manifest.js';
import { buildRoutes } from '../js/site-export-core.js';
import { scanVersions } from './helpers/versions.js';

const ROOT = join(import.meta.dirname, '..');
// Everything in here describes SERVED markup — third-party scripts on public
// pages, mailto: placeholders, and `?v=` cache discipline — so the walk must
// see only what the origin actually serves. `docs/`, `tests/` and `dist/` are
// `.assetsignore`'d (and `docs/` does not even travel to the fork), and
// sweeping them was quietly wrong in both directions: repo-only HTML got
// judged as a public page, and — the one with teeth — `docs/os-drafts/*.html`
// carry their own frozen `css/main.css?v=N` links, so the next legitimate CSS
// bump would have failed the `?v=` consistency check on a file nobody serves.
// Same exclusion list `tests/no-payment-links.test.js` already uses.
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'docs', 'tests', 'dist']);

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (name.endsWith(ext)) out.push(relative(ROOT, p));
  }
  return out;
}

const htmlFiles = walk(ROOT, '.html');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('no third-party scripts on public pages', () => {
  // The console's two pinned libs — the only cross-origin scripts allowed
  // anywhere, and only in the console shell.
  const CONSOLE_ALLOWED = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(exifr|jszip)@/;

  it.each(htmlFiles.map((f) => [f]))('%s', (file) => {
    const externals = [...read(file).matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)]
      .map((m) => m[1])
      .filter((src) => /^(https?:)?\/\//i.test(src));
    if (file === join('dev', 'field-console.html')) {
      for (const src of externals) expect(src).toMatch(CONSOLE_ALLOWED);
    } else {
      expect(externals).toEqual([]);
    }
  });
});

describe('nav routes are exported pages', () => {
  const routes = buildRoutes(EXPORT_MANIFEST.pages);
  // The console lives behind the live API; the export neither carries nor
  // remaps /dev (see tests/site-export.test.js integration notes).
  const LIVE_ONLY = new Set(['/dev']);

  it('every site.config.js nav destination is in the export manifest', () => {
    for (const item of siteConfig.nav) {
      const path = item.href.split(/[?#]/)[0];
      if (LIVE_ONLY.has(path)) continue;
      expect(routes[path], `nav "${item.label}" → ${item.href}`).toBeTruthy();
    }
  });
});

describe('the About page keeps a way to reach the owner', () => {
  // The editorial redesign (2059933) replaced the vault layout and silently
  // took the contact controls with it, leaving only the nav envelope — the
  // site's only "hire me / talk to me" surface disappeared for weeks without
  // failing a single test. These are the guards that would have caught it.
  const about = () => read(join('about', 'index.html'));

  it('renders a contact block with a mailto action', () => {
    expect(about(), '.ab-contact block').toMatch(/class="[^"]*\bab-contact\b/);
    const inBody = about().slice(about().indexOf('<main'));
    expect(inBody, 'a mailto: action outside the nav').toMatch(/href="mailto:/);
  });

  it('wires every subscribe control it renders', () => {
    const ids = ['gtd-about-btn', 'gtd-about-panel', 'gtd-about-form',
                 'gtd-about-email', 'gtd-about-ok', 'gtd-about-err'];
    for (const id of ids) expect(about(), `#${id} in markup`).toContain(`id="${id}"`);

    // No inline handlers are possible under the strict CSP, so the controls are
    // only live if the page's module actually binds them.
    const js = read(join('js', 'page-about.js'));
    for (const id of ['gtd-about-btn', 'gtd-about-panel', 'gtd-about-email']) {
      expect(js, `#${id} bound in page-about.js`).toContain(id);
    }
    expect(js, 'submits through the shared helper').toContain('submitGTD(');
    expect(about(), 'page-about.js loaded').toMatch(/src="\/js\/page-about\.js\?v=\d+"/);
  });
});

describe('contact addresses stay neutral placeholders', () => {
  // Identity is edge-injected: src/edge/chrome.js rewrites every mailto: from
  // site.config.js `email`. A real address in served markup is an identity
  // leak into engine code AND breaks every fork (manual §2, CLAUDE.md).
  it.each(htmlFiles.map((f) => [f]))('%s', (file) => {
    for (const m of read(file).matchAll(/href="mailto:([^"?]*)/g)) {
      expect(m[1], 'hardcoded instance address').toBe('you@example.com');
    }
  });
});

describe('footer attribution stays edge-injected', () => {
  // The homepage footer's OS + webring chips are built by _footerChipsHtml and
  // injected into a neutral <span data-site-chips> hook. Before that, the chip
  // was static markup carrying a github.com URL — the last identity-shaped
  // string in served HTML, and the reason a fork's index.html differed from
  // the engine's. Keeping it injected means every fork serves the same bytes
  // and `poweredBy: false` can actually remove it.
  it('index.html carries the hook and no hardcoded chip', () => {
    const html = read('index.html');
    expect(html, 'the injection hook').toContain('data-site-chips');
    expect(html, 'chip markup belongs in src/edge/chrome.js').not.toContain('powered-chip');
    expect(html, 'no project URL in served markup').not.toContain('github.com');
  });
});

describe('?v= cache discipline', () => {
  // One scanner, shared with tests/version-bump.test.js. This file used to
  // carry its own copy whose character class was [\w-]+ — blind to any path
  // with a directory in it, so a js/console/*.js module would have been silently
  // skipped by the very guard meant to catch it. Two scanners that disagree is
  // worse than one, because the weaker one still reads as a pass.
  const scanFiles = [
    ...htmlFiles,
    ...walk(join(ROOT, 'js'), '.js').map((p) => p),
    join('dev', 'sw.js'),
  ];
  const seen = scanVersions((f) => { try { return read(f); } catch { return null; } }, scanFiles);

  /** dev/sw.js SHELL_ASSETS as Map('js/foo.js' → '3'); unversioned entries (fonts) are skipped. */
  const swAssets = () => {
    const block = read(join('dev', 'sw.js')).match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)[1];
    return new Map(
      [...block.matchAll(/'\/((?:js|css)\/[\w/-]+\.(?:js|css))\?v=(\d+)'/g)].map((m) => [m[1], m[2]])
    );
  };

  it('found the console bridge modules at all (regex sanity)', () => {
    expect(seen.has('js/console-ui.js')).toBe(true);
    expect(seen.has('css/field-console.css')).toBe(true);
  });

  it.each([...seen.keys()].map((k) => [k]))('%s carries one version everywhere', (base) => {
    const byVersion = seen.get(base);
    const detail = [...byVersion.entries()]
      .map(([v, files]) => `?v=${v} in ${files.join(', ')}`)
      .join(' · ');
    expect(byVersion.size, detail).toBe(1);
  });

  it('dev/sw.js SHELL_ASSETS matches the bridge versions exactly', () => {
    const swVersions = swAssets();
    expect(swVersions.size).toBeGreaterThan(0);
    for (const [base, version] of swVersions) {
      const byVersion = seen.get(base);
      expect(byVersion, `${base} is precached but never referenced`).toBeTruthy();
      expect([...byVersion.keys()], base).toEqual([version]);
    }
  });

  // The console resolves module versions through an import map, so that map is
  // the authority. A SW cannot read it, so SHELL_ASSETS restates it — and a
  // module precached at the wrong version is an offline copy of code the page
  // never runs. These two must be the same set, not merely overlapping.
  it('the import map and SHELL_ASSETS cover the same js modules at the same versions', () => {
    const bridge = read(join('dev', 'field-console.html'));
    const mapBlock = bridge.match(/<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/i);
    expect(mapBlock, 'no <script type="importmap"> in dev/field-console.html').toBeTruthy();

    const imports = JSON.parse(mapBlock[1]).imports;
    const mapped = new Map();
    for (const [key, value] of Object.entries(imports)) {
      const m = value.match(/^(\/(?:js|css)\/[\w/-]+\.(?:js|css))\?v=(\d+)$/);
      expect(m, `import map value "${value}" is not a versioned same-origin asset`).toBeTruthy();
      expect(m[1], `import map key "${key}" should point at its own path`).toBe(key);
      mapped.set(key.slice(1), m[2]);
    }

    const swJs = new Map([...swAssets()].filter(([p]) => p.startsWith('js/')));
    expect([...mapped.keys()].sort(), 'import map vs SHELL_ASSETS js entries').toEqual([...swJs.keys()].sort());
    for (const [path, version] of mapped) {
      expect(swJs.get(path), `${path}: import map says v${version}, SHELL_ASSETS says v${swJs.get(path)}`).toBe(version);
    }
  });

  // The regression guard for the cascade the import map exists to remove. A
  // versioned cross-module specifier means bumping that module edits this file
  // too, which changes its content, which forces it to bump — repeat up the
  // stack. One re-added ?v= quietly reintroduces that, so it is worth failing on.
  it('no js/ module imports another with a ?v= — versions belong in the import map', () => {
    const offenders = [];
    for (const file of walk(join(ROOT, 'js'), '.js')) {
      for (const m of read(file).matchAll(/from\s+['"](\.{1,2}\/[\w/-]+\.js)\?v=(\d+)['"]/g)) {
        offenders.push(`${file}: '${m[1]}?v=${m[2]}' — drop the ?v=, the import map carries it`);
      }
    }
    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
  });
});
