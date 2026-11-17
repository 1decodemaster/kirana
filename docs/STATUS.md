# STATUS
Updated: 2026-11-16 by lane A (T-P4-01 + T-P4-02 sessions/auth landed)
Current phase: P4 — Household, Sync, PWA (§15.3). Cards T-P4-01…T-P4-07 in
docs/progress/PHASE-4.md; merge order contracts → backend → web → e2e.

## Done this phase
- T-P4-01: contract v1.3 → v1.4 (ADR-0005) — auth roster, household
  create/update, members CRUD; openapi regenerated; shared 96 green.
- T-P4-02: migration 0003 sessions (ADR-0006), scrypt passcode hashing in
  @kirana/db, session store + cache, default-deny auth on /api/v1,
  login/mutation rate limits, household create + members APIs, demo seed
  logs in with DEMO_PASSCODE '0000'; schema hash repinned to 0003.

## In progress
- none.

## Blocked
- none. R-014 still open (lane A, not a gate blocker): import
  ensureCategory grocery-scope only; household-scope categories re-created
  on import.

## Known-red until later cards
- e2e suites are red against the authed server by design until T-P4-07
  (specs need login/storageState); web screens 401 until T-P4-04. Unit/
  integration `pnpm verify` is green (374 tests).

## Next
- T-P4-03: GET /events SSE (§7.5: tail, heartbeat 20s, Last-Event-ID,
  ≤20 conns/session, NFR-7 ≤1s) + change_log completeness audit + /board
  delta verification. Then T-P4-04…06 (web), T-P4-07 (e2e close).

## Contract state
shared/contracts.ts @ v1.4 (ADR-0005). openapi.json current.
Schema hash pinned at 0003 (migration 0003 applied).

## Migration lock
0003 applied (sessions). Next free: 0004 — claimed by the alias soft-delete
backlog item when it runs.

(End of file)
