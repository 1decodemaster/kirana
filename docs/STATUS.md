# STATUS
Updated: 2026-11-15 by lane A (solo bootstrap session)
Current phase: P0 — Foundations & Contracts — COMPLETE (tag pending push to a remote)
Phase progress: 8/8 tasks

## Done this phase
- T-P0-00 docs skeleton + git init
- T-P0-01 workspace root + toolchain (pnpm 12, Node 22, TS 5.9 strict)
- T-P0-02 shared/ contracts + domain utilities (54 unit tests)
- T-P0-03 db/ schema, 0001_init.sql + FTS triggers, runner, seeds (19 tests)
- T-P0-04 server/ Fastify boot, /healthz, error envelope, jobs stub (16 tests)
- T-P0-05 web/ React shell, 8 routed placeholders, tokens, nav (G0.6)
- T-P0-06 platform: Dockerfile, compose, Caddyfile, backup.sh, CI (G0.1)
- T-P0-07 e2e harness (12 specs) + openapi.json generator + pnpm verify

## In progress
- none — P0 gate passed; see docs/progress/PHASE-0.md for evidence

## Blocked
- none

## Next
- P1 — Core Board. First cards: T-P1-01 GET /board + list-item read APIs
  (lane A), T-P1-02 Home screen real data (lane B, mocks OK immediately).
  Both start from PRD §7.3, §6.6, §6.8, §8.3.

## Contract state
shared/contracts.ts @ v1.0 — FROZEN as of P0 exit (openapi.json committed,
guarded by `pnpm contracts:check`). Changes now require contract: PR + ADR.

## Migration lock
next available: 0002 (0001_init.sql applied; schema hash pinned in
db/schema-hash.txt — regenerate with `pnpm --filter @kirana/db hash-schema`
whenever a migration lands)
