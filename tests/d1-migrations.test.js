// The unmigrated-D1 floor + the migrations plumbing (F6, 2026-08-07).
//
// A one-click Deploy install binds D1 but nothing in that flow is guaranteed
// to create the console tables — and before this, /api/drafts answered a raw
// "no such table" 500 that red-latched the console for exactly the
// zero-terminal audience. Two layers fix it, both pinned here:
//
//   1. THE FLOOR: drafts + bench handlers catch D1 "no such table" and answer
//      the standard 501 notConfigured shape (the console treats it as
//      "feature off", never a fault) with a hint naming the migrations
//      command. Verified to fail against the old handlers, which returned
//      500 (drafts) / 503 (bench list).
//   2. THE FIX: the console tables are wrangler migrations (migrations/),
//      applied by setup.sh and by the package.json `deploy` script — the
//      command Workers Builds runs on the one-click path.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import worker from '../worker.js';
import { createToken } from '../src/shared/auth.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const SESSION_SECRET = 'test-secret-please-ignore';

// A bound D1 whose tables were never created: every statement raises the
// error SQLite raises. (D1 surfaces it via the promise, message intact.)
function tablelessDB() {
  const raise = (sql) => {
    const m = /(?:FROM|INTO|UPDATE)\s+(\w+)/i.exec(sql);
    throw new Error(`D1_ERROR: no such table: ${m ? m[1] : 'fn_drafts'}: SQLITE_ERROR`);
  };
  return {
    prepare(sql) {
      const stmt = {
        bind() { return stmt; },
        async all() { raise(sql); },
        async first() { raise(sql); },
        async run() { raise(sql); },
      };
      return stmt;
    },
    async batch() { throw new Error('D1_ERROR: no such table: bench_entries: SQLITE_ERROR'); },
  };
}

async function call(path, method = 'GET', body) {
  const env = { SESSION_SECRET, DB: tablelessDB() };
  const token = await createToken(env);
  return worker.fetch(new Request(`https://example.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
}

describe('an unmigrated D1 answers the deliberate 501, never a raw 500', () => {
  it.each([
    ['GET /api/drafts', () => call('/api/drafts')],
    ['PUT /api/drafts', () => call('/api/drafts', 'PUT', { id: 'd1', body: 'x' })],
    ['DELETE /api/drafts', () => call('/api/drafts', 'DELETE', { id: 'd1' })],
    ['GET /api/bench', () => call('/api/bench')],
    ['POST /api/bench/entries', () => call('/api/bench/entries', 'POST', [{ id: 'b1' }])],
    ['DELETE /api/bench/done', () => call('/api/bench/done', 'DELETE')],
  ])('%s', async (_label, fire) => {
    const res = await fire();
    const data = await res.json();
    // The optional-secret degradation contract (src/shared/http.js): 501 +
    // notConfigured:true is what the console already knows not to red-latch
    // or retry on; anything else surfaces as a fault lamp.
    expect(res.status).toBe(501);
    expect(data.notConfigured).toBe(true);
    // The hint must name the fix — the command, since the fix is not a secret.
    expect(data.error).toContain('wrangler d1 migrations apply');
  });

  it('a real D1 failure still surfaces as an error, not a fake 501', async () => {
    const env = { SESSION_SECRET, DB: {
      prepare() { const s = { bind: () => s, async all() { throw new Error('D1_ERROR: database is locked'); } }; return s; },
    } };
    const token = await createToken(env);
    const res = await worker.fetch(new Request('https://example.com/api/drafts', {
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    expect(res.status).toBe(500);
    expect((await res.json()).notConfigured).toBeUndefined();
  });
});

describe('the migrations are the single source of truth for console tables', () => {
  const migration = read('migrations/0001_console_tables.sql');

  it('migration 0001 creates both console tables, idempotently', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS fn_drafts/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS bench_entries/);
    // Idempotence is what makes applying them to a pre-migrations instance
    // database (tables already created via d1 execute) a clean no-op.
    expect(migration).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
  });

  it('the superseded schema files are gone — one copy, no drift', () => {
    expect(existsSync(join(ROOT, 'src/console/schema-fn-drafts.sql'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/console/schema-bench.sql'))).toBe(false);
  });

  it('both wrangler configs point D1 at migrations/', () => {
    for (const cfg of ['wrangler.jsonc', 'wrangler.example.jsonc']) {
      expect(read(cfg), cfg).toMatch(/"migrations_dir":\s*"migrations"/);
    }
  });

  it('the package.json deploy script applies migrations before deploying', () => {
    // This is the one-click path: Workers Builds runs the repo's deploy
    // script, and Cloudflare's deploy-button docs say to chain migrations
    // there, referencing the BINDING name (DB) so it works whatever the
    // fork named its database.
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['db:migrate']).toContain('d1 migrations apply DB --remote');
    expect(pkg.scripts.deploy).toMatch(/db:migrate.*wrangler deploy/);
  });

  it('setup.sh applies the migrations (CLI path, same files)', () => {
    expect(read('scripts/setup.sh')).toMatch(/wrangler d1 migrations apply "\$db_name" --remote/);
  });
});
