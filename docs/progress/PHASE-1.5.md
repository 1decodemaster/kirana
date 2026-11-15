# PHASE-1.5 — Shop Mode

Goal: the in-store experience — a focused single-store view over the same
board cache. Depends on P2; parallel-safe with P3.
Refs: PRD §8.5, §15.3 (P1.5 card). Gates: G15.1–G15.5.

## Session log

## 2026-11-15 — lane B+D — T-P1.5-01 (P1.5 complete)

Built:      Shop Mode (§8.5): `/store/:id` as a full-screen route outside
            NavShell (no tab bar, no rail) under a new RootLayout that hosts
            `<ScrollRestoration />` for every route. Sticky header: icon,
            store name, bought/total counter, progressbar, ✕ exit. One
            category expanded at a time — the current category is derived
            (first §6.8-ordered group with an unchecked item); completing it
            auto-expands the next unchecked one with a 200 ms ease-out rAF
            scroll tween that respects prefers-reduced-motion. ShopRow:
            56 px row, 28 px visual checkbox, right-aligned qty chip, §8.8
            accessible name via itemAriaLabel. Footer "Done shopping" —
            enabled only once nothing is unchecked; taps POST
            /stores/:id/done and returns Home. Wake Lock API on mount
            (re-acquired on visibilitychange, released on unmount; silent
            no-op when unsupported). Escape exits like ✕. Entry: "Shop here"
            as the first action in Home's store ⋯ menu. web/src/lib/
            shopGroups.ts (pure §6.8 consecutive grouping + counts +
            firstUncheckedIndex) with 8 vitest unit tests — web's first unit
            runner; StoreCard now consumes the same grouping function
            (local duplicate removed). e2e shop-mode.spec.ts: 11 specs × 2
            viewports; smoke.spec.ts deep-link assertion updated to the real
            route's not-found state.
Tests:      `pnpm verify` green: 91 shared + 32 db + 8 web (new) + 101
            server = 232 unit/integration. `pnpm e2e` 72/72 across
            mobile-chrome 375×667 + pixel-7 (G15.1 ×2, G15.2 bounding-box
            sizes, AC-H2-analogue reload persistence, G15.3 offline read +
            rollback + Retry recovery, G15.4 same-scroll return, done flow,
            footer-disabled + ✕ early exit, keyboard Space/Escape, empty
            store, not-found). `pnpm contracts:check` green (contract
            unchanged at v1.1 — Shop Mode is a pure view). Docker:
            kirana:local-node rebuilt with the new lockfile under
            --frozen-lockfile; smoke on :8095 — healthz 200, store create
            201, add-by-name stores verbatim (§7.4), PATCH toggle → bought,
            done → status done.
Decisions:  (1) Entry point: the PRD never says how you enter Shop Mode;
            §8.3 reserves the store-header tap for expand/collapse, so
            "Shop here" went in as the first action of the existing ⋯ menu
            (assumption logged per §21; deep links also work). (2) "Done
            shopping" is enabled only when all items are bought — the
            server's markStoreDone 409s (STORE_NOT_EMPTY) with active items
            and §8.3's board convention is Done ✓ at zero active; ✕ is the
            early exit and leaves the trip intact (e2e-asserted). (3) Aisle
            order = the §6.8 board order verbatim (category_order_json ∪
            sort_order, unchecked-first within a group) — "shop mode reads a
            single store subtree"; bought rows sink within their aisle as
            you check them. (4) Auto-advance state is fully derived — no
            persisted expansion, no sync bugs; the 200 ms figure is a rAF
            ease-out tween because browsers don't expose a duration for
            native smooth scroll. (5) Collapsed sections are non-interactive
            headers (icon, name, bought/total) — strict §8.5 reading;
            peeking ahead is a BACKLOG candidate. (6) G15.3 offline reading
            = the warm board cache (in-session); the service-worker shell
            and mutation queue are P4. The e2e models "browser online, WAN
            dead" with route aborts — CDP setOffline blackholes localhost
            fetches (they hang); with navigator.onLine=false react-query
            pauses queries instead of failing. (7) web devDeps: vitest
            ^5.1.0 (already a workspace dependency — no new package) +
            @types/node ^22.20.5 (required for vitest's peer resolution);
            e2e tsconfig gained the DOM lib for page.evaluate callbacks.
Deviations: None against the contract (v1.1 unchanged). Lockfile churn: the
            `pnpm update -r vitest` needed to repair web's peer resolution
            consolidated all vitest variants to include the coverage plugins
            (already in the graph via shared) — versions unchanged. PRD §8.10
            gained 6 Shop Mode rows (deck-addition path, AGENTS §5).
Learned:    (a) pnpm 12.3.4 filtered installs (`--filter X add/install`)
            corrupt workspace lockfiles for optional-peer devDeps — web's
            vitest resolved peer-less — and prune node_modules including the
            platform-matching native optionals (rolldown bindings). Repair
            recipe: `pnpm update -r <pkg>` to re-resolve peers, then
            `rm node_modules/.modules.yaml && pnpm install --force` to
            re-materialize the skipped bindings. Never mix filtered installs
            with full-workspace state. (b) This box's non-interactive shells
            need PATH="$HOME/.nvm/versions/node/v22.23.2/bin:
            $HOME/.local/share/pnpm/bin" — system node is v18 and vitest 5
            needs ≥22.12 (node:util styleText). (c) Playwright's click
            auto-scrolls the target into view: a scrollTo(0, 300) followed
            by clicking a top-of-page button silently resets the scroll and
            poisons scroll assertions — click a target that is visible at
            the scrolled position. (d) react-query v5 sets status "error"
            on refetch failure even with cached data (queryReducer 'error'
            case) — a failed background refetch flips the screen to the
            error state; filed to BACKLOG for P4. (e) The initial history
            entry has no state.key ({"idx":0}); ScrollRestoration still
            works in-session because save (navigate-away) and restore (POP)
            both key on location.key ("default").
Next:       P3 — Management & Import/Export. First card: item management
            screens + import/export APIs; P3 claims migration 0003 if the
            sessions table slips to P4.

## Handoff

Done:        P1.5 Shop Mode complete; G15.1–G15.5 evidenced below.
Next:        P3 — Management & Import/Export (§15.3 order). First card: item
             management screens + import/export APIs.
Blocked:     none.
Files:       web/src/{App.tsx,routes/ShopMode.tsx,routes/Home.tsx,
             components/{ShopRow,Sheet,StoreCard}.tsx,lib/{shopGroups.ts,
             shopGroups.test.ts,scroll.ts},vitest.config.ts,package.json},
             e2e/{specs/{shop-mode,smoke}.spec.ts,specs/support.ts,
             tsconfig.json}, pnpm-lock.yaml, docs/PRD.md §8.10,
             docs/BACKLOG.md.
Tests:       `pnpm verify` (232 green) + `pnpm e2e` (72 green, both
             viewports) + docker build & run smoke (healthz, store, add,
             toggle, done).
Context:     Contracts still v1.1 — openapi.json unchanged. Migration lock:
             next available 0003. The demo container on :8080 still runs the
             P1 image; a P1.5 demo is one `docker run -p 8080:8080
             -e SESSION_SECRET=… -e DATABASE_URL=/data/kirana.db
             kirana:local-node` away (image rebuilt this session). CSRF:
             every mutation sends X-Requested-With: kirana.

### Gate evidence
- G15.1: e2e shop-mode entry spec (current expanded, others collapsed) +
         auto-advance spec (category completes → next expands, scrolled
         into view, walk continues to 5/5) — both viewports.
- G15.2: e2e bounding boxes — row ≥56 px, checkbox ≥28 px, ✕ and footer
         ≥44 px; both viewports.
- G15.3: e2e offline spec — client-side navigation and cached reads work
         with API calls aborted; a failed check rolls back with the §8.7
         banner; Retry recovers. (Offline app shell + mutation queue = P4,
         per the card's "checks queue per P4 rules".)
- G15.4: e2e scroll spec — Home scrolled to 300, enter Shop Mode via the
         menu, exit via ✕ → window.scrollY is 300 again (ScrollRestoration
         + navigate(-1)).
- G15.5: e2e/shop-mode.spec.ts green across both viewports (11 specs).
