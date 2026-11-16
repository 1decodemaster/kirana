# BACKLOG

Anything noticed while working that belongs to a later phase or is out of scope
for v1 (PRD §1.5). Do not implement ahead — write it here instead (AGENTS.md §3).

- [P3?] `item_aliases` has no `deleted_at` — alias removal is a hard row
  delete (UI confirms first). If soft-deleted aliases ever matter, claim
  migration 0003 for a `deleted_at` column + partial-index rethink.
- [P5] Nightly 03:00 backup (§12.4/NFR-11) is host cron / sidecar work, not
  in-process: `sqlite3 kirana.db ".backup …"` + gzip with the date-only name,
  or reuse POST /admin/backup. Needed before the P5 restore drill. The
  on-demand endpoint already prunes (14 daily + 8 weekly).
- [P3?] JSON import restores list rows as `active` — the §9.3 preview/commit
  model (contract #29) carries no list-row status, so a restore from
  `GET /export?format=json` loses bought/cleared states. If byte-exact
  restore ever matters, that is a contract v1.4 addition (status on import
  rows) + ADR. CSV round-trip has the same shape by design (no status column
  in §9.1; cleared rows are excluded from CSV export on purpose).
- [P3] `PUT /stores/:id/category-order` (contract #27) — drag-reorder UI ships
  in P3; `PATCH /stores/:id {categoryOrder}` already covers the API need.
- [P3] Server-side quick-parse defense: §6.3 is a sheet behavior, so a raw
  POST like `{"name": "milk 2 l"}` stores the whole string as the item name.
  If non-Kirana clients ever matter, parse-by-name server-side needs an ADR
  (it changes what the stored name is vs what the client asked for).
- [P4] `sessions` table is required by §7.6 ("in memory + a sessions table") but
  is not in the §5.2 DDL. Schema change after P0 → needs an ADR + migration when
  auth lands. Do not silently add it to `0001_init.sql`.
- [P4] `GET /board?since=` delta cannot express tombstones (a store deleted
  since the cursor is simply absent). The P4 SSE merge design must decide:
  refetch-on-unknown-id or a contract change for tombstones.
- [P4] PWA manifest + icons (`web/public/manifest.webmanifest`) — deferred from
  P0 shell on purpose; installability is a P4 gate.
- [P4] Server-side search divergence tail (ADR-0002 §7): GET /items hides an
  affinity-boosted edit-only match when the result page is full of tier
  matches; the client index finds it. If P3 management screens need exact
  parity, run the edit-tier scan unconditionally there.
- [P6] Nightly purge of `cleared` list rows older than 180 days (§6.7) — needs
  the real jobs worker; the P0 stub only logs.
- [P6] jobs worker: real polling implementation (P0 ships a stub that logs "no jobs").
- [chore] Web bundle exceeds the 500 kB chunk warning (lucide-react + react +
  router + vaul in one chunk); code-split per route when it matters (P4 perf pass).
- [P4] A failed background board refetch flips the whole screen to the §8.7
  error state even when cached data exists (react-query v5 sets status
  "error" on refetch failure regardless of data). Consider failureCount-gated
  error UI or networkMode tuning when the offline queue lands — with
  navigator.onLine=false queries pause instead of failing, so the rough edge
  is specifically the "browser online, WAN dead" case surfaced in the
  shop-mode offline e2e.
- [P1.5?] Shop Mode shows only the current category; peeking/checking ahead
  in a later aisle is intentionally impossible (strict §8.5 reading). If the
  family asks for it, tap-to-expand collapsed headers is the minimal change.
