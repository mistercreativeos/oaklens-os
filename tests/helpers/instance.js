// Is this checkout the source repo, or an extracted fork?
//
// A handful of tests assert things that are only true in the source instance —
// that the bench console surface is switched on, that this config's real
// support tiers are not also sitting in the shipped example. They have to skip
// in a fork, or the fork's own suite fails on somebody else's facts.
//
// The old signal was `site.config.js !== site.config.example.js`. An extracted
// tree ships those two identical, so "they differ" read as "someone configured
// this" — which is wrong in the worst possible place, because setup.sh's
// closing instructions tell a brand new owner, as step 1:
//
//     1. Put your name on it
//        Open site.config.js and fill in your name, tagline, email and location.
//
// The moment they did, instance-only tests began running against their config,
// and `doctor.sh` (which runs the suite) reported "Some internal checks failed"
// to someone who had done exactly what they were told — a false alarm at the
// precise moment they are deciding whether to trust any of this. Found on the
// first real fork deploy, 2026-08-07.
//
// The signal is now the presence of the EXTRACTOR ITSELF. `scripts/os-extract.mjs`
// is the tool that builds forks, and it deliberately excludes itself from its
// own output — so "this tree can produce a fork" is exactly "this tree is not
// one". Two things make it sturdy: no user edit can flip it, and the absence is
// already pinned from the other side by tests/os-extract.test.js, which asserts
// the extractor must not ship.
//
// Deliberately NOT the package name: naming the private repo here would put
// that string into a file that travels, which the identity gate rejects — and
// a forker renaming their own package would flip it anyway.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

/** True only in the source repo; false in any extracted fork. */
export const IS_INSTANCE = existsSync(join(ROOT, 'scripts', 'os-extract.mjs'));
