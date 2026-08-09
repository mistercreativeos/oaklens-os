#!/usr/bin/env bash
# doctor.sh — a health check for your site.
#
# Read-only: it looks at things and tells you what it found. It never creates,
# changes, or deletes anything, so it is always safe to run.
#
#   bash scripts/doctor.sh
#
# Every problem it reports comes with the thing to do about it, because "FAIL"
# on its own is just an unpleasant surprise.
#
# Covered by tests/setup-script.test.js.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

pass=0; warn=0; fail=0
ok()   { printf '  \033[32m✓\033[0m  %s\n' "$1"; pass=$((pass+1)); }
note() { printf '  \033[33m!\033[0m  %s\n' "$1"; warn=$((warn+1)); }
bad()  { printf '  \033[31m✗\033[0m  %s\n' "$1"; fail=$((fail+1)); }
fix()  { printf '     \033[2m→ %s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

echo
printf '\033[1mChecking your site\033[0m\n'
echo

# ---- tools ----------------------------------------------------------------
echo "Tools"
if have node; then ok "Node $(node -v)"; else
  bad "Node.js isn't installed"; fix "Install the LTS version from https://nodejs.org"; fi
have npm && ok "npm $(npm -v)" || { bad "npm isn't available"; fix "It comes with Node — reinstall from https://nodejs.org"; }
if [ -d node_modules ]; then ok "Project tools installed"; else
  note "Project tools not installed yet"; fix "Run: npm install"; fi
echo

# ---- config ---------------------------------------------------------------
echo "Settings"
if [ -f wrangler.jsonc ]; then
  ok "wrangler.jsonc found"
  # Comment-aware. The old check was a plain `grep YOUR_`, which also matched
  # the example file's own explanatory comments — so a *finished* setup was
  # told to go run setup again, every time, forever.
  if left="$(node scripts/lib/config-check.mjs wrangler.jsonc 2>/dev/null)"; then
    ok "All settings filled in"
  else
    bad "Some settings are still blank: $(printf '%s' "$left" | tr '\n' ' ')"
    fix "Run: bash scripts/setup.sh"
  fi
else
  bad "wrangler.jsonc is missing — your site has no settings yet"
  fix "Run: bash scripts/setup.sh"
fi
if [ -f site.config.js ]; then
  ok "site.config.js found"
  if grep -q "you@example.com" site.config.js 2>/dev/null; then
    note "Your contact email is still the example one"
    fix "Open site.config.js and put your real email in"
  fi
else
  bad "site.config.js is missing — this is where your name and details live"
  fix "Run: bash scripts/setup.sh"
fi
echo

# ---- what GitHub actually has ---------------------------------------------
#
# THE CHECK THAT WOULD HAVE SAVED AN EVENING.
#
# `wrangler.jsonc` is tracked and ships full of placeholders. setup.sh fills it
# in on this computer. If it is never committed and pushed, GitHub keeps the
# blank template — and the moment the repo is connected to Cloudflare, Cloudflare
# builds from GitHub's copy: wrong worker name, a junk R2 bucket auto-provisioned
# as `your-bucket-name`, and a hard stop on the KV placeholder. The live site
# carries on serving the last hand-deploy, so there is nothing to see. The person
# only finds out when they wonder why Publish does nothing.
#
# Filled in locally + still blank in the history is a specific, detectable,
# fatal state. So detect it.
#
# All offline, on purpose. Asking GitHub what it holds would mean a network call
# and, on a private repo, a credential prompt — and a health check that hangs
# waiting for a password is worse than one that reports slightly stale news.
# `origin/main` here is the local remote-tracking ref: what this computer last
# saw. That is enough to say "you have work that has not gone up".
echo "Your project's history"
if ! have git; then
  note "Git isn't installed, so I can't check what GitHub has"
  fix "Install it from https://git-scm.com/downloads"
elif [ ! -d .git ]; then
  bad "This folder isn't a git project, so nothing here can reach GitHub"
  fix "The code was probably downloaded as a ZIP. Publishing needs a real clone of your own GitHub copy — see setup.md."
else
  dirty="$(git status --porcelain -- wrangler.jsonc site.config.js 2>/dev/null)"
  head_cfg="$(git show HEAD:wrangler.jsonc 2>/dev/null)"
  history_ok=0
  if [ -z "$head_cfg" ]; then
    bad "Your settings file isn't saved in your project's history at all"
    fix "Run: git add wrangler.jsonc site.config.js && git commit -m \"my site's settings\""
  elif ! printf '%s' "$head_cfg" | node scripts/lib/config-check.mjs - >/dev/null 2>&1; then
    bad "The saved copy of your settings is still the blank template"
    fix "Cloudflare builds from GitHub's copy, not this one. Run: git add wrangler.jsonc site.config.js && git commit -m \"my site's settings\" && git push"
  else
    history_ok=1
    ok "Your settings are saved in your project's history"
  fi

  if [ -n "$dirty" ]; then
    note "You have changes to your settings that aren't saved yet"
    fix "Run: git add wrangler.jsonc site.config.js && git commit -m \"settings\""
  fi

  # Unpushed work. Counted against the last state this computer saw, so it can
  # only ever under-report — which is the safe direction for a warning.
  if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    ahead="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
    if [ "${ahead:-0}" -gt 0 ]; then
      note "$ahead change$([ "$ahead" -eq 1 ] || echo s) saved here but not sent to GitHub yet"
      fix "Run: git push  (the password it asks for is your GitHub token, not your account password)"
    elif [ "$history_ok" = "1" ]; then
      ok "Everything saved here has been sent to GitHub"
    fi
    # No `else` when the saved config is still the template: "everything has been
    # sent to GitHub" is literally true and completely misleading two lines under
    # "the saved copy is still the blank template". Nothing sent is not the same
    # as nothing to send, and a reassuring tick beside a fatal cross is how a
    # report gets skimmed past.
  else
    note "Couldn't tell whether your changes have reached GitHub"
    fix "Run: git push  — it's harmless if there's nothing to send"
  fi
fi
echo

# ---- account + secrets ----------------------------------------------------
echo "Cloudflare"
signed_in=0
if have npx && npx wrangler whoami >/dev/null 2>&1; then
  signed_in=1; ok "Signed in to Cloudflare"
else
  bad "Not signed in to Cloudflare"
  fix "Run: npx wrangler login"
fi

if [ "$signed_in" = "1" ]; then
  # Only meaningful when signed in — otherwise every secret reads as missing
  # and the report screams about problems that do not exist.
  secrets="$(npx wrangler secret list --format json 2>/dev/null || true)"
  has_secret() { printf '%s' "$secrets" | grep -q "\"$1\""; }

  # Two accepted forms for the password. The hash is preferred and wins when
  # both are present; the plaintext form exists so a one-click deploy can ask
  # for a password in a dialog.
  if has_secret AUTH_PASSWORD_HASH; then
    ok "Console password is set (scrambled — the safer form)"
    has_secret AUTH_PASSWORD && {
      note "AUTH_PASSWORD is also set, and is being ignored"
      fix "Tidy up: npx wrangler secret delete AUTH_PASSWORD"; }
  elif has_secret AUTH_PASSWORD; then
    ok "Console password is set"
    note "It's stored as the password itself, not scrambled"
    fix "Safer: bash scripts/setup.sh re-scrambles it, then delete AUTH_PASSWORD"
  else
    bad "Console password isn't set — you won't be able to sign in"
    fix "Run: bash scripts/setup.sh"
  fi

  # The signing key can be generated and kept in KV, so an unset secret is
  # only a problem when there is no KV namespace to keep it in.
  if has_secret SESSION_SECRET; then
    ok "Signing key is set"
  elif grep -q '"binding": *"SUBSCRIBERS"' wrangler.jsonc 2>/dev/null; then
    ok "Signing key generates itself on first use"
  else
    bad "No signing key, and nowhere to keep a generated one"
    fix "Run: bash scripts/setup.sh"
  fi

  # Does the storage this config NAMES actually exist on the account?
  #
  # It did not, on a real first run, and nothing here noticed. setup.sh had
  # written `photo-cdn` into the config after a create that failed, so every
  # check above went green while the bucket had never been made — and the
  # truth only arrived as a dead `wrangler deploy` some minutes later. A health
  # check that reads the settings file and stops there is checking the map, not
  # the ground.
  cfg_value() { grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" wrangler.jsonc 2>/dev/null | head -1 | sed 's/.*:[[:space:]]*"//;s/"$//'; }

  bucket="$(cfg_value bucket_name)"
  if [ -n "$bucket" ]; then
    r2_out="$(npx wrangler r2 bucket info "$bucket" 2>&1)"
    if [ $? -eq 0 ]; then
      ok "Photo storage \"$bucket\" is there"
    elif printf '%s' "$r2_out" | grep -qE '10042|enable R2|not entitled to use r2'; then
      bad "Photo storage isn't switched on for your Cloudflare account yet"
      fix "Turn it on once in your browser: dash.cloudflare.com -> Storage & databases -> R2"
    else
      bad "Your settings name a photo storage called \"$bucket\", but it isn't on your account"
      fix "Run: bash scripts/setup.sh"
    fi
  fi

  db="$(cfg_value database_name)"
  if [ -n "$db" ] && [ "$db" != "YOUR_DB_NAME" ]; then
    if npx wrangler d1 list --json 2>/dev/null | grep -q "\"$db\""; then
      ok "Database \"$db\" is there"
    else
      bad "Your settings name a database called \"$db\", but it isn't on your account"
      fix "Run: bash scripts/setup.sh"
    fi
  fi

  # Optional features. Each is off until you set it, and off is a valid,
  # fully-working state — so these are notes, never failures.
  # GITHUB_TOKEN + GITHUB_REPO are NOT in the optional list any more. They are
  # what the console's Publish button runs on, and a site you cannot publish
  # from is a demo. Still a note rather than a cross — the site genuinely works,
  # and someone mid-install has not failed at anything — but it gets its own
  # line instead of sitting between RAW cold storage and Wayback backups.
  if has_secret GITHUB_TOKEN && has_secret GITHUB_REPO; then
    ok "Publishing from the console is wired up"
  else
    note "Publishing from the console isn't set up yet — the Publish button will say \"not configured\""
    fix "setup.md, \"GITHUB_TOKEN + GITHUB_REPO\" — it is the one optional-looking step that isn't optional"
  fi

  off=""
  add_off() { off="${off}${off:+, }$1"; }
  has_secret ADMIN_KEY      || add_off "subscriber export"
  has_secret B2_APP_KEY     || add_off "RAW cold storage"
  has_secret ARCHIVE_S3_ACCESS || add_off "daily Internet Archive backup"
  if [ -n "$off" ]; then
    note "Optional features currently off: $off"
    fix "That's fine — everything else works. setup.md lists how to turn one on."
  else
    ok "All optional features configured"
  fi
else
  note "Skipped the password and feature checks (needs you signed in)"
fi
echo

# ---- security -------------------------------------------------------------
echo "Security"
if grep -Eq '^[[:space:]]*consoleShellPublic:[[:space:]]*true' site.config.js 2>/dev/null; then
  note "Your admin console page is set to load for anyone"
  fix "Only do this if your site holds nothing private. Remove consoleShellPublic from site.config.js to lock it again."
else
  ok "Admin console is private (asks for your password before it loads)"
fi
note "Optional second lock: Zero Trust → Access controls → Applications"
fix "Puts a sign-in wall at Cloudflare's edge, in front of /dev/field-console. Free for up to 50 people; walkthrough in setup.md. (Some accounts still label that sidebar entry \"Cloudflare One\".)"
echo

# ---- tests ----------------------------------------------------------------
echo "Self-test"
if have npm && [ -d node_modules ]; then
  log="$(mktemp)"
  if npm test --silent >"$log" 2>&1; then
    ok "All internal checks passed"
    rm -f "$log"
  else
    bad "Some internal checks failed"
    fix "Details: $log"
  fi
else
  note "Skipped (install the project tools first)"
  fix "Run: npm install"
fi
echo

# ---- summary --------------------------------------------------------------
if [ "$fail" -eq 0 ] && [ "$warn" -eq 0 ]; then
  printf '\033[1;32mEverything looks good.\033[0m  %d checks passed.\n' "$pass"
elif [ "$fail" -eq 0 ]; then
  printf '\033[1;32mGood to go.\033[0m  %d passed, %d thing%s worth a look (none of it broken).\n' \
    "$pass" "$warn" "$([ "$warn" -eq 1 ] || echo s)"
else
  printf '\033[1;31m%d thing%s need fixing\033[0m before your site will work properly.\n' \
    "$fail" "$([ "$fail" -eq 1 ] || echo s)"
  printf 'Each one above has a → line telling you what to run.\n'
fi
echo
[ "$fail" -eq 0 ]
