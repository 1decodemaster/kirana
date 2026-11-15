# ADR-0003: GET /items/:id — the missing single-item read

Status: Accepted
Date: 2026-11-15
Decided by: lane A (P3 T-P3-01)

## Context

P3's first card is item management (§15.3; screens `/catalog` and
`/catalog/:id` per §8.1). §7.2 has `GET /items` (search/browse, returns
`SearchResultDto` — no aliases-with-ids, no attrs, no timestamps) but no
`GET /items/:id`. The IA promises `/catalog/:id` = "Item detail (aliases,
defaults, history, merge)". Without a read endpoint the detail screen would
have to re-search by name (fragile, ranking could hide the exact row) or
reconstruct the DTO client-side from the board `catalog` array, which
carries only `CatalogItemDto`.

A second candidate change — an `ITEM_IN_USE` error code to block
`DELETE /items/:id` while list rows reference the item — was drafted and
then **withdrawn**: PRD §5.4 INV-6 explicitly requires "a soft-deleted item
never loses its `list_items`; UI renders 'Archived item'", and the §7.2 #19
spec says plain "Soft delete". Blocking would be a silent deviation from the
PRD (AGENTS §4.4). The archived-render path already works: the board joins
`list_items → items` without a `deleted_at` filter while `catalog` omits
deleted items, so the client detects an archived item by `itemId` absence.

## Decision

- Add **`GET /items/:id`** → `200 { item: ItemDto, stats: CatalogStats }`.
  `ItemDto` already carries aliases (with ids, for #21) and attrs;
  `CatalogStats` (`timesAdded`, `lastAddedAt`, `storeIds`) is the "history"
  surface for the detail screen, reusing the existing §7.3 board schema —
  no new DTO shape.
- `DELETE /items/:id` stays an **unconditional soft delete** per INV-6; no
  new error code. The closed error set (§7.1) is unchanged.

Contract version: v1.1 → **v1.2**. Purely additive.

## Consequences

- `openapi.json` regenerates (the generator's endpoint table gains
  `get /api/v1/items/{id}`); `contracts:check` stays green.
- No DB migration: API-surface only, so the migration lock (next: 0003) is
  untouched and `db/schema-hash.txt` stays pinned.
- Alias removal (#21) stays a hard row delete: `item_aliases` has no
  `deleted_at` column and aliases are trivially re-addable; the UI confirms
  first (§8 data ethics). Soft-deleting aliases would need migration 0003 —
  filed to BACKLOG instead of doing it now.
- Merge (#22) keeps its contract shape `{ item: ItemDto }`; nothing new.

## Alternatives rejected

- **Client-side reconstruction of item detail** from `GET /items?q=` + board
  catalog: two round trips, still missing attrs/timestamps/alias ids.
- **`ITEM_IN_USE` + blocked delete**: contradicts INV-6 (see Context).
- **`GET /items/:id?include=history` with per-store stat rows**: richer, but
  invents a new endpoint shape the screens don't need yet; `CatalogStats`
  covers the IA's "history" promise (how often, when, where).

Refs: PRD §7.2 #16–26, §8.1, §7.1, §5.4 (INV-6), §15.3 (T-P3-01); AGENTS §4.1
(contract PR).
