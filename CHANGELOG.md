# Changelog

What changed in the engine, and whether you have to do anything about it.

**How to read this.** Your site is a fork, and you take updates by merging:

```bash
git fetch upstream
git merge upstream/main
```

There are no released versions to pin to, so a merge brings you everything
since the last one. Skim the entries above the date you last merged, look for
the flag below, then merge.

> ⚠️ **ACTION REQUIRED** marks the only entries you cannot ignore. Everything
> else is safe to merge and forget: it either changes nothing you touch, or it
> is a fix you want. If an entry needs you to create a Cloudflare resource,
> edit your config, or change a setting, it says so in the entry and tells you
> what to run.

Two files conflict on every merge, always, and that is by design:
`site.config.js` and `wrangler.jsonc` hold your identity and your Cloudflare
resources. Keep yours. [setup.md](setup.md) has the exact commands.

---

## 2026-08-08

The engine repository went public. Everything below shipped alongside that.

### Your config is now forward-compatible

New config keys can no longer break your site. The engine reads
`site.config.js` through a defaults layer (`src/shared/config.js`), so any key
it gains in future resolves to a sensible default on configs written before
that key existed.

This matters because the merge that brings you engine updates deliberately
never touches your `site.config.js`. Before this, a new key the engine read
directly would have been missing from your file, and a missing key on the
page-rendering path is a site-wide error delivered by a merge that reported no
conflicts at all. `location` was one read that way.

Nothing to do. Your existing config keeps working exactly as it did, and every
value you set still wins over the default.

### `npm test` works on current Node

Node 24 and newer define their own empty `localStorage`, which shadowed the one
the test environment installs and made two console test files fail to load on a
fresh clone. The suite is green on Node 22 through 26 now. This also un-skipped
30 tests that had been quietly skipping.

### Windows setup is documented properly

The setup scripts are shell scripts, so they need **Git Bash** (which comes
with [Git for Windows](https://git-scm.com/downloads)) or WSL. PowerShell
cannot run them and fails with an error that explains nothing. Git is now
listed as a prerequisite as well, since step one of the install clones a repo.

If you installed on Windows and got stuck at `bash scripts/setup.sh`, that was
this, and it was our documentation's fault rather than yours.

### Community docs

`CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) and a rewritten `README.md`.
`CONTRIBUTING.md` had a cache-discipline instruction that contradicted a test
the CI actually runs: it told you to put a `?v=` on cross-module `import`
specifiers, which `tests/guards.test.js` fails on. Versions belong in the
import map. Corrected.

---

## Before this

The engine ran as a single private instance. Its history up to this point is in
the commit log rather than here.
