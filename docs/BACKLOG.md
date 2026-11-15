# BACKLOG

Anything noticed while working that belongs to a later phase or is out of scope
for v1 (PRD §1.5). Do not implement ahead — write it here instead (AGENTS.md §3).

- [P2] Undo for `DELETE /list-items/:id`: the response's `undoToken` doubles as
  the `clientId` for the P2 re-add (§7.4 idempotency) — wire the UI toast when
  the add endpoint exists. Server side is ready.
- [P3] `PUT /stores/:id/category-order` (contract #27) — drag-reorder UI ships
  in P3; `PATCH /stores/:id {categoryOrder}` already covers the API need.
- [P4] `sessions` table is required by §7.6 ("in memory + a sessions table") but
  is not in the §5.2 DDL. Schema change after P0 → needs an ADR + migration when
  auth lands. Do not silently add it to `0001_init.sql`.
- [P4] `GET /board?since=` delta cannot express tombstones (a store deleted
  since the cursor is simply absent). The P4 SSE merge design must decide:
  refetch-on-unknown-id or a contract change for tombstones.
- [P4] PWA manifest + icons (`web/public/manifest.webmanifest`) — deferred from
  P0 shell on purpose; installability is a P4 gate.
- [P6] Nightly purge of `cleared` list rows older than 180 days (§6.7) — needs
  the real jobs worker; the P0 stub only logs.
- [P6] jobs worker: real polling implementation (P0 ships a stub that logs "no jobs").
- [chore] Web bundle exceeds the 500 kB chunk warning (lucide-react + react +
  router in one chunk); code-split per route when it matters (P4 perf pass).
