# Worker Setup

There are two ways to stand up an instance. Pick one.

## First, either way: you need a repo you can push to

Your site publishes by **committing to your own GitHub repo** — you write a
post in the Field Console, it saves to GitHub, and (once connected) Cloudflare
rebuilds the site from there. So the copy of this code you work from has to be
one you can push to.

- **The one-click button does this for you.** It copies the repo into your own
  GitHub account as part of the install. Skip ahead.
- **Going the CLI route? Fork first.** Use the **Fork** button (or *Use this
  template*), then clone **your fork**:

  ```bash
  git clone https://github.com/YOUR-USERNAME/YOUR-REPO
  cd YOUR-REPO
  ```

> **Why this matters more than it looks.** If you `git clone` the upstream
> repo instead of forking, everything below still works — resources get
> created, the site deploys, the console loads. It breaks later, at your first
> **Publish**, because you cannot push to a repo you do not own. That failure
> arrives hours after its cause, which is exactly the kind that wastes an
> afternoon. Fork now.

## The quick way — one click

If this repo is published behind a **Deploy to Cloudflare** button, clicking it
does the whole thing in a browser: it copies the repo into your own GitHub
account, creates your photo storage, database and subscriber list on your
Cloudflare account, wires them up, and deploys. It also sets up automatic
redeploys, so from then on saving a change publishes it.

The button URL is your repo's URL wrapped like this:

```
https://deploy.workers.cloudflare.com/?url=https://github.com/<owner>/<repo>
```

Two things the engine does so that flow can work at all:

- **Your password.** The dialog can ask you for secrets, but it cannot ask you
  to produce a bcrypt hash. So the login accepts either `AUTH_PASSWORD_HASH`
  (scrambled — what `setup.sh` writes) **or** `AUTH_PASSWORD` (the password
  itself). If both are set, the scrambled one wins. To have the dialog ask for
  it, uncomment the `"secrets"` line in `wrangler.jsonc` — but read the note
  there first: a secret listed that way becomes *required* to deploy, which
  blocks the CLI route below.
- **The signing key.** `SESSION_SECRET` needs no dialog. Leave it unset and the
  Worker generates a real 32-byte key on first use and keeps it in your KV
  namespace. Nobody has to invent random text.
- **Your database tables.** The button creates the database, and the tables
  come from the repo's own deploy step: `package.json`'s `deploy` script runs
  `wrangler d1 migrations apply DB --remote` before every deploy (Cloudflare
  runs that script on the button path — the button does *not* apply migrations
  on its own). The migration files are idempotent, so re-running them is
  always safe. And if a deploy ever happens without them, nothing breaks
  loudly: draft and bench features answer "not configured yet" with the exact
  command to run, instead of erroring.

One thing to know: the **client portal** (`/c/*`) stays switched off on an
install that never set `SESSION_SECRET` explicitly. It is out of launch scope
and a new site is not using it; set the secret if you want it on.

## The guided way — one command

```bash
npx wrangler login      # sign in to Cloudflare
bash scripts/setup.sh   # six steps, asks a few questions
bash scripts/doctor.sh  # confirms it all worked
npx wrangler deploy     # go live
```

`setup.sh` creates the same resources and never asks you to copy an ID out of
your terminal. Everything below is the manual version of what it does.

> **On Windows, run these in Git Bash** — the terminal that comes with
> [Git for Windows](https://git-scm.com/downloads), not PowerShell and not
> Command Prompt. `setup.sh` and `doctor.sh` are shell scripts; PowerShell will
> say it doesn't recognise `bash` and stop there. WSL works too if you already
> have it. Everything else in this file is the same on every platform.

After you're live, do one more thing when you're ready: **connect your repo**
(section below) so publishing from the console updates your site on its own.

---

## Install dependencies

```bash
npm install
```

## Generate bcrypt password hash

```bash
node -e "const b = require('bcryptjs'); b.hash('YOUR_PASSWORD', 12).then(h => console.log(h))"
```

## Set worker secrets

Only two secrets are **required** — a fresh instance runs with just these:

```bash
wrangler secret put AUTH_PASSWORD_HASH
# paste the bcrypt hash from above
# (or set AUTH_PASSWORD to the password itself — see "one click" above.
#  The hash wins if both are set.)

wrangler secret put SESSION_SECRET
# paste a random 32-char string, e.g.: openssl rand -hex 32
# (optional: with a SUBSCRIBERS KV binding the Worker generates and stores
#  one itself on first use. Set it explicitly if you want the client portal,
#  which still reads this value directly.)
```

Everything else is **optional** and gates one feature. Until a secret is set,
its endpoint answers `501 { notConfigured: true }` and the console shows
"not configured" instead of an error. The worker logs which features are off
(`[health] …`, once per isolate — visible in `wrangler tail`).

### `GITHUB_TOKEN` + `GITHUB_REPO` — what makes Publish work

These two are worth doing carefully; they are the fiddliest part of the whole
install, and together they are what lets the Field Console save your photos
and posts to your repo. Until both are set, Publish answers *"not
configured"* — that is deliberate, not a fault. Everything else works without
them.

**Make the token** (GitHub → your avatar → **Settings** → **Developer
settings** → **Personal access tokens**). Two kinds exist; the first is
better:

- **Fine-grained** (recommended) → *Generate new token*
  - **Repository access:** *Only select repositories* → pick your site's repo.
  - **Permissions:** *Repository permissions* → **Contents** → **Read and
    write**. That is the only one needed — it covers both the reading and the
    committing your site does. Leave everything else alone.
  - **Expiration:** your call. Note that when it expires, Publish starts
    failing and the console will say the token was rejected — that is your cue
    to make a new one and re-run the command below, not a sign anything broke.
- **Classic** → *Generate new token (classic)*, scope **`repo`**. Simpler to
  find, but it grants access to **every** repo you own, so prefer fine-grained.

**Then set both secrets:**

```bash
wrangler secret put GITHUB_TOKEN
# paste the token you just made (it is shown once — copy it before leaving
# the page)

wrangler secret put GITHUB_REPO
# value: owner/repo — e.g. yourname/your-site. Just those two parts, no
# https://, no .git, no branch.

wrangler secret put ADMIN_KEY
# key for /api/subscribers/export

wrangler secret put RESEND_API_KEY
# portal email notifications

# B2_BUCKET_NAME + B2_KEY_ID + B2_APP_KEY (+ B2_ENDPOINT/B2_REGION overrides)
#   — bench RAW cold-storage proxy
# ARCHIVE_S3_ACCESS + ARCHIVE_S3_SECRET
#   — daily Wayback archive cron
```

## Deploy

```bash
wrangler deploy
```

## Connect your repo — so publishing goes live by itself (recommended)

When you hit **Publish** in the Field Console, your changes are saved to your
GitHub repo. Whether they then *appear on your site* depends on one thing:
whether Cloudflare is watching that repo.

- **Repo connected:** Cloudflare notices the save, rebuilds, and your site
  updates in about a minute. Publish → done. No terminal.
- **Repo not connected:** the save happens, but your live site keeps serving
  the old files until you run `npx wrangler deploy` yourself.

(The one-click **Deploy to Cloudflare** button sets this connection up for
you — this section is for everyone who used `setup.sh` instead.)

To connect it, in the Cloudflare dashboard:

1. **Workers & Pages** → your Worker → **Settings** → **Build** →
   **Connect a repository**, and pick your site's GitHub repo.
2. Leave the **build command empty** — this site has no build step.
   Set the **deploy command** to `npx wrangler deploy`.
3. Turn **off** builds for non-production branches (your site deploys from
   `main` only).
4. In `site.config.js`, set `repoConnected: true` so the console's Publish
   screen describes what actually happens now.

**The one habit that changes:** once connected, your repo is the source of
truth. Going forward you go live with `git push origin main` (or by hitting
Publish) — and you should **stop running `npx wrangler deploy` by hand**. A
hand deploy isn't saved in the repo, so the next publish-triggered rebuild
quietly puts things back the way the repo has them, undoing it.

## Keeping your site up to date with the engine

Your site is a **fork**. It's yours — your config, your photos, your changes —
but the engine underneath it keeps getting fixes. Here's how to take them.

Do this once, to tell git where the engine lives:

```bash
git remote add upstream https://github.com/oaklensart/oaklens-os.git
```

Then whenever you want the latest:

```bash
git fetch upstream
git merge upstream/main
```

Run `npm test` afterwards, and if it's green, `git push origin main` — your site
redeploys itself.

**Read [CHANGELOG.md](CHANGELOG.md) first.** It lists what changed since your
last merge, and flags the rare entry that needs you to *do* something (create a
Cloudflare resource, change a setting) rather than just merge. Anything not
flagged is safe to take without reading further.

**Two files will conflict, and it's the same two every time:** `site.config.js`
and `wrangler.jsonc`. That's not a bug. Those hold *your* identity and *your*
Cloudflare resources, while the engine ships example versions of both. **Always
keep yours:**

```bash
git checkout --ours site.config.js wrangler.jsonc
git add site.config.js wrangler.jsonc
```

For anything else that conflicts, take the engine's copy (`git checkout --theirs
<file>`) unless you deliberately changed that file yourself.

> **Worth a skim before you merge:** the engine's `site.config.example.js`
> sometimes gains new options, and `wrangler.jsonc` occasionally gains a new
> setting that matters (`preview_urls: false` was one — it stops every deployed
> version from getting its own public address, which you want on a site with an
> admin console). Diffing your two files against the examples after a merge
> takes a minute and is worth it.

**If you started from the "Deploy to Cloudflare" button:** that copied the code
into a brand-new repo rather than a git fork, so your history and the engine's
have nothing in common. Your *first* merge needs an extra flag and will report
conflicts on a lot of files at once:

```bash
git merge upstream/main --allow-unrelated-histories
```

Resolve them the same way (yours for the two config files, the engine's for the
rest). It's a one-time tax — after that first merge the two share history and
updates are ordinary.

## Join a webring (optional)

Webrings are the old-web way of finding good work: a set of independent sites
that link to each other, so a visitor to one can wander to the rest. No feed, no
algorithm, no company in the middle.

**ANALOGS.NETWORK** ([analogs.network](https://analogs.network)) is one, for
people who run their own sites — photographers, writers, artists, coders. This
engine has built-in support for it, switched **off**. Nothing appears on your
site, and nothing links anywhere, until you decide to join. That is deliberate:
forking someone's code should never sign you up to their network.

**If you want in:**

1. Email `themonitor@analogs.network` with your site, your name, and what you
   make — or open a pull request adding your node file to the registry at
   [github.com/oaklensart/analogs.network](https://github.com/oaklensart/analogs.network).
   Either way a person reads it and adds you by hand.
2. When you're merged you get a **permanent node number** and a slug.
3. Put them in `site.config.js`:

   ```js
   webring: { node: 7, slug: 'your-slug' },
   ```

That's it. Your footer grows a small `ANALOGS //007` chip next to the `OS` one,
and your site starts serving a one-line ownership claim at
`/.well-known/analogs.txt`. The claim is optional but worth having: because only
you can serve a file at your own domain, it's what lets you change or remove
your listing later without an email round-trip, and what protects your number if
the domain ever lapses.

You are never required to display anything. Remove the `webring` line and
everything goes away again.

### The `OS` chip

Your homepage footer carries a small `OS` chip linking to the project this site
runs on. It's two letters on one page, it loads nothing, and it's there so a
visitor who likes your site can find out how to make their own.

If you'd rather not have it, remove it:

```js
poweredBy: false,
```

No hard feelings and no licence problem — the MIT licence never asked for
attribution on your pages.

## Console access (secure by default)

The Field Console document (`/dev/field-console`) is served only to an
authenticated session: your first visit shows a minimal login page, and the
same password that authenticates the API also sets a 30-day `console_shell`
cookie that unlocks the page. No extra secrets or steps — it rides on
`AUTH_PASSWORD_HASH` + `SESSION_SECRET`. Logging out from the console's
settings re-locks it. If you genuinely want the shell public again (nothing
sensitive on the instance), set `consoleShellPublic: true` in `site.config.js`.

### Optional hardening: Cloudflare Access (recommended)

For instances holding real client data (portal projects, subscriber lists),
add an identity wall at Cloudflare's edge — enforced **before** any request
reaches the worker, free for up to 50 users, zero code:

1. Cloudflare dashboard → **Cloudflare One → Access controls →
   Applications → Add an application → Self-hosted**.
2. **Click "+ Add public hostname" first**, before touching anything else.
   Then **delete the pre-filled Private IP row** — leaving it blank is not
   enough, and the save fails with
   `use_clientless_isolation_app_launcher_url can only be enabled for apps
   with private destinations`.
3. Add **two** destinations (domain = your apex, subdomain blank):
   path `dev/field-console` **and** path `dev/field-console.html`. The worker
   answers on both (`worker.js`, console-shell gate) and the service worker
   uses the `.html` form — gate only one and the other stays open.
4. Name the app, set **Session Duration** (1 week is a sane default).
5. Build the policy under **Access controls → Policies → Add a policy**:
   Action *Allow*, Include → *Emails* → your email. Then attach it to the app
   (**Applications → your app → Access policies → Add current policies**).
   An app with no policy is not protected — verify the Policies column shows
   your policy, not `--`.

Leave `/api/*` out of the Access app — the console and the `bench-upload.sh`
CLI authenticate those with the bearer token.

**Pick a login email on a different provider than the domain you're gating.**
An address on the gated domain is delivered via that domain's MX records, in
the same account holding the lock — so a DNS mistake locks you out, and an
account compromise lets an attacker repoint MX and receive the code. An
independent mailbox (or a passkey-backed account login) breaks the loop.

Verify before trusting it: in a private window, both console URLs should
challenge, and your apex + `/dev` should not.

## Smoke tests

```bash
# Login
curl -s -X POST https://your-site.example/api/auth \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://your-site.example' \
  -d '{"password":"YOUR_PASSWORD"}' | jq .

# Sync (replace TOKEN)
curl -s "https://your-site.example/api/sync?files=data/buffer.json" \
  -H 'Authorization: Bearer TOKEN' \
  -H 'Origin: https://your-site.example' | jq .

# Upload test (replace TOKEN)
echo "test" > /tmp/test.webp
curl -s -X POST https://your-site.example/api/upload \
  -H 'Authorization: Bearer TOKEN' \
  -H 'Origin: https://your-site.example' \
  -F 'files=@/tmp/test.webp;filename=archive/test-480w.webp' | jq .
```
