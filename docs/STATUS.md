# STATUS
Updated: 2026-11-16 by lane A (P4 opened; T-P4-01 in progress)
Current phase: P4 — Household, Sync, PWA (§15.3). Cards T-P4-01…T-P4-07 in
docs/progress/PHASE-4.md; merge order contracts → backend → web → e2e.

## Done this phase
- Phase opened: PHASE-4.md written from §15.3; migration 0003 claimed for
  the sessions table (alias soft-delete backlog renumbered to 0004).

## In progress
- T-P4-01: contract v1.3 → v1.4 (ADR-0005) — auth #1–3, /events #31,
  POST /household (wizard §8.9), members CRUD for /settings.

## Blocked
- none. R-014 still open (lane A, not a gate blocker): import
  ensureCategory grocery-scope only; household-scope categories re-created
  on import.

## Next
- T-P4-01 → then T-P4-02 (migration 0003 sessions + scrypt auth) and
  T-P4-03 (household/members/SSE) — lanes A; T-P4-04…06 lane B after
  contract freezes; T-P4-07 lane D closes the phase (G4.1–G4.7).

## Contract state
shared/contracts.ts @ v1.3 → v1.4 in flight (T-P4-01, ADR-0005).
openapi.json regenerated with the contract card. Schema hash 0002.

## Migration lock
0003 CLAIMED by T-P4-02 (sessions). Next free after that: 0004 (claimed by
the alias soft-delete backlog item when it runs). 0001 + 0002 applied.

(End of file)
