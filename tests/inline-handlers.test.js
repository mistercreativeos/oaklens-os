// Guards the console's inline on*= handler contract.
//
// Motivation, from a real regression: the asset-library filter pills, the sort
// toggle, and the FN// buffer-dates Clear button were all wired as
// `onclick="someModuleLet = value; rerender()"`. Inline handlers run in global
// scope and cannot see a module's `let`, so those assignments landed on a
// window property nothing read. Three controls did nothing, for months, with a
// green test suite. See tests/helpers/inline-handlers.js for the mechanics.
//
// These checks matter most while console-ui.js is being decomposed: splitting a
// module is exactly when an export gets dropped or a name stops being reachable.

import { describe, it, expect } from 'vitest';
import { scanInlineHandlers, globalNames } from './helpers/inline-handlers.js';

const scan = scanInlineHandlers();
const globals = globalNames();

describe('inline on*= handlers', () => {
  it('finds a meaningful number of handlers (scanner sanity)', () => {
    // Without a floor, a regex that silently stops matching would make every
    // other assertion in this file pass vacuously.
    expect(scan.handlerCount).toBeGreaterThan(150);
    expect(scan.calls.size).toBeGreaterThan(80);
    expect(globals.size).toBeGreaterThan(250);
  });

  it('every function an inline handler calls is reachable on window', () => {
    const unresolved = [...scan.calls.entries()]
      .filter(([name]) => !globals.has(name))
      .map(([name, files]) => `${name}  (used in ${[...files].join(', ')})`)
      .sort();

    expect(
      unresolved,
      'These names are invoked from inline on*= handlers but are not exported by ' +
      'any module on the bridge and are not a top-level global of a classic ' +
      'script. At runtime they are undefined and the control silently does ' +
      'nothing. Export the function, or route the handler through one that is.',
    ).toEqual([]);
  });

  it('no inline handler assigns to a bare identifier', () => {
    const offenders = [...scan.assigns.entries()]
      .map(([name, files]) => `${name}  (assigned in ${[...files].join(', ')})`)
      .sort();

    expect(
      offenders,
      'An inline on*= handler assigns to a bare identifier. Because handlers run ' +
      'in global scope, this cannot reach a module-scope binding — it just sets a ' +
      'window property nothing reads, and the control appears wired while doing ' +
      'nothing. Move the mutation into an exported setter and call that instead.',
    ).toEqual([]);
  });

  it('records handlers that cannot be checked statically', () => {
    // Runtime-assembled handlers (onclick="${onClick}") are legitimate but
    // opaque to this scanner. Keep the count pinned so new ones are a conscious
    // choice rather than a quiet way around the guard above.
    expect(scan.dynamic.length).toBeLessThanOrEqual(1);
  });
});
