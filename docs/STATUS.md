# STATUS
Updated: 2026-11-15 by lane B+D (P1.5 session)
Current phase: P1.5 — Shop Mode — COMPLETE (gates G15.1–G15.5 evidenced)
Phase progress: T-P1.5-01 done in one session

## Done this phase
- Shop Mode (§8.5): /store/:id full-screen (outside NavShell — no tab bar),
  sticky header with counter + progressbar + ✕, one-category-at-a-time
  auto-advance with a 200 ms reduced-motion-aware scroll, 56 px rows with
  28 px checkbox + qty chip, "Done shopping" footer (enabled only when
  nothing is unchecked; marks done + returns Home), Wake Lock, Escape exit,
  ScrollRestoration-backed same-scroll return (G15.4)
- Entry: "Shop here" first action in Home's store ⋯ menu (PRD is silent on
  entry; §8.3 reserves the header tap — assumption logged in PHASE-1.5)
- web/src/lib/shopGroups.ts: pure §6.8 grouping/advance logic + 8 vitest
  tests (web's first unit runner); StoreCard refactored onto it
- e2e shop-mode.spec.ts (11 specs × 2 viewports) + smoke deep-link updated
- Docker image rebuilt (new lockfile under --frozen-lockfile); smoke green

## In progress
- none — gate evidence in docs/progress/PHASE-1.5.md

## Blocked
- none. Environment: the P1 demo container still runs on :8080 (user review,
  old image). `kirana:local-node` now contains P1.5; a fresh demo is
  `docker run -p 8080:8080 -e SESSION_SECRET=… -e DATABASE_URL=/data/kirana.db
  kirana:local-node`. Non-interactive shells here need
  PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$HOME/.local/share/pnpm/bin".

## Next
- P3 — Management & Import/Export (§15.3 order). First card: item management
  screens + import/export APIs; P3 claims migration 0003 if the sessions
  table slips to P4.

## Contract state
shared/contracts.ts @ v1.1 — unchanged this phase (Shop Mode is a pure
view; zero new tables/endpoints/DTOs). openapi.json check green.

## Migration lock
next available: 0003 (0001_init.sql + 0002_item_search_norm_keys.sql applied;
schema hash re-pinned in db/schema-hash.txt — regenerate with
`pnpm --filter @kirana/db hash-schema` whenever a migration lands)
