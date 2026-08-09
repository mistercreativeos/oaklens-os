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

## 2026-08-09 (night)

`setup.sh` broke on Linux — quietly. The deploy-log temp directory was made
with a BSD-only `mktemp` flag that macOS accepts and GNU refuses ("too few
X's"), so on every Linux machine the script lost the "Your site is live at:"
address read-back while still exiting 0. Fixed with a portable template, and
a guard test now keeps BSD-isms out of every script a fork runs. Nothing to
do — merge and it's yours. If you installed from Linux and never saw your
address printed, this was why.

The console is stamped v0.13.1 (the sync-failure reporting below).

## 2026-08-09 (even later)

A mistyped `GITHUB_REPO` secret used to look like a *working* site. Every
GitHub read failed with "Not Found", but the console's sync still painted
green — the only data in the ledger line (`✓ sync · drafts:0`) came from the
site's own database, not GitHub — and the Publish button failed with a bare
"Not Found" that pointed at nothing. A fresh install hit exactly this.

Nothing to do on your end unless you are seeing it: sync now says plainly when
**nothing** came from GitHub, names the repo the worker asked for (so a typo
is visible on sight), and both sync and Publish translate GitHub's two classic
config errors into their fixes — "Not Found" → check `GITHUB_REPO`,
"Bad credentials" → check `GITHUB_TOKEN`.

- `/api/sync` now returns `repo` (which repo the worker queried) alongside the
  per-file results. Console-authed, additive, ignored by older consoles.
- A sync where files arrived but main's HEAD didn't still warns about the
  disarmed stale-base guard, exactly as before. The new failure mode is only
  the total one: no files *and* no HEAD.

## 2026-08-09 (later)

Connecting your repo to Cloudflare — the thing that makes the console's
**Publish** button actually put changes live — was broken, and broken in the
worst way: silently. This fixes it and promotes the whole flow from optional to
required.

### ⚠️ ACTION REQUIRED — if you connected your repo, check what GitHub has

`wrangler.jsonc` ships tracked and full of placeholders. `setup.sh` fills it in
**on your computer**. Nothing ever told anyone to commit it — so the moment you
connected the repo, Cloudflare built from GitHub's copy: it deployed under the
name `your-worker-name`, auto-provisioned an R2 bucket literally called
`your-bucket-name`, and stopped on
`KV namespace 'YOUR_KV_NAMESPACE_ID' is not valid`. Your site carried on serving
its last hand-deploy the whole time, so nothing looked wrong.

Run `bash scripts/doctor.sh`. It now checks this directly and tells you in one
line. If it flags you:

```bash
git add wrangler.jsonc site.config.js
git commit -m "my site's settings"
git push
```

Then delete the junk `your-bucket-name` bucket if Cloudflare made one
(`npx wrangler r2 bucket delete your-bucket-name`). It is empty and costs
nothing, but it will confuse you later.

### What changed

- **`setup.sh` commits your settings for you**, as a new step 6 of 8, before it
  deploys. If git does not know who you are yet it asks once and records the
  answer against this project only.
- **`doctor.sh` reports on your project's history**: whether the saved copy of
  your settings is the real one, whether anything is uncommitted, and whether
  anything is waiting to be pushed. All offline — it never asks GitHub, so it
  cannot hang on a password prompt.
- **`setup.md`'s "Connect your repo" is rewritten** in the order that works,
  with the field-by-field dashboard settings and a recovery section.
- **Every `wrangler` command in `setup.md` is now `npx wrangler`.** A global
  install was never a prerequisite and the bare form fails on a clean machine.
- **The console stops claiming a deploy that is not happening.** After Publish
  it used to say "Cloudflare Pages deploying (~30s)" every time; on an
  unconnected repo nothing was deploying at all. It now says which of the two
  actually happened.
- **`repoConnected` ships live and `false`** in `site.config.example.js`
  instead of commented out, so turning it on is an edit rather than an
  excavation. No behaviour change — `false` was already the default.
- **Re-running `setup.sh` no longer resets your look.** The theme question
  defaulted to option 1 every time, so a re-run quietly put a `passe-partout`
  site back to `aperture`. It now defaults to whatever you already chose.
- **The fork's docs stop describing the client portal**, which forks do not
  have. `RESEND_API_KEY` went with it.

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
