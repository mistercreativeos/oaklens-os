// The Publish key, set from the console (src/api/publish-key.js).
//
// The wall between a one-click install and a working studio on a phone was a
// second dashboard: two secrets, one of them an exact `owner/repo`. The owner
// can now paste the key into the console; the site checks it with GitHub and
// keeps it in KV (owner decision, 2026-10-08). These pin what that promises:
// the key is never handed back, only the console can set it, a key that cannot
// SAVE to the repo is refused with the reason, the dashboard secrets still
// win, and Publish and sync use whichever is set.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleGetPublishKey, handlePutPublishKey, handleDeletePublishKey,
  githubCreds, checkKey, projectFromHost, PUBLISH_KEY_KV,
} from '../src/api/publish-key.js';
import { createToken } from '../src/shared/auth.js';

const KEY = 'fake-key-for-tests-0123456789-abcdefghijklmnopqrstuvwxyz-WXYZ';

/** GitHub, as the key sees it: which repos it can see, and which it can write. */
let github;
let calls;
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  github = { valid: [KEY], login: 'ada', sees: ['ada/my-studio'], writes: ['ada/my-studio'], down: false };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || 'GET').toUpperCase();
    calls.push(`${method} ${u.pathname}`);
    if (github.down) throw new TypeError('fetch failed');
    const auth = (init.headers && init.headers.Authorization) || '';
    const token = auth.replace(/^Bearer /, '');
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
    if (!github.valid.includes(token)) return json({ message: 'Bad credentials' }, 401);
    if (u.pathname === '/user') return json({ login: github.login });
    if (u.pathname === '/user/repos') return json((github.lists || github.sees).map((full_name) => ({ full_name })));
    const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/git\/blobs)?$/);
    if (m) {
      const repo = m[1];
      if (!github.sees.includes(repo)) return json({ message: 'Not Found' }, 404);
      if (!m[2]) return json({ full_name: repo, permissions: { admin: true, push: true } });
      return github.writes.includes(repo)
        ? json({ sha: 'b10b' }, 201)
        : json({ message: 'Resource not accessible by personal access token' }, 403);
    }
    return json({ message: 'Not Found' }, 404);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function site({ kv = new Map(), secrets = {}, vars = {}, noKv = false } = {}) {
  return {
    SESSION_SECRET: 'test-secret-for-publish-key-0123456789',
    ...secrets, ...vars,
    ...(noKv ? {} : {
      SUBSCRIBERS: {
        async get(k) { return kv.has(k) ? kv.get(k) : null; },
        async put(k, v) { kv.set(k, v); },
        async delete(k) { kv.delete(k); },
      },
    }),
    _kv: kv,
  };
}

async function call(handler, env, { method = 'GET', body, host = 'my-studio.ada-account.workers.dev', query = '', auth = true } = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${await createToken(env)}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await handler(new Request(`https://${host}/api/publish/key${query}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json() };
}
const put = (env, body, opts) => call(handlePutPublishKey, env, { method: 'PUT', body, ...opts });

describe('setting the key from the console', () => {
  it('keeps a key that can save to the site\'s repo, and never hands it back', async () => {
    const env = site({ vars: { GIT_REPO: 'ada/my-studio' } });
    const r = await put(env, { token: KEY });
    expect(r.body).toMatchObject({ ok: true, state: 'ok', repo: 'ada/my-studio', last4: 'WXYZ', source: 'console' });
    expect(JSON.stringify(r.body)).not.toContain(KEY.slice(0, -4));
    const g = await call(handleGetPublishKey, env);
    expect(g.body).toMatchObject({ configured: true, source: 'console', repo: 'ada/my-studio', last4: 'WXYZ' });
    expect(JSON.stringify(g.body)).not.toContain(KEY.slice(0, -4));
  });

  it('proves it can WRITE by making one unreferenced blob, nothing on a branch', async () => {
    const env = site({ vars: { GIT_REPO: 'ada/my-studio' } });
    await put(env, { token: KEY });
    expect(calls).toEqual(['GET /repos/ada/my-studio', 'POST /repos/ada/my-studio/git/blobs']);
  });

  it('finds the repo with nothing typed: the build\'s stamp, else the address and the key\'s owner', async () => {
    expect((await put(site({ vars: { GIT_REPO: 'ada/my-studio' } }), { token: KEY })).body.repo).toBe('ada/my-studio');
    const r = await put(site(), { token: KEY });
    expect(r.body).toMatchObject({ ok: true, repo: 'ada/my-studio' });
  });

  it('says exactly what is wrong, and keeps nothing', async () => {
    const cases = [
      [() => { github.valid = []; }, 'rejected'],
      [() => { github.sees = []; }, 'not-granted'],
      [() => { github.writes = []; }, 'read-only'],
      [() => { github.down = true; }, 'unreachable'],
    ];
    for (const [arrange, state] of cases) {
      github = { valid: [KEY], login: 'ada', sees: ['ada/my-studio'], writes: ['ada/my-studio'], down: false };
      arrange();
      const env = site({ vars: { GIT_REPO: 'ada/my-studio' } });
      const r = await put(env, { token: KEY });
      expect(r.body, state).toMatchObject({ ok: false, state });
      expect(env._kv.has(PUBLISH_KEY_KV), `${state} must not be kept`).toBe(false);
    }
  });

  it('when its guess is wrong and the key names one repo, uses that one', async () => {
    github.sees = ['ada/portfolio']; github.writes = ['ada/portfolio'];
    const r = await put(site(), { token: KEY });
    expect(r.body).toMatchObject({ ok: true, repo: 'ada/portfolio' });
  });

  it('when the key names several repos, offers them and binds none (an All-repositories key)', async () => {
    github.sees = ['ada/portfolio', 'ada/dotfiles', 'ada/site']; github.writes = github.sees;
    const env = site();
    const r = await put(env, { token: KEY });
    expect(r.body).toMatchObject({ ok: false, state: 'need-repo', needRepo: true, choices: ['ada/portfolio', 'ada/dotfiles', 'ada/site'] });
    expect(env._kv.has(PUBLISH_KEY_KV)).toBe(false);
    const typed = await put(env, { token: KEY, repo: 'https://github.com/ada/site.git' });
    expect(typed.body).toMatchObject({ ok: true, repo: 'ada/site' });
  });

  it('off workers.dev, where the address says nothing, asks the key', async () => {
    github.sees = ['ada/studio']; github.writes = ['ada/studio'];
    expect((await put(site(), { token: KEY }, { host: 'studio.example.com' })).body).toMatchObject({ ok: true, repo: 'ada/studio' });
    github.lists = [];
    expect((await put(site(), { token: KEY }, { host: 'studio.example.com' })).body).toMatchObject({ ok: false, state: 'need-repo', choices: [] });
  });

  it('a repo typed by hand is checked as typed: no fallback to a list', async () => {
    github.sees = ['ada/portfolio']; github.writes = ['ada/portfolio'];
    expect((await put(site(), { token: KEY, repo: 'ada/elsewhere' })).body).toMatchObject({ ok: false, state: 'not-granted', repo: 'ada/elsewhere' });
  });

  it('turns away what is not a key, or not a repo', async () => {
    expect((await put(site(), { token: 'hunter2' })).body.state).toBe('not-a-key');
    expect((await put(site(), { token: `${KEY} ${KEY}` })).body.state).toBe('not-a-key');
    expect((await put(site(), { token: KEY, repo: 'not a repo' })).body.state).toBe('bad-repo');
  });

  it('answers only the console', async () => {
    const env = site();
    for (const [h, method] of [[handleGetPublishKey, 'GET'], [handlePutPublishKey, 'PUT'], [handleDeletePublishKey, 'DELETE']]) {
      expect((await call(h, env, { method, body: method === 'PUT' ? { token: KEY } : undefined, auth: false })).status).toBe(401);
    }
  });

  it('says plainly when the site has nowhere to keep it', async () => {
    expect((await put(site({ noKv: true }), { token: KEY })).status).toBe(503);
  });
});

describe('reading, checking and removing it', () => {
  it('reports not configured, with the repo it would use', async () => {
    expect((await call(handleGetPublishKey, site({ vars: { GIT_REPO: 'ada/my-studio' } }))).body)
      .toMatchObject({ configured: false, repo: 'ada/my-studio' });
    expect((await call(handleGetPublishKey, site())).body).toMatchObject({ configured: false, repo: null, guess: 'my-studio' });
  });

  it('checks the kept key with GitHub on request (an expired key reads rejected)', async () => {
    const env = site({ vars: { GIT_REPO: 'ada/my-studio' } });
    await put(env, { token: KEY });
    expect((await call(handleGetPublishKey, env, { query: '?check=1' })).body.state).toBe('ok');
    github.valid = [];
    expect((await call(handleGetPublishKey, env, { query: '?check=1' })).body.state).toBe('rejected');
  });

  it('removes the console\'s key', async () => {
    const env = site({ vars: { GIT_REPO: 'ada/my-studio' } });
    await put(env, { token: KEY });
    const d = await call(handleDeletePublishKey, env, { method: 'DELETE' });
    expect(d.body).toMatchObject({ ok: true, configured: false });
    expect(env._kv.has(PUBLISH_KEY_KV)).toBe(false);
  });
});

describe('which key Publish uses', () => {
  it('the dashboard secrets, when both are set, win over the console\'s', async () => {
    const env = site({ secrets: { GITHUB_TOKEN: 'ghp_dashboard', GITHUB_REPO: 'ada/from-dashboard' } });
    env._kv.set(PUBLISH_KEY_KV, JSON.stringify({ token: KEY, repo: 'ada/my-studio', setAt: 1 }));
    expect(await githubCreds(env)).toEqual({ token: 'ghp_dashboard', repo: 'ada/from-dashboard', source: 'secret' });
  });

  it('else the console\'s; else none', async () => {
    const env = site();
    expect(await githubCreds(env)).toBe(null);
    env._kv.set(PUBLISH_KEY_KV, JSON.stringify({ token: KEY, repo: 'ada/my-studio', setAt: 1 }));
    expect(await githubCreds(env)).toEqual({ token: KEY, repo: 'ada/my-studio', source: 'console' });
  });

  it('ignores a kept value that is not a key and a repo', async () => {
    const env = site();
    env._kv.set(PUBLISH_KEY_KV, JSON.stringify({ token: KEY, repo: '../../etc' }));
    expect(await githubCreds(env)).toBe(null);
  });

  it('checkKey and the address reader stand alone', async () => {
    expect(await checkKey(KEY, 'ada/my-studio')).toBe('ok');
    expect(projectFromHost('my-studio.ada.workers.dev')).toBe('my-studio');
    expect(projectFromHost('studio.example.com')).toBe(null);
  });
});

describe('Publish and sync use the console\'s key', () => {
  it('are "not configured" without a key, and reach GitHub with the console\'s', async () => {
    const { handleSync } = await import('../src/api/publish.js');
    const env = site();
    const req = async () => new Request('https://my-studio.ada.workers.dev/api/sync?files=data/posts.json', {
      headers: { Authorization: `Bearer ${await createToken(env)}` },
    });
    expect((await handleSync(await req(), env)).status).toBe(501);
    env._kv.set(PUBLISH_KEY_KV, JSON.stringify({ token: KEY, repo: 'ada/my-studio', setAt: 1 }));
    calls = [];
    const res = await handleSync(await req(), env);
    expect(res.status).not.toBe(501);
    expect(calls.some((c) => c.includes('/repos/ada/my-studio')), calls.join(', ')).toBe(true);
  });
});
