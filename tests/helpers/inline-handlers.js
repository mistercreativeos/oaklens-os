// Shared scanner for inline `on*=` event handlers.
//
// The console binds most of its UI through inline on*= attributes — both in
// dev/field-console.html and in HTML strings built at runtime inside js/*.js.
// Those handlers execute in GLOBAL scope, so every identifier they name has to
// exist on `window`. The ES-module bridge at the bottom of field-console.html
// is what puts them there (`Object.assign(window, ...namespaces)`), which means
// only *exported* bindings are reachable.
//
// Two failure modes follow, and neither one throws anywhere a human would see:
//
//   1. A handler calls a function that was never exported -> undefined at click
//      time. The button silently does nothing.
//   2. A handler ASSIGNS to a module-scope binding (`onclick="filter='x'"`).
//      Global scope cannot see a module's `let`, so this quietly creates a
//      same-named property on window that no module code ever reads. The
//      control appears wired and changes nothing.
//
// Both stay invisible to a test suite that never opens a browser, and both get
// dramatically more likely as console-ui.js is split into modules. This scanner
// is the mechanical check.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const ROOT = join(import.meta.dirname, '../..');

// `docs/` is skipped for the same reason tests/guards.test.js skips it: it never
// travels to a fork, it is `.assetsignore`'d, and nothing in it is served. What
// it DOES hold is design artifacts — owner-written HTML specimens and interface
// mockups, kept verbatim as records. Those are not the app, and scanning them
// produces only false positives: a mockup handler like
// `onclick="loadRecent('📸', 'Chasing light. Losing my mind.', …)"` makes the
// scanner read `mind` and `light` as unreachable function calls. This guard
// exists to protect the console and the public pages; an archived mockup is
// neither, and it must not be able to fail the suite.
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'coverage', 'docs']);

// on<event>="..." / on<event>='...'. Inside a JS template literal the quote is
// backslash-escaped, so allow an optional leading backslash.
const HANDLER_RE = /\bon[a-z]+\s*=\s*\\?"([^"]*)"|\bon[a-z]+\s*=\s*\\?'([^']*)'/g;

// Names the inline-handler scope chain resolves without help from the bridge:
// language keywords/literals, JS builtins, and the DOM globals in scope.
const AMBIENT = new Set([
  // supplied to every inline handler
  'this', 'event',
  // keywords + literals
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
  'continue', 'return', 'typeof', 'instanceof', 'new', 'delete', 'void', 'in',
  'of', 'let', 'const', 'var', 'function', 'class', 'try', 'catch', 'finally',
  'throw', 'true', 'false', 'null', 'undefined', 'async', 'await', 'yield',
  // builtins
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'Set', 'Map', 'WeakMap', 'WeakSet', 'Promise', 'RegExp', 'Error', 'Symbol',
  'BigInt', 'Intl', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  // DOM / host globals
  'window', 'document', 'console', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'alert',
  'confirm', 'prompt', 'fetch', 'FormData', 'URL', 'URLSearchParams', 'Blob',
  'File', 'FileReader', 'Image', 'AbortController', 'CustomEvent', 'Event',
  'getComputedStyle', 'scrollTo', 'open', 'close', 'print',
]);

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (name.endsWith(ext)) out.push(relative(ROOT, p).replace(/\\/g, '/'));
  }
  return out;
}

export function htmlFiles() { return walk(ROOT, '.html').sort(); }
export function jsFiles() { return walk(join(ROOT, 'js'), '.js').sort(); }

/**
 * True if the match at `index` sits on a line that is a `//` or `*` comment.
 * Deliberately line-based rather than a full comment stripper: this codebase is
 * full of `FN//` and `https://` inside real strings, and a global strip would
 * eat live code.
 */
function onCommentLine(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  return /^\s*(\/\/|\*|\/\*)/.test(text.slice(start, index));
}

/** Identifiers a single handler body needs to find in global scope. */
export function analyzeHandler(body) {
  // A handler that is nothing but an interpolation (onclick="${onClick}") is
  // assembled at runtime and cannot be resolved statically.
  if (/^\s*\$\{[^}]*\}\s*$/.test(body)) return { calls: [], assigns: [], dynamic: true };

  // Blank interpolated expressions: their contents are module-scope JS spliced
  // in as a value, not names the handler itself must resolve.
  const src = body.replace(/\$\{[^}]*\}/g, '_');

  const calls = new Set();
  const assigns = new Set();

  // Bare call — foo(
  for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(m[2]);
  // Rooted member access — Foo.bar(...) needs `Foo` on window
  for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\./g)) calls.add(m[2]);
  // Bare assignment — foo = ... (excluding ==, ===, =>, and obj.prop = ...)
  for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*=(?!=|>)/g)) assigns.add(m[2]);

  for (const s of [calls, assigns]) for (const n of s) if (AMBIENT.has(n)) s.delete(n);
  return { calls: [...calls], assigns: [...assigns], dynamic: false };
}

/**
 * Scan the repo for inline handlers.
 * @returns {{calls: Map<string,Set<string>>, assigns: Map<string,Set<string>>,
 *            dynamic: Array<[string,string]>, handlerCount: number}}
 */
export function scanInlineHandlers(files = [...htmlFiles(), ...jsFiles()]) {
  const calls = new Map();
  const assigns = new Map();
  const dynamic = [];
  let handlerCount = 0;

  for (const rel of files) {
    let text;
    try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(HANDLER_RE)) {
      const body = m[1] ?? m[2] ?? '';
      if (!body.trim()) continue;
      if (onCommentLine(text, m.index)) continue;
      handlerCount++;
      const got = analyzeHandler(body);
      if (got.dynamic) { dynamic.push([rel, body]); continue; }
      for (const n of got.calls) { if (!calls.has(n)) calls.set(n, new Set()); calls.get(n).add(rel); }
      for (const n of got.assigns) { if (!assigns.has(n)) assigns.set(n, new Set()); assigns.get(n).add(rel); }
    }
  }
  return { calls, assigns, dynamic, handlerCount };
}

/** Top-level declarations of a classic (non-module) script become globals. */
function addClassicTopLevel(text, names) {
  for (const m of text.matchAll(/^(?:async\s+)?function\s*\*?\s*([\w$]+)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^(?:const|let|var|class)\s+([\w$]+)/gm)) names.add(m[1]);
}

/**
 * Every name that ends up on `window` at runtime.
 *
 * Three sources: ES modules reachable through the bridge contribute their
 * `export`ed bindings; classic scripts (`<script src>` with no type=module)
 * contribute their top-level declarations; and inline `<script>` blocks in the
 * HTML do the same, provided they are not `type="module"` (a module's top level
 * is its own scope, not the global one).
 */
export function globalNames(files = jsFiles(), pages = htmlFiles()) {
  const names = new Set();

  for (const rel of pages) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const [, attrs, code] = m;
      if (/type\s*=\s*["']?module/i.test(attrs)) continue; // module scope, not global
      if (/\bsrc\s*=/i.test(attrs)) continue;              // external file, scanned below
      addClassicTopLevel(code.replace(/^\s*\n/, ''), names);
    }
  }

  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    const isModule = /^\s*(export|import)\s/m.test(text);
    if (isModule) {
      for (const m of text.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)/gm)) names.add(m[1]);
      for (const m of text.matchAll(/^export\s+(?:const|let|var|class)\s+([\w$]+)/gm)) names.add(m[1]);
      // export { a, b as c }
      for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const part of m[1].split(',')) {
          const alias = part.trim().split(/\s+as\s+/).pop().trim();
          if (alias) names.add(alias);
        }
      }
    } else {
      addClassicTopLevel(text, names);
    }
  }
  return names;
}
