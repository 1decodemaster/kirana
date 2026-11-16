# STATUS
Updated: 2026-11-15 by lane B (P3 T-P3-03 session)
Current phase: P3 — Management & Import/Export
Phase progress: T-P3-01, T-P3-02, T-P3-03 done

## Done this phase
- T-P3-01: contract v1.2 (ADR-0003), item/alias/merge/category APIs.
- T-P3-02: contract v1.2 → v1.3 (ADR-0004) — import preview `token`;
  import/export/backup backend (§9.1–9.4, §12.4).
- T-P3-03: web /catalog browser (debounced server search + cursor-paginated
  browse, §8.2 category-grouped) and /catalog/:id detail (rename, defaults,
  alias add/remove, merge with irreversible confirm, soft delete); 5 new
  web unit tests; 12-test playwright smoke green on 375×667 + pixel-7
  (throwaway spec, not committed); §8.10 copy deck extended in the same
  change per AGENTS.md §5.

## In progress
- none — next session starts T-P3-04 (Stores + Categories management).

## Blocked
- none. Note: the G1.2 board-perf gate (p95 ≤ 50ms) is sensitive to this
  shared box's load; a lone failure under visible load = re-run first.

## Next
- T-P3-04 — web: Stores + Categories management, per-store aisle ordering
  (drag; PATCH /stores/:id {categoryOrder} already in the contract).
  Then T-P3-05 (Data screen: import preview/commit, export, backup),
  T-P3-06 (e2e import round-trip + phase close G3.2–G3.6).

## Contract state
shared/contracts.ts @ v1.3 — unchanged by T-P3-03 (frontend-only card;
the detail stats type is derived locally as GetItemResponse['stats']).

## Migration lock
next available: 0003 (0001 + 0002 applied; schema hash pinned in
db/schema-hash.txt). No migration needed for T-P3-04.

(End of file - total 34 lines)
