// THE MOBILE DEPLOY CONTRACT.
//
// "Deploy from your phone" was certified on 2026-10-08 (K100) by a real phone
// install: the Deploy button, the console, Turn on Publish with a key made on
// GitHub's mobile site, and a camera-roll photo published and live, with no
// Cloudflare dashboard and no code edit. That run is the proof; this file is
// what keeps it true. Each block is one step a phone owner takes, pinned to
// what makes that step work. If one goes red, the claim is at risk: fix the
// step, or re-run the phone install before claiming it again (CLAUDE.md).
//
// Derived, not hard-coded, where a fork differs: the os/ pages and the claim
// rules live only in the source repo (tests/helpers/instance.js).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { IS_INSTANCE } from './helpers/instance.js';
import { deployArgs } from '../scripts/deploy.mjs';
import { DEMO_LOCKED_ROUTES } from '../worker.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('1. the Deploy button can install it from a phone', () => {
  it('asks for the console password on the setup screen, never with a default', () => {
    const lines = read('.dev.vars.example').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    expect(lines).toEqual(['AUTH_PASSWORD=']);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.cloudflare.bindings.AUTH_PASSWORD.description).toMatch(/password/i);
  });

  it('provisions its own storage: KV, D1 (with migrations), R2', () => {
    const cfg = strip(read('wrangler.example.jsonc'));
    expect(cfg).toMatch(/"kv_namespaces"/);
    expect(cfg).toMatch(/"d1_databases"[\s\S]*"migrations_dir":\s*"migrations"/);
    expect(cfg).toMatch(/"r2_buckets"/);
  });

  it('deploys with npm run deploy: migrations, then the stamping deploy', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.deploy).toBe('npm run db:migrate && node scripts/deploy.mjs');
  });
});

describe('2. the build says the site is connected (no site.config.js edit)', () => {
  it('stamps REPO_CONNECTED and GIT_REPO on Cloudflare\'s builds', () => {
    expect(deployArgs({ WORKERS_CI: '1' }, 'https://github.com/ada/my-studio.git'))
      .toEqual(['wrangler', 'deploy', '--var', 'REPO_CONNECTED:true', '--var', 'GIT_REPO:ada/my-studio']);
  });

  it('the site reads the stamp', () => {
    expect(read('src/api/site-meta.js')).toMatch(/env\.REPO_CONNECTED\)\s*===\s*'true'/);
  });
});

describe('3. Publish is turned on from the console (no dashboard)', () => {
  const html = read('dev/field-console.html');

  it('the key routes exist, and a demo cannot write them', () => {
    const worker = read('worker.js');
    for (const r of ['GET /api/publish/key', 'PUT /api/publish/key', 'DELETE /api/publish/key']) {
      expect(worker, r).toContain(`'${r}'`);
    }
    expect(DEMO_LOCKED_ROUTES.has('PUT /api/publish/key')).toBe(true);
    expect(DEMO_LOCKED_ROUTES.has('DELETE /api/publish/key')).toBe(true);
  });

  it('the welcome card offers it first', () => {
    const card = html.slice(html.indexOf('id="welcome-card"'), html.indexOf('id="publish-key-sheet"'));
    const first = card.slice(card.indexOf('<li>'), card.indexOf('</li>'));
    expect(first).toMatch(/Turn on Publish/);
    expect(first).toMatch(/openPublishKey\(\)/);
  });

  it('the sheet\'s link makes the right key, in a new tab', () => {
    const sheet = html.slice(html.indexOf('id="publish-key-sheet"'));
    const href = sheet.match(/id="pk-make" href="([^"]+)"/)[1].replace(/&amp;/g, '&');
    const u = new URL(href);
    expect(u.origin + u.pathname).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(u.searchParams.get('contents')).toBe('write');
    expect(Number(u.searchParams.get('expires_in'))).toBeLessThanOrEqual(365);   // 366 is refused
    expect(sheet).toMatch(/id="pk-make"[^>]*target="_blank"[^>]*rel="noopener"/);
  });

  it('the sheet says the one manual choice, and where the key goes', () => {
    const sheet = html.slice(html.indexOf('id="publish-key-sheet"'));
    expect(sheet).toMatch(/Only select repositories/);
    expect(sheet).toMatch(/only to this site/);
    expect(sheet).toMatch(/Paste/);
  });

  it('a Publish with no key opens the sheet instead of failing', () => {
    expect(read('js/console/publish.js')).toMatch(/dispatchEvent\(new CustomEvent\('publish:needs-key'\)\)/);
    expect(read('js/console/session.js')).toMatch(/addEventListener\('publish:needs-key'/);
  });

  it('Publish and sync take the console\'s key', () => {
    const pub = read('src/api/publish.js');
    expect(pub).toMatch(/import \{ githubCreds \} from '\.\/publish-key\.js'/);
    expect(pub).not.toMatch(/env\.GITHUB_TOKEN/);
  });
});

describe('4. the instructions say the phone path', () => {
  it('setup.md: open the console, turn on Publish there', () => {
    const s = read('setup.md');
    expect(s).toMatch(/Turn on Publish, from the console/);
    expect(s).toMatch(/Only select repositories/);
  });

  it.skipIf(!IS_INSTANCE)('os/setup: the console path, the one manual choice', () => {
    const s = read('os/setup/index.html');
    expect(s).toMatch(/Turn on Publish, in the console/);
    expect(s).toMatch(/Only select repositories/);
    expect(s).toMatch(/expires_in=365/);
  });

  it.skipIf(!IS_INSTANCE || !existsSync(join(ROOT, 'docs/os-positioning.md')))('the claim rules say it is certified, with its rider', () => {
    const s = read('docs/os-positioning.md');
    expect(s).toMatch(/"deploy from your phone" is now true \(certified 2026-10-08, K100\)/);
    expect(s).toMatch(/R2 switched on first/);
  });
});
