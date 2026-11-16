# PHASE-3 — Management & Import/Export

Goal: everything is editable, and the catalog can be bootstrapped from a
spreadsheet. Refs: PRD §15.3 (P3), §7.2 #16–30/#33, §9, §12.4.
Gates: G3.1–G3.6.

## Task cards

- T-P3-01 — item & category management APIs (backend) ✅
- T-P3-02 — import preview/commit + export JSON/CSV + admin backup (backend) ✅
- T-P3-03 — web: Catalog browser + item detail (aliases, merge) ✅
- T-P3-04 — web: Stores + Categories management, per-store aisle ordering (drag) ✅
- T-P3-05 — web: Data screen (import preview/commit, export, backup) ✅
- T-P3-06 — e2e import-roundtrip.spec.ts + phase close (G3.2–G3.6) ✅

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

## 2026-11-15 — lane B — T-P3-03 (web Catalog browser + item detail)

Built:      /catalog (§8.1): 80ms-debounced server search (GET /items,
            ranked per §8.6) over a cursor-paginated browse (limit 50,
            keepPreviousData so key swaps never flash a skeleton); browse
            mode groups by default category (§8.2 4px left-border section
            headers, sortOrder order, uncategorized last); search mode is a
            flat ranked list; empty/loading/error states per §8.7; "Load
            more" for the next cursor.
            /catalog/:id (ADR-0003 read): header with back action, name and
            a stats meta line (times added, last added UTC day, store
            count); Defaults card (category/unit/qty) with an edit sheet;
            Aliases card (lang chips, add sheet with en/hi-Latn/hi picker,
            remove with confirm — hard row delete per ADR-0003, so UI
            confirms first); merge flow (target picker sheet → G3.5
            irreversible confirm → POST /items/merge → navigates to the
            target's detail); delete item with confirm (INV-6 soft delete)
            → back to /catalog. Alias 409 ITEM_NEAR_DUPLICATE renders the
            server message plus a "Go to {name}" jump to the colliding item
            (from details.suggestions).
            api/queries.ts: useItems (useInfiniteQuery), useItem,
            usePatchItem, useDeleteItem, useCreateAlias, useDeleteAlias,
            useMergeItems — all invalidate ['item', id] + ['items'] + board.
Tests:      `pnpm verify` green: 91 shared + 32 db + 13 web (was 8; +5:
            catalogGroups 4, formatDay 1) + 167 server. Playwright smoke
            (throwaway spec, deleted after the run — the committed e2e is
            T-P3-06): 12/12 green on mobile-chrome 375×667 + pixel-7,
            covering browse groups, detail nav, alias add/remove
            round-trip, merge sheet + Escape, search empty state, and the
            keyboard path (skip link → search → row → Enter → detail).
Decisions:  (1) New microcopy added to §8.10 in this same change per
            AGENTS.md §5 (empty catalog, search-empty, load more, back to
            catalog, item not found, stats meta, merge/delete/alias
            confirms, alias languages, "Go to {name}", "Uncategorized").
            (2) The browser uses server search/browse (GET /items) rather
            than the board's catalog snapshot — the snapshot is capped at
            5,000 (catalogTruncated) and has no cursoring; /items is the
            authoritative browse surface. (3) ItemStats derived locally as
            GetItemResponse['stats'] — exporting CatalogStats from shared
            would be a contract PR + ADR for a type alias; not worth it.
            (4) useItems sets keepPreviousData so each keystroke keeps the
            previous list visible instead of skeleton-flashing.
Deviations: None to the PRD. Test-environment note: on emulated touch
            viewports (pixel-7 project) Tab from a *typed* text field drops
            focus to <body> — a headless-Chromium emulation quirk (browse-
            mode Tab works on the same project); T-P3-06's committed
            keyboard spec should avoid Tab-after-type assertions.
Learned:    (a) pnpm lives in ~/.local/share/pnpm/bin and node 22 in
            ~/.nvm/versions/node/v22.23.2/bin — neither is on this shell's
            default PATH; export both before any pnpm command (node 18
            otherwise breaks vitest/eslint on node:util.styleText). (b) The
            e2e harness boots its own server on 8090 from web/dist with a
            fresh seeded DB (global-setup) — ideal for smoke-testing a
            freshly built bundle without touching the :8080 demo container.
            (c) React Query hashes query keys structurally, so
            ['items', { q }] is stable across renders. (d) Plain Sheet is
            fine for form sheets; vaul's Drawer stays add-sheet-only.
Next:       T-P3-04 — web: Stores + Categories management, per-store aisle
            ordering (drag) (§8.1; PATCH /stores/:id {categoryOrder}
            already in the contract).

## 2026-11-15 — lane B — T-P3-04 (web Stores + Categories management)

Built:      /stores (§8.1): board-cached management list — drag + keyboard
            reorder (sortOrder renumber ×10 via sequential PATCH, optimistic
            applyStoreOrder), rename/icon sheet (StoreFormSheet reuse, now
            with an inline server-error slot), Add store, per-row menu
            (Shop here / Rename… / Aisle order… deep-link to
            /categories?store= / Archive — disabled while active items > 0 /
            Restore / Delete store… with confirm; STORE_NOT_EMPTY renders the
            copy-deck blocked message as a banner); archived stores in a
            separate section (Restore/Delete only); §8.7 loading skeleton /
            error+Retry / empty state.
            /categories (§8.1): GET /categories list with usage counts, drag
            + Move up/Move down reordering (PATCH sortOrder ×10), CategoryForm
            Sheet (name, 12-emoji icon picker, §8.2 6-color palette or none)
            for add/edit, Delete… with confirm (server soft-deletes and
            reassigns to the §6.5 'Other' fallback); the grocery 'Other' row
            hides Delete (the server would 409); per-store "Aisle order"
            section: store chips driven by ?store=, effective order =
            saved categoryOrder (unknown ids dropped) then the remainder by
            sortOrder+name (lib/reorder.ts), drag → PATCH /stores/:id
            {categoryOrder} — G3.4 persistence verified end-to-end in e2e.
            api/queries.ts: useCategories, category CRUD hooks,
            useReorderStores/useReorderCategories (sequential PATCH + one
            optimistic swap), useSetAisleOrder. cache.ts: applyStorePatch
            (replaces applyStoreStatus — useUpdateStore is now optimistic for
            every patch field), applyStoreOrder, applyCategorySortOrder.
            ReorderList component: pointer drag (midpoint swap) + keyboard
            drag (Space grab, arrows, Space drop, Escape cancel) with a
            polite live region; 44px handle; touch-action none.
Tests:      `pnpm verify` green: 91 shared + 32 db + 30 web (was 13; +17:
            reorder 12, cache 5) + 167 server. Throwaway Playwright smoke
            (8 specs × mobile-chrome 375×667 + pixel-7, deleted after the
            run — committed e2e is T-P3-06): rename round-trip, pointer drag
            swap + persistence + keyboard restore, blocked-delete banner,
            add/delete store round-trip, 'Other' delete guard, aisle-order
            keyboard move persisted per store (G3.4), category rename/add/
            delete round-trips.
Decisions:  (1) Store reorder commits one PATCH per changed store
            (sortOrder = index*10) — no bulk endpoint exists and N is small;
            aisle order commits a single PATCH {categoryOrder: all ids}.
            (2) PUT /stores/:id/category-order (#27) stays unimplemented —
            the UI uses #7's categoryOrder field, exactly as the BACKLOG
            entry from T-P3-01 anticipated. (3) Category scope is not
            exposed in the UI (create sends 'grocery'; PATCH never sends
            scope) — the PRD defines no scope UI and the board mixes scopes
            globally; logged here rather than inventing copy. (4) The
            grocery 'Other' fallback row hides Delete (server 409s it);
            household 'Other' keeps it. (5) Delete confirms close on error
            so the banner is not stranded behind the sheet overlay. (6) New
            microcopy added to §8.10 in the same change (stores menu labels,
            categories empty/add/edit/delete, aisle-order section + hint,
            reorder handle/hint/live-region strings, "{n} item(s)") per
            AGENTS.md §5. (7) ReorderList captures the pointer on the UL,
            not the handle — reordering moves <li> nodes, which implicitly
            releases an element capture mid-drag and strands the pointerup
            (found via the e2e trace); commit is skipped when the order did
            not change so a handle tap never re-PATCHes.
Deviations: None to the PRD. (The #27 PUT gap was already BACKLOG'd; no
            contract change; schema untouched.)
Learned:    (a) Implicit pointer capture is released when the captured
            element's DOM position changes (React key reorder) — capture a
            stable ancestor (the UL) and host move/up/cancel there.
            (b) Playwright mouse.up exactly on a row's midpoint does not
            swap (insertionIndex is strictly-greater) — aim past the
            midpoint in drag specs. (c) expect.poll against the request
            fixture's /board is a cheap way to assert server-side
            persistence after optimistic UI assertions. (d) A bare handle
            tap is pointerdown+up with no move — gate the commit on an
            actual order change. (e) Pointer-drag has no edge auto-scroll;
            keyboard reorder covers long lists (BACKLOG note added).
Next:       T-P3-05 — web Data screen (import preview/commit, export,
            backup) — §8.1 /data, §9.2–9.4, §12.4; contract v1.3 frozen.

## 2026-11-15 — lane B — T-P3-05 (web Data screen: import/export/backup)

Built:      /data (§8.1, §9.2–9.4): Import card — file picker (CSV or export
            JSON; multipart via a new postForm client helper, browser-set
            boundary), preview summary "{n} new · {d} duplicates · {c}
            conflicts · {i} invalid" + the §8.10 conflict line when
            duplicates+conflicts exist, per-row review list (store ·
            category · qty/unit, merge rows show "→ {target}", error rows
            show the message with no decision control) and a per-row
            decision select (Create new / Merge into {target} / Skip,
            options gated by the preview action); commit sends one decision
            per non-error line (§7.2 #29) — a target-less merge downgrades
            to skip rather than failing the whole commit; success copy
            "Imported {n} items across {m} stores." (m = distinct stores
            among committed rows, lib/importRows.ts), "No rows were
            imported." when all skipped; Start over / Import another file.
            Export card — GET /export?format=json and ?format=csv&storeId=
            downloads via a new download() client helper (blob + objectURL,
            content-disposition filename honoured, fallback
            kirana-export-YYYY-MM-DD.json), store select for CSV.
            Backup card — POST /admin/backup → "Backup saved: {file}".
            api/queries.ts: useImportPreview, useImportCommit (invalidates
            board + categories + items), useAdminBackup.
Tests:      `pnpm verify` green: 91 shared + 32 db + 37 web (was 30; +7
            importRows: initial/override decisions, committedRows counts,
            commit payload incl. target-less-merge downgrade, distinct
            stores) + 167 server. Throwaway Playwright smoke (5 specs ×
            mobile-chrome 375×667 + pixel-7, deleted after the run): preview
            diff counts on a file with a new row + an in-file conflict + an
            existing-item merge, decision override flips the commit-button
            count, commit → success copy with store count, re-import shows
            0 new, JSON export downloads and parses (schemaVersion + items),
            CSV export carries the §9.1 header + a known item, backup
            reports the saved file (run against a locally started server
            with a writable DATA_DIR — see R-013).
Decisions:  (1) New microcopy added to §8.10 in the same change (import
            hint/reading/summary/action/start over/another/row actions/
            nothing/empty action, file chosen, export buttons, backup
            section); the deck's existing "Import success"/"Import
            conflict" rows are reused verbatim. (2) Preview rows render in
            full (no virtualization) — the G3.2 gate is a 200-row file and
            MAX_IMPORT_ROWS=5000 is a hard cap, not a demo shape; revisit
            only if a real household hits it. (3) Exports download via
            fetch+blob (not navigation) so failures surface as a banner and
            the filename can honour content-disposition. (4) Commit
            invalidates board + categories + items — a commit can create
            stores/categories/items/aliases/rows/stats. (5) Backup errors
            surface the server message; the e2e-harness root cause is R-013.
Deviations: None to the PRD. Contract unchanged (v1.3).
Learned:    (a) The e2e webServer env sets no DATA_DIR, so the server
            default (/data, the container volume) makes POST /admin/backup
            500 with EACCES in the harness; verified against a locally
            started server with DATA_DIR set and filed R-013 for lane D.
            (b) services/csv.ts emits RFC 4180 CRLF — normalize \r\n before
            line-wise spec assertions. (c) An sr-only file input still
            accepts setInputFiles, and the button+hidden-input pattern
            keeps the picker keyboard-accessible. (d) Do NOT pkill -f
            "server/dist/index.js" on this box: the demo Docker container
            (8080) runs the same command line and respawns — kill debug
            instances by port. (e) Playwright download.path() + fs.readFile
            verifies export content cheaply, no extra server round-trip.
Next:       T-P3-06 — e2e import-roundtrip.spec.ts + phase close
            (G3.2–G3.6) — lane D card; R-013 unblocks its backup specs.

## 2026-11-16 — lane D — T-P3-06 (e2e import round-trip + phase close)

Built:      R-013: DATA_DIR (e2e/.tmp) added to the Playwright webServer
            env — POST /admin/backup works in the harness. Three committed
            specs (× mobile-chrome 375×667 + pixel-7): import-roundtrip —
            G3.2 200-row CSV fixture (189 new + 1 in-file conflict pair +
            8 name-match merges + 1 invalid): preview counts "190 new · 8
            duplicates · 1 conflicts · 1 invalid" + review line, per-row
            decision select drives the commit count, conflict pair defaults
            (create/skip), commit → "Imported 198 items across 2 stores.",
            re-import previews "0 new" and a second commit leaves the
            catalog item count and the single 'Import Conflict Chips' item
            untouched; backup (§12.4): "Backup saved:
            kirana-YYYYMMDD-HHMMSS.db.gz" + file exists under
            e2e/.tmp/backups; CSV export (§9.4): §9.1 header + demo rows +
            content-disposition filename. G3.3 export → wipe → import
            through the real client path (blob download feeds the file
            input): 20 rows restored with identical row counts, per-store
            row names, and store names; Home re-renders "5/9/6 to buy".
            aisle-order (G3.4): keyboard reorder (Space grab → arrows →
            Space drop, live-region strings) moves Snacks & Namkeen to the
            top of Costco's aisle list, PATCH persists (board
            categoryOrder[0] polled + reload), Home's Costco card now
            leads with Biscuits, and Indian Store's order stays [].
            merge-items (G3.5): API-seeded disposable pair + alias;
            confirm sheet with "This cannot be undone." — Escape aborts
            (both items survive), confirm merges → target detail shows the
            moved alias, source 404s and is absent from catalog search
            (which surfaces the kept item via the carried-over alias),
            board shows 2 target rows and 0 source rows.
            support.ts: removeImportArtifacts/removeMergeArtifacts (direct
            DB cleanup, FTS triggers respected), catalogItemCount/
            itemCountByName, wipeHouseholdData, restoreDemoBoard (wipe +
            idempotent seedDemoBoard re-seed) — exported boardOf.
Tests:      `pnpm e2e` 92/92 (was 80; +12 = 3 specs × 2 viewports).
            `pnpm verify` green: 91 shared + 32 db + 37 web + 167 server.
            `pnpm contracts:check` green (v1.3 untouched).
Decisions:  (1) G3.4/G3.5's earlier evidence was throwaway specs (deleted
            after T-P3-03/04 runs) — dedicated committed specs keep every
            P3 gate reproducible from a clean clone (§16 gate checklist
            item 1). (2) G3.3 wipes via direct DB (no wipe endpoint;
            §12.5 restore drills are P5) and restores the canonical demo
            board in afterEach: the import model rebuilds list rows but
            not orphan seed items (40 → 20 items) and re-creates
            household-scope categories as grocery-scope rows (R-014), so
            the raw restored board is not the demo board; the gate's "row
            counts and names" is asserted on the restore itself. (3)
            Conflict rows render no per-row message in the UI (only error
            rows do) — the spec asserts the decidable selects' defaults
            (create/skip) instead of a message string. (4) The atomicity
            half of G3.2 is evidenced by the server suite
            (import.test.ts "rejects bad decisions with 400/404 and rolls
            everything back") — the UI cannot produce a mid-commit
            failure. (5) The merge spec asserts source-link absence rather
            than an empty catalog search: the kept item legitimately
            surfaces because the merge carried the source's alias over
            (search continuity).
Deviations: None to the PRD. Contract unchanged (v1.3); no migration —
            lock stays 0003. R-014 filed (open, lane A) for the import
            category-scope quirk discovered by G3.3; not a gate blocker.
Learned:    (a) Playwright evaluate/evaluateAll callbacks do not close
            over test scope — pass values as the arg parameter. (b) A spec
            that wipes shared state must restore a pristine baseline in
            afterEach, not just delete its own artifacts — otherwise the
            failure cascades into every later file (G3.3's category
            re-creation re-ordered Costco's aisles and broke shop-mode).
            (c) evaluateAll on an already-filtered locator enumerates only
            the matches — read positions from the unfiltered handle list.
            (d) expect(locator).toHaveValue works on <select> to pin the
            default decision. (e) The e2e webServer env is the only place
            the harness server's DATA_DIR comes from; keep it beside
            DATABASE_URL.
Next:       P4 — household, sync, PWA per PRD §15.3 (new phase file +
            cards; lanes A+B+D).

## Handoff (P3 complete)

Done:        T-P3-01…T-P3-06. Gates evidenced: G3.1 server integration
             (items-management, categories-crud) + committed e2e CRUD/
             management specs; G3.2 + G3.3 import-roundtrip.spec.ts;
             G3.4 aisle-order.spec.ts; G3.5 merge-items.spec.ts; G3.6 the
             spec itself green. Demo script: the suite runs end-to-end
             against the seedDemoBoard demo board (global-setup).
Tests:       327 unit/integration (91+32+37+167) + 92 e2e green from a
             clean checkout; `pnpm verify` + `pnpm contracts:check` green.
Contract:    shared/contracts.ts @ v1.3 (ADR-0003, ADR-0004); openapi.json
             current; schema hash 0002; migration lock: next 0003.
Branch/tag:  feat/p3/items-management; tag phase-3-complete on the phase
             close commit. Push pending (branch was 3 ahead before this
             session; push both together).
Open items:  R-014 (lane A, import category scope); BACKLOG: alias
             soft-delete needs migration 0003; PUT /stores/:id/
             category-order (#27) unimplemented by design; JSON import
             restores rows as active (statuses not carried); store icons
             reset to 🏬 on import.
Next:        P4 — household, sync, PWA per PRD §15.3. Lanes: A (sync
             backend), B (PWA shell), D (phase file + e2e). Start by
             creating docs/progress/PHASE-4.md from §15.3's P4 card.
