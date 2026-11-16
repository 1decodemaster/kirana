# STATUS
Updated: 2026-11-15 by lane B (P3 T-P3-04 session)
Current phase: P3 — Management & Import/Export
Phase progress: T-P3-01, T-P3-02, T-P3-03, T-P3-04 done

## Done this phase
- T-P3-01: contract v1.2 (ADR-0003), item/alias/merge/category APIs.
- T-P3-02: contract v1.2 → v1.3 (ADR-0004) — import preview `token`;
  import/export/backup backend (§9.1–9.4, §12.4).
- T-P3-03: web /catalog browser + /catalog/:id detail (rename, defaults,
  aliases, merge, soft delete).
- T-P3-04: web /stores (drag + keyboard reorder, rename/icon, archive,
  blocked delete) and /categories (usage counts, reorder, form sheet,
  'Other' guard) with per-store aisle ordering → PATCH
  /stores/:id {categoryOrder} (G3.4 persisted, e2e-verified); ReorderList
  drag/keyboard component; new copy in §8.10.

## In progress
- none — next session starts T-P3-05 (web Data screen).

## Blocked
- none. Note: the G1.2 board-perf gate (p95 ≤ 50ms) is sensitive to this
  shared box's load; a lone failure under visible load = re-run first.

## Next
- T-P3-05 — web: Data screen (import preview/commit with per-row decisions,
  export JSON/CSV, backup) (§8.1 /data, §9.2–9.4, §12.4). Then T-P3-06
  (e2e import round-trip + phase close G3.2–G3.6).

## Contract state
shared/contracts.ts @ v1.3 — unchanged by T-P3-04 (frontend-only card;
store reorder uses PATCH /stores/:id {sortOrder/categoryOrder}; the #27
PUT /stores/:id/category-order route remains intentionally unimplemented,
see BACKLOG).

## Migration lock
next available: 0003 (0001 + 0002 applied; schema hash pinned in
db/schema-hash.txt). No migration needed for T-P3-05.

(End of file - total 36 lines)
