# STATUS
Updated: 2026-11-15 by lane B (P3 T-P3-05 session)
Current phase: P3 — Management & Import/Export
Phase progress: T-P3-01 … T-P3-05 done; T-P3-06 (e2e + phase close) remains

## Done this phase
- T-P3-01: contract v1.2 (ADR-0003), item/alias/merge/category APIs.
- T-P3-02: contract v1.2 → v1.3 (ADR-0004) — import preview `token`;
  import/export/backup backend (§9.1–9.4, §12.4).
- T-P3-03: web /catalog browser + /catalog/:id detail (rename, defaults,
  aliases, merge, soft delete).
- T-P3-04: web /stores + /categories management with per-store aisle
  ordering (G3.4 persisted, e2e-verified); ReorderList drag/keyboard
  component; new copy in §8.10.
- T-P3-05: web /data — import preview (counts + per-row decisions) →
  commit, export JSON/CSV downloads, on-demand backup; new copy in §8.10.

## In progress
- none — T-P3-06 is lane D's card (e2e import round-trip + phase close).

## Blocked
- none. R-013 (open, lane D): e2e webServer env lacks DATA_DIR, so
  POST /admin/backup 500s in the harness (server default /data is the
  container volume); backup UI verified against a locally started server.
- Note: the G1.2 board-perf gate (p95 ≤ 50ms) is sensitive to this shared
  box's load; a lone failure under visible load = re-run first.

## Next
- T-P3-06 — e2e import-roundtrip.spec.ts + phase close (G3.2–G3.6). Lane D:
  add DATA_DIR to e2e/playwright.config.ts webServer env first (R-013).
- After P3 closes: P4 (household, sync, PWA) per §15.3.

## Contract state
shared/contracts.ts @ v1.3 — unchanged by T-P3-04/T-P3-05 (frontend-only
cards). Schema hash pinned at 0002.

## Migration lock
next available: 0003 (0001 + 0002 applied). No migration needed for the
remaining P3 work.

(End of file - total 38 lines)
