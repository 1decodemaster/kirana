# PHASE-4 — Household, Sync, PWA

Goal: it's a shared app the family installs on their phones.
Refs: PRD §15.3 (P4), §4.7, §7.1–7.6, §8.7–8.10, §10 NFR-7, §11, §12.1–12.2,
§19. Gates: G4.1–G4.7.

## Task cards

- T-P4-01 — contract v1.3 → v1.4: auth, household create, members, SSE (lane A, contract; ADR-0005) — **everything below depends on this**
- T-P4-02 — backend: sessions table (migration 0003), scrypt auth, rate limit, auth enforcement (G4.6)
- T-P4-03 — backend: household create + members APIs + GET /events SSE (G4.1 server half, NFR-7)
- T-P4-04 — web: first-run wizard (§8.9), login/session screens, /settings (household, members, theme, about)
- T-P4-05 — web: SSE client, offline mutation queue (§4.7), offline banner (§8.7)
- T-P4-06 — web: service worker, manifest + icons, installability (G4.4), axe findings fixed (G4.5)
- T-P4-07 — e2e: first-run, auth, live-sync (G4.1), offline-queue (G4.2/G4.3), a11y (G4.5) + phase close

## Card details

### T-P4-01 — contract v1.4 (contract territory)

§7.2 #1–3 (auth), #31 (/events) have request/response schemas to add.
The wizard needs household creation and the settings screen needs members
management — neither endpoint exists in §7.2. Additions (ADR-0005, additive
only): POST /household (wizard commit), POST/PATCH/DELETE /members.
Deliverable: shared/contracts.ts v1.4, openapi.json regenerated,
`pnpm contracts:check` green. No migration in this card.

### T-P4-02 — sessions + auth (server, db)

Migration **0003 claimed** (see lock below): `sessions` table per §7.6
(survives restart → G4.6). scrypt per §12.2 (N=16384, r=8, p=1, keylen=64,
`scrypt$N$r$p$salt$hash`, timingSafeEqual). `sid` cookie HttpOnly,
SameSite=Lax, Secure when https, Path=/, Max-Age=2592000; SESSION_SECRET
required (§12.1). Login rate limit 5/5min/IP (§11). Replace the
resolveActor pre-auth stub with session resolution; every route 401
UNAUTHORIZED without a session except /auth/login, POST /household,
/healthz, static.

### T-P4-03 — household create, members, SSE (server)

POST /household (single request: name, passcode, displayName, color,
seedCategories? → §14.1 categories + §14.2 sample items when opted in;
first store reuses POST /stores). Members CRUD for /settings. SSE per
§7.5: change_log tail, heartbeat 20s, Last-Event-ID, ≤20 connections per
session (§11), propagation ≤1s (NFR-7). Audit that every mutating service
appends change_log rows (catalog/categories/listItems/stores do; verify).

### T-P4-04…T-P4-06 — web cards

Lane B; see card lines above. Copy from §8.10 verbatim; new strings go
into §8.10 in the same PR (session-expired, wizard, members, offline queue
counts if missing).

### T-P4-07 — e2e + close (lane D)

New specs: first-run, auth, live-sync (two contexts, add on A → B ≤1s),
offline-queue (3 offline checks → reconnect → persist, no duplicates;
same clientId replayed twice → one row), axe a11y on Home/add sheet/
Catalog. Gates G4.1–G4.7 evidenced; tag phase-4-complete.

## Migration lock

**0003 claimed by T-P4-02** (sessions). The BACKLOG item "alias soft-delete
needs migration 0003" is renumbered: it now claims **0004**.

## Open items carried in

- R-014 (lane A): import ensureCategory grocery-scope only — household-scope
  categories re-created as grocery rows on import. Not a gate blocker.
- BACKLOG: alias soft-delete (now 0004), PUT /stores/:id/category-order
  (#27) unimplemented by design, JSON import restores rows as active,
  store icons reset to 🏬 on import.

## Session log

## 2026-11-16 — lane A — T-P4-01 (contract v1.4)

Built:      Contract v1.3 → v1.4 (ADR-0005): POST /auth/members (passcode-
            gated roster for the login screen), POST /household (§8.9 wizard
            commit; 403 when one exists; seedSampleData default true),
            PATCH /household (settings rename + passcode change), members
            CRUD (soft delete; 403 on last-member delete). openapi.json
            regenerated; tags household + members added. All additions;
            nothing existing changed.
Tests:      `pnpm verify` green: 96 shared (+5 contract tests) + 32 db +
            37 web + 167 server. `pnpm contracts:check` green.
Decisions:  (1) ADR-0005 — the §7.2 table predates P4's needs; the roster
            endpoint is required or a second member could never log in.
            (2) Member duplicate-name → 400 VALIDATION_FAILED (closed error
            set kept). (3) Passcode change needs no current-passcode
            re-confirm (session is the proof; casual-access model).
Deviations: None. Additive contract change, ADR'd.
Learned:    Zod omits absent optionals from parsed output — assert on the
            field only when explicitly provided.
Next:       T-P4-02 — sessions table (migration 0003) + scrypt auth.

## 2026-11-16 — lane A — T-P4-02 (sessions + auth)

Built:      Migration 0003_sessions.sql (ADR-0006): sessions table keyed by
            sha256(token); the sid cookie carries
            `<base64url token>.<base64url HMAC(token, SESSION_SECRET)>`.
            db/passcode.ts (§12.2 scrypt, timingSafeEqual) exported from
            @kirana/db — shared by the demo seed and the server (both lanes
            A; kept out of shared/ to avoid a second contract PR). Server:
            plugins/auth.ts (session resolution with a 1000-entry cache,
            default-deny 401 outside {POST /auth/login, POST /auth/members,
            POST /household}, per-session 120/min mutation limiter),
            services/sessions.ts, services/rateLimit.ts (sliding window,
            injectable clock), routes/auth.ts (login/logout/me/roster,
            household create+patch, members CRUD — all append change_log
            member rows; member delete revokes that member's sessions).
            requireActor() at every handler boundary. helpers.ts: test apps
            auto-seed a demo household (DEMO_PASSCODE='0000', members
            Alex+Sam) and injectJson auto-logs-in as Alex — existing tests
            unchanged. db/demo.ts now seeds the usable demo passcode.
Tests:      `pnpm verify` green: 96 shared + 38 db (+6 passcode) + 37 web +
            203 server (+36: passcode 6, rateLimit 9, sessions 7, auth
            integration 14). Schema hash repinned to 0003; migrate tests
            updated.
Decisions:  (1) ADR-0006 (sessions table) as above. (2) Rate limiter is
            record-then-check with a strict-> boundary: exactly 5 logins
            pass per 5min/IP; the 6th records the breach; each attempt
            past the limit after a block expires doubles the block (capped
            1h) — an earlier check-first/5-min-failure-window design made
            the backoff provably dead code. (3) Login counts every attempt
            (§11 "5 attempts/5min/IP"), not just failures. (4) board.test
            "bootstraps a default household" replaced by "fresh db is 401":
            the lazy-bootstrap behaviour was the pre-auth stub, removed by
            design in §7.6 — households come from the wizard. (5) Member
            delete calls sessions.revokeAllForMember because the cache path
            cannot re-check deleted_at without defeating the cache.
            (6) Demo passcode '0000' (min length 4) so dev/e2e can log in.
Deviations: None to the PRD. Cross-lane touches: db/cli.ts + e2e
            global-setup/support (seedDemoBoard is now async) — mechanical
            await fixes, no behaviour change; e2e suites stay red against
            auth until T-P4-07 (expected mid-branch; verify does not run
            e2e).
Learned:    (a) Node's scrypt needs no maxmem override at N=16384/r=8 —
            128·N·r = 16MB fits the 32MB default; a hand-rolled maxmem of
            exactly 16MB trips "memory limit exceeded". (b) light-my-request
            res.cookies strips flags — assert cookie flags on
            res.headers['set-cookie']. (c) Fastify onRequest hooks run in
            registration order: the CSRF hook (403) precedes auth (401) on
            header-less mutations. (d) The e2e harness env already carried
            SESSION_SECRET — the P0 author anticipated P4.
Next:       T-P4-03 — GET /events SSE + change_log audit + /board delta
            verification.

## 2026-11-16 — lane A — T-P4-03 (SSE /events + sync backend complete)

Built:      routes/events.ts — GET /events?since=<revision> per §7.5:
            change_log tail as `event: change` / `id: <rev>` / `data:` JSON
            frames (changeEventSchema), 20s heartbeat comment, Last-Event-
            ID honoured when since is absent, replay bounded at 500 rows,
            per-session connection cap 20 → 429 (§11), poll interval 250ms
            → propagation ≪1s (NFR-7), reply.hijack + raw writeHead +
            flushHeaders, cleanup on socket close (slot freed, intervals
            cleared). services/events.ts: changesSince (pure, capped) +
            formatSseEvent + SSE_HEADERS (no-transform, x-accel-buffering:
            no for the R-5 proxy risk). change_log completeness audit:
            every mutating service appends rows (stores 6 sites, listItems
            3 + clearBought/bulkCheck per-row, items, categories, import
            commit, members via T-P4-02). /board?since= delta was already
            implemented + tested (board.test.ts §7.2 #5 block) — verified,
            no change.
Tests:      `pnpm verify` green: 96 shared + 38 db + 37 web + 214 server
            (+11 events tests: formatting 4, streaming integration 7 —
            replay+live tail, Last-Event-ID, 401, connection cap 20, slot
            release, list_item propagation <1s). `pnpm contracts:check`
            green (v1.4 unchanged — /events was documented at v1.0).
Decisions:  (1) Poll (250ms) instead of a change-notification primitive —
            better-sqlite3 has none and polling an indexed PK cursor is
            cheap; NFR-7's 1s budget has 4× headroom. (2) Headers are
            flushed on connect (flushHeaders) — writeHead alone buffers
            until the first body write, and an idle stream has none for up
            to heartbeatMs (this exact bug hung every header-only SSE test
            for 5s each; the passing tests were the ones whose replay
            wrote frames). (3) No-since connect starts at currentRevision
            (fresh streams get only new events); reconnects replay from
            Last-Event-ID.
Deviations: None to the PRD. No contract change; no migration.
Learned:    (a) ServerResponse.writeHead does NOT flush — always
            flushHeaders() for event streams. (b) AGENTS/PHASE-3 note
            confirmed again: never pkill -f "server/dist/index.js" (the
            demo container respawns); kill by port (fuser -k). (c) A
            hanging http.get in a vitest test shows up as a 5s test
            timeout, not a socket error — instrument the handler before
            suspecting the client.
Next:       T-P4-04 — web: first-run wizard (§8.9), login/session screens,
            /settings (household, members, theme, about). Contract v1.4
            frozen.

## 2026-11-16 — lane B — T-P4-04 (web: wizard, login, settings)

Built:      /login (§7.6): passcode step → POST /auth/members roster →
            member picker → POST /auth/login → clear cache → Home; ?expired
            banner shows the §8.10 copy only when a session actually died
            (a query that already had data 401'd), not on first visit;
            401/404/429 messages verbatim from the deck. /welcome (§8.9
            five steps + coach-mark landing): household name → passcode +
            confirm → display name + 8-swatch color → seed toggle (default
            on) → first store (12 emoji presets + free-text emoji, skippable)
            → POST /household then POST /stores → Home; 403 renders "A
            household already exists.". /settings (§8.1): Household (name +
            passcode sheets), Members (list with avatars, add/edit sheets
            with the color palette, remove with confirm — disabled for the
            last member; 400/403 stay inline, other errors close the sheet
            into a dismissible banner), Theme (System/Light/Dark radios →
            data-theme attribute, tokens.css data-theme blocks added),
            About (version + revision from public /healthz), Sign out.
            main.tsx: queryCache/mutationCache onError → shouldRedirectToLogin
            (lib/session.ts) → cache clear + /login. Home: header now shows
            data.household.name (§8.3) and the §8.9 coach-mark bubble above
            the + on an empty board, dismissed forever after the first add
            (lib/coachmark.ts). api: useAuthMembers/useLogin/useLogout/
            useCreateHousehold/usePatchHousehold/useCreateMember/
            useUpdateMember/useDeleteMember/useHealth (getRoot for /healthz).
Tests:      `pnpm verify` green: 96 shared + 38 db + 48 web (+11: prefs
            theme/coachmark/colors 7, session redirect 4) + 214 server.
            Throwaway Playwright smoke (not committed; committed specs are
            T-P4-07) at 375×667: login→picker→Home (household name +
            avatars), settings sections + theme data-theme round-trip +
            household rename + sign out, full wizard → Home with coach-mark
            + "Corner Shop", second-household 403 copy, keyboard-only login
            (fill → Enter → Tab → Enter → Home). All green.
Decisions:  (1) The wizard's first store reuses POST /stores client-side —
            ADR-0005 kept the endpoint minimal; a failed store-create after
            a successful household create still lands on Home (§8.9 step 6
            works regardless). (2) Expired-banner heuristic: only when the
            failing query had cached data — first-visit 401s get the plain
            login. (3) Member color palette is a fixed 8-swatch UI choice
            (contract keeps free hex). (4) Settings remove-member button is
            disabled at ≤1 members rather than relying on the 403. (5) New
            microcopy added to §8.10 in the same change (login, wizard,
            settings, coach-mark — 24 rows) per AGENTS.md §5.
Deviations: None to the PRD. Contract v1.4 unchanged; no migration.
Learned:    (a) Playwright .tap() needs hasTouch — Desktop Chrome without
            the option throws; the committed e2e projects (pixel-7) have
            it. (b) The login rate limiter is per-IP in server memory:
            repeated smoke runs from 127.0.0.1 trip 429s — restart the
            debug server between smoke suites. (c) light-my-request curl
            checks need Accept: text/html for the SPA fallback; browsers
            always send it. (d) getByText matches section headings twice
            when a nav rail also has the label — prefer getByRole('heading').
Next:       T-P4-05 — web SSE client + offline queue + offline banner.

## 2026-11-16 — lane B — T-P4-05 (web: live sync, offline queue, banner)

Built:      lib/useLiveSync.ts — EventSource('/api/v1/events') mounted in
            NavShell; on §7.5 change events it invalidates the board query
            (plus items/categories keys per entity); automatic reconnect
            replays via Last-Event-ID. lib/offline.ts — §4.7 queue: non-GET
            mutations outside /auth|/import|/admin that fail with a network
            error or 5xx enqueue to IndexedDB (client-generated clientId),
            api() resolves them as success so the optimistic UI stands;
            drainQueue replays oldest-first on boot + the browser 'online'
            event, dropping 400/404/409/410 as applied-or-obsolete (§4.7
            last-write-wins) and keeping everything else; a count pub-sub
            feeds the banner. components/OfflineBanner.tsx — §8.7 thin top
            banner while offline with "{n} change(s) waiting to sync" when
            >0, and "Updated elsewhere." for a few seconds after a drop
            (window event). main.tsx: mutations default networkMode
            'offlineFirst' (they must attempt immediately — 'online' parks
            them paused), queries stay 'online' (refetches pause offline);
            startOfflineQueue() on boot.
Tests:      `pnpm verify` green: 96 shared + 38 db + 59 web (+11: offline
            queueable/drain/publisher 7, replay-over-fetch 2, client scope
            2) + 214 server. Throwaway Playwright smoke at 375×667 (not
            committed): G4.1 shape — check on context A appears on context
            B in 333ms (<1s, NFR-7); G4.2 shape — 3 checks offline →
            banner + queue count → reconnect → drain → reload → all 3
            persisted server-side.
Decisions:  (1) Queued mutations resolve as success (undefined body): the
            optimistic UI stands, sheets close, and TanStack pauses the
            invalidated refetches offline ('online' networkMode) until
            reconnect reconciles. (2) The queue surface excludes /auth,
            /import (single-use token) and /admin — those surface errors.
            (3) drainQueue removes an entry ONLY on 2xx or a drop-code —
            the first draft removed-then-broke on 401 and would have lost
            queued data (the test caught it). (4) New §8.10 rows: offline
            queue count + "Updated elsewhere.".
Deviations: None to the PRD. Contract v1.4 unchanged; no migration.
Learned:    (a) TanStack v5 pauses MUTATIONS offline too (networkMode
            'online') — offline writes never reach mutationFn without
            'offlineFirst'. (b) Checking rows reorders the board (§6.8) and
            fully-bought stores auto-collapse (§8.3): index-based locators
            go stale mid-test — pin rows by aria-label and re-expand
            sections before asserting. (c) A test that asserts optimistic
            state must wait for content (store headings) after login —
            skeletons have zero checkboxes.
Next:       T-P4-06 — web: service worker, manifest + icons,
            installability (G4.4), axe findings fixed (G4.5).

## 2026-11-16 — lane B — T-P4-06 (web: PWA + a11y pass)

Built:      PWA (G4.4): web/public/manifest.webmanifest (name/short_name,
            standalone, start_url /, theme #4f46e5, icons 192+512 any +
            maskable — generated by rendering an SVG tile via a throwaway
            Playwright screenshot, real per-size PNGs); index.html links
            manifest + apple-touch-icon; main.tsx registers /sw.js in PROD
            only. web/public/sw.js — hand-rolled (no new dependency):
            install precaches the shell AND the hashed assets parsed out of
            index.html (assets load before the worker controls the page, so
            runtime caching alone misses them); navigations network-first
            with cached-shell fallback; assets stale-while-revalidate;
            /api/* never intercepted (writes + SSE must reach the server).
            A11y (G4.5): @axe-core/playwright added to e2e (justification:
            G4.5 mandates axe-core; no hand-rolled alternative). Throwaway
            scan of every screen — three findings, all fixed:
            (1) StoreCard h3 applied the §8.2 category palette as TEXT
            color (2.3–2.9:1 on white) — the PRD restricts the palette to
            the 4px left border; h3 now uses text-muted + border-l-4 with
            the category color (matches the Catalog's §8.2 rendering).
            (2) --color-bought #9ca3af fails 4.5:1 on white — light theme
            now #6b7280 (4.83:1), dark themes keep #9ca3af (8.7:1), and
            the data-theme light/dark blocks each pin their own value.
            (3) /data's sr-only file input had no label (axe critical) —
            aria-label added. Rescan: zero critical/serious on Home, add
            sheet, Catalog (the G4.5 gates), plus login, welcome, settings,
            stores, categories, data.
Tests:      `pnpm verify` green: 96 shared + 38 db + 59 web + 214 server.
            Throwaway Playwright (not committed): G4.4 shape — manifest
            parses (4 icons, standalone), SW reaches 'activated', offline
            reload renders the shell from cache; axe scans above.
Decisions:  (1) Hand-rolled SW over vite-plugin-pwa — ~70 lines, no new
            dependency, and the caching rules are three boring branches.
            (2) Install-time asset precache is derived from index.html so
            a rebuild needs no SW sync step (hashes are read at runtime).
            (3) The committed a11y spec lands in T-P4-07 (lane D); this
            card fixed what the scan found.
Deviations: None to the PRD. (The h3 color was a pre-existing deviation
            from §8.2 found by the scan, now corrected.) No contract
            change; no migration. New dev dependency @axe-core/playwright
            justified above.
Learned:    (a) writeHead-then-idle isn't the only "nothing flushes" trap:
            a SW edit to web/public does nothing until the next web build
            copies public/ into dist/. (b) Playwright setOffline is on the
            context, not the page. (c) navigator.serviceWorker.ready
            resolves while the worker is still 'activating' — wait for the
            statechange to 'activated' before asserting. (d) axe's
            color-contrast rule earns its keep: the palette-as-text bug had
            been on Home since P1 and no human complaint surfaces for 2.5:1
            until someone's grandmother tries to read it.
Next:       T-P4-07 — e2e: first-run, auth, live-sync, offline-queue,
            a11y specs + phase close (G4.1–G4.7).

## 2026-11-16 — lane D — T-P4-07 (e2e + phase close)

Built:      Harness: setup-auth projects — one login + one §11 session per
            viewport (auth-mobile.json / auth-pixel.json), pixel's setup
            DEPENDS on mobile-chrome so first-run's identity wipes can never
            kill its session; global-setup wipes sessions first. New specs
            (× both viewports unless noted): auth (fresh unauthed contexts:
            wrong passcode copy, login → Home household+avatars, sign out,
            §8.10 expired banner; ≤3 login attempts documented), first-run
            (§19: wizard → first store → empty Home + coach-mark;
            self-contained second-household 403; wipes identity per test and
            restores the demo board + fresh auth state after), live-sync
            (G4.1: check on A reaches B <1s over SSE), offline-queue (G4.2:
            3 offline checks → banner + queue count → reconnect → reload →
            persisted, each exactly once; G4.3: same clientId replayed via
            API → 201 then 200, one row), a11y (G4.5: axe zero critical AND
            serious on Home, add sheet, Catalog), pwa (G4.4: manifest
            completeness + 4 icons resolve, SW activated, precache holds
            shell + hashed assets, offline reload renders the shell).
            shop-mode G15.3 updated to its own gate text ("checks queue per
            P4 rules") — offline checks now persist and replay instead of
            rolling back; afterEach unchecks bought rows. support.ts:
            wipeIdentityData, removeReplayArtifact, failure messages on
            bulk-check/reopen. Server: LOGIN_RATE_LIMIT + MUTATION_RATE_
            LIMIT env overrides (defaults 5 / 120 = the §11 values, pinned
            by unit tests; the harness sets 50 / 2000 because one IP and
            one session carry an entire run).
Tests:      `pnpm e2e` 124/124 green (62 × 2 viewports; was 92).
            `pnpm verify` 407 unit/integration green (96+38+59+214).
Decisions:  (1) Per-viewport sessions + dependency-ordered setup projects —
            the first run's 26 pixel failures were the shared session: the
            §11 120/min budget and first-run's wipes both cross project
            boundaries otherwise. (2) Rate-limit env overrides are harness
            plumbing: defaults unchanged in production, unit tests pin
            them (auth.test.ts 429 tests still pass on the defaults).
            (3) G15.3's spec update is the P1.5→P4 transition the gate text
            itself mandates ("checks queue per P4 rules"), not a weakening —
            the old rollback assertion described the pre-queue behaviour.
            (4) G4.4's Lighthouse half is evidenced by the primitives spec
            (manifest fields + icons + active SW + offline shell = what
            Lighthouse checks minus HTTPS, a deployment property); the
            Lighthouse run itself is deferred to P5 device testing.
            (5) G4.6 (session survives restart) is evidenced by
            server/__tests__/sessions.test.ts ("a fresh store instance
            (restart) resolves from the table") + the sessions table being
            disk-backed in the harness DATA_DIR — the e2e harness cannot
            restart its own webServer mid-run.
Deviations: Two test-only env vars (LOGIN_RATE_LIMIT, MUTATION_RATE_LIMIT)
            added to config.ts + e2e harness env — production defaults are
            the §11 values and unit-pinned; documented here rather than in
            an ADR because no production behaviour changes. The demo seed
            no longer creates the legacy 'You' member (pre-auth actor
            remnant; demo.test updated) — caught by the sign-out snapshot.
Learned:    (a) Playwright runs dependency-FREE projects first regardless of
            declaration order — order with dependencies, not position.
            (b) A project "fails" when any of its tests fail, skipping
            dependent projects ("N did not run") — one flaky spec can hide
            a whole viewport. (c) The §11 mutation budget is per session:
            two viewport runs sharing one sid exhaust 120/min in a ~2min
            suite. (d) A queued mutation's replay must announce itself to
            the UI (QUEUE_DRAINED_EVENT → invalidateQueries) — Shop Mode
            has no SSE client, so the drained check stayed 'false' on
            screen while the server said 'bought'. (e) The demo seed
            carried the pre-auth 'You' member until this session —
            snapshot-driven specs surface what grep misses.
Next:       P5 — Hardening & Release (§15.3): perf verification (NFR-1…15
            with numbers), error-state sweep, restore drill (G5.2), README
            + operator guide, CHANGELOG, dependency audit, final a11y pass,
            real-device testing. Lanes: A (perf), B (polish), C (deploy
            docs + restore drill), D (release notes, flakiness check).

## Handoff (P4 complete)

Done:        T-P4-01…T-P4-07. Gates evidenced: G4.1 live-sync.spec
             (two contexts, <1s); G4.2 offline-queue.spec; G4.3
             offline-queue.spec + server idempotency tests; G4.4
             pwa.spec.ts (primitives) + offline shell; G4.5 a11y.spec.ts
             (zero critical/serious on the three gates); G4.6
             sessions.test.ts restart case + disk-backed table; G4.7 the
             committed specs green. Demo: two browsers, one adds, the
             other sees it; airplane-mode checks replay.
Tests:       407 unit/integration (96+38+59+214) + 124 e2e green;
             `pnpm verify` + `pnpm contracts:check` green.
Contract:    shared/contracts.ts @ v1.4 (ADR-0005); openapi.json current;
             schema hash 0003 (migration 0003 sessions, ADR-0006);
             migration lock: next free 0004 (alias soft-delete backlog).
Branch/tag:  feat/p4/contract-v14; tag phase-4-complete on the phase
             close commit; pushed.
Open items:  R-014 (import category scope, lane A); BACKLOG: alias
             soft-delete (migration 0004), PUT /stores/:id/category-order
             (#27) by design, JSON import restores rows as active, store
             icons reset on import; rate-limit env overrides documented in
             the phase log (README/env docs belong to P5).
Next:        P5 — Hardening & Release per §15.3. Start: create
             docs/progress/PHASE-5.md from the P5 card.

## 2026-11-17 — post-close maintenance — ADR-0007 (user request)
Built:      Item-level normalization within a store. Adds now fold into the
            store's existing active row for the item instead of appending a
            second row (PRD §6.4 G2.3 gap + user bug report). Pure merge
            rule in shared/src/accumulate.ts (mergeAddIntoRow); finishAdd
            merge branch (200 vs 201); import commit parity; mergeItems
            consolidates via consolidateActiveRows; migration
            0004_consolidate_list_rows.sql (data-only, backfills INV-6 on
            pre-0004 databases); web applyListItemAdd mirrors the merge
            optimistically (itemId match, else name match). Reset-passcode
            follow-up (1bcf1e5) landed earlier today.
Tests:      shared 104 + db 45 + web 63 + server 221 = 433 green
            (`pnpm verify`); e2e suite re-run pending before commit.
Decisions:  ADR-0007 — merge semantics matrix (qty-less add inherits row
            unit and never invents a quantity; same-unit sums; explicit
            different unit replaces only with a quantity; note/categoryId
            replace only when provided); 201=created / 200=merged /
            200=replayed (replay wins); consolidation survivor = lowest
            (sort_order, created_at, id); bought/cleared rows never merge.
            Decisions empty = "merge with the preview's targetItemId" stays
            a 400 (the UI always sends decisions) — kept as-is, documented
            by the import test.
Deviations: none beyond ADR-0007 itself (user-requested behavior change;
            openapi.json summary updated, no shape/version change).
Learned:    "No duplicate rows" is a *service* invariant, not a schema one —
            merge + import + item-merge + optimistic cache must all uphold
            it; write the rule once in shared and reuse everywhere. The
            reset-passcode CLI must run under the same Node major as the
            compiled better-sqlite3 (v18 shell default segfaults; use the
            nvm v22).
Next:       Commit this work, re-run the e2e suite, then open P5 (§15.3).
