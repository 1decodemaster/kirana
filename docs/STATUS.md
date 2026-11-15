# STATUS
Updated: 2026-11-15 by lane A+B (P2 session)
Current phase: P2 — Add Item & Search — COMPLETE (gates G2.1–G2.6 evidenced)
Phase progress: spike + T-P2-01 + T-P2-02 done in one session

## Done this phase
- Search spike → ADR-0002: shared §8.6 scorer (no Fuse.js), FTS5 rebuilt on
  canonical forms (migration 0002, trigger-maintained via registered
  kirana_norm/kirana_fold), Devanagari rides exact/prefix norm tiers
- Contract v1.1 (additive): catalogItemDto.stats?, getItemsQuery.storeId?;
  openapi.json regenerated, contracts:check green
- T-P2-01: GET /items (SQL tiers ∪ FTS prefilter ∪ edit-tier-on-demand),
  POST /stores/:id/items (§6.4 upsert + revival, §6.5 write-backs, INV-8
  stats, §7.4 clientId idempotency), POST /items, board ships §8.6 signals
- T-P2-02: AddItemSheet (vaul, 80ms debounce, grouped suggestions, live
  quick-parse, unit segmented control, category chips, near-dup prompt),
  FAB → store picker, delete-item undo via undoToken re-add (BACKLOG closed)
- Tests: 224 unit/integration + 50 e2e (both viewports) + docker smoke

## In progress
- none — gate evidence in docs/progress/PHASE-2.md

## Blocked
- none. Environment: the P1 demo container still runs on :8080 (user review,
  old image). `kirana:local-node` was rebuilt with P2; a fresh demo is
  `docker run -p 8080:8080 -e SESSION_SECRET=… -e DATABASE_URL=/data/kirana.db
  kirana:local-node`. The foreign uvicorn on the host and kirana:local tag
  contention from P1 still apply.

## Next
- P1.5 — Shop Mode (§8.5) per §15.3 order, then P3 — Management &
  Import/Export. First P1.5 card: shop-mode screen over the same board cache;
  first P3 card: item management + import/export APIs (P3 also claims
  migration 0003 if the sessions table lands with P4 instead).

## Contract state
shared/contracts.ts @ v1.1 (P2 addendum: stats + storeId — ADR-0002);
openapi.json regenerated, contracts:check green. Copy deck gained 7 rows in
PRD §8.10 (near-dup actions, sheet title, picker title, groups, unit types,
item-removed toast).

## Migration lock
next available: 0003 (0001_init.sql + 0002_item_search_norm_keys.sql applied;
schema hash re-pinned in db/schema-hash.txt — regenerate with
`pnpm --filter @kirana/db hash-schema` whenever a migration lands)
