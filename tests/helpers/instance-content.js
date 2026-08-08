// Is this checkout carrying real content, or is it a bare engine?
//
// A handful of guards assert things about *this instance's* photos and posts —
// that every published field note survives the markdown engine, that the export
// manifest expands to a plausible media set, that the recent-work grid picks
// sensible items. They are good tests and worth keeping. They are also
// meaningless in the extracted `oaklens-os` tree, which ships no content by
// design, and a fresh fork whose CI is red on clone is both a bad first
// impression and a direct contradiction of the "an AI can maintain this"
// claim — agents are instructed never to ship on a red suite.
//
// So those guards skip *visibly* when the fixture they need is absent, rather
// than failing or — worse — quietly asserting nothing.
//
// The distinction being drawn:
//   engine behaviour   -> always runs (the markdown engine's own dialect, the
//                         export rewriter's URL math, the entity JSON-LD shape)
//   instance content   -> runs only where content exists

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

/** Published field notes on disk (`posts/*.md`). The CC0 sample note is
 * ENGINE, not content — it travels to every fork (manual §5.21), so counting
 * it would turn the instance-content guards back on in the extracted tree. */
export function hasPosts() {
  const dir = join(ROOT, 'posts');
  return existsSync(dir)
    && readdirSync(dir).some((f) => f.endsWith('.md') && f !== 'fn-sample.md');
}

/** A `data/*.json` file that exists and holds at least one entry. */
export function hasData(file) {
  const p = join(ROOT, 'data', file);
  if (!existsSync(p)) return false;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed);
  } catch {
    return false;
  }
}

/** True when this checkout has instance content at all. */
export const HAS_CONTENT = hasPosts();
