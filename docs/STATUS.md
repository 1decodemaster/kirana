# STATUS
Updated: 2026-11-16 by lane D (P4 T-P4-07 session — phase closed)
Current phase: P4 complete → P5 next (Hardening & Release, §15.3)
Phase progress: T-P4-01…T-P4-07 done; gates G4.1–G4.7 evidenced; tag
phase-4-complete on the phase-close commit.

## Done this phase
- T-P4-01: contract v1.4 (ADR-0005) — auth roster, household create/update,
  members CRUD; openapi regenerated.
- T-P4-02: migration 0003 sessions (ADR-0006), scrypt hashing, session
  store + cache, default-deny auth, login/mutation rate limits, household
  + members APIs, demo seed logs in with DEMO_PASSCODE '0000'.
- T-P4-03: GET /events SSE (§7.5 frames, heartbeat, Last-Event-ID,
  20-conn cap, 250ms poll ≤ NFR-7); change_log audit complete.
- T-P4-04: web /login, /welcome wizard (§8.9), /settings (household,
  members, theme, about); session-expired redirect; Home header household.
- T-P4-05: web live sync (EventSource → invalidations), offline mutation
  queue (§4.7 IndexedDB, clientId replay), §8.7 offline banner.
- T-P4-06: PWA — manifest + 4 icons, hand-rolled sw.js (offline shell),
  a11y pass (axe: 3 findings fixed; zero critical/serious on all screens).
- T-P4-07: committed e2e — auth, first-run, live-sync (G4.1), offline-queue
  (G4.2/G4.3), a11y (G4.5), pwa (G4.4 primitives); G15.3 updated to the P4
  queue rules; per-viewport sessions with dependency-ordered setup projects.

## In progress
- none.

## Blocked
- none. R-014 open (lane A, not a gate blocker): import ensureCategory
  grocery-scope only; household-scope categories re-created on import.

## Next
- Open P5: create docs/progress/PHASE-5.md from PRD §15.3's P5 card
  (perf numbers NFR-1…15, error sweep, restore drill G5.2, README,
  CHANGELOG, v1.0.0 tag). Lanes A+B+C+D per §15.2.

## Contract state
shared/contracts.ts @ v1.4 (ADR-0005). openapi.json current.
Schema hash pinned at 0003.

## Migration lock
0003 applied (sessions). Next free: 0004 — claimed by the alias soft-delete
backlog item when it runs.

## Gates (evidence)
- G4.1: e2e/specs/live-sync.spec.ts (two contexts, <1s, both viewports).
- G4.2/G4.3: e2e/specs/offline-queue.spec.ts (+ server idempotency tests).
- G4.4: e2e/specs/pwa.spec.ts (manifest, icons, active SW, offline shell);
  a manual Lighthouse run belongs to P5 device testing.
- G4.5: e2e/specs/a11y.spec.ts — zero critical AND serious on Home, add
  sheet, Catalog.
- G4.6: server/__tests__/sessions.test.ts restart case; sessions table is
  disk-backed (the e2e harness cannot restart its own webServer).
- G4.7: 124/124 e2e across mobile-chrome 375×667 + pixel-7; `pnpm verify`
  407 unit/integration green.

(End of file)
