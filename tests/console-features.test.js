// @vitest-environment happy-dom
//
// Config-gated console surfaces (`site.config.js` -> `console: { … }`).
//
// The bench is the case this was built for: a working, auth-gated console
// surface whose only feeder is `scripts/bench-upload.sh` — instance tooling
// that does not travel with the engine. A fork inherited a BENCH tab it could
// never put a frame into, which is a bug report waiting to happen in the very
// QA round the launch plan exists to collect (docs/bench-decision.md). It comes
// back as a designed v2; until then the config decides who sees it.
//
// The switch is OPT-IN, which is the opposite of pages{} where a missing key
// means enabled — a fork's config says nothing about `console`, so a fork ships
// without the surface. That inversion is the thing most likely to be "fixed"
// by someone reading fast, so it is pinned here from both directions.
//
// HTMLRewriter only exists on the Workers runtime, so the injection is driven
// through the same stand-in tests/support-config.test.js uses, plus one real
// boot of the console with the gated markup removed — because "the tab is
// hidden" is worthless if the console it leaves behind throws on startup.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import siteConfig from '../site.config.js';
import exampleConfig from '../site.config.example.js';
import { IS_INSTANCE } from './helpers/instance.js';
import { injectSiteChrome, injectConsoleFeatures, consoleFeatureOn } from '../src/edge/chrome.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const HOOK = 'data-console-feature';
const consoleHtml = read('dev/field-console.html');

// In an extracted tree the example IS the installed config, so there is no
// instance to make instance-shaped assertions about.
// IS_INSTANCE lives in a helper — see tests/helpers/instance.js for why it is
// NOT "site.config.js differs from the example" any more.

// ---- HTMLRewriter stand-in (records handlers, runs the matching one) --------

function fakeRewriter() {
  const handlers = [];
  return {
    on(selector, h) { handlers.push({ selector, h }); },
    element(selector) {
      return handlers.find((x) => x.selector === selector && x.h.element)?.h.element;
    },
    has(selector) { return handlers.some((x) => x.selector === selector); },
  };
}

function fakeElement(attrs = {}) {
  const map = new Map(Object.entries(attrs));
  return {
    removed: false,
    getAttribute: (k) => (map.has(k) ? map.get(k) : null),
    setAttribute(k, v) { map.set(k, String(v)); },
    removeAttribute(k) { map.delete(k); },
    remove() { this.removed = true; },
    has: (k) => map.has(k),
  };
}

/** Run the gate over one hooked element and report what happened to it. */
function gate(feature, features, register = (rw) => injectConsoleFeatures(rw, features)) {
  const rw = fakeRewriter();
  register(rw);
  const handler = rw.element(`[${HOOK}]`);
  expect(handler, 'no handler registered for the console-feature hook').toBeTruthy();
  const el = fakeElement({ [HOOK]: feature });
  handler(el);
  return el;
}

// ---------------------------------------------------------------------------

describe('the gate is opt-in', () => {
  it('keeps a surface the config explicitly turns on, and strips the hook', () => {
    const el = gate('bench', { bench: true });
    expect(el.removed, 'an enabled surface must survive').toBe(false);
    expect(el.has(HOOK), 'the hook is consumed, like every other edge hook').toBe(false);
  });

  it.each([
    ['switched off', { bench: false }],
    ['a console block that never mentions it', { wall: true }],
    ['an empty console block', {}],
    // `null`, not `undefined`: the parameter default only fires on undefined,
    // so production's missing-block case (siteConfig.console absent ->
    // `(features || {})`) lands on the same guard this does.
    ['no console block at all', null],
  ])('removes the surface with %s', (_label, features) => {
    expect(gate('bench', features).removed).toBe(true);
  });

  it('takes only an explicit true — no truthy near-misses', () => {
    // pages{} reads `=== false`; this reads `=== true`. Both are exact on
    // purpose: a half-typed value must fall to the SAFE side, and for an
    // opt-in switch the safe side is off.
    for (const value of ['true', 'yes', 1, {}]) {
      expect(consoleFeatureOn('bench', { bench: value }), JSON.stringify(value)).toBe(false);
    }
    expect(consoleFeatureOn('bench', { bench: true })).toBe(true);
  });

  it('removes a surface whose name nothing in the config knows', () => {
    expect(gate('typo-in-the-markup', { bench: true }).removed).toBe(true);
  });
});

describe('the shipped configs', () => {
  it('the example config — what a fork installs — does not enable the bench', () => {
    // scripts/os-extract.mjs copies site.config.example.js over as the fork's
    // site.config.js, so this file IS the fork's answer.
    expect(consoleFeatureOn('bench', exampleConfig.console),
      'a fork would get a BENCH tab it can never fill').toBe(false);
  });

  it.skipIf(!IS_INSTANCE)('this instance enables it — the CLI → B2 → D1 path is live', () => {
    expect(consoleFeatureOn('bench', siteConfig.console)).toBe(true);
  });

  it('documents every hook the markup uses as a switch a fork can read', () => {
    // A `data-console-feature` value with no matching key is markup that gets
    // deleted on every instance and never comes back — silent, and invisible
    // in a diff. Tying the hooks to the example config's keys means adding a
    // gated surface forces documenting its switch where forks actually look.
    const used = [...new Set(
      [...consoleHtml.matchAll(new RegExp(`${HOOK}="([^"]+)"`, 'g'))].map((m) => m[1])
    )];
    expect(used, 'no console-feature hooks found — the selector or the markup moved').toContain('bench');
    expect(Object.keys(exampleConfig.console || {}).sort())
      .toEqual(expect.arrayContaining(used.sort()));
  });
});

describe('every bench entry point in the shell is hooked', () => {
  // Three nav surfaces share the data-view contract (sidebar, More sheet, the
  // view itself). Missing one leaves a fork a live button into a missing view.
  it.each([
    ['sidebar tab', /<button[^>]*class="nav-btn"[^>]*data-view="bench"/],
    ['More-sheet item', /<button[^>]*class="sheet-item"[^>]*data-view="bench"/],
    ['the view section', /<section[^>]*id="view-bench"/],
  ])('%s carries the hook', (_label, re) => {
    const tag = consoleHtml.match(re);
    expect(tag, 'markup moved — this bench entry point no longer matches').not.toBeNull();
    // The hook may sit before or after the matched attributes, so re-read the
    // whole tag rather than trusting attribute order.
    const whole = consoleHtml.slice(tag.index, consoleHtml.indexOf('>', tag.index) + 1);
    expect(whole, whole).toContain(`${HOOK}="bench"`);
  });

  it('leaves no other bench control loose in the shell', () => {
    // Every bench-owned control lives inside #view-bench (which the gate takes
    // whole), except the two nav entries above. A new one outside them would
    // survive the gate and call into a module with no DOM to draw on.
    const view = consoleHtml.slice(
      consoleHtml.indexOf('<section class="view" id="view-bench"'),
      consoleHtml.indexOf('<section class="view" id="view-publish"')
    );
    expect(view.length, '#view-bench not found where expected').toBeGreaterThan(500);
    const outside = consoleHtml.replace(view, '');
    const loose = [...outside.matchAll(/on\w+="([^"]*[Bb]ench[^"]*)"/g)].map((m) => m[1])
      .filter((h) => !/^(showView|sheetGo)\('bench'\)$/.test(h));
    expect(loose, 'a bench control outside #view-bench and outside the gated nav entries').toEqual([]);
  });
});

describe('the gate is wired into the real request path', () => {
  it('injectSiteChrome registers it, unconditionally', () => {
    // Unconditional like injectSupport: the console shell and the 404 body go
    // through the same rewriter, and the selector simply does not match on a
    // page that has no hooks.
    const rw = fakeRewriter();
    injectSiteChrome(rw, new URL('https://example.test/dev/field-console'));
    expect(rw.has(`[${HOOK}]`)).toBe(true);
  });

  it('uses the installed config when none is passed', () => {
    const el = gate('bench', undefined, (rw) => injectSiteChrome(rw, new URL('https://example.test/')));
    expect(el.removed).toBe(!consoleFeatureOn('bench'));
  });

  it('no public page carries a hook for it to catch', () => {
    for (const page of ['index.html', '404.html', 'about/index.html', 'archive/index.html']) {
      expect(read(page), page).not.toContain(HOOK);
    }
  });

  it('gates the shell only — the API routes stay mounted', () => {
    // The bench API is Bearer-gated and answers nobody without the console
    // token. Gating it here too would put a second, weaker authorization story
    // beside the real one, and would break this instance's CLI feeder.
    const worker = read('worker.js');
    for (const route of ['GET /api/bench', 'POST /api/bench/entries', '/api/bench/raw/']) {
      expect(worker, route).toContain(route);
    }
    expect(worker, 'the router must not learn about console feature flags')
      .not.toContain('consoleFeatureOn');
  });
});

// ---------------------------------------------------------------------------
// What a fork's console actually does with the surface gone.
//
// Hiding a tab is easy; the risk is what the removal leaves behind — a router
// seeded from a view that is not there, a stage-indicator sweep reaching for a
// count element, an init() that throws before wiring anything. That failure
// would be invisible to every assertion above.

describe('the console boots with the surface removed', () => {
  const bootErrors = [];
  let win;

  beforeAll(async () => {
    globalThis.fetch = async () =>
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });

    // The shell as a fork receives it: the edge has taken the hooked elements.
    const body = consoleHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
    const gated = [...document.querySelectorAll(`[${HOOK}]`)];
    expect(gated.length, 'nothing to remove — the markup lost its hooks').toBeGreaterThan(0);
    for (const el of gated) el.remove();

    window.addEventListener('error', (e) => bootErrors.push(e.message));

    // The window bridge, read out of the page itself (same as console-boot).
    const script = consoleHtml.match(/<script\s+type=["']module["'][^>]*>([\s\S]*?)<\/script>/i)[1];
    const specs = [...script.matchAll(/import\s+\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const mods = [];
    for (const spec of specs) mods.push(await import(/* @vite-ignore */ `..${spec}`));
    Object.assign(window, ...mods);
    win = window;

    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((r) => setTimeout(r, 0));
  });

  it('boots without throwing', () => {
    expect(bootErrors).toEqual([]);
  });

  it('came up — init() ran to the end', () => {
    expect(document.getElementById('sync-status').textContent).toBe('// Log in to enable auto-sync');
  });

  it('has no bench tab, sheet item or view left', () => {
    expect(document.querySelector('[data-view="bench"]'), 'a live button into a missing view').toBeNull();
    expect(document.getElementById('view-bench')).toBeNull();
    expect(document.getElementById('nav-count-bench')).toBeNull();
  });

  it('still routes between the surfaces that remain', () => {
    win.showView('archive');
    expect(document.querySelector('.view.active')?.id).toBe('view-archive');
    win.showView('buffer');
    expect(document.querySelector('.view.active')?.id).toBe('view-buffer');
  });

  it('keeps the stage indicators sweeping every count that IS there', () => {
    // refreshStageIndicators() reads its sidebar counts unguarded. Bench was
    // never in that list — this is the guard for the next surface that is.
    expect(() => win.refreshStageIndicators()).not.toThrow();
  });

  it('leaves the registered renderer inert rather than reachable', () => {
    // init.js still registers "bench" (the module travels with the engine —
    // gating is config, not surgery). Nothing can route to it, and asking the
    // router to redraw a surface with no DOM must not throw either.
    expect(win._registeredViews()).toContain('bench');
    expect(() => win.showView('bench')).not.toThrow();
  });
});

// The signal that decides whether instance-only assertions run at all.
//
// It used to be `site.config.js !== site.config.example.js`. An extracted tree
// ships those identical, so "they differ" read as "someone configured this" —
// and setup.sh's closing instructions tell a brand new owner, as step 1, to open
// site.config.js and put their name in it. The moment they did, instance-only
// tests began running against their config, and `doctor.sh` (which runs the
// suite) reported "Some internal checks failed" to someone who had done nothing
// wrong. Found on the first real fork deploy, 2026-08-07.
describe('IS_INSTANCE survives a fork personalising its config', () => {
  const helper = readFileSync(join(ROOT, 'tests', 'helpers', 'instance.js'), 'utf8');

  // Stated so it holds in BOTH kinds of tree — this file travels, so a guard
  // that only makes sense in the source repo just fails in every fork, which
  // is the same class of bug it is here to prevent.
  it('tracks whether the extractor is present, whichever tree this is', () => {
    expect(IS_INSTANCE).toBe(existsSync(join(ROOT, 'scripts', 'os-extract.mjs')));
  });

  it('does not derive from site.config.js, which every fork edits on day one', () => {
    const code = helper.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code, 'IS_INSTANCE must not read site.config.js').not.toMatch(/site\.config/);
  });

  it('names no private repo, since this file travels to every fork', () => {
    // A literal instance name here is an identity leak into engine code — the
    // gate in tests/os-extract.test.js rejects it, which is how the first
    // attempt at this helper was caught.
    expect(helper).not.toMatch(/oaklens-(site|cdn|portal)/);
  });
});
