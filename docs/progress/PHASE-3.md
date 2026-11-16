# PHASE-3 — Management & Import/Export

Goal: everything is editable, and the catalog can be bootstrapped from a
spreadsheet. Refs: PRD §15.3 (P3), §7.2 #16–30/#33, §9, §12.4.
Gates: G3.1–G3.6.

## Task cards

- T-P3-01 — item & category management APIs (backend) ✅
- T-P3-02 — import preview/commit + export JSON/CSV + admin backup (backend) ✅
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

## 2026-11-15 — lane A — T-P3-02 (import/export/backup backend)

Built:      Contract v1.2 → v1.3 (ADR-0004): importPreviewResponseSchema
            gains `token` — §9.3 step 4 makes it the commit request's input,
            but the drafted schema had no field carrying it. Purely additive;
            openapi.json regenerated. Server (§7.2 #28–30/#33, §9.1–9.4,
            §12.4): POST /import/preview (multipart CSV or a verbatim /export
            JSON payload → per-row diff {create|merge|skip|error} + HMAC-signed
            token, 10-min TTL, in-memory map capped at 20 entries);
            POST /import/commit (decisions default to their preview action;
            one transaction — stores/categories/items/aliases/list rows/stats;
            any failure rolls back everything and keeps the token usable);
            GET /export?format=json (full dump, contract-validated on the way
            out) and ?format=csv&storeId= (§9.1 CSV, round-trips through
            preview); POST /admin/backup (better-sqlite3 online .backup →
            gzip under <dataDir>/backups, pruned to BACKUP_KEEP_DAILY=14 daily
            + 8 UTC-week files, wx-flag so it never clobbers). New pure
            modules: services/csv.ts (RFC 4180), importParse.ts (CSV+JSON →
            rows, per-row validation, §9.1 alias-language inference),
            importToken.ts / importPreview.ts / importCommit.ts.
Tests:      `pnpm verify` green: 91 shared + 32 db + 8 web + 167 server
            (was 126; +41 across csv/import/export/backup test files).
            `pnpm contracts:check` green. JSON and CSV round-trips are
            covered end-to-end in export.test.ts.
Decisions:  (1) ADR-0004 above — the drafted preview schema simply omitted
            the token the PRD's own commit step requires. (2) Row semantics:
            'duplicate' = exact name/alias match or fuzzy edit-ratio ≥ 0.9
            (matchQuality's fuzzy tier is 0.5·ratio, so the gate is quality
            ≥ 0.45 — searchScore was considered and rejected: with §8.6
            weights a fuzzy-only match can never reach 0.9 total, which would
            make the guard dead code); 'conflict' = same normalized
            name+store appearing twice in one file (second row defaults to
            skip; cross-store rows of one item are legitimate and both
            import); 'invalid' = per-row field validation. (3) Commit
            response counts catalog items created vs rows attached — a
            preview 'create' whose item now exists (or was created by an
            earlier line in the same commit) attaches and counts as merged
            rather than failing the whole file. (4) Undecided lines keep
            their preview action; the token is consumed only on success.
            (5) Import-created aliases use source 'import' (already in the
            §5.2 CHECK); aliases equal to the item's own name are dropped;
            merge decisions do not add aliases. (6) CSV export carries
            active+bought rows only — §9.1 has no status column and
            re-importing cleared history as active would corrupt it; JSON
            export carries every status (full dump) but the import model
            restores rows as active — known limitation, in BACKLOG. (7)
            Backup files are kirana-YYYYMMDD-HHMMSS.db.gz (seconds precision
            instead of §12.4's date-only name) so an on-demand backup can
            never overwrite the nightly's file; retention pruning runs after
            every create. (8) New dependency @fastify/multipart — official
            Fastify plugin, required by the committed multipart contract
            #28; hand-rolling multipart parsing is risk without benefit.
            (9) Preview tokens are process-memory only — single-process
            deployment is the PRD's shape; noted for any future
            multi-instance run.
Deviations: Contract v1.3 is additive and ADR'd (ADR-0004) — no silent
            deviation. No migration touched; schema hash stays pinned at 0002.
Learned:    (a) Two seed stores + `{ otherStoreId, … }` shorthand instead of
            `storeId: otherStoreId` produces a NOT NULL failure on
            list_items.store_id that looks like a service bug — vitest
            (esbuild) does not typecheck, so the smell was "valid-looking
            call, null binding". `pnpm typecheck` catches it; run it before
            debugging test failures. (b) light-my-request multipart works
            fine by hand-rolling the body string with a fixed boundary — no
            form-data helper needed. (c) better-sqlite3 is a transitive dep
            here: runtime imports must come from @kirana/db (openDatabase);
            only `import type` may reference better-sqlite3 directly. (d)
            matchQuality's fuzzy tier caps at 0.5·ratio — any future feature
            expecting "fuzzy ≥ 0.9" semantics must decide whether it means
            edit-ratio or the §8.6 total score; they are not interchangeable.
Next:       T-P3-03 — web Catalog browser + item detail (§8.1; contract v1.3
            frozen, mocks not needed — real endpoints exist).

## Handoff (T-P3-01)

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
