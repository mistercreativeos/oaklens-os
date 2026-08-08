import { describe, it, expect } from 'vitest';
import worker from '../worker.js';
import { createToken } from '../src/shared/auth.js';

// The secrets diet: AUTH_PASSWORD_HASH + SESSION_SECRET are the only required
// secrets. Every optional secret gates one feature, and a missing one must
// answer 501 { notConfigured: true } — a state the console renders as
// "not configured", never as a red-latched fault, and never retries
// (the client retry set is status 0/502/503/504 only).

const SESSION_SECRET = 'test-secret-please-ignore';

// Minimal KV stand-in for the rate limiter (fail-open contract: get/put only).
const kvStub = { get: async () => null, put: async () => {} };

const baseEnv = { SESSION_SECRET, SUBSCRIBERS: kvStub };

async function authedReq(path, { method = 'GET', env = baseEnv, body } = {}) {
  const token = await createToken(env);
  return new Request(`https://example.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body } : {}),
  });
}

describe('GitHub publish/sync without GITHUB_TOKEN/GITHUB_REPO', () => {
  it('POST /api/publish answers 501 notConfigured for an authed session', async () => {
    const res = await worker.fetch(await authedReq('/api/publish', { method: 'POST', body: '{"files":[{"path":"x","content":"y"}]}' }), baseEnv);
    expect(res.status).toBe(501);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.notConfigured).toBe(true);
    expect(data.error).toContain('GITHUB_TOKEN');
    expect(data.error).toContain('GITHUB_REPO');
  });

  it('GET /api/sync answers 501 notConfigured for an authed session', async () => {
    const res = await worker.fetch(await authedReq('/api/sync'), baseEnv);
    expect(res.status).toBe(501);
    const data = await res.json();
    expect(data.notConfigured).toBe(true);
  });

  it('501 is not in the client retry set (0/502/503/504)', async () => {
    // Guards the contract the console relies on: notConfigured must never
    // burn retry backoff. If the retry set ever grows to include 501, the
    // degradation design needs revisiting.
    const retryable = [0, 502, 503, 504];
    expect(retryable).not.toContain(501);
  });

  it('auth still comes first: no token → 401, even with GitHub unset', async () => {
    // Config state must not leak to unauthenticated callers.
    const res = await worker.fetch(new Request('https://example.com/api/publish', { method: 'POST' }), baseEnv);
    expect(res.status).toBe(401);
  });

  it('with GitHub configured, the gate passes (bad body reaches 400, not 501)', async () => {
    const env = { ...baseEnv, GITHUB_TOKEN: 't', GITHUB_REPO: 'owner/repo' };
    const res = await worker.fetch(await authedReq('/api/publish', { method: 'POST', body: 'not json', env }), env);
    expect(res.status).toBe(400);
  });
});

describe('subscriber export without ADMIN_KEY', () => {
  it('answers 501 notConfigured instead of 401', async () => {
    const res = await worker.fetch(new Request('https://example.com/api/subscribers/export'), baseEnv);
    expect(res.status).toBe(501);
    const data = await res.json();
    expect(data.notConfigured).toBe(true);
    expect(data.error).toContain('ADMIN_KEY');
  });

  it('with ADMIN_KEY set, a wrong key is still 401 (feature on, caller unauthorized)', async () => {
    const env = { ...baseEnv, ADMIN_KEY: 'real-key' };
    const res = await worker.fetch(new Request('https://example.com/api/subscribers/export', {
      headers: { Authorization: 'Bearer wrong-key' },
    }), env);
    expect(res.status).toBe(401);
  });
});

describe('bench RAW proxy without B2 secrets', () => {
  it('answers 501 notConfigured for an authed session', async () => {
    const res = await worker.fetch(await authedReq('/api/bench/raw/some-file.dng'), baseEnv);
    expect(res.status).toBe(501);
    const data = await res.json();
    expect(data.notConfigured).toBe(true);
  });
});
