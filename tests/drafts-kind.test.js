// A draft's kind (K65, migrations/0003_draft_kind.sql): 'note' or 'spark'
// (the Bridge's quick draft). Held here: the kind a console sends is kept;
// a console that sends none (an older cached one) never demotes a spark; and
// a D1 that never ran 0003 (a fork deployed with a plain `wrangler deploy`)
// keeps its cloud drafts working on the columns before it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import worker from '../worker.js';
import { createToken } from '../src/shared/auth.js';
import { isMissingColumnError } from '../src/api/drafts.js';

const SESSION_SECRET = 'test-secret-please-ignore';

// A fake D1 that understands the numbered statement, with or without `kind`.
// `migrated: false` answers any statement naming `kind` the way SQLite does.
function makeDB({ migrated = true } = {}) {
  const table = new Map();
  const seen = [];
  function exec(sql, binds) {
    if (!migrated && /\bkind\b/.test(sql)) throw new Error('D1_ERROR: table fn_drafts has no column named kind');
    if (/^\s*SELECT/i.test(sql)) {
      if (/ORDER BY/.test(sql)) return { results: [...table.values()] };
      return table.get(String(binds[0])) || null;
    }
    const [id, fn_id, title, location, date, body, hero_filename, buffer_dates, updated_at] = binds;
    const prev = table.get(String(id));
    if (prev && / WHERE fn_drafts\.updated_at <= \?10/.test(sql) && !(prev.updated_at <= binds[9])) return null;
    const row = { id: String(id), fn_id, title, location, date, body, hero_filename, buffer_dates,
      updated_at: prev ? Math.max(updated_at, prev.updated_at + 1) : updated_at };
    if (migrated) row.kind = binds[10] ?? (prev ? prev.kind : 'note');
    table.set(row.id, row);
    return { updated_at: row.updated_at };
  }
  return {
    table, seen,
    prepare(sql) {
      const rec = { sql, binds: [] };
      seen.push(rec);
      const stmt = {
        bind(...b) { rec.binds = b; return stmt; },
        async first() { return exec(sql, rec.binds); },
        async all() { return exec(sql, rec.binds); },
        async run() { return { meta: { changes: 1 } }; },
      };
      return stmt;
    },
  };
}

const env = (db) => ({ SESSION_SECRET, DB: db });
async function call(db, method, body) {
  const e = env(db);
  const token = await createToken(e);
  return worker.fetch(new Request('https://example.com/api/drafts', {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), e);
}
const draft = (over = {}) => ({ id: 's1', title: 'Untitled', body: 'a thought on the train', ...over });

describe('PUT /api/drafts carries a draft\'s kind', () => {
  it('keeps the kind it is sent, and a new draft with none is a note', async () => {
    const db = makeDB();
    expect((await call(db, 'PUT', draft({ kind: 'spark' }))).status).toBe(200);
    expect(db.table.get('s1').kind).toBe('spark');
    expect((await call(db, 'PUT', draft({ id: 'n1' }))).status).toBe(200);
    expect(db.table.get('n1').kind).toBe('note');
  });

  it('a console that sends no kind never demotes a spark', async () => {
    const db = makeDB();
    await call(db, 'PUT', draft({ kind: 'spark' }));
    await call(db, 'PUT', draft({ body: 'edited on an old console' }));
    expect(db.table.get('s1').kind).toBe('spark');
    // …and an EXPAND sends 'note' on purpose.
    await call(db, 'PUT', draft({ kind: 'note' }));
    expect(db.table.get('s1').kind).toBe('note');
  });

  it('refuses a kind it does not know, as if none were sent', async () => {
    const db = makeDB();
    await call(db, 'PUT', draft({ kind: 'spark' }));
    await call(db, 'PUT', draft({ kind: 'nonsense' }));
    expect(db.table.get('s1').kind).toBe('spark');
  });

  it('binds no slot past a statement\'s highest parameter', async () => {
    const db = makeDB();
    await call(db, 'PUT', draft({ kind: 'spark' }));
    const put = db.seen.find((r) => /^\s*INSERT/.test(r.sql));
    const highest = Math.max(...[...put.sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
    expect(put.binds.length).toBe(highest);
  });
});

describe('an unmigrated D1 keeps its drafts (0003 never ran)', () => {
  it('PUT and GET fall back to the columns before `kind`', async () => {
    const db = makeDB({ migrated: false });
    const put = await call(db, 'PUT', draft({ kind: 'spark' }));
    expect(put.status).toBe(200);
    const legacy = db.seen.filter((r) => /^\s*INSERT/.test(r.sql)).at(-1);
    expect(legacy.sql).not.toMatch(/\bkind\b/);
    expect(legacy.binds.length).toBe(Math.max(...[...legacy.sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]))));
    const got = await call(db, 'GET');
    expect(got.status).toBe(200);
    expect((await got.json()).drafts.map((d) => d.id)).toEqual(['s1']);
  });

  it('recognises SQLite\'s two spellings of a missing column, and nothing else', () => {
    expect(isMissingColumnError(new Error('table fn_drafts has no column named kind'))).toBe(true);
    expect(isMissingColumnError(new Error('no such column: kind'))).toBe(true);
    expect(isMissingColumnError(new Error('no such table: fn_drafts'))).toBe(false);
  });
});

describe('the migration', () => {
  it('adds kind with a default every existing row takes, and says it is safe to skip', () => {
    const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '0003_draft_kind.sql'), 'utf8');
    expect(sql).toMatch(/ALTER TABLE fn_drafts ADD COLUMN kind TEXT NOT NULL DEFAULT 'note';/);
  });
});
