# Kirana — Architecture Rundown

**What it is:** a self-hosted household shopping board. One Docker container serves a React PWA + a Fastify JSON API backed by a single SQLite file. No external services, no telemetry, works with the WAN unplugged. v1.0.0 (P0–P5 shipped; P6 "Intelligence" is designed but dormant — `jobs`, `item_embeddings`, `item_pairs`, `llm_cache` tables exist empty, worker is a stub).

---

## 1. Monorepo & dependency graph

pnpm workspaces, strict TypeScript, ES modules. Dependencies only point downward:

```
@kirana/web ─────────┐
                     ├──> @kirana/shared   (Zod contracts v1.4 + pure domain logic)
@kirana/server ──────┤        │
                     │        └── consumed by web (client ranking) AND server
@kirana/db ──────────┘             (single source of truth for search scoring)
     │
     └── better-sqlite3 wrapper: connection, migrations, passcode, seeds

@kirana/e2e  ── Playwright, depends on nothing but running artifacts
```

- **`shared/src`** — `contracts.ts` (every request/response schema + 11 error codes), and *pure* domain modules: `normalize`, `fold` (diacritics), `parseQty`, `units`, `ids` (UUIDv7), `categoryHints`, `search` (the one scorer used by both server and client), `accumulate` (how duplicate adds merge into a row). No DB, no clock — `now` is always injected.
- **`db/`** — `connection.ts` opens SQLite with `WAL`, `foreign_keys=ON`, `busy_timeout=5000`, and registers `kirana_norm`/`kirana_fold` as deterministic SQL functions so FTS triggers can call the *same* TS normalization. `migrate.ts` applies numbered SQL files transactionally into `__migrations` and computes a schema hash (pinned at `0003`).
- **`server/`** — Fastify 5. Layers: `routes/` (thin, Zod-parsed) → `services/` (domain functions taking `(db, actor, input, now)`) → better-sqlite3. `plugins/` holds the error envelope, db decorator, and auth.
- **`web/`** — React 19 SPA, Vite build, `react-router`, TanStack Query, hand-rolled offline queue, custom service worker.
- **`e2e/`** — Playwright: desktop + iPhone + Pixel projects sharing a login `storageState`; ~20 specs incl. offline-queue, live-sync, a11y, NFR perf probes.

## 2. Component / deployment view

```
        LAN / Tailscale          (Caddy optional; infra/Caddyfile provided)
             │
┌────────────▼──────────────────────────────────────────────────┐
│  kirana container (node:22-slim, non-root, :8080)             │
│                                                               │
│  ┌─ SPA (web/dist, served by @fastify/static, SPA fallback) ─┐│
│  │  Router: Home / ShopMode /catalog /stores /categories     ││
│  │           /data /settings /login /welcome                 ││
│  │  TanStack Query ── optimistic cache reducers (cache.ts)   ││
│  │  searchIndex.ts ── local catalog ranking (no network)     ││
│  │  offline.ts ── IndexedDB mutation queue + replay          ││
│  │  useLiveSync ── EventSource('/api/v1/events')             ││
│  │  sw.js ── app-shell cache (never intercepts /api/*)       ││
│  └───────────────────────┬───────────────────────────────────┘│
│                          │ fetch JSON  + SSE                  │
│  ┌───────────────────────▼───────────────────────────────────┐│
│  │ Fastify (/api/v1 scope)                                   ││
│  │  onRequest: CSRF (X-Requested-With: kirana on mutations)  ││
│  │  onRequest: session resolve → default-deny 401 → rate     ││
│  │             limit (login per-IP, mutations per-member)    ││
│  │  routes: auth · board · events(SSE) · stores · list-items ││
│  │          items · categories · import/export · admin       ││
│  │  services: board, catalog(add/merge), listItems, stores,  ││
│  │            sessions, events, changeLog, import*, backup   ││
│  └───────────────────────┬───────────────────────────────────┘│
│                          │ better-sqlite3 (sync, one writer)  │
│  ┌───────────────────────▼───────────────────────────────────┐│
│  │ SQLite /data/kirana.db (WAL)                              ││
│  │   9 core tables + change_log + sessions + 4 P6 tables     ││
│  │   FTS5 item_search (trigram) synced by SQL triggers       ││
│  │   /data/backups/*.db.gz (pruned daily/weekly)             ││
│  └───────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

Compose: `./data` volume, `SESSION_SECRET` required, 256M memory cap, `/healthz` healthcheck. `infra/backup.sh` for the nightly cron.

## 3. Entity model (as-built, migrations 0001→0004)

```
households ─1:N─ members (soft delete, sessions revoked on delete)
    │
    ├─1:N─ stores ─1:N─ list_items ─N:1─ items
    │         │              │
    │         │              ├─ status: active|bought|cleared
    │         │              ├─ client_id UNIQUE ── idempotency key
    │         │              ├─ checked_at/by, added_by (member FKs)
    │         │              └─ category_id (per-entry override)
    │         └─ category_order_json (per-store aisle order, ADR-0007-adjacent)
    │
    ├─1:N─ categories (household_id NULL = global seed rows; scope grocery|household|general)
    ├─1:N─ items (name_norm UNIQUE per household; soft delete w/ name revival)
    │        ├─1:N─ item_aliases (alias_norm + search_key=fold; lang en|hi-Latn|hi)
    │        └─N:M─ stores via item_store_stats (times_added↑, last_added_at, per-store default category)
    │
    └─ change_log: polymorphic, no FK, autoincrement id == global revision
         (entity, entity_id, op, store_id denormalized for fanout, actor_id)

sessions: HMAC-signed opaque token, cookie `sid` (httpOnly, SameSite=Lax,
30d); DB stores sha256(token) only; small in-process Map cache in front.
```

**Key invariants enforced in services:** INV-2 (`bought ⟺ checked_at != NULL`), INV-5 (one `name_norm` per household — soft-deleted rows are *revived*, not re-created), INV-8 (`times_added` only increases), ADR-0007 (at most one *active* row per store+item; re-adding folds quantity into it — bought/cleared rows never merge).

FTS5 `item_search(name, aliases, search_keys)` is maintained **entirely by SQL triggers** on items/item_aliases — app code cannot drift it.

## 4. Request lifecycle (server)

```
req → genReqId (x-request-id or UUID) → cookie+sensible plugins
    → errorsPlugin (§7.1 envelope: {error:{code,message,details,requestId}})
    → /api/v1 scope:
        onRequest #1: CSRF — mutations need X-Requested-With: kirana
        onRequest #2: resolve sid → actor {householdId, memberId}
                      default-deny 401 except POST /auth/login,
                      /auth/members, POST /household (first-run)
                      mutation limiter: 120/min per member; login 5/5min
                      per IP with escalating backoff
    → route: parseRequest(Schema, body|query|params)  ← Zod at the boundary
    → service(db, actor, input, Date.now())           ← typed domain fn
        writes + appendChange(change_log) in one transaction
    → response (DTOs validated by shared schemas)
```

Error codes are a closed set (`UNAUTHORIZED … CONFLICT_STALE`); every non-2xx uses the envelope; `requestId` ties to the log line.

## 5. Sequence diagrams

### 5.1 First run & login (§8.9)
```
Browser                    Server                        DB
  │ GET /board 401 ─────────►│ (default-deny)              │
  │ → route /welcome         │                             │
  │ POST /household          │                             │
  │  {name,passcode,member…} │ scrypt hash                 │
  │  (403 if one exists)     │ txn: households+members     │
  │                          │      + seed categories/items│
  │                          │      + change_log(member)   │
  │ ◄── 201 {member,household} + Set-Cookie sid            │
  │ POST /auth/login (later visits)                        │
  │  {passcode, displayName} │ per-IP limiter → verify →   │
  │ ◄── 200 {member} + sid   │ memberByName                │
  │ GET /auth/me, GET /board │                             │
```
Sessions: cookie value = `<random>.<HMAC(secret)>`; DB keeps sha256 of the random part; restart-safe (table is truth, cache is an optimization).

### 5.2 Add item — the hot path (§6.4, §7.4, ADR-0007)
```
User        AddItemSheet (web)            POST /stores/:id/items
  │ types "mil"  │                             │
  │              │ searchCatalog(local index,  │
  │              │  precomputed candidates,    │
  │              │  ~2ms @5k items, offline)   │
  │ taps / or    │                             │
  │ submits name │ resolveLocal() previews the │
  │              │ exact server decision       │
  │              │ optimistic row into cache   │
  │              ├────────────────────────────►│
  │              │                             │ 1) client_id replay? → 200
  │              │                             │ 2) exact name_norm? → item
  │              │                             │ 3) alias_norm? → item
  │              │                             │ 4) fuzzy ≥0.7 & top?
  │              │                             │     near-dup → 409 +suggestions
  │              │                             │    else create/revive item
  │              │                             │    + user alias (search_key=fold)
  │              │                             │ 5) finishAdd:
  │              │                             │    category: input > item_store_stats
  │              │                             │      > item default > hint > Other
  │              │                             │    unit write-back ("last unit used")
  │              │                             │    fold into existing ACTIVE row
  │              │                             │      (ADR-0007) → 200 merged
  │              │                             │    else INSERT row → 201
  │              │                             │    bump item_store_stats
  │              │                             │    append change_log ×(item/alias/list_item)
  │              │ ◄── 200/201 {listItem, item, createdItem, createdAlias}
  │              │ onSettled: invalidate board │
```
Client-side `clientId` (UUIDv7) makes replay idempotent — this is what makes the offline queue safe.

### 5.3 Live sync fanout (§7.5)
```
Phone A              Server                        change_log      Phone B
  │ PATCH /list-items/:id           │                 │             │
  │────────────────────────────────►│ txn: UPDATE +   │             │
  │ ◄── 200 {listItem}              │ appendChange ──►│ rev 421     │
  │ optimistic check (~4ms)         │                 │             │
  │                                 │ poll 250ms ─────┤             │
  │                                 │ SSE: event:change              │
  │                                 │ id: 421                        │
  │                                 │ data:{entity:"list_item",…} ──►│
  │                                 │                 │   invalidate ['board']
  │                                 │ ◄── GET /board?since=420 ──────┤
  │                                 │ ── delta: only stores touched  │
  │                                 │    since 420 (changedStoreIds) │
```
SSE details: `reply.hijack()`, headers flushed immediately, heartbeat every 20s, `Last-Event-ID` resume, 500-event cap per reconnect poll, ≤20 connections per member. **Conflict policy:** last-write-wins; the SSE refetch simply overwrites optimistic state with server truth.

### 5.4 Offline mutation queue (§4.7, §8.7)
```
mutation ── network fail or 5xx? ──► enqueue in IndexedDB
              │                       (never for /auth/, /import/, /admin/)
              ▼ 2xx
        optimistic reducer on ['board'] cache; onError → rollback; 
        onSettled → invalidate board
reconnect ('online' event | boot | 15s watchdog):
  drainQueue oldest-first; stop at first network/5xx failure
  ├ 2xx      → remove, replayed++ → 'kirana:queue-drained' → invalidate all
  ├ 400/404/409/410 → remove, dropped++ → "Updated elsewhere" toast once
  └ 401/429  → keep, stop (resume next session)
```
Shop Mode deliberately has no SSE connection of its own; it relies on the drain event + query invalidation.

### 5.5 Import / export (§9, ADR-0004)
```
POST /import/preview (multipart ≤5MB)
  → parseCsv/parseJson → match vs catalog (exact/alias/fuzzy suggestion)
  → rows tagged create|merge|skip|error + counts
  → state stored server-side, HMAC token issued (TTL 10min, ≤20 previews)
POST /import/commit {token, decisions[]}
  → verify token → per-row txn: ensureStore/ensureCategory/createItem/
    insertImportAlias/attachListRow → {created, merged, skipped}
GET /export?format=json        → full ExportPayload (schemaVersion, reimportable)
GET /export?format=csv&storeId → per-store CSV download
POST /admin/backup             → gzip snapshot + prune (8 weekly, N daily)
```

## 6. Frontend composition

- **Routes** (`App.tsx`): full-screen `ShopMode /store/:id`, auth screens `Login`/`Welcome` outside the shell; everything else under `NavShell` (mobile tab bar Home/Catalog/Stores + "More" sheet; desktop rail). `ScrollRestoration` sits above all routes so leaving Shop Mode restores Home's scroll.
- **State**: exactly one server-of-truth query — `['board']` (`BoardResponse`: revision, household, me, members, categories, stores→items, catalog ≤5000 w/ truncation flag). `cache.ts` holds pure reducers (`applyListItemAdd/Patch/Delete`, `applyBulkCheck`, `applyClearBought`, `applyStoreUpsert/Patch/Order/Delete`, …) used by both optimistic updates and tests. Catalog/Items screens use cursor-paginated `['items']` + `['item', id]`.
- **Search**: the board's catalog hydrates a local `searchIndex` (candidates precomputed once per item — that was a real 30ms→2ms fix). Same `searchScore`/`resolveItem` from `@kirana/shared` as the server, so preview matches the authoritative decision.
- **UX plumbing**: `OfflineBanner` (queue count pub-sub), `UndoToast` (undoToken from delete/clear), coachmarks, theme via `localStorage` + tokens.css, member colors.
- **PWA**: `sw.js` — network-first navigations falling back to cached shell, stale-while-revalidate for hashed assets, never intercepts `/api/*` (reads are TanStack's concern, writes/SSE must hit the wire).

## 7. Sync model summary

`change_log` is the spine: every mutation service appends a row inside the same transaction as the write; its autoincrement `id` is the global revision. Consumers: SSE tailer (poll 250ms), `GET /board?since` (delta by touched store ids), and the future P6 job system.

## 8. Quality gates

- `pnpm verify` = build → typecheck → lint → unit tests (workspace-serial). Unit suites per package; domain logic tested with injected clocks; server tests use real Fastify + in-memory SQLite (`server/__tests__/helpers.ts`).
- E2E: Playwright with auth setup project → saved `storageState` reused by desktop/iPhone/Pixel projects; specs cover auth, first-run, add flows, duplicate guard, shop mode, aisle order, live sync, offline queue, merge, import round-trip, a11y, PWA, NFR perf.
- `openapi.json` is generated from `shared/contracts.ts` (`pnpm gen:openapi`, CI checks drift).
- Ops: schema hash pinned, migrations serialized (`0004` applied, `0005` reserved), restore drill executed (RTO 1.57s), CI (`.github/workflows/ci.yml`) green.

**Where the seams are (worth knowing before touching things):** `shared/` is contract territory (ADR required), the `now`-injection discipline is what keeps tests deterministic, and the add-item decision logic (`server/services/catalog.ts:409` `addListItem` + `shared/src/search.ts` `resolveItem`) is the single most invariant-dense code path — PRD §6.4, §7.4 and ADR-0007 all live there.
