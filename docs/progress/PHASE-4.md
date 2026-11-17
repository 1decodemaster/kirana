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
