# Contributing

Thanks for your interest in the engine. It powers real sites that real people
publish their work from, so the bar is "does this help every fork," not any one
instance.

> **Working with an AI assistant?** Read [`CLAUDE.md`](CLAUDE.md) first — it's the
> agent working agreement: the engine-vs-instance model, the **Definition of
> Done** release gate (tests · cache-bust · docs · no identity leaks · deploy),
> and the stack's hard rules. The notes below are the human-facing "why."

## Mental model: engine vs. instance

This repo is the **engine** — the system. A live site is one **instance** of it,
and everything an instance changes lives in `site.config.js` (name, tagline,
contact, nav, location, CDN base, entity, heroes, support tiers). Everything
else derives from the request origin at runtime. Keep that boundary intact:

- **Never** put an instance's identity, content, or credentials in engine code.
  No real emails, coordinates, resource IDs, CDN domains, photos, or **payment
  links** in a PR. Where the money goes is identity too: a checkout URL in
  markup means a fork's supporters pay the original owner.
- New identity-shaped values belong in `site.config.js`, read at the edge — not
  hardcoded in a handler or a template.

## Ground rules

- **No build step.** The frontend is hand-authored HTML/CSS/JS and native ES
  modules; the Worker bundles at deploy time. Don't add a bundler or framework.
- **Storage tiers matter.** New *mutable* state goes in D1 (atomic single-row
  ops), large binary in R2, versioned content in git. Never add a new
  "JSON file as a database" blob.
- **Cache discipline.** `css/*` and `js/*` are served immutable. If you edit a
  module or the stylesheet, bump its `?v=` everywhere it's referenced — the
  `<link>`/`<script>` tags in every page that loads it, the console's import
  map in `dev/field-console.html`, and the service worker's asset list — then
  bump the service worker's `CACHE` name once for the whole change.
  **Not** on a cross-module `import` specifier: versions live in the import map
  precisely so bumping one module doesn't cascade edits up through everything
  that imports it, and `tests/guards.test.js` fails if one appears.
- **Security is load-bearing.** Privileged routes verify a scoped token; keep
  secrets in Worker bindings, never in the browser. Any new gate ships with a
  test for it.

## Workflow

1. Open an issue first for anything non-trivial so we can agree on the shape.
2. Fork, branch, keep the PR focused on one change.
3. `npm install`, then `npm test` — the suite must pass. CI also runs a
   `wrangler deploy --dry-run` build check.
4. Match the surrounding code's style; no reformatting-only diffs.

## Reporting security issues

Please don't open a public issue for vulnerabilities — see
[`SECURITY.md`](SECURITY.md).

## Code of conduct

Taking part here means agreeing to the [Code of Conduct](CODE_OF_CONDUCT.md).
The part specific to this project: most people opening an issue are
photographers, writers and artists, not developers. A step that confused
someone is a bug in the docs, not a failure of the person who got stuck on it.
