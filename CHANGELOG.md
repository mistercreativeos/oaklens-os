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

## 2026-08-09

Three first-run bugs, all found by watching a stranger install this from
nothing. None of them affect a site that is already up and running — but the
first one may be quietly true of yours, so it is worth two minutes.

### ⚠️ ACTION REQUIRED — check your photo storage actually exists

`setup.sh` used to treat *any* failure from `wrangler r2 bucket create` as
"it must already exist". There is another reason it fails: R2 is not switched
on for the account, which needs a one-time subscription added from the
Cloudflare dashboard and cannot be done from the terminal.

When that happened the script said **"Photo storage ready"**, wrote the bucket
name into `wrangler.jsonc` anyway, and from then on skipped the storage step
entirely because the placeholder was filled. The bucket was never created. The
only symptom was a deploy that failed minutes later on a bucket that had never
existed.

Check yours:

```bash
bash scripts/doctor.sh
```

It now verifies that the storage your config *names* is really on your account,
rather than trusting the config to be telling the truth. If it reports the
bucket missing, switch R2 on (dashboard → **Storage & databases** → **R2**),
then re-run `bash scripts/setup.sh` — it will create it and pick up from there.

If your site is serving photographs today, your bucket exists and there is
nothing to do.

### `setup.sh` now deploys, and tells you your web address

Two required secrets are stored *on a Worker*, and until something has deployed
there is no Worker to attach them to. Wrangler asks whether to create one and
reads the answer from stdin — the same stdin the secret is piped to — so the
prompt ate the secret and the command failed. The script then reported
`check you're online`, which was wrong every single time it fired.

Setup is seven steps now instead of six: it deploys before setting secrets, so
they always attach, and it reads your `.workers.dev` address back out of the
deploy and prints it on a line of its own. Finding your own site used to mean
scrolling back through wrangler's output.

Failures quote wrangler's actual words instead of guessing.

If your repo is connected to Cloudflare, the new deploy step skips itself — a
hand-deploy on a connected repo is undone by the next automatic build.

### The R2 sign-up wants a payment method, and the docs now say so

Switching on R2 goes through a Cloudflare checkout that asks for a card, Apple
Pay, Google Pay, PayPal or a bank account, plus a billing address — while
showing `Total Due Now $0.00` and `$0/month`. Both things are true: you are
authorising charges only above the free allowance.

The README and the install guide used to say "no card required", which was
wrong. They now say what actually happens, and spell out what the allowance
holds in terms you can check: 10 GB is roughly 25,000 photographs at the three
sizes this engine generates, and the limit you would really meet first is the
Workers free tier's 100,000 requests a day, not storage.

Nothing to do. This is a documentation correction, not a change to your site.

### Dashboard names, both of them

Cloudflare is rolling out a redesigned dashboard account by account, so
**Workers & Pages** now sits under **Compute**, and **Cloudflare One** is
**Zero Trust** again. The scripts and `setup.md` name both labels rather than
picking the one that is wrong for half of you.

---

## 2026-08-08

The engine repository went public. Everything below shipped alongside that.

### New optional config: `entity.codeRepository`

If your own fork's code is public, naming it credits you as the author of your
engine in the homepage's structured data:

```js
entity: {
  // ...
  codeRepository: 'https://github.com/YOUR-USERNAME/YOUR-REPO',
  codeName: 'YOUR ENGINE NAME',   // optional, defaults to OAKLENS OS
},
```

Leave it empty and nothing is emitted, which is the right default: pointing a
crawler at a private repository weakens your entity signal instead of helping
it. Nothing to do unless you want it.

This is also the first key to arrive since configs became forward-compatible,
so it is the shape every future one will take: optional, defaulted, and
inert until you fill it in.

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
