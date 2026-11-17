# ADR-0006 — Migration 0003: the `sessions` table

**Status:** Accepted
**Date:** 2026-11-16
**Phase:** P4 (T-P4-02)
**Refs:** PRD §7.6, §12.1–12.2, G4.6

## Context

§7.6 requires sessions to live "server-side in memory **+ a `sessions`
table (survives restart)"** — G4.6 makes the restart survival a gate. The
P0 DDL has no sessions table; auth until now was the pre-auth actor stub
(ADR recorded in `server/services/actor.ts`). Migration number 0003 was
claimed in `STATUS.md` before this file was written (AGENTS.md §4.3).

## Decision

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,   -- sha256 hex of the raw token (never the token itself)
  household_id  TEXT NOT NULL REFERENCES households(id),
  member_id     TEXT NOT NULL REFERENCES members(id),
  created_at    INTEGER NOT NULL,   -- UTC epoch ms
  expires_at    INTEGER NOT NULL,   -- created_at + 2,592,000,000 ms (30 d, §7.6 Max-Age)
  revoked_at    INTEGER
);
CREATE INDEX idx_sessions_member  ON sessions(member_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

- **The token never touches the DB.** The `sid` cookie carries
  `<base64url(32 random bytes)>.<base64url(HMAC-SHA256(token, SESSION_SECRET))>`.
  The row id is `sha256(token)`. A leaked DB dump yields no usable
  credentials; a leaked cookie is verified against `SESSION_SECRET` before
  any lookup.
- **`revoked_at`** makes logout auditable and non-destructive; expired and
  revoked rows are simply never resolved. (Purging expired rows is left to
  a later housekeeping pass — SQLite file size is bounded by NFR-8 and a
  family generates a handful of sessions per year.)
- **In-memory cache in front** (`server/services/sessions.ts`): the table
  is the truth, the cache is a per-process Map keyed by token hash, capped
  at 1,000 entries. Logout deletes from both. Restart = cold cache, warm
  table → G4.6.
- **`@kirana/db` gains `hashPasscode`/`verifyPasscode`** (`db/passcode.ts`):
  both the demo seed and the server must produce §12.2-format hashes, and
  `db/**` is lane-A territory (no contract change). scrypt
  `N=16384, r=8, p=1, keylen=64`, 16-byte salt,
  `scrypt$N$r$p$saltB64$hashB64`, `timingSafeEqual` compare.
- The demo seed (`db/demo.ts`) now creates its household with the known
  passcode `0000` (exported `DEMO_PASSCODE`) instead of an unusable random
  secret — dev containers and the e2e harness must be able to log in.

## Consequences

- `db/schema-hash.txt` is repinned to the 0003 hash; the migrate tests
  assert the new table and the three-applied-migrations list.
- Fresh dev/demo databases created before P4 (the `./data` volume) hold a
  household whose passcode hash is unusable; re-running the demo seed
  script or wiping the volume is required to log in. Documented in the
  phase log, not migrated (data fix ≠ schema fix).
- Deleting a member does not cascade to sessions; a revoked/expired check
  plus member lookups being `deleted_at IS NULL` in every read keeps a
  deleted member's session inert. `resolveSession` verifies the member is
  still active.
