# PHASE-0 — Foundations & Contracts

Goal: a running skeleton with frozen contracts, so every later phase is additive.
Refs: PRD §3, §15.3 (P0 card). Gates: G0.1–G0.6.

## Session log

## 2026-11-15 — lane A (solo bootstrap) — T-P0-00
Built:      git repo on `main`; docs skeleton (STATUS, this log, ADR-0001,
            REQUESTS, BACKLOG); .gitignore; .env.example; README stub.
Tests:      none (no code yet).
Decisions:  Solo session runs all four lanes sequentially in dependency order
            (contracts → db → server → web → platform → e2e). Commit-per-task
            instead of branch-per-task because there is no remote; PR flow
            starts when a remote exists. Recorded as a deviation in ADR-0001.
Deviations: none beyond the above.
Learned:    Environment has Node 22.23.2 (nvm) and pnpm 12.3.4, both off the
            default non-interactive PATH; every shell command must export
            PATH. Docker 29.9.2 daemon is running.
Next:       T-P0-01 workspace root + toolchain.

## 2026-11-15 — lane A — T-P0-01 … T-P0-07 (bootstrap complete)
Built:      pnpm workspace (shared/db/server/web/e2e); shared contracts
            (§7 Zod schemas, OAS 3.1 openapi.json, normalize/fold/parseQty/
            units/categoryHints/ids); SQLite layer (0001_init.sql = §5.2
            verbatim + §5.3 FTS triggers, runner, Drizzle schema, 26 seeded
            categories + 40-item catalog); Fastify 5 boot (/healthz, §7.1
            error envelope, static SPA, jobs stub); React 19 shell (8 routed
            placeholders, §8.2 tokens, §8.1 nav shell); Dockerfile/compose/
            Caddyfile/backup.sh/CI; Playwright smoke suite.
Tests:      89 unit/integration green (54 shared + 19 db + 16 server) via
            `pnpm verify`; 12/12 Playwright specs at 375×667 + Pixel 7 via
            `pnpm e2e`; all green from a clean clone too.
Decisions:  ADR-0001 (stack). fastify-plugin added (encapsulation-breaking
            hooks, §4.2). pino-pretty dropped (NFR-15 JSON logs). Contracts
            additions implied by §7.2 but unstated: logout {}, deleted
            {deleted}, bulk-check {updated}, admin/backup {file}.
Deviations: (1) commits on main per task card until a remote exists
            (ADR-0001). (2) compose image is local `kirana:local`, not
            ghcr (nothing published pre-1.0). (3) healthcheck uses `node -e`
            instead of §12.3's wget — slim image ships no wget. (4)
            categoryDto carries `color` beyond the §7.3 example (needed by
            §8.2's 4px category border; additive field). (5) hintCategory
            matches raw names case-insensitively, not name_norm (NFKD
            mangles Devanagari matras deterministically — see Learned).
Learned:    (a) PRD §6.1's normalizeName strips Devanagari matras/viramas
            (`चावल`→`च वल`); norms stay consistent so uniqueness holds, but
            P2's search spike must decide how Devanagari queries match
            (BACKLOG). (b) `pnpm -r` needs shared/dist built before db/server
            typecheck — root verify orders build first. (c) tsx needs
            baseUrl for tsconfig paths. (d) Fastify: exactly one
            setNotFoundHandler; plugin hooks need fastify-plugin. (e)
            better-sqlite3 has no prebuilt for this Node ABI — Docker build
            stage needs python3/make/g++.
Next:       P1 — Core Board (first card: T-P1-01 board API).

## Handoff

Done:        P0 Foundations & Contracts complete; all gates G0.1–G0.6 evidenced.
Next:        P1 — Core Board. T-P1-01 (GET /board + stores CRUD APIs, lane A)
             and T-P1-02 (Home screen, lane B, against frozen §7.3 mocks).
Blocked:     none.
Files:       everything (bootstrap phase).
Tests:       `pnpm verify` (89 green) + `pnpm e2e` (12 green) + clean-clone
             verify + `docker compose up` healthz 200.
Context:     Read AGENTS.md → STATUS.md → this file → ADR-0001. Contracts are
             FROZEN: touch shared/** only via contract: PR + ADR. Migration
             0002 is unclaimed. The Devanagari normalize quirk (Learned) is
             the single most important thing to know before P2.

### Gate evidence
- G0.1: `docker compose up -d` → curl /healthz = 200
        {"status":"ok","version":"0.1.0","revision":"dev","uptime":…};
        / = 200 text/html; container State.Health = healthy.
- G0.2: db/__tests__/migrate.test.ts — fresh migrate applies 0001_init.sql,
        idempotent re-run, hash matches db/schema-hash.txt
        (337b42efe7c1818776c84e20aef5fb49d9183318545a47b1ed688034386ab9c1).
- G0.3: db/__tests__/seed.test.ts — categories seeded twice → same rows
        (26); catalog seeded twice → 40 items / same alias count.
- G0.4: `pnpm verify` exit 0 locally and from a clean `git clone`.
- G0.5: .github/workflows/ci.yml runs `pnpm verify` (+ contracts:check,
        e2e, docker build) on push/PR. (No remote yet — first push will
        exercise it; flagged for the next session.)
- G0.6: e2e/specs/smoke.spec.ts — 8 routes reachable, nav shell + More
        sheet, SPA fallback, skip-link focus; 12/12 across both viewports.
