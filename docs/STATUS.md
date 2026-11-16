# STATUS
Updated: 2026-11-16 by lane D (P3 T-P3-06 session — phase closed)
Current phase: P3 complete → P4 next (household, sync, PWA, §15.3)
Phase progress: T-P3-01…T-P3-06 done; gates G3.1–G3.6 evidenced; tag
phase-3-complete on the phase-close commit.

## Done this phase
- T-P3-01: contract v1.2 (ADR-0003) — item/alias/merge/category APIs.
- T-P3-02: contract v1.2 → v1.3 (ADR-0004) — import preview `token`;
  import/export/backup backend (§9.1–9.4, §12.4).
- T-P3-03: web /catalog browser + /catalog/:id detail (rename, defaults,
  aliases, merge, soft delete).
- T-P3-04: web /stores + /categories management with per-store aisle
  ordering (G3.4); ReorderList drag/keyboard component.
- T-P3-05: web /data — import preview → commit, export, backup (§9.2–9.4).
- T-P3-06: committed e2e — import-roundtrip (G3.2 200-row CSV, G3.3
  export→wipe→import, backup, CSV export), aisle-order (G3.4), merge-items
  (G3.5); R-013 fixed (DATA_DIR in the e2e webServer env).

## In progress
- none.

## Blocked
- none. R-014 open (lane A, not a gate blocker): import ensureCategory
  matches grocery scope only — household-scope categories (e.g. 'Cleaning
  Supplies') are re-created on import (duplicate names in /categories,
  aisle-order drift). G3.3 passes on its terms (row counts + names).

## Next
- Open P4: create docs/progress/PHASE-4.md from PRD §15.3's P4 card
  (household, sync queue, PWA) and its task cards. Lanes A+B+D per §15.2.

## Contract state
shared/contracts.ts @ v1.3 — unchanged by T-P3-06 (e2e + docs only).
openapi.json current. Schema hash pinned at 0002.

## Migration lock
next available: 0003 (0001 + 0002 applied). No migration made this phase.

## Gates (evidence)
- G3.1: server items-management + categories-crud integration tests;
  committed e2e management specs (aisle-order, merge-items) + T-P3-03/04
  throwaway runs (recorded in PHASE-3.md).
- G3.2/G3.3: e2e/specs/import-roundtrip.spec.ts; atomicity also covered
  server-side (import.test.ts rollback case).
- G3.4: e2e/specs/aisle-order.spec.ts. G3.5: e2e/specs/merge-items.spec.ts.
- G3.6: import-roundtrip.spec.ts green — 92/92 e2e across mobile-chrome
  375×667 + pixel-7; `pnpm verify` 327 unit/integration green.

(End of file)
