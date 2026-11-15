# STATUS
Updated: 2026-11-15 by lane A+B (P1 session)
Current phase: P1 — Core Board — COMPLETE (gates G1.1–G1.6 evidenced)
Phase progress: 2/2 task cards

## Done this phase
- T-P1-01 GET /board (+?since delta), stores CRUD + clear-bought/done/
  reopen, list-items patch/delete/bulk-check, GET /categories, CSRF guard,
  demo seed (db:seed:demo), G1.2 perf test
- T-P1-02 Home screen real data: optimistic check, progress, §6.8 grouping,
  clear-bought + undo toast, done/archive/restore, store add/rename/delete,
  empty/loading/error states; e2e specs for G1.6 + AC-H1..H5
- fix(p0): stale compiled artifacts removed from shared/src (shadowed
  contracts.ts at runtime); Docker: /data mountpoint + zod declared in server

## In progress
- none — P1 gate evidence in docs/progress/PHASE-1.md

## Blocked
- none. Note: the `kirana:local` image tag is contended on this machine
  (other sessions build unrelated stacks under it); this repo's compose now
  uses `kirana:local-node`. A foreign Python `uvicorn server.kirana.main`
  runs on the host as root — not this project's code, left alone.

## Next
- P2 — Add Item & Search. First 20%: search spike (§8.6 ranking, FTS5 vs
  trigram, Devanagari matching — see PHASE-0 Learned a). Then T-P2-01
  POST /stores/:id/items (§6.4 upsert + §7.4) and T-P2-02 add-item sheet.
  P2 gates: G2.1–G2.6 (3-tap add is the adoption gate).

## Contract state
shared/contracts.ts @ v1.0 — FROZEN; untouched in P1 (openapi.json check
green). Copy deck gained one row in PRD §8.10 (store delete confirm).

## Migration lock
next available: 0002 (0001_init.sql applied; schema hash pinned in
db/schema-hash.txt — regenerate with `pnpm --filter @kirana/db hash-schema`
whenever a migration lands)
