# PHASE-1 — Core Board

Goal: the Home screen is real. You can see, check, and clear items.
Refs: PRD §15.3 (P1 card). Gates: G1.1–G1.6.

## Session log

## 2026-11-15 — lane A — T-P1-01 (board + stores + list-item APIs)
Built:      Server owns the SQLite connection (open + migrate at boot, db
            plugin with onClose). Pre-auth actor resolution: first household
            + its oldest member act on every /api/v1 request; a fresh DB
            bootstraps household "Home" + member "You" (P4 replaces this).
            GET /board per §7.3 with §6.6 counts, §6.8 sorting (category
            order json → sort_order, unknown last, active before bought),
            catalog cap 5,000 + catalogTruncated, and ?since= delta driven by
            change_log. Stores: create (revives a soft-deleted name row —
            the unique index blocks a second row), patch with §4.6 status
            transitions (done/archived require zero active → 409
            STORE_NOT_EMPTY), soft delete, clear-bought, done, reopen. List
            items: patch (INV-2 checked_at semantics, INV-3 via contract),
            hard delete returning undoToken (= the P2 re-add clientId),
            bulk-check (the undo path for clear-bought). GET /categories
            with active+bought usage counts. CSRF hook: mutations require
            X-Requested-With: kirana (§7.1). Demo board seed `db:seed:demo`
            (idempotent, skips households that already have stores).
Tests:      61 server (board/stores/list-items/categories + G1.2 perf) + 5
            new db demo-seed tests, via `pnpm --filter … test:unit`; all
            green from `pnpm verify` (139 total).
Decisions:  (1) @kirana/db added as a server dependency (workspace-internal;
            the server must own the connection). (2) zod declared directly in
            server/package.json — validate.ts imports it at runtime and pnpm
            deploy correctly dropped the undeclared transitive dep (caught
            by the Docker check). (3) Store name conflicts → 409
            CONFLICT_STALE (only conflict code in the closed set). (4)
            `PATCH status=archived` also requires zero active items
            (archiving must not hide active work). (5) done + archived
            stores render together in the bottom "Archived" section — AC-H4
            says the card moves there on Done ✓; §4.6's done→archived
            transition stays available in the ⋯ menu. (6) `?since` > current
            revision returns the full board (restored-DB safety). (7) The
            2k-item G1.2 fixture is built inline in board.perf.test.ts
            (deterministic) instead of a JSON fixture — same evidence,
            fewer files.
Deviations: none. Contracts untouched (openapi.json check green).
Learned:    (a) Fastify error handlers must be registered BEFORE routes:
            setErrorHandler set in a later-registered plugin is not inherited
            by earlier subtrees — moved errorsPlugin first in buildApp.
            (b) fastify-plugin shares the parent scope, so a hook inside an
            fp plugin leaks to EVERYTHING (CSRF 403'd /healthz tests until
            apiRoutes became a normal scoped plugin). Hooks apply to a
            plugin's own scope + children, never siblings. (c) P0 had
            committed stale compiled .js artifacts inside shared/src which
            shadowed the .ts sources at runtime (index.ts's
            `export * from './contracts.js'` resolved to the stale file —
            four schemas silently missing). Deleted + gitignored. (d) Vitest
            worker-threads pool inflated the board-latency gate ~2.5×; the
            server suite now runs pool=forks + fileParallelism=false so G1.2
            measures the server, not the harness. (e) better-sqlite3 row
            materialization dominates board time; dropping the redundant
            SQL ORDER BY (JS re-sorts per §6.8) and skipping the catalog
            sort under the cap took the builder from ~11ms to ~8ms p50.
Next:       T-P1-02 Home screen (lane B).

## 2026-11-15 — lane B — T-P1-02 (Home screen real data)
Built:      api client (typed fetch, §7.1 envelope → ApiError, CSRF header,
            content-type only with a body) + react-query hooks with
            optimistic board-cache updates and rollback. Home per §8.3:
            member avatars, store cards (X/Y badge, progress bar, chevron
            toggle persisted in localStorage), §6.8 category groups, custom
            checkbox rows (role=checkbox + aria-checked + accessible name
            "{name}, {qty}, {category}", icon AND strikethrough, 44px
            targets), optimistic check surviving reload, clear-bought with
            the 5s undo toast (bulk-check restores exactly), Done ✓ /
            "All done! Archive this store?" / auto-collapse of fully-bought
            stores, Archived section (collapsed, last) with Restore/Archive
            in the ⋯ menu, add/rename store sheet (12 emoji presets + free
            text), delete confirms with deck copy, deck-verbatim empty
            states, skeleton loading, error + Retry, mutation-error banner.
            Minimal focus-trapped Sheet (Escape + backdrop + focus restore);
            vaul still deferred to P2 per ADR-0001. Deps: lucide-react,
            clsx, tailwind-merge (all pre-approved as "deferred to P1" in
            ADR-0001 §6).
Tests:      e2e 28/28 green twice (mobile-chrome 375×667 + pixel-7): smoke
            (6), check-item (AC-H1/H2/H5), clear-bought (G1.4 ×2),
            archive-store (AC-H4 ×3). `pnpm verify` 139 green. Docker image
            boots, migrates, serves board + store creation (docker run on
            8093).
Decisions:  (1) FAB opens the add-store sheet in P1 (the add-item sheet is
            P2); empty-Home primary action uses it too. (2) Copy deck gained
            one row: Store delete confirm "Remove {name}? Its history stays
            in backups." (PRD §8.10 updated in this phase's commits).
            (3) Expansion overrides persist per store; default = collapsed
            only when fully bought. (4) Delete-item undo toast deferred to
            P2 (needs the re-add endpoint; BACKLOG). (5) e2e port moved to
            8090: an unrelated container/server already binds 8080 on this
            machine.
Deviations: compose re-verification blocked — a pre-existing container named
            `kirana` (older build, started by another session, user lxd)
            holds the name and port 8080; left untouched. Image verified via
            `docker run` instead; `docker compose up` should be re-run when
            that container is removed.
Learned:    (a) Never filter a locator by the state the click changes
            (`[aria-checked="false"]` re-resolves to a different row after
            the optimistic flip). (b) Playwright `beforeAll` runs once per
            WORKER — with workers:1 both projects share it, so the second
            project inherited mutated state; arrange in `beforeEach`. (c)
            Cleared rows are invisible to the board API, so any e2e that
            clears rows must restore them by id or it poisons later suites.
            (d) A bodiless POST must not send content-type: application/json
            (Fastify 400 "Body cannot be empty"). (e) Server-side reset of
            e2e state must also restore the store status — Done ✓ leaves the
            store in the collapsed Archived section where the next suite
            can't see it.
Next:       P1 gate review, then P2 — Add Item & Search (search spike first
            20%, per the P2 card).

## Handoff

Done:        T-P1-01 + T-P1-02. Home is real end-to-end; all P1 gates have
             evidence below.
Next:        P2 — Add Item & Search. First card: search spike (§8.6 ranking,
             FTS5 vs trigram, Devanagari — see PHASE-0 Learned (a)), then
             POST /stores/:id/items (§6.4 upsert, §7.4), add-item sheet.
Blocked:     none (see Deviations for the compose note).
Files:       db/{index,demo,cli}.ts, db/__tests__/demo.test.ts,
             server/{app,config,db,validate}.ts, server/plugins/db.ts,
             server/routes/**, server/services/**, server/__tests__/**,
             web/src/{api,components,lib,routes}/**, e2e/**,
             Dockerfile, .gitignore, PRD §8.10 (one copy row).
Tests:       `pnpm verify` (139 green) + `pnpm e2e` (28 green ×2 runs) +
             docker run smoke (healthz, board, store create).
Context:     Contracts still FROZEN at v1.0 — untouched this phase.
             Migration 0002 still unclaimed. The pre-auth actor (server/
             services/actor.ts) is THE thing P4 replaces; every /api/v1
             route reads req.actor. CSRF: every mutation must send
             X-Requested-With: kirana (web client does).

### Gate evidence
- G1.1: AC-H1..H5 covered — server tests (counts §6.6, sorting §6.8,
        STORE_NOT_EMPTY) + e2e check-item.spec (H1, H2, H5),
        archive-store.spec (H4), clear-bought.spec (H3).
- G1.2: board.perf.test.ts — 2,000 rows / 10 stores, p95 of 60 runs
        ≤ 50ms (observed ~25–35ms); suite is forks + sequential so the
        number is the server's, not the harness's.
- G1.3: e2e AC-H2 spec — optimistic flip without network wait, persists
        across reload.
- G1.4: e2e clear-bought.spec — undo restores the exact same rows; expiry
        path asserts the clear stands after 5s.
- G1.5: server stores.test.ts — done/archived with active items → 409
        STORE_NOT_EMPTY (both POST /done and PATCH status).
- G1.6: e2e check-item.spec.ts + clear-bought.spec.ts green (plus
        archive-store.spec.ts).
