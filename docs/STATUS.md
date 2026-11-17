# STATUS
Updated: 2026-11-17 (P5 hardening done — release pending owner go)
Current phase: P5 — T-P5-01…T-P5-04 complete; T-P5-05 (release) next.
P4 closed earlier today (G4.1–G4.7; tag phase-4-complete). ADR-0007 e2e
re-run done: 124/124.

## Done this phase
- T-P5-01 (A): perf verified — NFR-1/2/8/9/10/15 with numbers (board p95
  11.8ms real HTTP; worst endpoint 30.7ms; cold start 803ms; RSS 153MB;
  DB projected 45.7MB @10y; logs JSON + reqId + no leaks). New
  nfr2.perf.test.ts + scripts/perf-nfr.ts (R-015).
- T-P5-02 (B): NFR-3 202KB gzip; NFR-5 bench — FIRST RUN FAILED (30.24ms
  > 30ms), fixed by precomputing search candidates in buildIndex (now
  ~2ms); NFR-6 3.8ms in-page probe; NFR-4 throttled proxy 410–510ms.
  Error sweep: all 11 screens have loading/error/empty. a11y.spec.ts
  extended to 9 screens, zero critical/serious.
- T-P5-03 (C): restore drill executed per §12.5 — RTO 1.57s, counts
  identical; README rewritten as operator guide (~10-min deploy, env
  table, backups cron + sqlite3 dep, restore steps, lockout reset);
  backup.sh needs sqlite3 CLI (not on this host — documented).
- T-P5-04 (D): CHANGELOG.md; G5.3 TODO sweep clean (zero markers);
  docs/DEVICE-CHECKLIST.md for the manual iOS/Android pass.

## In progress
- none.

## Blocked
- none. Awaiting owner go for T-P5-05 (merge to main + tags).

## Next
- T-P5-05 release path (owner to approve): commit P5 work on
  chore/p5/hardening → PR feat/p4/contract-v14 → main (ff; carries P3+P4,
  first CI contact with that code) → PR P5 → main, CI green twice
  consecutively (G5.4) → bump root package.json to 1.0.0 → tags
  phase-5-complete + v1.0.0 → owner runs docs/DEVICE-CHECKLIST.md.
- Manual device pass (NFR-4/13 real-device numbers) is the owner's.

## Contract state
shared/contracts.ts @ v1.4 (ADR-0005). openapi.json current.
Schema hash pinned at 0003.

## Migration lock
0004 applied (ADR-0007). Next free: 0005 — reserved for alias soft-delete
backlog (post-1.0).

## Gates (evidence)
- G5.1: numbers table in docs/progress/PHASE-5.md (all 15 NFRs covered:
  1/2/8/9/10/15 this phase, 3/4/5/6 this phase, 7 P4 evidence, 11 backup
  wiring + retention tests, 12 = G5.2, 13/14 documented + checklist).
- G5.2: drill executed, RTO 1.57s (PHASE-5.md).
- G5.3: zero TODO/FIXME/XXX/HACK in all source trees.
- G5.4: pending T-P5-05 (CI has never run on P3/P4 code — release-blocking
  fact, now scheduled).
- G5.5: README operator guide; deploy-from-scratch ≈10 min documented.
- G5.6: pending T-P5-05 tag.

(End of file)
