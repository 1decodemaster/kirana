# STATUS
Updated: 2026-11-15 by lane A (P3 T-P3-01 session)
Current phase: P3 — Management & Import/Export
Phase progress: T-P3-01 done (backend item/category management)

## Done this phase
- Contract v1.1 → v1.2 (ADR-0003): added GET /items/:id →
  { item: ItemDto, stats: CatalogStats } for the §8.1 /catalog/:id screen;
  openapi.json regenerated, contracts:check green. Purely additive.
- Items APIs: GET/PATCH/DELETE /items/:id (rename keeps old name as alias,
  INV-5 norm uniqueness; soft delete per INV-6 — list rows survive),
  POST/DELETE aliases (idempotent; 409 ITEM_NEAR_DUPLICATE on cross-item
  collisions), POST /items/merge (tx: rows+stats+aliases move, source kept
  as alias, source soft-deleted).
- Categories APIs: POST/PATCH/DELETE (seed rows editable; deleted household
  rows revive; delete reassigns everything to the §6.5 'Other' fallback,
  which refuses deletion).
- P1.5 squash-merged to main (6918fc5) + tagged phase-1.5-complete; P3
  branch feat/p3/items-management cut from it.

## In progress
- none — next session starts T-P3-02.

## Blocked
- none. Note: the G1.2 board-perf gate (p95 ≤ 50ms) is sensitive to this
  shared box's load (sibling agent sessions); it passed in the final verify
  and 3/3 isolated. A lone failure under visible load = re-run first.

## Next
- T-P3-02 — import preview/commit + export JSON/CSV + admin backup (§9,
  §12.4). Contract schemas #28–30/#33 already exist at v1.2. Then web
  screens (T-P3-03..05) and e2e import-roundtrip (T-P3-06).

## Contract state
shared/contracts.ts @ v1.2 — GET /items/:id added (ADR-0003). openapi.json
regenerated and green.

## Migration lock
next available: 0003 (0001 + 0002 applied; schema hash re-pinned in
db/schema-hash.txt — regenerate with `pnpm --filter @kirana/db hash-schema`
whenever a migration lands). No migration was needed for T-P3-01.
