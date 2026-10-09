// ---- The Publish key, set from the console: GET · PUT · DELETE /api/publish/key ----
//
// Publish saves to the site's GitHub repo, so the Worker needs a key to it.
// It used to be two secrets set in the Cloudflare dashboard (GITHUB_TOKEN,
// GITHUB_REPO): on a phone, a second dashboard with an exact `owner/repo` to
// type, the wall between a one-click install and a working studio
// (docs/ideas/install-and-go-on-a-phone.md). Now the owner can paste the key
// into the console, and the site checks it with GitHub and keeps it.
//
// WHERE IT LIVES (owner decision, 2026-10-08): one KV key in the namespace
// that already exists, `__`-prefixed so the subscriber export filters it out
// by construction (src/api/storage.js's convention). Anyone with the
// Cloudflare account can read a KV value, where a secret is write-only; but
// those same people can deploy code that reads the secrets, so the boundary is
// the account either way. What this file guarantees:
//   · the key is never sent back to any browser (GET answers its last four);
//   · only the console's bearer can set, replace or remove it;
//   · the dashboard secrets, when both are set, still win (githubCreds), so an
//     instance configured the old way is untouched;
//   · demo mode cannot write it (worker.js DEMO_LOCKED_ROUTES).
//
// THE CHECK, before a key is kept: GitHub must accept it (401 = rejected), it
// must see the repo (404 = not granted, or not this repo), and it must be able
// to WRITE there. A fine-grained key's repo `permissions` describe the user,
// not the key, so write is proven by creating one unreferenced blob
// (POST /git/blobs): it touches no branch and no file, and GitHub collects it.
//
// WHICH REPO: what the owner typed, else the repo the build came from (the
// deploy stamps GIT_REPO from its own checkout, scripts/deploy.mjs), else a
// guess from the address (`<project>.<account>.workers.dev` is the project,
// and the key says whose it is). A guess that the key cannot see asks.

import { verifyToken } from '../shared/auth.js';
import { jsonRes } from '../shared/http.js';

export const PUBLISH_KEY_KV = '__publish_key';
const GH = 'https://api.github.com';
const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

const store = (env) => (env && env.SUBSCRIBERS) || null;

/** Pure: the project name from a workers.dev address, else null. */
export function projectFromHost(host) {
  const m = String(host || '').toLowerCase().match(/^([a-z0-9-]+)\.[a-z0-9-]+\.workers\.dev$/);
  return m ? m[1] : null;
}

/** The key and repo Publish uses: the dashboard secrets when both are set, else the console's. */
export async function githubCreds(env) {
  if (env && env.GITHUB_TOKEN && env.GITHUB_REPO) {
    return { token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, source: 'secret' };
  }
  const kept = await readKept(env);
  return kept ? { token: kept.token, repo: kept.repo, source: 'console' } : null;
}

async function readKept(env) {
  const kv = store(env);
  if (!kv) return null;
  try {
    const v = await kv.get(PUBLISH_KEY_KV);
    const o = v ? JSON.parse(v) : null;
    return o && typeof o.token === 'string' && REPO_RE.test(o.repo || '') ? o : null;
  } catch { return null; }
}

function gh(token, path, init = {}) {
  return fetch(`${GH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'oaklens-worker/1.0',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

/**
 * Can this key save to this repo? One of:
 *   ok · rejected (GitHub refused the key) · not-granted (it cannot see the
 *   repo: not picked, or not this repo) · read-only · unreachable
 */
export async function checkKey(token, repo) {
  try {
    const r = await gh(token, `/repos/${repo}`);
    if (r.status === 401) return 'rejected';
    if (r.status === 404 || r.status === 403) return 'not-granted';
    if (!r.ok) return 'unreachable';
    const w = await gh(token, `/repos/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: 'oaklens: publish key check', encoding: 'utf-8' }),
    });
    if (w.status === 201) return 'ok';
    if (w.status === 401) return 'rejected';
    if (w.status === 403 || w.status === 404) return 'read-only';
    return 'unreachable';
  } catch { return 'unreachable'; }
}

async function whoseKey(token) {
  try {
    const r = await gh(token, '/user');
    if (r.status === 401) return { rejected: true };
    if (!r.ok) return {};
    const u = await r.json();
    return { login: typeof u.login === 'string' ? u.login : null };
  } catch { return {}; }
}

/** The repos this key can name, newest first (at most 50). A one-repo key may
 *  list only that repo; an "All repositories" key lists the account. */
async function reposOfKey(token) {
  try {
    const r = await gh(token, '/user/repos?per_page=50&sort=pushed&affiliation=owner,collaborator');
    if (!r.ok) return [];
    const list = await r.json();
    return Array.isArray(list) ? list.map((x) => x && x.full_name).filter((n) => REPO_RE.test(n || '')) : [];
  } catch { return []; }
}

const last4 = (t) => String(t).slice(-4);

function describe(creds, env, request) {
  if (creds) {
    return { configured: true, source: creds.source, repo: creds.repo, last4: last4(creds.token) };
  }
  const hint = (env && REPO_RE.test(env.GIT_REPO || '') && env.GIT_REPO) || null;
  return { configured: false, source: null, repo: hint, guess: hint ? null : projectFromHost(new URL(request.url).hostname) };
}

// GET: is Publish on, with which repo; ?check=1 asks GitHub too. Never the key.
export async function handleGetPublishKey(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  const creds = await githubCreds(env);
  const out = { ok: true, ...describe(creds, env, request) };
  if (creds && new URL(request.url).searchParams.get('check') === '1') {
    out.state = await checkKey(creds.token, creds.repo);
  }
  return jsonRes(out, 200);
}

// PUT { token, repo? }: check the key against the repo, keep it only if it can save there.
export async function handlePutPublishKey(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  const kv = store(env);
  if (!kv) return jsonRes({ ok: false, state: 'no-storage', error: 'This site has no KV namespace to keep the key in.' }, 503);
  let body;
  try { body = await request.json(); } catch { return jsonRes({ ok: false, state: 'bad-request' }, 400); }
  const token = String((body && body.token) || '').trim();
  if (token.length < 20 || token.length > 400 || /\s/.test(token)) {
    return jsonRes({ ok: false, state: 'not-a-key' }, 400);
  }
  let repo = String((body && body.repo) || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (repo && !REPO_RE.test(repo)) return jsonRes({ ok: false, state: 'bad-repo', repo }, 400);
  let guessed = false;
  if (!repo && REPO_RE.test(env.GIT_REPO || '')) repo = env.GIT_REPO;
  if (!repo) {
    const who = await whoseKey(token);
    if (who.rejected) return jsonRes({ ok: false, state: 'rejected' }, 200);
    const project = projectFromHost(new URL(request.url).hostname);
    if (who.login && project) { repo = `${who.login}/${project}`; guessed = true; }
  }
  let state = repo ? await checkKey(token, repo) : 'need-repo';
  if (state === 'need-repo' || (guessed && state === 'not-granted')) {
    // No stamp and no right guess: ask GitHub which repos the key names. One is
    // this site's; several mean the key reaches more than it should, so the
    // owner picks (and is told), never a silent guess.
    const choices = await reposOfKey(token);
    if (choices.length === 1) {
      repo = choices[0];
      state = await checkKey(token, repo);
    } else {
      return jsonRes({ ok: false, state: 'need-repo', needRepo: true, repo: repo || null, choices }, 200);
    }
  }
  if (state !== 'ok') {
    return jsonRes({ ok: false, state, repo }, 200);
  }
  try {
    await kv.put(PUBLISH_KEY_KV, JSON.stringify({ token, repo, setAt: Date.now() }));
  } catch {
    return jsonRes({ ok: false, state: 'no-storage' }, 503);
  }
  return jsonRes({ ok: true, state: 'ok', configured: true, source: 'console', repo, last4: last4(token) }, 200);
}

// DELETE: forget the console's key. The dashboard secrets, if any, are untouched.
export async function handleDeletePublishKey(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  const kv = store(env);
  if (kv) { try { await kv.delete(PUBLISH_KEY_KV); } catch { return jsonRes({ ok: false }, 503); } }
  const creds = await githubCreds(env);
  return jsonRes({ ok: true, ...describe(creds, env, request) }, 200);
}
