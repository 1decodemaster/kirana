# STATUS
Updated: 2026-11-15 by lane A (P3 T-P3-02 session)
Current phase: P3 — Management & Import/Export
Phase progress: T-P3-01, T-P3-02 done (management + import/export/backup APIs)

## Done this phase
- T-P3-01: contract v1.2 (ADR-0003), item/alias/merge/category APIs.
- T-P3-02: contract v1.2 → v1.3 (ADR-0004) — importPreviewResponseSchema
  gains `token` (additive; §9.3 requires it for /import/commit).
- Import/export/backup backend (§9.1–9.4, §12.4, #28–30/#33):
  POST /import/preview (multipart CSV or verbatim export-JSON → diff +
  HMAC-signed 10-min token), POST /import/commit (one tx, rollback keeps
  the token), GET /export?format=json|csv&storeId= (CSV round-trips),
  POST /admin/backup (online .backup → gzip, pruned 14 daily + 8 weekly).
- New pure modules: services/{csv,importParse,importToken,importPreview,
  importCommit,export,backup}.ts; @fastify/multipart added (official
  plugin, required by multipart contract #28).

## In progress
- none — next session starts T-P3-03 (web Catalog browser + item detail).

## Blocked
- none. Note: the G1.2 board-perf gate (p95 ≤ 50ms) is sensitive to this
  shared box's load; a lone failure under visible load = re-run first.

## Next
- T-P3-03 — web: Catalog browser + item detail (aliases, merge) (§8.1).
  Then T-P3-04 (stores/categories/aisle order), T-P3-05 (Data screen:
  import preview/commit, export, backup), T-P3-06 (e2e import round-trip,
  phase close G3.2–G3.6).

## Contract state
shared/contracts.ts @ v1.3 — preview `token` added (ADR-0004). openapi.json
regenerated and green.

## Migration lock
next available: 0003 (0001 + 0002 applied; schema hash pinned in
db/schema-hash.txt). No migration needed for T-P3-02.

(End of file - total 43 lines)
