#!/usr/bin/env node
// Extract one module out of js/console-ui.js, per dev/console-module-plan.md.
//
// Lifts line ranges VERBATIM into js/console/<name>.js, then rewires the barrel:
// import back what console-ui.js still uses itself, `export *` the rest so the
// window bridge in dev/field-console.html keeps receiving every name the
// markup's inline on*= handlers call.
//
// Every range boundary is asserted against expected anchor text BEFORE any
// slicing, including anchors on the sections either side that must NOT move. A
// line number that has drifted therefore fails loudly instead of quietly moving
// the wrong code.
//
// Usage: node scripts/console-extract-module.mjs <config.json>
//
// Config shape (see the worked example in dev/console-module-plan.md):
//   module            module name, becomes js/console/<module>.js
//   ranges            [[startLine, endLine], ...] 1-based inclusive, in file order
//   anchors           [[line, regexSource, description], ...] asserted first
//   promoteToExport   names that were module-private but are called from code
//                     staying behind — they must become exports to survive the
//                     file boundary
//   externalImports   { './console-state.js': ['STATE'], ... } for the new file
//   header            the module's header comment
//   barrelComment     one line describing the module, left in console-ui.js
//   anchorAfter       exact text in console-ui.js to insert the import block after
//
// AFTER RUNNING: add the module to the import map in dev/field-console.html AND
// dev/sw.js SHELL_ASSETS, bump console-ui.js and the SW CACHE name, run
// `npm test`, and exercise the surfaces the moved code serves in a real browser.
// A dangling module-level const does not fail at load — it throws only when its
// line runs, which is how a dead asset library shipped past a green suite.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const src = readFileSync(`${ROOT}/js/console-ui.js`, 'utf8');
const lines = src.split('\n');
const at = (n) => lines[n - 1];

for (const [n, pattern, what] of cfg.anchors) {
  if (!new RegExp(pattern).test(at(n))) {
    throw new Error(`line ${n} is not ${what}\n  expected /${pattern}/\n  found:   ${JSON.stringify(at(n))}`);
  }
}

const slice = ([a, b]) => lines.slice(a - 1, b).join('\n');
let moved = cfg.ranges.map(slice).join('\n\n');

// Some moved functions were module-private but are called from code staying
// behind; they have to become exports to survive the file boundary.
for (const name of cfg.promoteToExport || []) {
  const re = new RegExp(`^(function|const|let|async function)\\s+${name}\\b`, 'm');
  if (!re.test(moved)) throw new Error(`cannot promote ${name} — no top-level declaration in the moved code`);
  moved = moved.replace(re, (m) => `export ${m}`);
}

const imports = Object.entries(cfg.externalImports || {})
  .map(([mod, names]) => `import { ${names.join(', ')} } from '${mod}';`)
  .join('\n');

for (const names of Object.values(cfg.externalImports || {})) {
  for (const n of names) {
    if (!new RegExp(`(^|[^.\\w$])${n}\\b`).test(moved)) throw new Error(`${n} is imported but unused by the moved code`);
  }
}

mkdirSync(`${ROOT}/js/console`, { recursive: true });
writeFileSync(`${ROOT}/js/console/${cfg.module}.js`, `${cfg.header}\n${imports}\n\n${moved}\n`);

// --- rewrite the barrel ---
const drop = new Set();
for (const [a, b] of cfg.ranges) for (let n = a; n <= b; n++) drop.add(n);
for (const [, b] of cfg.ranges) if (at(b + 1) === '') drop.add(b + 1);
const remainder = lines.filter((_, i) => !drop.has(i + 1)).join('\n');

const exported = [...moved.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
// LINE comments only — pairing-based stripping mis-pairs on an apostrophe in
// prose and silently under-reports, which would produce a barrel missing imports.
const remainderCode = remainder.replace(/^\s*\/\/[^\n]*$/gm, ' ');
const stillUsed = exported.filter((n) => new RegExp(`(^|[^.\\w$])${n}\\b`).test(remainderCode)).sort();

const block =
  `\n// ${cfg.barrelComment}\n` +
  (stillUsed.length ? `import {\n${stillUsed.map((n) => `  ${n},`).join('\n')}\n} from './console/${cfg.module}.js';\n` : '') +
  `export * from './console/${cfg.module}.js';\n`;

if (!remainder.includes(cfg.anchorAfter)) throw new Error(`anchor not found: ${JSON.stringify(cfg.anchorAfter)}`);
writeFileSync(`${ROOT}/js/console-ui.js`, remainder.replace(cfg.anchorAfter, cfg.anchorAfter + block));

console.log(`${cfg.module}: moved ${cfg.ranges.reduce((a, [x, y]) => a + (y - x + 1), 0)} lines`);
console.log(`  exports (${exported.length}): ${exported.join(', ')}`);
console.log(`  still used by the barrel (${stillUsed.length}): ${stillUsed.join(', ') || '(none)'}`);
