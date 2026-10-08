// @vitest-environment happy-dom
// EVERY OVERLAY IS A CHILD OF THE BODY (K50e, 2026-10-05). K50c removed the
// Settings window's Display section and one closing </div> with it. The
// browser closed the Settings body at the end of the document instead, so
// every overlay written after it — the asset library, the audio library, the
// focal-point / card-crop window — was parsed INSIDE the Settings overlay,
// which is display:none whenever Settings is closed. They opened at 0×0:
// on the owner's iPad, FN's PICTURE and AUDIO did nothing. Nothing failed,
// because nothing looked at the document's shape. This does, by parsing the
// shell the way a browser does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HTML = readFileSync(join(process.cwd(), 'dev', 'field-console.html'), 'utf8');

describe('the console shell parses into the shape it was written in', () => {
  const doc = new DOMParser().parseFromString(HTML, 'text/html');

  it('finds the overlays at all (a guard on the scan)', () => {
    const overlays = doc.querySelectorAll('.modal-overlay, .sheet-overlay');
    expect(overlays.length).toBeGreaterThanOrEqual(6);
    for (const id of ['settings-modal', 'asset-library-modal', 'audio-library-modal']) {
      expect(doc.getElementById(id), id).toBeTruthy();
    }
  });

  it('no overlay is nested in another — each one is a direct child of <body>', () => {
    for (const ov of doc.querySelectorAll('.modal-overlay, .sheet-overlay')) {
      const parent = ov.parentElement;
      const where = parent ? `${parent.tagName.toLowerCase()}${parent.id ? '#' + parent.id : ''}` : 'nothing';
      expect(where, `#${ov.id} is inside ${where}`).toBe('body');
    }
  });

  it('the Settings window holds its own parts and nothing else\'s', () => {
    const settings = doc.getElementById('settings-modal');
    // Close and Log out lead the sheet, large (2026-10-06); everything else folds.
    expect(settings.querySelector('.settings-actions')).toBeTruthy();
    expect(settings.querySelectorAll('.settings-actions .settings-action')).toHaveLength(2);
    expect(settings.querySelectorAll('details.settings-fold').length).toBeGreaterThanOrEqual(4);
    expect(settings.querySelector('details.settings-fold[open]')).toBeNull();
    expect(settings.querySelector('#settings-build-details')).toBeTruthy();
    expect(settings.querySelectorAll('.modal-overlay, .sheet-overlay')).toHaveLength(0);
  });
});
