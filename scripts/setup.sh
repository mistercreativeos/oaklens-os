#!/usr/bin/env bash
# setup.sh — first-run setup for a new OAKLENS OS site.
#
# Written for the person this engine is actually for: a photographer or writer
# who wants their own site and does not want a lecture about edge computing.
# Three rules it tries to keep:
#
#   1. Say what is about to happen, in words, BEFORE doing it.
#   2. Never ask someone to copy a 36-character ID out of their terminal.
#      We read every ID out of the command's own output and write it into the
#      placeholder ourselves. NOT `--update-config`: that flag APPENDS a fresh
#      binding block rather than filling the template's, so the config ended up
#      with the same binding twice — "SUBSCRIBERS assigned to multiple KV
#      Namespace bindings" — which is a parse error, so every wrangler command
#      after it failed. The script VERIFIES the config after each step instead
#      of assuming, and asks for help only when the automatic path genuinely
#      failed.
#   3. Fail early and in plain English. Stopping before anything is created
#      beats leaving half-made resources on someone's account.
#
# Safe to stop (Ctrl-C) and re-run — it skips whatever is already done.
# Covered by tests/setup-script.test.js, which runs it end to end against a
# fake wrangler.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# ---- output helpers -------------------------------------------------------
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
step()  { printf '\n\033[1m[%s of 8] %s\033[0m\n' "$1" "$2"; }
info()  { printf '  %s\n' "$1"; }
good()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$1"; }
oops()  { printf '\n\033[31m%s\033[0m\n' "$1"; }
ask()   { local p="$1" d="${2:-}" v; read -r -p "  $p${d:+ [$d]}: " v; printf '%s' "${v:-$d}"; }

# Run a command, show it, keep its output for parsing.
CAPTURED=""
capture() { printf '  \033[2m$ %s\033[0m\n' "$*"; CAPTURED="$("$@" 2>&1)"; local rc=$?; printf '%s\n' "$CAPTURED" | sed 's/^/    /'; return $rc; }

# True if PLACEHOLDER is still an unfilled *value*. Comments are ignored —
# the example config explains itself in prose that names the placeholders, and
# matching those is how doctor.sh used to tell a finished setup it wasn't.
# The `|| true` is load-bearing under `set -o pipefail`: config-check exits 1
# when placeholders remain, which is the case we care about, and pipefail would
# otherwise fail the whole pipeline even though grep matched.
placeholder_left() { { node scripts/lib/config-check.mjs wrangler.jsonc 2>/dev/null || true; } | grep -qx "$1"; }
any_placeholder_left() { ! node scripts/lib/config-check.mjs wrangler.jsonc >/dev/null 2>&1; }
sub() { # sub PLACEHOLDER VALUE — targeted, no JS/JSON parser hand-rolled
  [ -n "${2:-}" ] || return 1
  sed -i.bak "s|$1|$2|g" wrangler.jsonc && rm -f wrangler.jsonc.bak
}

# ---- saying what happened ---------------------------------------------------
#
# The script talks plenty about what it is ABOUT to do and almost nothing about
# what it just did, which is fine until something recovers. On a real run the
# screen read:
#
#     ✘ [ERROR] A KV namespace with the title "demo-subscribers" already exists.
#     ...
#     ✓ Subscriber list ready.
#
# A red error, then a green tick, and nothing in between saying which one won.
# The person cannot tell whether their existing list was adopted, ignored, or
# quietly overwritten — and "quietly overwritten" is the one that would matter.
# So: every recovery narrates itself, and the end recaps what was made versus
# what was already there.

SUMMARY_LINES=""
made()   { SUMMARY_LINES="${SUMMARY_LINES}made|$1
"; }
reused() { SUMMARY_LINES="${SUMMARY_LINES}reused|$1
"; }

# Called after a failed `create`, BEFORE the lookup, so wrangler's red error has
# a sentence next to it instead of a bare tick two lines later.
explain_create_failure() {
  case "$CAPTURED" in
    *"already exists"*|*"already taken"*)
      info "That name is already on your account — checking whether it's yours to reuse…" ;;
    *)
      info "That didn't create. Checking whether it already exists…" ;;
  esac
}

# Ask for an ID by hand — only ever reached when the automatic path failed.
# Rejects the things people actually type, so a stray "y" never lands in the
# config and breaks the deploy an hour later.
ask_id_manually() { # ask_id_manually PLACEHOLDER LABEL
  local ph="$1" label="$2" v
  warn "Couldn't read the $label automatically."
  info "It's in the output just above — the long string of letters and numbers."
  while :; do
    v="$(ask "Paste the $label (or press Enter to skip and finish by hand)")"
    [ -z "$v" ] && { warn "Skipped. You'll need to put the $label into wrangler.jsonc yourself."; return 1; }
    if node scripts/lib/id-check.mjs "$v" 2>/dev/null; then sub "$ph" "$v"; good "Saved."; return 0; fi
    info "That doesn't look like an ID — it should be a long run of letters, numbers and dashes."
  done
}

# ---- 0. prerequisites -----------------------------------------------------
bold "Setting up your OAKLENS OS site"
echo
info "This creates the storage your site needs on your Cloudflare account,"
info "sets your console password, and gets you ready to go live."
info "Nothing here is destructive, and you can stop with Ctrl-C at any point."

if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  oops "Node.js isn't installed."
  info "It's the toolkit this site is built with. Grab the LTS version from:"
  info "  https://nodejs.org"
  info "Then run this again."
  exit 1
fi

step 1 "Checking you're signed in to Cloudflare"

# Install BEFORE the first wrangler call, not after. `npx wrangler` with no
# node_modules downloads whatever version is newest on npm — so the very first
# command ran on a different wrangler than the one this project pins and tests
# against, and cost a minute doing it. With the install first, every `npx
# wrangler` below resolves to the pinned local copy.
[ -d node_modules ] || { info "Installing the project's tools (one time, takes a minute)…"; npm install >/dev/null 2>&1 && good "Done." || { oops "npm install failed — run 'npm install' and see what it says."; exit 1; }; }

if ! npx wrangler whoami >/dev/null 2>&1; then
  oops "You're not signed in to Cloudflare yet."
  info "Run this, finish signing in in the browser window it opens, then run"
  info "this script again:"
  echo
  info "    npx wrangler login"
  echo
  exit 1
fi
good "Signed in."

# ---- 2. worker config -----------------------------------------------------
step 2 "Naming your site"
# Gate on the PLACEHOLDER, not on the file existing. A fork ships a ready-made
# wrangler.jsonc (os-extract.mjs installs the example as the real config), so
# "the file is here" meant "already named" and this step silently skipped —
# leaving the worker called `your-worker-name` and failing the final check at
# the very end, after every resource had already been created. Every other step
# in this script asks the placeholder; this one now does too.
[ -f wrangler.jsonc ] || cp wrangler.example.jsonc wrangler.jsonc
if placeholder_left your-worker-name; then
  # Say that the name is VISIBLE. A real run typed one character wrong and
  # ended up living at mistercreaetiveos.workers.dev, because nothing here
  # suggested the answer was worth reading back before pressing return.
  info "Lowercase letters, numbers and dashes."
  info "This becomes part of your web address, like"
  info "  https://your-site-name.something.workers.dev"
  info "so it's worth a second look before you press return. It is not your own"
  info "domain — you can add one of those later, and this name still works."
  worker_name="$(ask 'Site name' 'my-photo-site')"
  sub your-worker-name "$worker_name"
  good "Named: $worker_name"
  info "Your address will end up looking like  $worker_name.<something>.workers.dev"
else
  good "Already named — leaving your existing settings alone."
fi

# ---- 3. storage -----------------------------------------------------------
step 3 "Creating your storage"

# Recover the id of a resource that already exists. `create` fails outright
# when the name is taken, and that is not an edge case: it happens on any
# account already running an instance of this engine (the demo beside a live
# site is exactly that), and on every RE-RUN after a partial setup — which this
# script's own header promises is safe. Without this, "already exists" dead-ends
# into asking a photographer to find a 32-character id in a wall of output.
lookup_id() { # lookup_id kv|d1 NAME -> prints the id, or nothing
  local kind="$1" name="$2" out
  if [ "$kind" = "kv" ]; then
    out="$(npx wrangler kv namespace list 2>&1)"
  else
    out="$(npx wrangler d1 list --json 2>&1)"
  fi
  printf '%s' "$out" | node scripts/lib/wrangler-parse.mjs "find-$kind" "$name" 2>/dev/null
}

# R2 is the one piece here that an account does not get switched on by default:
# Cloudflare wants you to add the R2 subscription once, in the browser, and
# wrangler cannot do it — it answers `code: 10042`.
#
# That used to be completely invisible, and it cost a real person their whole
# first run. `r2 bucket create` failed, the script assumed the only other
# explanation ("must already exist"), said "Photo storage ready", and wrote the
# bucket name into the config anyway. Every later run then SKIPPED this step,
# because the placeholder was filled — so the bucket was never created at all,
# and the truth surfaced ten minutes later as a deploy that died on it.
#
# Hence two checks: ask BEFORE creating anything, and never claim to have
# adopted an existing bucket without looking for it.
r2_off() {
  local out
  out="$(npx wrangler r2 bucket list 2>&1)"
  case "$out" in
    *10042*|*"enable R2"*|*"not entitled to use r2"*) return 0 ;;
  esac
  return 1
}
bucket_exists() { npx wrangler r2 bucket info "$1" >/dev/null 2>&1; }

# Ask about that switch before creating ANYTHING. Rule 3 of this script's
# header: stopping before anything exists beats leaving half-made resources
# behind on a stranger's account.
if placeholder_left your-bucket-name && r2_off; then
  oops "One switch to flip first."
  info "Photo storage (Cloudflare calls it R2) is the only piece here that isn't"
  info "already switched on. Cloudflare asks you to turn it on once, in your"
  info "browser, and there is no way to do it from the terminal."
  echo
  info "  1. Open   https://dash.cloudflare.com"
  info "  2. Go to  Storage & databases  →  R2 Object Storage  →  Overview"
  info "            (some accounts shorten this to just \"R2\")"
  info "  3. Press \"Add R2 subscription\" and finish the checkout."
  echo
  info "It asks for a payment method and still costs nothing: the page says"
  info "Total Due Now \$0.00 and \$0/month, and you're only charged if you go"
  info "past the free allowance. That allowance is 10GB, which is around 25,000"
  info "photographs at the three sizes this site saves them in."
  info "You'll know it worked when the R2 page reads \$0.00 billable usage and"
  info "\"No billable usage incurred yet\". There's an \"Add Budget Alert\" button"
  info "right there too — worth setting, and it takes half a minute."
  echo
  info "Then run this script again. Nothing has been created yet, so you are not"
  info "leaving anything half-finished behind you."
  exit 1
fi

# The orientation comes AFTER the gate on purpose: someone about to be sent to
# the dashboard should not first read three lines about what is coming next.
info "Three pieces, all on Cloudflare's free tier:"
info "  • a place for photos and video   (R2)"
info "  • a small database for drafts and your work queue   (D1)"
info "  • a list for email subscribers   (KV)"
echo
info "Two things you'll see and can ignore: wrangler asking whether it should"
info "edit your config (this script fills it in itself, more reliably), and an"
info "\"already exists\" error if something here is already on your account —"
info "that one gets reused, and this script says so when it happens."
echo

# --- KV. Wrangler can write this into the config itself; we verify it did.
if placeholder_left YOUR_KV_NAMESPACE_ID; then
  info "Subscriber list…"
  info "  Somewhere to keep the email addresses of people who want to hear when"
  info "  you post. Nothing is sent yet and nobody is on it — this just makes"
  info "  the empty list. You can have several later; one general list is the"
  info "  right place to start, and the suggested name below is a fine one."
  # The TITLE is asked for, like the database and the bucket below. It used to
  # be hardcoded to the binding name, "SUBSCRIBERS" — and titles are unique per
  # account, so the second site on an account could never create one. The
  # binding stays SUBSCRIBERS (the Worker reads env.SUBSCRIBERS); only the
  # title varies.
  kv_title="$(ask 'Subscriber list name' 'photo-subscribers')"
  capture npx wrangler kv namespace create "$kv_title"
  if placeholder_left YOUR_KV_NAMESPACE_ID; then
    # Read the id out of the output, then fall back to looking up one that
    # already exists under this title.
    kv_id="$(printf '%s' "$CAPTURED" | node scripts/lib/wrangler-parse.mjs kv 2>/dev/null)"
    if [ -n "$kv_id" ]; then
      made "Subscriber list  $kv_title"
    else
      explain_create_failure
      kv_id="$(lookup_id kv "$kv_title")"
      if [ -n "$kv_id" ]; then
        good "Found it — reusing \"$kv_title\". Nothing was created or overwritten."
        reused "Subscriber list  $kv_title"
      fi
    fi
    if [ -n "$kv_id" ]; then sub YOUR_KV_NAMESPACE_ID "$kv_id"; good "Subscriber list ready."
    else ask_id_manually YOUR_KV_NAMESPACE_ID "subscriber list ID"; fi
  else
    good "Subscriber list ready."
    made "Subscriber list  $kv_title"
  fi
fi
if placeholder_left YOUR_KV_PREVIEW_ID; then
  # A second, throwaway namespace used only when previewing locally. Wrangler
  # titles it "<title>_preview".
  capture npx wrangler kv namespace create "${kv_title:-photo-subscribers}" --preview
  if placeholder_left YOUR_KV_PREVIEW_ID; then
    kv_prev="$(printf '%s' "$CAPTURED" | node scripts/lib/wrangler-parse.mjs kv 2>/dev/null)"
    if [ -z "$kv_prev" ]; then
      explain_create_failure
      kv_prev="$(lookup_id kv "${kv_title:-photo-subscribers}_preview")"
      [ -n "$kv_prev" ] && good "Found it — reusing the existing preview copy."
    fi
    if [ -n "$kv_prev" ]; then
      sub YOUR_KV_PREVIEW_ID "$kv_prev"
      good "Local-preview copy ready."
    else
      # Not worth stopping for: it is only used by `wrangler dev`, never live.
      sub YOUR_KV_PREVIEW_ID "${kv_id:-}"
      warn "Couldn't set up the local-preview copy — harmless unless you run \`wrangler dev\`."
    fi
  fi
fi

# --- D1. Same shape as the others: parse the id, then look it up if need be.
if placeholder_left YOUR_D1_DATABASE_ID; then
  echo
  info "Database…"
  info "  A small filing drawer your site writes to as you work: drafts of field"
  info "  notes you haven't published, and your processing queue. Your"
  info "  photographs do not go in here."
  info "  The name is internal — visitors never see it, it isn't part of your"
  info "  web address, and the suggestion below is a good long-term answer."
  db_name="$(ask 'Database name' 'site-notes')"
  sub YOUR_DB_NAME "$db_name"
  capture npx wrangler d1 create "$db_name"
  db_id="$(printf '%s' "$CAPTURED" | node scripts/lib/wrangler-parse.mjs d1 2>/dev/null)"
  # "already taken" is the normal re-run case — the previous attempt created it
  # and stopped before the id reached the config. Adopt it rather than asking.
  if [ -n "$db_id" ]; then
    made "Database         $db_name"
  else
    explain_create_failure
    db_id="$(lookup_id d1 "$db_name")"
    if [ -n "$db_id" ]; then
      good "Found it — reusing \"$db_name\". Your existing data is untouched."
      reused "Database         $db_name"
    fi
  fi
  if [ -n "$db_id" ]; then sub YOUR_D1_DATABASE_ID "$db_id"; good "Database ready."
  else ask_id_manually YOUR_D1_DATABASE_ID "database ID"; fi
fi

# --- R2.
if placeholder_left your-bucket-name; then
  echo
  info "Photo and video storage…"
  info "  Where your photographs and video actually live. This is the one that"
  info "  grows as you shoot; the free tier holds around 10GB."
  bucket="$(ask 'Storage name' 'photo-cdn')"
  # A bucket is addressed by NAME, so there is no id to read back. But "create
  # failed" is NOT the same as "already exists" — see r2_off above — and this
  # branch used to treat them as identical, tick green, and fill the config for
  # a bucket that did not exist. So the reuse claim is now VERIFIED against the
  # account before it is made, exactly like the KV and D1 lookups above, and
  # the config is only written once something is really there.
  if capture npx wrangler r2 bucket create "$bucket"; then
    made "Photo storage    $bucket"
    sub your-bucket-name "$bucket"
    good "Photo storage ready."
  else
    explain_create_failure
    if bucket_exists "$bucket"; then
      good "Found it — reusing \"$bucket\". Your photos are untouched."
      reused "Photo storage    $bucket"
      sub your-bucket-name "$bucket"
      good "Photo storage ready."
    else
      oops "The photo storage couldn't be created, and there's no \"$bucket\" on your account either."
      info "Cloudflare's own words are in the output just above."
      info "Nothing was written to your settings, so fixing whatever it says and"
      info "running this script again picks up right here."
      exit 1
    fi
  fi
fi

# ---- 4. database tables ---------------------------------------------------
# On a re-run step 3 is skipped, so recover the name from the config rather
# than relying on a variable that was never set this time around.
if [ -z "${db_name:-}" ]; then
  db_name="$(grep -oE '"database_name":[[:space:]]*"[^"]+"' wrangler.jsonc | head -1 | sed 's/.*:[[:space:]]*"//;s/"$//')"
fi

step 4 "Setting up the database tables"
if [ -z "${db_name:-}" ] || [ "$db_name" = "YOUR_DB_NAME" ]; then
  warn "Couldn't tell which database to use, so this step was skipped."
  info "Once wrangler.jsonc has a database name in it, re-run this script."
else
  # Console tables (fn_drafts + bench_entries) are wrangler migrations
  # (migrations/), so this is the same idempotent command the one-click
  # Deploy path runs from the package.json `deploy` script. --remote matters:
  # without it the tables are written to a local file that the live site
  # never reads, and everything looks fine until it isn't.
  if npx wrangler d1 migrations apply "$db_name" --remote >/dev/null 2>&1; then
    good "Console tables ready (migrations applied)."
  else
    warn "Couldn't apply the D1 migrations — re-run this script to retry."
  fi
fi

# ---- 5. look + identity ---------------------------------------------------
step 5 "Choosing your look"
if [ ! -f site.config.js ]; then
  cp site.config.example.js site.config.js
fi
info "You can change this any time — it's one line in site.config.js."
echo
info "  1) aperture       cool and architectural, contemporary studio"
info "  2) passe-partout  warm paper and museum labels, fine-art gallery"
info "  3) noir           black, white and red — high-contrast, terminal feel"
info "  4) selenium       the folio — serif headings, coral accent, built to read"
info "  5) cyanotype      the folio in Prussian-blue ink, like the contact print"
echo
# Default to whatever is ALREADY chosen, so pressing return on a re-run keeps
# it. This used to default to 1 every time: re-running the script — which its
# own header promises is safe — quietly put a passe-partout site back to
# aperture, with a green tick and no mention that anything had changed.
current_preset="$(sed -nE "s/.*preset:[[:space:]]*'([^']*)'.*/\1/p" site.config.js 2>/dev/null | head -1)"
case "$current_preset" in
  passe-partout) preset_default=2 ;;
  noir)          preset_default=3 ;;
  selenium)      preset_default=4 ;;
  cyanotype)     preset_default=5 ;;
  *)             preset_default=1 ;;
esac
preset_choice="$(ask 'Pick one [1-5]' "$preset_default")"
case "$preset_choice" in
  2) preset="passe-partout" ;;
  3) preset="noir" ;;
  4) preset="selenium" ;;
  5) preset="cyanotype" ;;
  *) preset="aperture" ;;
esac
# Targeted value swap — never hand-roll a JS parser over the config.
node -e "
const fs = require('fs');
const src = fs.readFileSync('site.config.js', 'utf8');
const out = src.replace(/preset:\s*'[^']*'/, \"preset: '$preset'\");
if (out !== src) fs.writeFileSync('site.config.js', out);
" && good "Look set to $preset."

# ---- 6. save the settings into the project's history ----------------------
#
# THE MOST EXPENSIVE FIVE LINES THIS SCRIPT DOES NOT HAVE, until now.
#
# `wrangler.jsonc` ships tracked in git, full of placeholders, and everything
# above fills it in ON THIS COMPUTER ONLY. Nothing told anyone to commit it. So
# the moment someone connected their repo to Cloudflare, Cloudflare checked out
# GitHub's copy — still `your-worker-name` / `YOUR_KV_NAMESPACE_ID` /
# `your-bucket-name` — deployed under the wrong name, auto-provisioned a junk R2
# bucket literally called `your-bucket-name`, and died on the KV placeholder.
# Their site kept running on the last hand-deploy, so the failure was completely
# invisible until they wondered why Publish did nothing.
#
# Committing here does not fix that on its own (the push is still theirs to
# make, and needs credentials this script has no business handling). What it
# does is remove the step a person can forget: by the time they push anything at
# all, the settings are already in the commit.
#
# Deliberately NOT `git add -A`: only the two files this script wrote. Somebody
# else's work-in-progress is not ours to commit.
step 6 "Saving your settings"
git_ok=0
if [ -d .git ] && command -v git >/dev/null 2>&1; then git_ok=1; fi
if [ "$git_ok" != "1" ]; then
  warn "This folder isn't a git project, so there's nothing to save your settings into."
  info "That usually means the code was downloaded as a ZIP rather than cloned."
  info "Everything below still works — but publishing from the console later"
  info "needs a real clone of your own GitHub copy. See setup.md."
# `git status --porcelain`, not `git diff`: diff is blind to a file git has
# never seen, and site.config.js is exactly that on a checkout that only ever
# had the example. "No diff" would have read as "already saved" while the
# file sat untracked.
elif [ -z "$(git status --porcelain -- wrangler.jsonc site.config.js 2>/dev/null)" ]; then
  good "Settings already saved — nothing changed."
else
  info "Your settings live in two files, and they're only on this computer so far."
  info "This records them in your project's history so they can travel to GitHub."
  echo
  # Git labels every save with a name and an email, and a freshly installed git
  # has neither — `git commit` then fails with "Please tell me who you are",
  # which reads like the script broke. Ask, and write it --local so we never
  # touch settings that belong to the rest of their machine.
  if [ -z "$(git config user.email 2>/dev/null)" ] || [ -z "$(git config user.name 2>/dev/null)" ]; then
    info "First, git needs to know who's making the change — it labels every"
    info "save with a name and an email. This stays on this project only."
    # The owner of the GitHub copy is already in the remote address, so the
    # defaults are usually just right and they can press return twice.
    owner="$(git config --get remote.origin.url 2>/dev/null \
      | sed -E 's#.*[/:]([^/]+)/[^/]+(\.git)?$#\1#')"
    [ "$owner" = "$(git config --get remote.origin.url 2>/dev/null)" ] && owner=""
    git_name="$(ask 'Your name' "${owner:-$(id -un)}")"
    git_mail="$(ask 'Your email' "${owner:+$owner@users.noreply.github.com}")"
    git config --local user.name "$git_name"
    git config --local user.email "$git_mail"
    good "Saved as $git_name <$git_mail>."
  fi
  if git add wrangler.jsonc site.config.js 2>/dev/null \
     && git commit -q -m "config: my site's settings" 2>/dev/null; then
    good "Settings saved to your project's history."
    info "They're still only on this computer. Sending them to GitHub is one"
    info "command — it's in the next-steps list at the end."
  else
    warn "Couldn't save the settings automatically."
    info "Nothing is broken and nothing is lost. Run these two yourself:"
    info "    git add wrangler.jsonc site.config.js"
    info "    git commit -m \"my site's settings\""
    info "Do it before you connect your repo to Cloudflare — connecting with"
    info "the blank template still on GitHub is what breaks the Publish button."
  fi
fi

# ---- 7. go live -----------------------------------------------------------
#
# This step used to be homework: the script finished, printed "now run npx
# wrangler deploy", and stopped. Two things went wrong with that, both found on
# a real first run.
#
# 1. The secrets in step 7 are stored ON A WORKER, and until something deploys
#    there is no worker to store them on. Wrangler asks "There doesn't seem to
#    be a Worker called X — create one?" — but the secret is piped to its
#    stdin, so the prompt swallowed the secret as its own answer and the
#    command failed. The script then said "check you're online", sending a real
#    person off hunting a network problem that did not exist. Deploying first
#    deletes that whole class of failure.
#
# 2. Nobody could find their own web address. It scrolls past inside wrangler's
#    output somewhere above the fold. Now the script reads it back out and says
#    it plainly, twice.
#
# The deploy runs with the terminal attached rather than through `capture`,
# because the very first one may ask which workers.dev subdomain you want and a
# question nobody can see is a hang. WRANGLER_LOG_PATH gets us the output
# anyway: wrangler writes its own log to that file while the screen stays
# interactive.
step 7 "Putting your site on the internet"
LIVE_URL=""
if grep -Eq '^[[:space:]]*repoConnected:[[:space:]]*true' site.config.js 2>/dev/null; then
  good "Your repo is connected to Cloudflare, so it deploys itself."
  info "Skipping the manual deploy on purpose — a hand-deploy gets undone by"
  info "the next automatic build. Push to main instead."
else
  info "This uploads your site and gives it a web address."
  info "The first time, Cloudflare may ask you to pick a workers.dev subdomain."
  info "That becomes part of your address, so your name or your studio name is"
  info "a good answer. Everything else you can just accept."
  echo
  # The log path MUST NOT EXIST YET. Wrangler refuses to write to a
  # WRANGLER_LOG_PATH that is already a file — it writes nothing, silently, and
  # says nothing about it. The first version of this used `mktemp`, which
  # CREATES the file, so the capture came back empty on a real cold run and the
  # script cheerfully printed "Done. Your site is live." followed by "Open the
  # address above", pointing at nothing. `mktemp -d` gives us a private
  # directory; the log is a name inside it that nothing has touched.
  # Template spelled out with X's, because the short flag-t form of mktemp is
  # a BSD-ism: macOS accepts it, but GNU mktemp (every Linux) refuses with
  # "too few X's" — which emptied deploy_dir, degraded the log path to
  # /deploy.log, and silently cost Linux installs the address read-back.
  # tests/guards.test.js pins the portable spelling.
  deploy_dir="$(mktemp -d "${TMPDIR:-/tmp}/oaklens-deploy.XXXXXX")"
  deploy_log="$deploy_dir/deploy.log"
  if WRANGLER_LOG_PATH="$deploy_log" npx wrangler deploy; then
    LIVE_URL="$(grep -oE 'https://[a-z0-9][a-z0-9.-]*\.workers\.dev' "$deploy_log" 2>/dev/null | head -1)"
    echo
    if [ -n "$LIVE_URL" ]; then
      good "Your site is live."
      bold "  $LIVE_URL"
      info "That's the address — copy it straight from the line above."
    else
      # Reading the address is wrangler's to give and ours to lose, so the
      # fallback has to send someone somewhere real rather than gesture at
      # output that may have scrolled away.
      good "Your site is live."
      info "Couldn't read the address back this time. It's in Cloudflare:"
      info "  dash.cloudflare.com → Compute → Workers & Pages → your site"
      info "  then the blue \"Visit\" button, top right."
    fi
  else
    rm -rf "$deploy_dir"
    oops "The deploy didn't go through."
    info "Cloudflare's own words are in the output above — that line is the real"
    info "answer, and it is usually specific."
    info "Your storage is all set up, so nothing is lost. Fix what it names and"
    info "run this script again; it picks up right here."
    exit 1
  fi
  rm -rf "$deploy_dir"
fi

# ---- 8. secrets -----------------------------------------------------------
step 8 "Setting your password"
info "Two things get stored securely on Cloudflare — never in your code,"
info "never in your repo, and not visible to anyone who clones your site."
echo
# Failures show wrangler's own last line. The old version swallowed all output
# and guessed "check you're online", which was wrong every single time it fired.
secret_put() { # secret_put NAME VALUE "done message" "the thing, for the error"
  local out rc
  out="$(printf '%s' "$2" | npx wrangler secret put "$1" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then good "$3"; return 0; fi
  warn "Couldn't save the $4. Cloudflare said:"
  printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 | sed 's/^/      /'
  info "Running this script again retries it."
  return 1
}
session_secret="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
secret_put SESSION_SECRET "$session_secret" "Signing key generated." "signing key"

info "Now your console password. This is what you'll use to sign in and post"
info "photos. It's scrambled before it's stored, so nobody — including you —"
info "can read it back. Pick something you'll remember, or save it in a"
info "password manager now."
echo
while :; do
  read -r -s -p "  Password: " pw; echo
  [ ${#pw} -ge 8 ] && break
  info "A bit longer, please — at least 8 characters."
done
hash="$(node -e "require('bcryptjs').hash(process.argv[1],12).then(h=>process.stdout.write(h))" "$pw")"
secret_put AUTH_PASSWORD_HASH "$hash" "Password saved." "password"
unset pw hash

# ---- final check ----------------------------------------------------------
echo
if any_placeholder_left; then
  oops "Almost there — a couple of settings didn't fill in."
  info "These are still blank in wrangler.jsonc:"
  node scripts/lib/config-check.mjs wrangler.jsonc | sed 's/^/    /'
  info "Re-running this script will try them again."
  exit 1
fi

# What ended up where. This exists because a real run showed a red "already
# exists" error immediately followed by a green tick, and the person running it
# had no way to tell whether their existing list had been adopted or clobbered.
# Naming each piece — and whether it was made or reused — is the answer to the
# question they were actually asking.
if [ -n "$SUMMARY_LINES" ]; then
  echo
  bold "What your site is using"
  printf '%s' "$SUMMARY_LINES" | while IFS='|' read -r kind what; do
    [ -n "$what" ] || continue
    case "$kind" in
      made)   good "$what  (created just now)" ;;
      reused) good "$what  (already on your account — reused, not changed)" ;;
    esac
  done
fi

echo
# Two shapes, because "Open the address above" with no address above is how the
# last cold run ended. Whichever branch runs, the reader is left holding
# something they can actually act on.
if [ -n "$LIVE_URL" ]; then
  bold "Done. Your site is live at:"
  bold "  $LIVE_URL"
  info "Your control room is that address with /dev/field-console on the end:"
  info "  $LIVE_URL/dev/field-console"
  echo
  info "Lost it later? It's in Cloudflare under"
  info "Compute → Workers & Pages → your site → the \"Visit\" button."
  first_step="Open the address above."
else
  bold "Done. Your site is live."
  echo
  info "To find its address:"
  info "  dash.cloudflare.com → Compute → Workers & Pages → your site"
  info "  then the blue \"Visit\" button, top right. (Or the Domains tab, where"
  info "  it's listed under Worker URL → Production.)"
  info "Your control room is that address with /dev/field-console on the end."
  first_step="Open your site's address, found as above."
fi

# Step 1 is printed separately, then the rest as a QUOTED heredoc. The quoting
# is not stylistic: the block below contains backticks around `npx wrangler
# deploy`, and an unquoted heredoc would run them as command substitution —
# deploying the site from inside a help message.
printf '\n  Next, in order:\n\n  1. Have a look at it\n     %s It comes with sample\n     photographs, so it should look like a real site straight away.\n' "$first_step"
cat <<'EOF'

  2. Put your name on it
     Open site.config.js and fill in your name, tagline, email and
     location. That's the only file with your details in it.

  3. Publish the change
     npx wrangler deploy
     Same command as before. Run it any time you change something.

  4. Check everything
     bash scripts/doctor.sh

  Then sign in at your address + /dev/field-console with the password you
  just set, and start posting.

  5. Make a GitHub token, and give it to your site
     One token, two jobs: it lets your console save posts to GitHub, and it
     is also what you type when git asks for a password. Make a fine-grained
     token with Contents: Read and write on this repo only —
     GitHub -> Settings -> Developer settings -> Personal access tokens.
     It is shown once, so put it in your password manager as it appears.
        echo -n 'ghp_your_token' | npx wrangler secret put GITHUB_TOKEN
        echo -n 'you/your-repo'  | npx wrangler secret put GITHUB_REPO
     Full walkthrough in setup.md, "GITHUB_TOKEN + GITHUB_REPO".

  6. Send your settings to GitHub  <- do this before step 7
     Your settings are saved on this computer. GitHub still has the blank
     template, and step 7 makes Cloudflare read GitHub's copy, so this has
     to happen first:
        git add -A
        git commit -m "my site"
        git push
     The push asks for a username and a password. The "password" is the
     token from step 5, NOT your GitHub account password. The account
     password is refused, which looks like a broken login and is not.

  7. Connect your GitHub repo to Cloudflare
     This is what makes the Publish button in your console actually put
     things live. Without it, Publish saves to GitHub and your site keeps
     serving the old copy until you run `npx wrangler deploy` by hand:
        Cloudflare dashboard -> Compute -> Workers & Pages -> your Worker
        -> Settings -> Build -> Connect a repository
     (Cloudflare is mid-redesign. Older accounts show "Workers & Pages"
     straight in the sidebar with no "Compute" above it — same place.)
     Leave the build command empty (there is nothing to build), keep the
     deploy command as `npx wrangler deploy`, and switch OFF builds for
     non-production branches. Then set  repoConnected: true  in
     site.config.js, commit and push — that push is what starts the first
     build. From then on go live with `git push`, not `npx wrangler deploy`,
     which the next automatic build would quietly undo.
     Full walkthrough in setup.md, "Connect your repo".

  Optional extras — each one is off until you set it, and nothing breaks
  while it's off:
     ADMIN_KEY                    export your subscriber list
     B2_*                         cold storage for RAW files
     ARCHIVE_S3_*                 daily backup to the Internet Archive

  Turn one on with:
     echo -n 'the-value' | npx wrangler secret put NAME

  A note on locking the door
  Your admin console is already private — it asks for the password you just
  set before it will even load. If your site will hold client photos or a
  subscriber list, you can add a second lock at Cloudflare's edge so the
  page never even reaches your site without an approved sign-in:
     Cloudflare dashboard -> Zero Trust -> Access controls -> Applications
     (Some accounts still label that sidebar entry "Cloudflare One". Same
     place, same screens — Cloudflare has renamed it in both directions.)
  Free for up to 50 people. Full walkthrough in setup.md, "Optional hardening".
EOF
