# OAKLENS OS

**Claim your space. Hold the keys.**

[![CI](https://github.com/oaklensart/oaklens-os/actions/workflows/ci.yml/badge.svg)](https://github.com/oaklensart/oaklens-os/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)

A photography site, field-notes blog and print-drop storefront that runs as a
single Cloudflare Worker. No framework, no build step, no monthly bill — and no
platform between you and the people looking at your work.

You publish from a console in your browser: drop photos straight off the camera
or phone, write the post on the train, hit publish. The site commits to **your**
GitHub repo and rebuilds itself. Nothing you make lives anywhere you can't reach.

**New to this?** [setup.md](setup.md) is the full walkthrough — accounts,
storage, secrets, the console — written for people who don't do this for a
living. Start there and you can ignore everything below.

---

## Engine vs. instance

This repo is the **engine**. A live site is one **configuration** of it.

Identity never lives in code. Everything a fork changes sits in one file —
`site.config.js` (name, tagline, contact, nav, location, theme, CDN base) — and
everything else derives from the request origin at runtime. So a fresh fork
works on its free `*.workers.dev` address with zero extra setup, and attaching
your own domain later changes nothing in the code.

## What you get

- **A console built for the field.** Cull, write and publish from a phone or an
  iPad on a café table. Two viewing modes: high-contrast for direct sun, OLED
  black for editing in the dark.
- **Photos in, web-ready out.** Drop JPEGs or camera RAW files in the browser;
  they're resized, variant-generated and live in seconds. GPS and EXIF are
  stripped on the way out — your art ships, your location doesn't.
- **Permanent frame numbers.** Every published image gets a number (`f#234`) and
  a SHA-256 fingerprint at intake. Numbers are never reused or reordered;
  retiring a frame leaves a dark placeholder so no link to your work ever
  breaks.
- **Field Notes that cite the work.** Write in Markdown, link any frame by its
  number, and the link opens a preview inline. Words and images stay tied
  together across years.
- **Survives a bad connection.** Lose signal and work is held locally; it
  uploads when you're back. Close the tab mid-upload and it pauses rather than
  publishing something half-formed.
- **An escape hatch.** Export the whole site — pages, images, code — as a single
  ZIP that runs from `file://` with no server and no network.
- **Nothing third-party on the public pages.** A fork ships zero third-party
  runtime JavaScript to visitors. Analytics and media embeds exist, but they are
  off by default and each one widens exactly the one thing it needs.

## Quick start

### 1. Get your own copy

**Fork this repo** (button, top right — or *Use this template*), then clone
**your fork**:

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO
cd YOUR-REPO
```

> **Why a fork and not a clone of this one.** Your site publishes by *committing
> to your own repo* — you write a post in the console, it saves to GitHub, and
> Cloudflare rebuilds from there. That needs a repo you can push to. Clone this
> one directly and everything works right up until your first Publish, hours
> later. Fork now; it takes five seconds.

### 2. Stand it up

```bash
npm install
npx wrangler login      # sign in to Cloudflare
bash scripts/setup.sh   # creates your storage, sets your password
bash scripts/doctor.sh  # confirms it all worked
npx wrangler deploy     # go live
```

That's the whole install. `setup.sh` asks a few questions and creates the
Cloudflare resources for you; `doctor.sh` tells you in plain English if
anything is still missing.

### 3. Make it yours

Open `site.config.js` and fill in every field — your name, your tagline, your
contact address, your city. Then connect the repo to Cloudflare so publishing
goes live on its own. Both are walked through in [setup.md](setup.md).

## What it costs

Nothing, for a normal portfolio. Cloudflare's free tier covers the Worker, the
database, the image storage and the subscriber list, and GitHub hosts the repo
free. There's no trial and no card required to follow the install guide.

The honest caveat: free tiers have limits (R2 storage and Worker requests are
the ones you'd meet first). A personal site with thousands of photos sits well
inside them. A site serving serious traffic will eventually cross into paid
usage — Cloudflare's pricing pages are the source of truth, not this README.

## Requirements

- A **GitHub account** — free
- A **Cloudflare account** — free, no card
- **Node 22 or newer** — the Cloudflare tooling refuses to run on older
  versions, with an error that doesn't explain itself
- **Git**, and a terminal you can paste into. On Windows use **Git Bash** (it
  comes with [Git for Windows](https://git-scm.com/downloads)) or WSL — the
  setup scripts are shell scripts, and PowerShell can't run them

Budget about fifteen minutes if you already have those, and an hour the first
time if you don't.

## How it works

For the curious, or anyone deciding whether to trust it:

- **One Worker, one deploy.** `worker.js` is a thin router; every subsystem
  lives in `src/`. Static assets and server code ship together, so there's no
  front-end/back-end split to keep in sync.
- **No build step.** Hand-authored HTML, CSS and native ES modules. The code you
  read is the code that runs — open a file, change it, push.
- **Identity is injected at the edge.** Pages are served with neutral
  placeholders and filled in from your config by HTMLRewriter on every response.
- **Storage picked per job.** D1 (SQLite) for mutable state, R2 for image
  variants, KV for subscribers, git for anything versioned.
- **The Worker is the only gate.** Every secret is a Worker binding; the browser
  only ever holds a short-lived scoped token. Privileged routes verify it.
- **1,000+ tests** run on every push, alongside a build check and a scan that
  fails the build if instance identity leaks into the code.

## Docs

| File | What's in it |
|------|--------------|
| [setup.md](setup.md) | Deploying and operating an instance — accounts, secrets, storage, the console |
| [CONTRIBUTING.md](CONTRIBUTING.md) | The engine-vs-instance model and the ground rules |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability privately |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | How we treat each other here |
| [CLAUDE.md](CLAUDE.md) | The working agreement for AI coding agents — and the fastest tour of the architecture if you're human |

## Contributing

Issues and pull requests are welcome. The one rule worth reading before you open
either: **no instance identity in engine code.** No real emails, coordinates,
domains or storage keys in a diff — anything that identifies a particular site
belongs in `site.config.js`. `CONTRIBUTING.md` explains why, and
`scripts/os-leak-scan.sh` checks it.

Run `npm test` before you push; CI runs the same suite. By taking part you
agree to the [Code of Conduct](CODE_OF_CONDUCT.md) — the short version is that
the person who got stuck is not the problem, the step that confused them is.

## Security

Please report vulnerabilities **privately** through GitHub's
*Security → Report a vulnerability* — not a public issue. Details and scope are
in [SECURITY.md](SECURITY.md). Test only against your own deployment.

## Licence

MIT — see [LICENSE](LICENSE). Fork it, change it, ship it, sell what you make
with it. Attribution in the footer is on by default and removable in one line.

## Also from OakLens

[**Fixxer**](https://github.com/oaklensart/fixxer) — photography workflow
automation. Fixxer organises the shoot; OAKLENS OS puts it on the web.
