-- Migration 0001 — the Field Console's D1 tables (fn_drafts + bench_entries).
--
-- THE single source of truth for console tables (2026-08-07; they lived in
-- src/console/schema-*.sql before, applied only by setup.sh — which meant a
-- one-click Deploy install bound D1 but never created them, and /api/drafts
-- answered raw "no such table" 500s to exactly the zero-terminal audience).
-- As wrangler migrations (`migrations_dir` in wrangler.jsonc) the same files
-- apply on every path:
--   CLI:        scripts/setup.sh → npx wrangler d1 migrations apply <db> --remote
--   one-click:  the package.json `deploy` script runs the same command before
--               `wrangler deploy` (Workers Builds runs that script — manual §9.7)
-- Everything here is CREATE ... IF NOT EXISTS, so applying it to a database
-- that already has the tables (an instance that predates migrations) is a
-- clean no-op. The frozen portal's schemas are NOT migrations — they are
-- instance-only, don't ship in the template, and stay in src/portal/.

-- Field-note cloud drafts: mutable work-in-progress that must survive a tab
-- close, a cleared localStorage, or a switch between the iPad and the laptop.
-- Published posts are NOT stored here — they flow to GitHub via /api/publish,
-- and a draft's row is deleted the moment it graduates to published.
-- `updated_at` is epoch milliseconds, stamped server-side, so login-time sync
-- can do a reliable last-writer-wins conflict check against the local copy.
CREATE TABLE IF NOT EXISTS fn_drafts (
  id            TEXT PRIMARY KEY,
  fn_id         TEXT,
  title         TEXT,
  location      TEXT,
  date          TEXT,
  body          TEXT,
  hero_filename TEXT,
  buffer_dates  TEXT,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fn_drafts_updated ON fn_drafts(updated_at DESC);

-- Bench queue (RAW-processing worklist). Migrated from a single data/bench.json
-- blob in R2 (read-modify-write the whole array on every mutation → lost-update
-- race + wipe-on-read-error) to D1, so every operation is an atomic single-row
-- statement. Entries are schemaless on the client (id, preview, raw_filename,
-- session_date, status, notes, queued_at, camera, raw_url, ...), so the full
-- object is preserved verbatim in the `data` JSON column. `id` (PK) and
-- `status` (filter) are also broken out as columns; status/notes writes use
-- json_set() to keep `data` and the `status` column consistent without a
-- read-modify-write.
CREATE TABLE IF NOT EXISTS bench_entries (
  id         TEXT PRIMARY KEY,
  status     TEXT,
  data       TEXT NOT NULL,        -- full entry object as JSON (source of truth)
  created_at INTEGER NOT NULL,     -- epoch ms; preserves queue/insertion order
  updated_at INTEGER NOT NULL      -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_bench_status ON bench_entries(status);
