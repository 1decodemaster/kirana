# STATUS
Updated: 2026-11-17 — **v1.0.0 shipped** (P5 complete; tags pushed)
Current phase: none — all phases P0–P5 complete. Next: P6 (post-1.0, §13)
only after the owner's device checklist.

## Released
- v1.0.0 @ 03fc830 on main; annotated tags `phase-5-complete` + `v1.0.0`
  pushed. PRs #3 (P3+P4) and #4 (P5) fast-forward-merged, CI green.
- P5 evidence: docs/progress/PHASE-5.md — G5.1 numbers table (all 15
  NFRs), G5.2 drill RTO 1.57s, G5.3 zero TODOs, G5.4 CI green ×2
  consecutively, G5.5 operator README, G5.6 tag.

## This release
- Perf: board p95 11.8ms real HTTP; worst endpoint 30.7ms; 202KB gzip
  bundle; client search ~2ms @ 5k items (fixed a real 30ms finding —
  candidate precompute); toggle feedback ~4ms; cold start 803ms; RSS
  153MB; DB projected 45.7MB @ 10y (change_log dominates — §6.7 purge is
  the long-term guard, a P6 job).
- Ops: restore drill executed (§12.5), README is now the operator guide,
  backup cron documented (backup.sh needs the sqlite3 CLI — not on this
  host), CHANGELOG, DEVICE-CHECKLIST.
- Demo container: restore-drilled, healthy; pre-drill DB kept at
  data/kirana.db.pre-drill until the owner deletes it.

## In progress
- none.

## Blocked
- none.

## Owner items (only human steps left)
- Run docs/DEVICE-CHECKLIST.md on real iOS Safari + Chrome Android; record
  one line per device in docs/progress/PHASE-5.md.
- Delete data/kirana.db.pre-drill when satisfied.

## Next
- P6 — Intelligence (§13), five independent increments, only after the
  device checklist. Nothing in P0–P5 calls an LLM; FEATURE_LLM stays off.

## Contract state
shared/contracts.ts @ v1.4 (ADR-0005). openapi.json current.
Schema hash pinned at 0003.

## Migration lock
0004 applied (ADR-0007). Next free: 0005 — reserved for alias soft-delete
backlog (post-1.0).

(End of file)
