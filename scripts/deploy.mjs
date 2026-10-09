#!/usr/bin/env node
// THE DEPLOY STEP (package.json "deploy", after the D1 migrations).
//
// On Cloudflare's own builds (the one-click install, and every publish after
// it) this is `wrangler deploy` plus two plain variables the site cannot learn
// any other way:
//   REPO_CONNECTED=true  this site deploys itself from git. Publish says
//                        "Cloudflare is rebuilding", not "run npx wrangler
//                        deploy" (src/api/site-meta.js). It used to need a
//                        hand edit of site.config.js, a code file, on a phone.
//   GIT_REPO=owner/repo  the repo the build came from, so setting the Publish
//                        key from the console needs no `owner/repo` typed
//                        (src/api/publish-key.js). Read from the checkout's
//                        own remote; credentials in the URL are never passed.
// Cloudflare's builds set WORKERS_CI=1. Anywhere else (a terminal deploy) this
// is plain `wrangler deploy`, as it always was.

import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Pure: `owner/repo` from a git remote URL (https or ssh), credentials dropped. */
export function repoFromRemote(url) {
  const m = String(url || '').trim().match(/github\.com[/:]([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Pure: wrangler's arguments for this environment. */
export function deployArgs(env, remoteUrl) {
  const args = ['wrangler', 'deploy'];
  if (env && env.WORKERS_CI === '1') {
    args.push('--var', 'REPO_CONNECTED:true');
    const repo = repoFromRemote(remoteUrl);
    if (repo) args.push('--var', `GIT_REPO:${repo}`);
  }
  return args;
}

function remoteUrl() {
  try {
    return execFileSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = deployArgs(process.env, remoteUrl());
  console.log(`> npx ${args.join(' ')}`);
  const r = spawnSync('npx', args, { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}
