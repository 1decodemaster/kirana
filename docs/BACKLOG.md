# BACKLOG

Anything noticed while working that belongs to a later phase or is out of scope
for v1 (PRD §1.5). Do not implement ahead — write it here instead (AGENTS.md §3).

- [P4] `sessions` table is required by §7.6 ("in memory + a sessions table") but
  is not in the §5.2 DDL. Schema change after P0 → needs an ADR + migration when
  auth lands. Do not silently add it to `0001_init.sql`.
- [P4] PWA manifest + icons (`web/public/manifest.webmanifest`) — deferred from
  P0 shell on purpose; installability is a P4 gate.
- [P1] `db/seed/fixtures/*.json` perf fixture (2,000 items / 500 list items) for
  G1.2 / NFR-1 — deterministic, fixed epoch ms.
- [P6] jobs worker: real polling implementation (P0 ships a stub that logs "no jobs").
