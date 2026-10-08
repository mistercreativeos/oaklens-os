// Sync coherence + the no-op commit guard (src/api/publish.js).
//
// The incident these pin (2026-08-23 maintenance log): a publish writes
// through GitHub's Git Data API (strongly consistent), but handleSync used to
// read file contents at `contents/<path>?ref=main` — and `main` there resolves
// on GitHub's eventually-consistent side, which can serve the PREVIOUS
// commit's content for a few seconds after a publish. So a sync could return a
// FRESH headSha stamped onto STALE files; the console imported them, silently
// reverting just-published (or just-edited) entries, and the next publish —
// built on that reverted state but carrying the fresh sha — sailed past the
// stale-base guard and re-committed the past. Repo evidence: frames committed
// bare on their first publish with focal/pin arriving only in a re-commit
// minutes later, plus two publish commits that changed zero files.
//
// The fix: resolve main's HEAD first and pin every content read to that sha,
// making "fresh sha, stale content" unrepresentable. And when a publish's tree
// is byte-identical to main's, don't manufacture an empty commit — answer with
// the current head instead.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../worker.js';
import { createToken } from '../src/shared/auth.js';

const SECRET = 'test-secret-please-ignore';
const ctx = { waitUntil() {} };
const env = { SESSION_SECRET: SECRET, GITHUB_TOKEN: 'gh-token', GITHUB_REPO: 'owner/repo' };

afterEach(() => { vi.restoreAllMocks(); });

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

const syncReq = async (files = 'data/posts.json,data/buffer.json') =>
  new Request(`https://example.com/api/sync?files=${files}`, {
    headers: { Authorization: `Bearer ${await createToken(env)}` },
  });

describe('GET /api/sync — content reads are pinned to the resolved head', () => {
  function stubSync({ refOk = true, commitsOk = false } = {}) {
    const seen = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      seen.push(u);
      if (u.includes('git/ref/heads/main')) {
        return refOk
          ? new Response(JSON.stringify({ object: { sha: 'SHA_HEAD' } }), { status: 200 })
          : new Response(JSON.stringify({ message: 'rate limited' }), { status: 403 });
      }
      if (u.includes('/commits/main')) {
        return commitsOk
          ? new Response(JSON.stringify({ sha: 'SHA_HEAD' }), { status: 200 })
          : new Response(JSON.stringify({ message: 'rate limited' }), { status: 403 });
      }
      if (u.includes('/contents/')) {
        return new Response(JSON.stringify({ content: b64('[]') }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    return seen;
  }

  it('fetches every file at ref=<headSha>, never at the movable ref=main', async () => {
    const seen = stubSync();
    const body = await (await worker.fetch(await syncReq(), env, ctx)).json();

    expect(body.headSha).toBe('SHA_HEAD');
    const contentReads = seen.filter((u) => u.includes('/contents/'));
    expect(contentReads.length).toBe(2);
    for (const u of contentReads) {
      expect(u, 'content must be read at the same revision the snapshot is stamped with')
        .toMatch(/\?ref=SHA_HEAD$/);
    }
  });

  it('the head resolves BEFORE any file is read — the pin cannot be a race', async () => {
    const seen = stubSync();
    await worker.fetch(await syncReq(), env, ctx);
    const firstContent = seen.findIndex((u) => u.includes('/contents/'));
    const refRead = seen.findIndex((u) => u.includes('git/ref/heads/main'));
    expect(refRead).toBeGreaterThanOrEqual(0);
    expect(firstContent).toBeGreaterThan(refRead);
  });

  it('falls back to ref=main when the head is unreadable — and says the guard is disarmed', async () => {
    // Old behavior, kept deliberately: files are still useful without a base
    // revision. But the response must announce it (headShaError/disarmed) —
    // that contract is pinned in publish-guard-failclosed.test.js; here we pin
    // that the reads really do fall back rather than erroring out.
    const seen = stubSync({ refOk: false, commitsOk: false });
    const body = await (await worker.fetch(await syncReq(), env, ctx)).json();

    expect(body.headSha).toBeNull();
    expect(body.staleBaseGuard).toBe('disarmed');
    expect(body.files['data/posts.json'].ok).toBe(true);
    for (const u of seen.filter((x) => x.includes('/contents/'))) {
      expect(u).toMatch(/\?ref=main$/);
    }
  });
});

describe('POST /api/publish — an identical tree makes no commit', () => {
  // GitHub answers a tree POST whose contents match base_tree with the SAME
  // tree sha. Committing that anyway is how the zero-file "publish: field
  // console update" commits got into the history.
  function stubPublish({ newTreeSha }) {
    const seen = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init = {}) => {
      const u = String(url);
      seen.push(`${init.method || 'GET'} ${u}`);
      if (u.includes('git/ref/heads/main') && (init.method || 'GET') === 'GET') {
        return new Response(JSON.stringify({ object: { sha: 'SHA_HEAD' } }), { status: 200 });
      }
      if (u.includes('git/commits/SHA_HEAD')) {
        return new Response(JSON.stringify({ tree: { sha: 'TREE_BASE' } }), { status: 200 });
      }
      if (u.endsWith('/git/blobs')) return new Response(JSON.stringify({ sha: 'b' }), { status: 200 });
      if (u.endsWith('/git/trees')) return new Response(JSON.stringify({ sha: newTreeSha }), { status: 200 });
      if (u.endsWith('/git/commits')) return new Response(JSON.stringify({ sha: 'NEW_COMMIT' }), { status: 200 });
      if (u.includes('git/refs/heads/main')) return new Response(JSON.stringify({}), { status: 200 });
      throw new Error(`unexpected fetch: ${u}`);
    });
    return seen;
  }

  const publishReq = async () => new Request('https://example.com/api/publish', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await createToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ path: 'data/posts.json', content: '[{"id":"a"}]' }],
      baseSha: 'SHA_HEAD',
    }),
  });

  it('answers with the current head and moves nothing when the tree is unchanged', async () => {
    const seen = stubPublish({ newTreeSha: 'TREE_BASE' });
    const res = await worker.fetch(await publishReq(), env, ctx);

    expect(res.status).toBe(200);
    expect((await res.json()).sha, 'the console records this as its base — it must be the real head')
      .toBe('SHA_HEAD');
    expect(seen.some((s) => s.endsWith('/git/commits') && s.startsWith('POST')),
      'no commit object may be created for a no-op publish').toBe(false);
    expect(seen.some((s) => s.startsWith('PATCH') && s.includes('git/refs/heads/main')),
      'main must not be moved').toBe(false);
  });

  it('a changed tree still commits exactly as before', async () => {
    const seen = stubPublish({ newTreeSha: 'TREE_NEW' });
    const res = await worker.fetch(await publishReq(), env, ctx);

    expect(res.status).toBe(200);
    expect((await res.json()).sha).toBe('NEW_COMMIT');
    expect(seen.some((s) => s.startsWith('PATCH') && s.includes('git/refs/heads/main'))).toBe(true);
  });
});
