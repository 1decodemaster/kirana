# PHASE-2 — Add Item & Search

Goal: the 3-tap add — the phase that decides whether the family adopts the app.
Refs: PRD §15.3 (P2 card). Gates: G2.1–G2.6.

## Session log

## 2026-11-15 — lane A+B — spike + T-P2-01 + T-P2-02 (P2 complete)

Built:      Search spike (probes 1–6, scripts in /tmp/opencode, results
            summarized in ADR-0002): Devanagari norms mangle deterministically
            and exact/prefix match works (nukta-insensitive); FTS5 trigram is
            case-sensitive on raw columns and can't be altered in place; FTS5
            retrieval is 20–100× faster than a JS full scan at the 5k cap;
            quoted per-token phrases are the only safe MATCH form.
            ADR-0002: one shared scorer (§8.6 verbatim), no Fuse.js (bitap
            can't express the tiers; deviation recorded), migration 0002
            rebuilds item_search on canonical forms, contract v1.0 → v1.1
            (catalogItemDto.stats?, getItemsQuery.storeId? — both additive).
            shared/src/search.ts: prepareQuery/matchQuality/searchScore/
            compareMatches/resolveItem/ftsPhraseQueries + editDistance.
            db: 0002_item_search_norm_keys.sql (keys blob via registered
            kirana_norm/kirana_fold functions in the six triggers — §5.3's
            "cannot drift" preserved; soft-deleted items excluded from FTS),
            reindex verified, hash-schema script added, schema hash re-pinned.
            Server: catalog.ts (GET /items with SQL tiers ∪ FTS prefilter ∪
            edit-tier-on-demand; POST /stores/:id/items with §6.4 resolution,
            soft-deleted revival, §6.5 category write-backs, INV-8 stats
            upsert, §7.4 clientId idempotency; POST /items for "Create new
            anyway"); board ships per-item §8.6 signals (stats). 40 tests
            added (catalog + search suites).
            Web: searchIndex.ts (local index ranked by the same shared
            scorer), AddItemSheet (vaul bottom sheet, 80 ms debounce, ≤5
            suggestions grouped "In this store"/"Also in your catalog", live
            quick-parse, Count/Weight/Volume segmented control per §6.2,
            category chips recents-first, Add / Add another, AC-A4 prompt
            with Use it / Create new anyway); FAB → store picker (§8.3) →
            sheet; delete-item undo toast now re-adds via undoToken-as-
            clientId (BACKLOG item closed). PRD §8.10 gained 7 copy rows.
Tests:      `pnpm verify` green: 91 shared (+34 new search tests; G2.2
            coverage: normalizeName/fold/parseQty/convert 100% stmts+funcs,
            resolveItem+search 100% stmts / 93.8% branches) + 32 db (4 new
            FTS tests) + 101 server (39 new). `pnpm e2e` 50/50 across
            mobile-chrome 375×667 + pixel-7 (12 new specs: add-item-known,
            add-item-new, duplicate-guard — G2.6, AC-A1..A5 + keyboard path).
            Docker image boots; smoke: healthz 200, store create 201, add by
            name creates item+alias, GET /items ranks with signals.
Decisions:  (1) No Fuse.js — ADR-0002 §2. (2) Near-dup threshold reads §6.4's
            "best.score ≥ 0.90" as the FULL §8.6 score: dedupe pressure lands
            on frequently-added items; never-added catalogs tolerate
            prefix-typed creates. Verified numerically in tests. (3) The
            sheet intercepts typed-exact/alias matches client-side (AC-A4
            prompt before any network call); a suggestion tap adds directly
            (AC-A1's 3 taps). "Create new anyway" is hidden for exact matches
            (INV-5 makes it impossible). (4) The server does NOT quick-parse
            (§6.3 is a sheet behavior; §7.4's name is the name) — the docker
            smoke posting "smoke milk 2 l" raw stores it verbatim, by design.
            (5) lang for auto-created aliases: 'hi' when the name contains
            Devanagari, else 'en' (§6.4 says 'en' verbatim; flagging the
            deviation-from-letter here rather than silently). (6) alias
            created on item creation duplicates name_norm — makes alias
            lookup hit for the name too (harmless, UNIQUE guards it). (7)
            Sheet clears the input on parse ('atta 5kg' → 'atta'); continued
            typing after a bare-number parse ('milk 2' → 'milk ' + qty 2)
            means "milk 2 l" typed char-by-char needs a unit fix via the
            segmented control — accepted quirk, AC-A2's one-shot flow is
            exact. (8) Item qty stays NULL when the add carries none; the
            typed unit becomes the item's default (§6.4 "last unit used").
Deviations: Contract v1.1 (stats + storeId) — additive, ADR-0002 §5,
            contracts:check green. Fuse.js dropped — ADR-0002 §2. Both land in
            contract:/feat commits citing the ADR.
Learned:    (a) better-sqlite3 registered functions (db.function) work inside
            triggers and inside migration transactions — the mechanism that
            keeps FTS drift-free without app-maintained columns. (b)
            noUncheckedIndexedAccess applies to typed arrays too; a sentinel
            read (`?? DP_UNSET`) is total and branch-free where `!` is
            banned. (c) v8 coverage mis-attributes ranges around ignored
            branches — istanbul agreed with v8 here; prefer removing provably
            redundant guards over ignoring them. (d) Playwright strict mode
            catches state pollution across projects: with workers:1 the two
            viewport projects share one server DB, so every P2 spec resets
            its artifacts via a direct-DB helper (support.ts
            resetAddItemState) — @kirana/db is already an e2e dep. (e) The
            sr-only Drawer.Description text matches getByText() — assert
            sheet titles via getByRole('heading'). (f) MenuSheet options and
            store-card headers share accessible names — scope picker clicks
            to getByRole('dialog').
Next:       P1.5 — Shop Mode (PRD §8.5), then P3 — Management & Import/Export.

## Handoff

Done:        P2 Add Item & Search complete; gates G2.1–G2.6 evidenced below.
Next:        P1.5 Shop Mode (§8.5 — P1-sized, sits before P3 in §15.3), or
             P3 if Shop Mode is deferred by the user. First P3 card: item
             management screens + import/export APIs.
Blocked:     none.
Files:       shared/src/{search.ts,search.test.ts,contracts.ts,index.ts,
             parseQty.ts}, scripts/gen-openapi.ts, openapi.json,
             db/{connection.ts,hash-schema.ts,migrations/0002_*.sql,
             __tests__/{fts,migrate}.test.ts,schema-hash.txt,package.json},
             server/{routes/{items,stores,api}.ts, services/{catalog,board,
             mappers}.ts, __tests__/{catalog,search}.test.ts},
             web/src/{components/AddItemSheet.tsx, lib/searchIndex.ts,
             api/{queries,cache}.ts, routes/Home.tsx}, e2e/specs/**,
             docs/DECISIONS/ADR-0002-search.md, PRD §8.10.
Tests:       `pnpm verify` (224 green) + `pnpm e2e` (50 green) + docker run
             smoke (healthz, store create, add, search).
Context:     Contracts now v1.1 — openapi.json regenerated, check green.
             Migration lock: next available 0003. The demo container on :8080
             still runs the P1 image (user review); a P2 demo is one
             `docker run -p 8080:8080 -e SESSION_SECRET=… kirana:local-node`
             away (image rebuilt this session). CSRF: every mutation sends
             X-Requested-With: kirana (web client does; curl needs -H).

### Gate evidence
- G2.1: e2e add-item-known (AC-A1 ×2 + keyboard), add-item-new (AC-A2, A3,
        A5, Add-another), duplicate-guard (AC-A4) — 50/50 both viewports;
        server contract tests assert the frozen response schemas.
- G2.2: vitest istanbul coverage over normalize.ts/fold.ts/parseQty.ts/
        units.ts/search.ts — 100% statements & functions in all five;
        branch 93.8% worst (search.ts; the rest 100%). normalizeName, fold,
        parseQty, convert (convertUnit) and resolveItem all ≥90%.
- G2.3: server catalog.test.ts — 100 sequential adds of the same name →
        exactly 1 item + 1 alias (plus the e2e AC-A3 double-add path).
- G2.4: server search.test.ts — pya, pyaz, प्याज़, chawa, dood, milk each
        return the right item as the top hit; mirrored in e2e via the UI.
- G2.5: server catalog.test.ts (409 ITEM_NEAR_DUPLICATE + suggestions, no
        second row; threshold needs signals) + e2e duplicate-guard.spec.ts
        (Use it / Create new anyway paths; never a second 'Basmati Rice').
- G2.6: e2e add-item-known.spec.ts, add-item-new.spec.ts,
        duplicate-guard.spec.ts green across both viewports.
