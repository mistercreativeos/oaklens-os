<!-- Keep PRs focused on one change. See CONTRIBUTING.md. -->

## What & why

<!-- What does this change, and what problem does it solve? Link an issue if there is one. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Docs
- [ ] Refactor / internal (no behavior change)

## Testing

<!-- How did you verify this? -->

- [ ] `npm test` passes
- [ ] Verified in a local `wrangler dev` where it applies

## Checklist

- [ ] No instance identity, content, secrets, or real resource IDs in the diff
      (identity lives in `site.config.js`, read at runtime)
- [ ] If I touched a `js/*` module or `css/*`, I bumped its `?v=` everywhere it
      is referenced (HTML, cross-module imports, service-worker asset list)
- [ ] New mutable state uses D1, not a JSON blob
- [ ] New auth gate / privileged path ships with a test
- [ ] No build step introduced
