# PHASE-3 — Management & Import/Export

Goal: everything is editable, and the catalog can be bootstrapped from a
spreadsheet. Refs: PRD §15.3 (P3), §7.2 #16–30/#33, §9, §12.4.
Gates: G3.1–G3.6.

## Task cards

- T-P3-01 — item & category management APIs (backend) ← current
- T-P3-02 — import preview/commit + export JSON/CSV + admin backup (backend)
- T-P3-03 — web: Catalog browser + item detail (aliases, merge)
- T-P3-04 — web: Stores + Categories management, per-store aisle ordering (drag)
- T-P3-05 — web: Data screen (import preview/commit, export, backup)
- T-P3-06 — e2e import-roundtrip.spec.ts + phase close (G3.2–G3.6)

## Session log

## 2026-11-15 — lane A — T-P3-01 (item & category management APIs)

Built:      Contract v1.1 → v1.2 (ADR-0003): GET /items/:id →
            { item: ItemDto, stats: CatalogStats } — the single-item read the
            §8.1 /catalog/:id screen needs; openapi.json regenerated. Server:
            GET/PATCH/DELETE /items/:id (rename re-normalizes with INV-5
            uniqueness and keeps the old display name as an alias; defaults +
            attrs patch; unconditional soft delete per INV-6 — list rows
            survive and the board still serves them, the client renders
            "Archived item" by itemId absence from catalog). POST/DELETE
            /items/:id/aliases (idempotent per item; 409 ITEM_NEAR_DUPLICATE
            with a suggestion when the alias collides with another item's
            name or alias). POST /items/merge (single transaction: list rows
            move, per-store stats fold — times_added sums, last_added_at max,
            default_category coalesced; aliases move, target-owned norms
            drop; source display name kept as a target alias; source
            soft-deleted). POST/PATCH/DELETE /categories (household rows;
            live seed rows editable — single-household deployment, G3.1;
            soft-deleted household rows revive on re-create like stores;
            delete reassigns list rows + item defaults + stat defaults to
            the §6.5 'Other' fallback; the fallback itself refuses deletion).
            otherCategoryId moved to services/categories.ts so catalog.ts and
            deleteCategory share one definition (no import cycle).
Tests:      `pnpm verify` green: 91 shared + 32 db + 8 web + 126 server
            (was 101; +25: items-management 18, categories-crud 7).
            `pnpm contracts:check` green (openapi.json regenerated for the
            v1.2 addition). No migration touched — schema hash stays pinned.
Decisions:  (1) ADR-0003: a drafted ITEM_IN_USE error code to block item
            deletes was withdrawn — PRD §5.4 INV-6 mandates soft delete with
            surviving list rows ("Archived item"), so blocking would be a
            silent PRD deviation. (2) Rename keeps the old display name as an
            alias (search continuity; PRD silent — logged assumption). Alias
            source stays 'user' (the §5.2 CHECK has no 'merge' value — hit as
            a SqliteError and fixed). (3) Category uniqueness follows the
            partial index: household rows collide with household rows (live
            or soft-deleted → revive) and with live seed rows; a household
            row may not shadow a seed name (duplicate board groups would be
            worse than blocking; seeds are editable instead). (4) Seed
            categories are PATCH-editable (single-household deployment; G3.1
            "everything is editable"). (5) Alias delete is a hard row delete —
            item_aliases has no deleted_at; UI will confirm; soft-delete
            needs migration 0003 (filed to BACKLOG).
Deviations: None. Contract change is additive-only and ADR'd (ADR-0003).
Learned:    (a) board.perf (G1.2, p95 ≤ 50ms @ 2k rows) is load-sensitive on
            this shared box: it failed twice mid-session while sibling agent
            sessions were running tsc/pnpm (load avg 10.5 on 4 cores) and
            passed 3/3 isolated + in the final full verify. Treat a lone perf
            failure under visible machine load as environmental; re-run
            before diagnosing code. (b) `pnpm --filter X add` was NOT needed
            anywhere this card — zero new dependencies. (c) The §5.2
            item_aliases.source CHECK is a closed set — new alias provenance
            values need a migration, not just a constant. (d) strict TS +
            noUncheckedIndexedAccess: test helpers reading list rows need a
            `first()` guard, not index access.
Next:       T-P3-02 — import preview/commit + export + admin backup (§9,
            §12.4; contract #28–30/#33 schemas already exist at v1.2).

## Handoff

Done:        T-P3-01 (contract v1.2 + items/aliases/merge/categories APIs,
             25 new tests, verify green).
Next:        T-P3-02 — import/export/backup backend (§9.1–9.4, §12.4).
Blocked:     none. Note: G1.2 perf gate is box-load-sensitive (see Learned a).
Files:       shared/src/contracts.ts, scripts/gen-openapi.ts, openapi.json,
             docs/DECISIONS/ADR-0003-item-detail-read.md,
             server/services/{items.ts,categories.ts,catalog.ts},
             server/routes/{items.ts,categories.ts},
             server/__tests__/{items-management,categories-crud}.test.ts.
Tests:       `pnpm verify` (257 green: 91+32+8+126) + contracts:check green.
Context:     Branch feat/p3/items-management off main@6918fc5 (P1.5 squash-
             merged + tagged phase-1.5-complete). Migration lock: next 0003
             untouched. Contracts now v1.2 (additive). The :8080 demo container
             runs the P1.5 image (rebuilt this session pre-P3; rebuild after
             the web screens land).
