# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue, and
do not disclose the details until a fix is available.

Use GitHub's private vulnerability reporting for this repository:
**Security → Report a vulnerability** (the "Report a vulnerability" button on
the repo's Security tab). It opens a private advisory visible only to the
maintainers.

When you report, please include:

- A description of the issue and its impact.
- Steps to reproduce (a proof-of-concept if you have one).
- Any affected routes, tokens, or storage tiers you identified.

You can expect an acknowledgement within a few days. We'll keep you updated as
we validate and fix, and we're happy to credit you in the advisory once it's
resolved (or keep you anonymous if you prefer).

## Scope

This engine's trust model centers on the Worker as the single authenticated
gateway: all external credentials are encrypted Worker secrets, and the browser
holds only a short-lived scoped token. Reports that are especially valuable:

- Privilege escalation across token families (console vs. portal vs. admin).
- Path traversal in upload / delete / sync / RAW-proxy key handling.
- Auth-gate bypass on any privileged `/api/*` or `/c/*` route.
- Secret exposure (in a URL, log, response body, or served asset).
- Stored XSS in portal-rendered user content.

Please test only against your own deployment — never against another
operator's live instance.
