# Kirana — Product Requirements & Build Specification

**Version:** 1.0 (frozen)  
**Status:** Approved for implementation  
**Owner:** Household operator (repo owner)  
**Audience:** Implementation agents (primary), human maintainer (secondary)  
**Companion document:** `AGENTS.md` — working ethics, conduct, and session protocol. Read it before this document.

* * *

## 0. How to use this document

This is the single source of truth. If code and this document disagree, the document wins until an ADR (§17.3) amends it.
**Read order for any new agent session:**

1.  `AGENTS.md`
    
2.  `docs/STATUS.md` (≤60 lines, current state of the world)
    
3.  The phase document for the phase you are working on (`docs/progress/PHASE-N.md`)
    
4.  ADRs created since your last session (`docs/DECISIONS/`)
    
5.  Only then: the specific source files you will touch
    

**Do not read the whole repository to "get context."** It burns your context window and produces drift. §17 defines the context protocol.
**Citation convention:** Every commit, task card, and phase log entry must cite the section it implements, e.g. `Refs: PRD §9.4`.

* * *

## 1. Product overview

### 1.1 Problem

A household's shopping knowledge lives in scattered WhatsApp messages, paper notes, and memory. Existing list apps are either too generic (flat checklists with no aisle grouping), too heavy (recipe/meal-planning suites), or single-user (no live sharing while one person is at the store).

### 1.2 Solution

**Kirana** is a self-hosted, installable web app for a single household. It maintains one shared board of stores. Each store holds a list of items grouped by physical-store category. Items are drawn from a growing, multilingual catalog so that the second time you add "atta" it takes three taps.

### 1.3 Users

| Persona | Context | Needs |
| --- | --- | --- |
| Primary shopper | In-store, one hand, poor connectivity | Fast scanning by aisle, large tap targets, progress at a glance |
| Household contributor | On couch, adds items as they run out | Two-second add, autocomplete, no form fatigue |
| Maintainer (you) | Homelab | Single container, one DB file, trivial backup, no cloud dependency |

### 1.4 Success criteria

| ID | Criterion | Measure |
| --- | --- | --- |
| SC-1 | Adding a known item takes ≤3 taps | Manual test, E2E `add-item-known.spec.ts` |
| SC-2 | Adding an unknown item takes ≤15 seconds | Manual timed test |
| SC-3 | Board loads in <1.5s on a mid-range Android over LAN | Lighthouse + manual |
| SC-4 | Two phones see the same list within 1s | E2E `live-sync.spec.ts` |
| SC-5 | A family member who has used a mobile app needs no explanation | Unmoderated first-run test |
| SC-6 | Zero data loss across app restart, container restart, host reboot | Restore drill §12.5 |

### 1.5 Non-goals (v1)

Recipe management, meal planning, price tracking, budget tracking, barcode scanning, multi-household tenancy, native mobile apps, notifications/push, voice input, offline _write_ conflict resolution beyond last-write-wins.

* * *

## 2. Glossary

| Term | Meaning |
| --- | --- |
| **Catalog item** | A globally unique thing ("Basmati Rice"). Lives in `items`. One row, ever. |
| **List item** | A row on a store's list: a catalog item + qty + unit + category + checked state. Lives in `list_items`. |
| **Store** | Top-level list container and physical destination ("Costco", "Indian Store"). |
| **Category** | Aisle grouping ("Produce", "Dairy & Eggs"). Global taxonomy, per-store ordering. |
| **Alias** | An alternate name for a catalog item, tagged with language (`en`, `hi-Latn`, `hi`). |
| **Board** | The entire Home payload: stores + their list items + categories + catalog snapshot. |
| **Bought** | A list item that has been checked. `status='bought'`. |
| **Cleared** | A bought list item removed from view but retained for history. `status='cleared'`. |
| **Done** | A store whose shopping is finished. `stores.status='done'`. |
| **Archived** | A done store collapsed to the bottom of Home. `stores.status='archived'`. |
| **Revision** | Monotonic `change_log.id`; the sync cursor. |
| **Fold** | Phonetic-ish normalization that maps Hinglish spelling variants to one key. |

* * *

## 3. Scope by phase

| Phase | Name | Ships |
| --- | --- | --- |
| **P0** | Foundations & Contracts | Repo, tooling, schema, migrations, seeds, shared contracts, Docker, CI, docs skeleton. **No user-facing features.** |
| **P1** | Core Board | Home screen, stores, categories, list items, check/uncheck, progress, clear-bought, archive. |
| **P2** | Add Item & Search | Add-item sheet, autocomplete, unit toggle, quick-parse, catalog upsert, dedupe, aliases. |
| **P1.5** | Shop Mode | Focused single-store in-store view. Depends on P2. Parallel-safe with P3. |
| **P3** | Management & Import/Export | CRUD pages for items/aliases/stores/categories, aisle ordering, import preview/commit, export, backups. |
| **P4** | Household, Sync, PWA | Passcode auth, members, SSE live sync, offline queue, installability, a11y pass. |
| **P5** | Hardening & Release | Perf verification, error states, restore drill, docs, `v1.0.0` tag. |
| **P6** | Intelligence | Async jobs worker, LLM enrichment, co-occurrence pills, generated icons. Post-release. |

* * *

## 4. System architecture

### 4.1 Context diagram

```
                    ┌──────────────────────────────────────────┐
                    │            HOUSEHOLD (2–6 people)        │
                    │  phones on LAN / Tailscale / VPN         │
                    └───────────────┬──────────────────────────┘
                                    │ HTTPS (Caddy, self-signed or ACME)
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │   KIRANA  (single Docker container)      │
                    │  ┌────────────────────────────────────┐  │
                    │  │  SPA (React)  ──served as static──┐│  │
                    │  │  /api/v1/*  (Fastify)             ││  │
                    │  │  SQLite + FTS5  (/data/kirana.db) ││  │
                    │  └────────────────────────────────────┘│  │
                    └───────┬───────────────────────┬──────────┘
                            │                       │
              nightly .backup copy            (P6, optional)
                            ▼                       ▼
                    ┌───────────────┐      ┌──────────────────┐
                    │ NAS / S3 /    │      │ Ollama on LAN    │
                    │ rclone target │      │ (OpenAI-compat)  │
                    └───────────────┘      └──────────────────┘
```

**Hard constraint:** no outbound network calls in P0–P5. The app must be fully functional with the WAN unplugged. P6 adds exactly one optional outbound dependency (the LLM endpoint), disabled by default.

### 4.2 Container diagram

```
┌──────────────────────────── Browser (PWA) ─────────────────────────────┐
│  React 19 SPA                                                          │
│  ├─ Router: /  /store/:id  /catalog  /stores  /categories  /settings   │
│  ├─ TanStack Query  ← optimistic cache, SSE-driven invalidation        │
│  ├─ Local catalog index (Fuse.js) ← instant suggestions, offline-safe  │
│  ├─ IndexedDB mutation queue ← offline writes, replayed with client_id │
│  └─ Service worker (Workbox) ← app shell cache, stale-while-revalidate │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ HTTPS  JSON + SSE
┌───────────────────────────────▼────────────────────────────────────────┐
│  Fastify 5                                                             │
│  ├─ Plugins: cookie, rate-limit, static, cors(off), sensible           │
│  ├─ auth        → session cookie, member resolution                    │
│  ├─ routes/*    → Zod-validated handlers, thin                      │
│  ├─ services/*  → domain logic (pure, unit-tested)                     │
│  ├─ repos/*     → Drizzle queries, transaction boundaries              │
│  ├─ events      → change_log tailer → SSE fanout                       │
│  └─ jobs        → (P6) polling worker over `jobs` table                │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ better-sqlite3 (sync, single writer)
┌───────────────────────────────▼────────────────────────────────────────┐
│  SQLite  /data/kirana.db  (WAL)                                        │
│  ├─ 9 core tables + change_log                                         │
│  ├─ 4 P6 tables (created empty in P0)                                  │
│  └─ FTS5 virtual table `item_search` (trigram) + sync triggers         │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Entity relationships

```
households ─1:N─ members
households ─1:N─ stores ─1:N─ list_items ─N:1─ items
households ─1:N─ categories (household_id NULL = global seed)
households ─1:N─ items
items ─1:N─ item_aliases
items ─N:M─ stores   (via item_store_stats — per-store add history)
categories ─1:N─ list_items      (per-entry category, overridable)
categories ─1:N─ items           (default category)
change_log                       (polymorphic, no FK, global revision counter)
```

```
┌──────────────┐         ┌─────────────────────┐         ┌──────────────────┐
│    stores    │ 1     * │     list_items      │ *     1 │      items       │
│──────────────│─────────│─────────────────────│─────────│──────────────────│
│ id (PK)      │         │ id (PK)             │         │ id (PK)          │
│ name_norm U  │         │ store_id (FK)       │         │ name_norm U      │
│ status       │         │ item_id (FK)        │         │ default_unit     │
│ category_    │         │ qty_value, unit_code│         │ default_category │
│  order_json  │         │ category_id (FK)    │         │ icon_kind/ref    │
│ icon         │         │ status              │         │ attrs_json       │
└──────┬───────┘         │ checked_at/by       │         └────┬────────┬────┘
       │                 └──────────┬──────────┘              │1       │1
       │                            │*                        │*       │*
       │                    ┌───────┴────────┐        ┌───────┴────┐ ┌┴───────────────┐
       │                    │   categories   │        │item_aliases│ │item_store_stats│
       │                    │ scope, sort    │        └────────────┘ └────────────────┘
       │                    └────────────────┘
       └─ (P1.5) shop mode reads a single store subtree
```

### 4.4 Flow: add item (the hot path)

```
User          Web (sheet)            API                     DB
 │  types "mil"  │                    │                       │
 │──────────────>│ Fuse.js local index│                       │
 │               │ <5ms, no network   │                       │
 │  taps sugg.   │                    │                       │
 │──────────────>│ POST /stores/:id/items                     │
 │               │───────────────────>│ Zod validate          │
 │               │                    │ resolve catalog item  │
 │               │                    │  ├ exact name_norm? ──┼─> items
 │               │                    │  ├ alias match? ──────┼─> item_aliases
 │               │                    │  └ else create item ──┼─> items (+alias)
 │               │                    │ upsert list_item ─────┼─> list_items
 │               │                    │ bump item_store_stats ┼─> item_store_stats
 │               │                    │ append change_log ────┼─> change_log
 │               │<───────────────────┤ 201 {listItem, item}  │
 │               │ optimistic patch   │                       │
 │<──────────────┤ sheet closes       │                       │
```

**Budget:** server handler ≤40ms p95; total perceived ≤100ms.

### 4.5 Flow: check item + live fanout

```
Phone A            API                  change_log            Phone B
  │ POST /list-items/:id/check │              │                  │
  │───────────────────────────>│ append row ─>│                  │
  │<───────────────────────────┤ 200          │                  │
  │ optimistic UI (instant)    │              │ SSE: revision 421 │
  │                            │─────────────────────────────────>│
  │                            │              │  GET /board?since │
  │                            │<─────────────────────────────────┤
  │                            │ 200 delta    │                  │
  │                            │              │  patch cache      │
```

### 4.6 Store lifecycle state machine

```
                 ┌────────────────────────────────────────────┐
                 │                                            │
                 ▼                                            │
   create ──> [ ACTIVE ] ──all items bought + confirm──> [ DONE ]
                 ▲   │                                      │  │
                 │   │ add item                             │  │ 24h elapsed
                 │   │                                      │  │ or manual archive
                 │   └──(stays active)                      ▼  ▼
                 │                                       [ ARCHIVED ]
                 └────────── reopen / restore ────────────────┘
```

Rules:

*   `ACTIVE` → `DONE` requires zero `active` list items (all bought) **and** explicit user action.
    
*   `DONE` → `ACTIVE` on any new item being added.
    
*   `DONE` → `ARCHIVED` manually, or by a nightly job after 24h.
    
*   `ARCHIVED` → `ACTIVE` on restore. Restoring does **not** resurrect cleared items.
    

### 4.7 Client mutation state machine (offline)

```
         ┌─────────┐   mutation    ┌──────────────┐
         │  IDLE   │──────────────>│ OPTIMISTIC   │
         └────┬────┘               └──────┬───────┘
              │                           │
     network  │                    ┌──────┴───────┐
     lost     │                    │ 2xx          │ 5xx / offline
              ▼                    ▼              ▼
         ┌─────────┐          ┌─────────┐   ┌──────────┐
         │ OFFLINE │          │ SYNCED  │   │  QUEUED  │
         │ (read)  │          └─────────┘   └────┬─────┘
         └────┬────┘                             │ reconnect
              │                                  ▼
              │                            ┌───────────┐
              └───────────────────────────>│ REPLAYING │
                                           └─────┬─────┘
                                                 │ drained (idempotent via client_id)
                                                 ▼
                                            ┌─────────┐
                                            │ SYNCED  │
                                            └─────────┘
```

Conflict policy: **last-write-wins per field**, with `updated_at` comparison. A queued mutation older than the server row is dropped and the server value wins; the UI shows a toast ("Updated elsewhere").

### 4.8 Deployment topology

```
Internet/LAN
     │
     ▼
┌──────────────────────────────────────────────┐
│ Caddy (or existing Traefik/NPM)              │
│  /        → kirana:8080 (static SPA)         │
│  /api/*   → kirana:8080 (Fastify)            │
│  /events  → kirana:8080 (SSE, no buffering)  │
└───────────────────┬──────────────────────────┘
                    │
        ┌───────────▼────────────┐
        │ kirana container       │
        │  :8080                 │
        │  /data  ← named volume │
        └───────────┬────────────┘
                    │
        ┌───────────▼────────────┐
        │ ./data/kirana.db       │
        │ ./data/backups/*.db    │
        │ ./data/icons/   (P6)   │
        └────────────────────────┘
```

SSE requires proxy config: `flush_interval -1` (Caddy does this by default for `text/event-stream`), and **disabled response buffering**.

* * *

## 5. Data model

### 5.1 SQLite pragmas (set on every connection open)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
```

### 5.2 Full DDL (P0 deliverable)

```sql
-- ─────────────────────────── identity ───────────────────────────
CREATE TABLE households (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  passcode_hash TEXT NOT NULL,          -- scrypt, see §12.2
  created_at    INTEGER NOT NULL
);

CREATE TABLE members (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  display_name TEXT NOT NULL,
  color        TEXT NOT NULL,           -- hex, used for avatar chip
  pin_hash     TEXT,                    -- reserved, unused in v1
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

-- ─────────────────────────── stores ─────────────────────────────
CREATE TABLE stores (
  id                  TEXT PRIMARY KEY,
  household_id        TEXT NOT NULL REFERENCES households(id),
  name                TEXT NOT NULL,
  name_norm           TEXT NOT NULL,
  icon_kind           TEXT NOT NULL DEFAULT 'emoji'
                        CHECK (icon_kind IN ('emoji','sprite','url','none')),
  icon_ref            TEXT,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','done','archived')),
  category_order_json TEXT NOT NULL DEFAULT '[]',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  UNIQUE (household_id, name_norm)
);
CREATE INDEX idx_stores_status
  ON stores(household_id, status, sort_order) WHERE deleted_at IS NULL;

-- ─────────────────────────── categories ─────────────────────────
CREATE TABLE categories (
  id           TEXT PRIMARY KEY,
  household_id TEXT REFERENCES households(id),   -- NULL = global seed row
  name         TEXT NOT NULL,
  name_norm    TEXT NOT NULL,
  scope        TEXT NOT NULL CHECK (scope IN ('grocery','household','general')),
  icon         TEXT,
  color        TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_seed      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE UNIQUE INDEX ux_categories_name
  ON categories(COALESCE(household_id,''), scope, name_norm) WHERE deleted_at IS NULL;

-- ─────────────────────────── catalog ────────────────────────────
CREATE TABLE items (
  id                  TEXT PRIMARY KEY,
  household_id        TEXT NOT NULL REFERENCES households(id),
  name                TEXT NOT NULL,          -- display form, original casing
  name_norm           TEXT NOT NULL,          -- §7.1
  default_category_id TEXT REFERENCES categories(id),
  default_unit_code   TEXT,                   -- §7.2 registry
  default_qty         REAL,
  icon_kind           TEXT NOT NULL DEFAULT 'emoji'
                        CHECK (icon_kind IN ('emoji','sprite','url','none')),
  icon_ref            TEXT,
  attrs_json          TEXT NOT NULL DEFAULT '{}',   -- P6 escape hatch
  cluster_id          TEXT,                          -- P6
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  UNIQUE (household_id, name_norm)
);
CREATE INDEX idx_items_category ON items(default_category_id) WHERE deleted_at IS NULL;

CREATE TABLE item_aliases (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  alias_norm TEXT NOT NULL,      -- §7.1
  search_key TEXT NOT NULL,      -- §7.3 folded key
  lang       TEXT NOT NULL CHECK (lang IN ('en','hi-Latn','hi')),
  source     TEXT NOT NULL DEFAULT 'user'
               CHECK (source IN ('user','seed','llm','import')),
  created_at INTEGER NOT NULL,
  UNIQUE (item_id, alias_norm)
);
CREATE INDEX idx_aliases_search ON item_aliases(search_key);

CREATE TABLE item_store_stats (
  item_id             TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  store_id            TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  times_added         INTEGER NOT NULL DEFAULT 0,
  last_added_at       INTEGER,
  default_category_id TEXT REFERENCES categories(id),
  PRIMARY KEY (item_id, store_id)
);

-- ─────────────────────────── the list ───────────────────────────
CREATE TABLE list_items (
  id          TEXT PRIMARY KEY,          -- UUIDv7, client-generated
  client_id   TEXT UNIQUE,               -- idempotency key for offline replay
  store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL REFERENCES items(id),
  qty_value   REAL CHECK (qty_value IS NULL OR qty_value > 0),
  unit_code   TEXT,
  category_id TEXT REFERENCES categories(id),
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','bought','cleared')),
  checked_at  INTEGER,
  checked_by  TEXT REFERENCES members(id),
  added_by    TEXT REFERENCES members(id),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_list_store_status ON list_items(store_id, status);
CREATE INDEX idx_list_item         ON list_items(item_id);
CREATE UNIQUE INDEX ux_list_client ON list_items(client_id) WHERE client_id IS NOT NULL;

-- ─────────────────────────── sync ───────────────────────────────
CREATE TABLE change_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,   -- == global revision
  entity       TEXT NOT NULL,      -- store | list_item | item | alias | category | member
  entity_id    TEXT NOT NULL,
  op           TEXT NOT NULL CHECK (op IN ('create','update','delete')),
  store_id     TEXT,               -- denormalized for scoped fanout
  payload_json TEXT NOT NULL,
  actor_id     TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_change_created ON change_log(created_at);

-- ─────────────────────────── P6 scaffolding (created empty in P0) ─
CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,      -- enrich_item | generate_icon | cluster_items | categorize_item
  payload_json TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','done','failed','dead')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  run_after    INTEGER,
  result_json  TEXT,
  error        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_jobs_pick ON jobs(status, run_after);

CREATE TABLE item_embeddings (
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  dim        INTEGER NOT NULL,
  vector     BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, model)
);

CREATE TABLE item_pairs (
  a_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  b_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  co_count  INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER,
  PRIMARY KEY (a_id, b_id),
  CHECK (a_id < b_id)
);

CREATE TABLE llm_cache (
  prompt_hash   TEXT PRIMARY KEY,
  model         TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- ─────────────────────────── FTS5 ───────────────────────────────
CREATE VIRTUAL TABLE item_search USING fts5(
  name,
  aliases,
  search_keys,
  item_id UNINDEXED,
  tokenize = 'trigram'
);
```

### 5.3 FTS synchronization

Maintained by **triggers**, not application code, so it cannot drift:

*   `AFTER INSERT ON items` → insert row into `item_search`.
    
*   `AFTER UPDATE ON items` → delete + reinsert row.
    
*   `AFTER INSERT/UPDATE/DELETE ON item_aliases` → rebuild the parent item's FTS row (aggregate `alias` and `search_key` with a space separator).
    
*   `AFTER DELETE ON items` → delete row.
    

A maintenance command `pnpm db:reindex` performs a full `INSERT INTO item_search(item_search) VALUES('rebuild')` after manual repairs.

### 5.4 Invariants (enforced by service layer + tests)

| ID | Invariant |
| --- | --- |
| INV-1 | Every `list_item` references exactly one store and one item. |
| INV-2 | `status='bought'` ⟺ `checked_at IS NOT NULL`. `status='active'` ⟹ `checked_at IS NULL`. |
| INV-3 | `qty_value` is NULL or > 0. Never 0, never negative. |
| INV-4 | `unit_code`, when present, exists in the unit registry (§7.2). |
| INV-5 | `(household_id, name_norm)` is unique among non-deleted items. |
| INV-6 | A soft-deleted item never loses its `list_items`; UI renders "Archived item". |
| INV-7 | `change_log.id` is strictly increasing and never reused. |
| INV-8 | `item_store_stats.times_added` only increases; never reset. |
| INV-9 | `stores.status='done'` ⟹ zero `list_items` with `status='active'` in that store. |
| INV-10 | Timestamps are UTC epoch milliseconds, integers. No local time in DB. |

### 5.5 Migration policy

*   Migrations are numbered `0001_init.sql`, `0002_....sql`, applied in order, tracked in `__migrations`.
    
*   **Serialized:** only one agent may author a migration at a time; the file number is claimed in `docs/STATUS.md` before writing.
    
*   Destructive migrations (drop/rename) require an ADR **and** a pre-migration `.backup` file written by the migration runner.
    
*   Migrations must be idempotent on re-run where practical (`IF NOT EXISTS`).
    
*   Every migration ships with a round-trip test: fresh DB → migrate → assert schema hash.
    

* * *

## 6. Domain rules

### 6.1 Normalization (`name_norm`)

```ts
function normalizeName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC`]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

Applied to item names, store names, category names, and aliases. Used for uniqueness, not display. Display always uses the original `name`.

### 6.2 Unit registry (static, in `shared/units.ts`)

```ts
export const UNITS = {
  ea:    { type: 'count',  label: 'ea',    base: 'ea', factor: 1,    plural: 'ea' },
  pack:  { type: 'count',  label: 'pack',  base: 'ea', factor: 1,    plural: 'packs' },
  dozen: { type: 'count',  label: 'dozen', base: 'ea', factor: 12,   plural: 'dozen' },
  g:     { type: 'weight', label: 'g',     base: 'g',  factor: 1,    plural: 'g' },
  kg:    { type: 'weight', label: 'kg',    base: 'g',  factor: 1000, plural: 'kg' },
  ml:    { type: 'volume', label: 'ml',    base: 'ml', factor: 1,    plural: 'ml' },
  l:     { type: 'volume', label: 'L',     base: 'ml', factor: 1000, plural: 'L' },
} as const;
```

Rules:

*   Measurement **type** is derived from `unit_code`; it is never stored separately.
    
*   Toggling type preserves the numeric value and picks a display unit: `count→ea`, `weight→kg if v>=1000 else g`, `volume→L if v>=1000 else ml`.
    
*   Conversion always goes through base units. Display rounds to max 2 decimals, strips trailing zeros (`1.50 → 1.5`, `2.00 → 2`).
    
*   No unit conversions between types are ever attempted (count ⇄ weight is meaningless).
    

### 6.3 Quantity quick-parse

The name field is parsed for an embedded quantity before catalog lookup. Grammar (case-insensitive, tolerant of spaces):

```
PATTERNS:
  /^(.+?)\s+(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|grams?|ml|l|ltr|litre|liter|dozen|dz|pack|packs|pcs?|x)\s*$/i
  /^(.+?)\s+x\s*(\d+)\s*$/i          → count
  /^(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\s+(.+)$/i   → leading quantity form
```

Examples:
| Input | Item name | Qty | Unit |
| --- | --- | --- | --- |
| `milk 2 l` | milk | 2 | l |
| `atta 5kg` | atta | 5 | kg |
| `eggs dozen` | eggs | 1 | dozen |
| `x3 bananas` | bananas | 3 | ea |
| `500 g paneer` | paneer | 500 | g |
| `dal 2` | dal | 2 | ea |

If parsing produces an empty name, the parse is discarded. The parsed value populates the qty controls, which remain editable. Never silently drop user text.

### 6.4 Catalog resolution (upsert) — the dedupe algorithm

On `POST /stores/:id/items` with a free-text `name`:

```
1. norm = normalizeName(name)
2. EXACT: SELECT * FROM items WHERE household_id=? AND name_norm=norm AND deleted_at IS NULL
   → hit: use it (confidence 1.0)
3. ALIAS: SELECT i.* FROM items i JOIN item_aliases a ON a.item_id=i.id
          WHERE a.alias_norm=norm AND i.deleted_at IS NULL
   → hit: use it
4. FUZZY: candidates = top 5 from search(name) scored by trigram + edit distance
   if best.score >= 0.90 → DO NOT auto-create. Return 409 { code:'ITEM_NEAR_DUPLICATE',
       suggestions:[...] } and let the UI offer "Use existing" / "Create new".
5. ELSE create item with defaults derived in this order:
      category   ← item_store_stats.default_category_id (same store)
                 ← most frequent category for this item across stores
                 ← inferred from keyword table (shared/categoryHints.ts)
                 ← 'Other'
      unit       ← last unit used for this item
                 ← 'ea'
      icon       ← emoji from keyword table, else '🛒'
   also create alias(name, lang='en', source='user')
6. Insert list_item, bump item_store_stats, append change_log.
```

**Never silently create a near-duplicate.** This is the single most important catalog-hygiene rule.

### 6.5 Category resolution for a list entry

`list_items.category_id` is resolved at add time and is independently editable:

```
1. explicit categoryId in request
2. item_store_stats.default_category_id for this (item, store)
3. items.default_category_id
4. categoryHints lookup on the item name
5. 'Other'
```

On every successful add, write back: `item_store_stats.default_category_id = resolved` and (if item had none) `items.default_category_id = resolved`.

### 6.6 Progress and counters

```
total   = COUNT(list_items WHERE store_id=? AND status IN ('active','bought'))
bought  = COUNT(list_items WHERE store_id=? AND status='bought')
display = bought === 0 ? (total === 0 ? 'Empty' : `${total} to buy`) : `${bought}/${total}`
```

`X/Y` is rendered as a light subscript next to the store name (§9.2). Never a donut chart.

### 6.7 Clear bought

`POST /stores/:id/clear-bought` sets `status='cleared'` for all `bought` rows in the store. It is a **soft** operation:

*   Rows remain for history and P6 co-occurrence.
    
*   UI shows a 5s undo toast; undo restores `status='bought'`.
    
*   A nightly job purges `cleared` rows older than 180 days.
    

### 6.8 Sorting

Within a category: unchecked first, then checked; within each group by `sort_order`, then `created_at`. `sort_order` is a float so drag-reorder is a midpoint insert. No manual reordering UI in v1 (reserved).
Categories within a store: `stores.category_order_json` (array of category IDs) if present, else `categories.sort_order`. Unknown categories append at the end.

* * *

## 7. API specification

### 7.1 Conventions

*   Base path `/api/v1`. JSON only. `Content-Type: application/json; charset=utf-8`.
    
*   All timestamps are integer UTC epoch ms.
    
*   All IDs are UUIDv7 strings.
    
*   Auth: `sid` HttpOnly cookie. Every route except `/auth/login` and `/healthz` requires it.
    
*   Mutations require header `X-Requested-With: kirana` (CSRF defense in depth alongside `SameSite=Lax`).
    
*   Every response carries `X-Request-Id`.
    
*   Errors use one envelope:
    

```json
{
  "error": {
    "code": "ITEM_NEAR_DUPLICATE",
    "message": "An item with a very similar name already exists.",
    "details": { "suggestions": [{ "id": "…", "name": "Basmati Rice", "score": 0.94 }] },
    "requestId": "01J…"
  }
}
```

Error codes (closed set): `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `ITEM_NEAR_DUPLICATE`, `STORE_NOT_EMPTY`, `IMPORT_TOKEN_EXPIRED`, `IMPORT_PARSE_FAILED`, `RATE_LIMITED`, `CONFLICT_STALE`, `INTERNAL`.

### 7.2 Endpoints

| # | Method | Path | Purpose |
| --- | --- | --- | --- |
| 1 | POST | `/auth/login` | `{passcode, displayName}` → sets `sid`, returns member |
| 2 | POST | `/auth/logout` | Clears session |
| 3 | GET | `/auth/me` | Current member + household |
| 4 | GET | `/board` | Full Home payload (§7.3) |
| 5 | GET | `/board?since=<revision>` | Delta payload since revision |
| 6 | POST | `/stores` | `{name, iconRef?, iconKind?}` |
| 7 | PATCH | `/stores/:id` | name, icon, status, categoryOrder, sortOrder, notes |
| 8 | DELETE | `/stores/:id` | Soft delete (409 if it has active items) |
| 9 | POST | `/stores/:id/items` | Add list item (§7.4) |
| 10 | POST | `/stores/:id/clear-bought` | Soft-clear all bought |
| 11 | POST | `/stores/:id/done` | Mark done (409 unless zero active) |
| 12 | POST | `/stores/:id/reopen` | done/archived → active |
| 13 | PATCH | `/list-items/:id` | qty, unit, category, note, status, sortOrder |
| 14 | DELETE | `/list-items/:id` | Hard delete a list row (with undo token) |
| 15 | POST | `/list-items/bulk-check` | `{ids[], checked}` |
| 16 | GET | `/items` | `?q=&categoryId=&limit=&cursor=` search/browse |
| 17 | POST | `/items` | Create catalog item (with optional aliases) |
| 18 | PATCH | `/items/:id` | name, defaults, icon, attrs |
| 19 | DELETE | `/items/:id` | Soft delete |
| 20 | POST | `/items/:id/aliases` | `{alias, lang}` |
| 21 | DELETE | `/items/:id/aliases/:aliasId` | Remove alias |
| 22 | POST | `/items/merge` | `{sourceId, targetId}` — merge duplicates |
| 23 | GET | `/categories` | List with usage counts |
| 24 | POST | `/categories` | Create |
| 25 | PATCH | `/categories/:id` | name, icon, color, sortOrder, scope |
| 26 | DELETE | `/categories/:id` | Soft delete (reassigns to 'Other') |
| 27 | PUT | `/stores/:id/category-order` | `{categoryIds: []}` |
| 28 | POST | `/import/preview` | multipart CSV/JSON → diff + token |
| 29 | POST | `/import/commit` | `{token, decisions[]}` |
| 30 | GET | `/export` | `?format=json |
| 31 | GET | `/events?since=` | SSE stream of change_log rows |
| 32 | GET | `/healthz` | `{status, version, revision, uptime}` |
| 33 | POST | `/admin/backup` | Trigger an on-demand `.backup` |

### 7.3 `GET /board` response shape

```json
{
  "revision": 421,
  "household": { "id": "hh_1", "name": "Home" },
  "me": { "id": "m_1", "displayName": "Alex", "color": "#4F46E5" },
  "members": [{ "id": "m_1", "displayName": "Alex", "color": "#4F46E5" }],
  "categories": [{ "id": "c_1", "name": "Produce", "scope": "grocery", "icon": "🥬", "sortOrder": 10 }],
  "stores": [
    {
      "id": "s_1", "name": "Costco", "iconKind": "emoji", "iconRef": "🏬",
      "status": "active", "categoryOrder": [], "sortOrder": 0,
      "counts": { "total": 12, "bought": 5 },
      "items": [
        {
          "id": "li_1", "itemId": "i_1", "name": "Basmati Rice",
          "qtyValue": 5, "unitCode": "kg", "categoryId": "c_4",
          "status": "active", "note": null, "addedBy": "m_1",
          "updatedAt": 1730000000000
        }
      ]
    }
  ],
  "catalog": [
    { "id": "i_1", "name": "Basmati Rice", "norm": "basmati rice",
      "aliases": ["chawal", "चावल"], "defaultUnit": "kg",
      "defaultCategoryId": "c_4", "iconRef": "🍚" }
  ]
}
```

`catalog` is the **entire** household catalog (cap 5,000 items; if exceeded, send `catalogTruncated: true` and rely on server search). It powers instant client-side suggestions.

### 7.4 `POST /stores/:id/items` request

```json
{
  "clientId": "01J8Z…",
  "itemId": "i_1",              // OR "name": "milk 2 l"
  "name": "milk 2 l",
  "qtyValue": 2,
  "unitCode": "l",
  "categoryId": "c_2",
  "note": null
}
```

Rules:

*   `itemId` and `name` are mutually exclusive; exactly one is required.
    
*   If `itemId` is given, `name` is ignored.
    
*   `clientId` makes the call idempotent: replaying the same `clientId` returns the original row with `200` instead of `201`.
    
*   Response `201` → `{ listItem, item, createdItem: boolean, createdAlias: boolean }`.
    

### 7.5 SSE

`GET /events?since=<revision>` emits:

```
event: change
id: 422
data: {"revision":422,"entity":"list_item","entityId":"li_9","op":"update","storeId":"s_1"}

: heartbeat every 20s
```

Client behavior: on `change`, if `entity === 'list_item'` and `storeId` is visible, refetch that store slice; otherwise refetch `/board?since=`. On reconnect, use `Last-Event-ID`.

### 7.6 Auth

*   Passcode hashed with **scrypt** (`N=16384, r=8, p=1`), constant-time compare.
    
*   Session: signed opaque token in `sid` cookie, `HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=2592000`.
    
*   Sessions stored server-side in memory + a `sessions` table (survives restart).
    
*   Login rate limit: 5 attempts / 5 min / IP, then exponential backoff.
    
*   No self-registration. The household is created by a first-run wizard (§9.9).
    

* * *

## 8. UX specification

### 8.1 Information architecture

```
/                    Home — the board (default landing, always)
/store/:id           Shop Mode (P1.5) — focused single-store view
/catalog             Catalog browser + search
/catalog/:id         Item detail (aliases, defaults, history, merge)
/stores              Manage stores (create, rename, icon, order, archive)
/categories          Manage categories + per-store aisle order
/data                Import / export / backup
/settings            Household, members, passcode, theme, about
```

**Navigation shell**

*   **Mobile (<768px):** bottom tab bar — `Home · Catalog · Stores · More`. Home is always the leftmost tab. `More` opens a sheet containing Categories, Data, Settings.
    
*   **Desktop (≥1024px):** persistent left rail with all destinations and a household avatar at the bottom.
    
*   **Tablet (768–1023px):** bottom tab bar, same as mobile.
    

Home has **no** top app bar beyond a 44px header row: household name on the left, member avatars on the right. No search field, no filters, no banners on Home.

### 8.2 Design tokens

| Token | Value |
| --- | --- |
| Base font | System UI stack (`-apple-system, Segoe UI, Roboto, …`) |
| Base size | 16px; item names 17px; store names 18px/600 |
| Spacing scale | 4 / 8 / 12 / 16 / 24 / 32 |
| Radius | 12px cards, 8px chips, 999px pills |
| Min tap target | 44×44px, 8px separation |
| Elevation | 0 (flat), 1 (card border), 2 (sheet shadow) — nothing else |
| Accent | One hue, configurable; default indigo `#4F46E5` |
| Category color | 6-color muted palette, used only as a 4px left border on section headers |
| Motion | 150ms ease-out for sheets/accordions; `prefers-reduced-motion` → 0ms |
| Dark mode | Follows `prefers-color-scheme`, overridable in Settings |

**Clutter budget:** max 2 visible actions per list row (checkbox + overflow). Max 1 primary button per screen. No more than 2 type sizes per card.

### 8.3 Screen: Home

```
┌──────────────────────────────────────┐
│ Home                    (A) (B) (C)  │   ← household, member avatars
├──────────────────────────────────────┤
│ ▸ 🏬 Costco                  5/12 ▍  │   ← collapsed store card
│ ▾ 🛒 Indian Store             3/9 ▍  │   ← expanded
│   ┌ Produce ───────────────────────┐ │
│   │ ☐ Tomatoes          1 kg    ⋯  │ │
│   │ ☑ Onions            2 kg    ⋯  │ │
│   ├ Dairy & Eggs ──────────────────┤ │
│   │ ☐ Paneer            500 g   ⋯  │ │
│   │ ☐ Curd              1 kg    ⋯  │ │
│   ├ Snacks & Namkeen ──────────────┤ │
│   │ ☐ Bhujia            2 pack  ⋯  │ │
│   └────────────────────────────────┘ │
│   [ Clear bought (3) ]  [ Done ✓ ]   │
│                                       │
│ ▸ 🏪 Target                  8 to buy │
│ ───────────────────────────────────── │
│ Archived (2)                        ▸ │
│                                       │
│                            ┌────────┐ │
│                            │   +    │ │  ← FAB, fixed above tab bar
│                            └────────┘ │
├──────────────────────────────────────┤
│  Home    Catalog    Stores    More    │
└──────────────────────────────────────┘
```

**Behaviors**

*   Tap store header → expand/collapse (state persisted per device in `localStorage`).
    
*   Tap `+` on Home → sheet asks which store (segmented chips) if >1 active store, else opens that store's add sheet.
    
*   Store card shows `Clear bought (n)` only when `n > 0`; `Done ✓` only when zero active items.
    
*   Fully-bought stores auto-collapse and show a subtle "All done — archive?" inline action.
    
*   Archived section is collapsed by default, always last.
    
*   Pull-to-refresh triggers `/board`.
    
*   Empty state: illustration-free, one line of text + primary "Add your first store".
    

**Acceptance criteria**

*   AC-H1: Given a store with 3 active and 2 bought items, the header shows `2/5` and a 40% progress bar.
    
*   AC-H2: Checking an item updates the row, the counter, and the progress bar within one frame (optimistic), and persists after reload.
    
*   AC-H3: `Clear bought` removes all bought rows and shows an undo toast for 5s; undo restores them exactly.
    
*   AC-H4: A store with zero active items shows `Done ✓`; tapping it moves the card to Archived.
    
*   AC-H5: Collapsed/expanded state survives a page reload.
    

### 8.4 Screen: Add-item sheet

```
┌──────────────────────────────────────┐
│  Add to Indian Store            ✕    │
│  ┌────────────────────────────────┐  │
│  │ milk 2 l                     ✎ │  │  ← autofocus, quick-parse
│  └────────────────────────────────┘  │
│  In this store                       │
│   🥛 Milk            1 L   Dairy     │  ← tap = fill
│   🥛 Full Cream Milk 1 L   Dairy     │
│  Also in your catalog                │
│   🥛 Milk Powder     500 g  Dairy    │
│  ──────────────────────────────────  │
│  [ Count | WEIGHT | Volume ]         │
│     [ − ]  2  [ + ]   [ kg ▾ ]       │
│  ──────────────────────────────────  │
│  Category                            │
│  (Dairy)(Produce)(Snacks)(Grains)…   │
│  ──────────────────────────────────  │
│  [        Add        ] [ Add another ]│
└──────────────────────────────────────┘
```

**Behaviors**

*   Sheet is a Vaul bottom sheet, 90vh max, keyboard-aware, `enterkeyhint="done"`.
    
*   Name field: 80ms debounce, max 5 suggestions, grouped "In this store" then "Also in your catalog", ranked per §8.6.
    
*   Selecting a suggestion fills name, qty, unit, category (all still editable).
    
*   Typing a parseable quantity (§6.3) moves the number into the qty control live, leaving the name clean.
    
*   Unit type segmented control swaps `unit_code` and preserves the value.
    
*   Category chips: horizontal scroll, recents first, then `sort_order`. Selected chip is filled.
    
*   Primary `Add` closes the sheet. `Add another` adds and keeps the sheet open with only the name cleared.
    
*   Near-duplicate response (§6.4) renders an inline card: "You already have **Basmati Rice**. [Use it] [Create new anyway]".
    
*   Sheet is fully operable with keyboard only, and with a screen reader.
    

**Acceptance criteria**

*   AC-A1: Typing "mil" shows "Milk" within 50ms; tapping it then `Add` completes the add in 3 total taps.
    
*   AC-A2: Typing "atta 5kg" leaves name "atta", qty 5, unit kg.
    
*   AC-A3: Adding a brand-new item creates exactly one catalog row and one alias; adding the same name again reuses it (no duplicate).
    
*   AC-A4: Adding "Basmati Rice" when "Basmati Rice" exists returns the near-duplicate prompt, not a second row.
    
*   AC-A5: Toggling Count→Weight→Volume never changes the numeric value and never produces an invalid unit.
    

### 8.5 Screen: Shop Mode (P1.5)

Single store, full screen, no tab bar.

*   Sticky header: store name, `5/12`, progress bar, `✕` to exit.
    
*   Only the current category is expanded; completing it (all checked) auto-expands the next unchecked category with a 200ms scroll animation.
    
*   Rows are 56px tall with a 28px checkbox and the qty chip right-aligned.
    
*   Footer: `Done shopping` (marks done, returns Home).
    
*   Optional: keep-screen-awake via Wake Lock API (progressive enhancement).
    

### 8.6 Search ranking (client and server must agree)

```
score = 0.55 * matchQuality + 0.25 * storeAffinity + 0.15 * recency + 0.05 * frequency

matchQuality:
  1.00  exact name_norm
  0.95  exact alias_norm
  0.85  name/alias starts with query
  0.70  trigram/FTS match
  0.50  1 - editDistance(fold(query), fold(candidate)) / maxLen   (if ≥ 0.7)

storeAffinity: 1.0 if the item has ever been added to this store, else 0
recency:       exp(-daysSinceLastAdded / 30)
frequency:     min(timesAdded / 20, 1)
```

Server returns `matchedVia: 'name' | 'alias' | 'fuzzy'` and `inStore: boolean` so the UI can group results.

### 8.7 Screen states (mandatory for every screen)

| State | Requirement |
| --- | --- |
| Loading | Skeleton matching final layout; never a full-page spinner |
| Empty | One sentence + one primary action; no illustrations in v1 |
| Error | Inline message + `Retry`; never a blank screen |
| Offline | Thin top banner "Offline — changes will sync"; queue count if >0 |
| Partial | Section-level skeletons; never block the whole board on one slow query |

### 8.8 Accessibility (WCAG 2.2 AA)

*   Contrast ≥4.5:1 for text, ≥3:1 for UI borders.
    
*   Checked state conveyed by icon **and** strikethrough, never color alone.
    
*   Checkbox is a real `<button role="checkbox" aria-checked>` with an accessible name of `"{item name}, {qty}, {category}"`.
    
*   Focus visible with a 2px ring, never removed.
    
*   All sheets trap focus, close on `Escape`, and restore focus to the trigger.
    
*   Full keyboard operation: `Space` toggles, `Enter` opens, `Delete` deletes with confirm.
    
*   Respect `prefers-reduced-motion` and browser font-size scaling to 200%.
    

### 8.9 First-run wizard

1.  Household name.
    
2.  Create passcode (min 4 digits/chars, confirm field).
    
3.  Your display name + color.
    
4.  "Seed starter categories?" → default **on**; creates the §14.1 category set and the §14.2 sample items.
    
5.  "Add your first store" → name + emoji picker (12 presets + free text).
    
6.  Lands on Home with an empty store and a coach-mark on the `+` (dismissed forever after first add).
    

### 8.10 Copy deck (use verbatim)

| Context | Copy |
| --- | --- |
| Empty Home | "No stores yet. Add the places you shop." |
| Empty store | "Nothing to buy here. Tap + to add an item." |
| All bought | "All done! Archive this store?" |
| Clear bought toast | "Cleared {n} items · Undo" |
| Item removed toast | "Removed {name} · Undo" |
| Offline banner | "Offline — changes will sync when you reconnect." |
| Near-duplicate | "You already have {name}. Use it, or create a new item?" |
| Near-duplicate actions | "Use it" / "Create new anyway" |
| Add-item sheet title | "Add to {store}" |
| Store picker title | "Add to which store?" |
| Suggestion groups | "In this store" / "Also in your catalog" |
| Unit types | "Count" / "Weight" / "Volume" |
| Import success | "Imported {n} items across {m} stores." |
| Import conflict | "{n} rows look like duplicates. Review them below." |
| Delete confirm | "Remove {name} from this list?" |
| Store delete confirm | "Remove {name}? Its history stays in backups." |
| Store delete blocked | "This store still has items. Clear them first." |
| Session expired | "Your session ended. Enter the passcode to continue." |
| Store menu — shop | "Shop here" |
| Shop Mode footer | "Done shopping" |
| Shop Mode exit | "Exit shop mode" |
| Shop Mode empty | "Nothing to buy here." |
| Shop Mode back action | "Back to Home" |
| Shop Mode not found | "Store not found." |
| Catalog search field | "Search catalog" |
| Catalog search empty | "No matches for "{query}"." |
| Empty catalog | "No catalog items yet. Add items from any store list." |
| Empty catalog action | "Go to Home" |
| Load more | "Load more" / "Loading…" |
| Uncategorized group | "Uncategorized" |
| Item detail back action | "Back to catalog" |
| Item not found | "Item not found." |
| Item stats | "Never added" / "Added {n} time(s)" / "Last added {date}" / "{n} store(s)" |
| Merge item action | "Merge with another item…" |
| Merge pick hint | "Search for the item you want to keep." |
| Merge confirm | "Merge {source} into {target}? List entries, aliases and stats move to the item you keep. This cannot be undone." |
| Item delete confirm | "Delete {name} from the catalog? Items on lists stay and show as "Archived item"." |
| Alias languages | "English" / "Hindi (Latin)" / "Hindi (Devanagari)" |
| Alias remove confirm | "Remove alias "{alias}"?" |
| Alias conflict action | "Go to {name}" |
| Store menu — rename | "Rename…" |
| Store menu — aisle order | "Aisle order…" |
| Store menu — archive | "Archive" |
| Store menu — restore | "Restore" |
| Store menu — delete | "Delete store…" |
| Categories empty | "No categories yet. Add the aisles you shop by." |
| Categories add action | "Add category" |
| Category edit sheet title | "Edit category" |
| Category menu | "Edit…" / "Move up" / "Move down" / "Delete…" |
| Category delete confirm | "Delete {name}? Items in it move to Other." |
| Category usage | "{n} item(s)" |
| Aisle order section | "Aisle order" |
| Aisle order hint | "Drag to set how {store} groups its aisles." |
| Reorder handle label | "Reorder {name}" |
| Reorder handle hint | "Press Space on the reorder handle to pick up a row, then use the arrow keys to move it." |
| Reorder grabbed | "{name} grabbed. Use the up and down arrow keys to move it, then press Space to drop, Escape to cancel." |
| Reorder moved | "Position {n} of {total}." |
| Reorder dropped | "{name} dropped." |
| Reorder cancelled | "Reorder cancelled." |
| Data import hint | "Choose a CSV or an export file to preview." |
| Data import reading | "Reading file…" |
| Data import summary | "{n} new · {d} duplicates · {c} conflicts · {i} invalid" |
| Data import action | "Import {n} items" |
| Data import start over | "Start over" |
| Data import another | "Import another file" |
| Data import row actions | "Create new" / "Merge into {name}" / "Skip" |
| Data import nothing | "No rows were imported." |
| Data import empty action | "Nothing to import" |
| Data file chosen | "File: {name}" |
| Data export section | "Export" |
| Data export everything | "Export everything (JSON)" |
| Data export store CSV | "Export store CSV" |
| Data backup section | "Backup" |
| Data backup hint | "A snapshot of the whole database, saved on the host." |
| Data backup action | "Create backup" |
| Data backup saved | "Backup saved: {file}" |
| Login passcode field | "Passcode" |
| Login unlock action | "Unlock" / "Checking…" |
| Login member picker | "Who's using this?" |
| Login invalid passcode | "Invalid passcode." |
| Login unknown member | "Unknown member." |
| Login rate limited | "Too many attempts. Try again in a few minutes." |
| Login wizard link | "First time here? Set up your household" |
| Wizard household name | "Name your household" / "Household name" |
| Wizard passcode | "Create a passcode" / "Confirm passcode" |
| Wizard passcode too short | "Passcodes must be at least 4 characters." |
| Wizard passcode mismatch | "Passcodes don't match." |
| Wizard you | "Your name" / "Pick a color" |
| Wizard seed | "Seed starter categories" / "Adds the default categories and 40 sample catalog items." |
| Wizard store | "Add your first store" / "Store name" / "Icon" / "Or any emoji" |
| Wizard finish | "Next" / "Back" / "Finish" / "Setting up…" / "Skip for now" |
| Wizard exists | "A household already exists." |
| Wizard sign-in link | "Already set up? Sign in" |
| Settings title | "Settings" |
| Settings household section | "Household" / "Name" / "Passcode" / "Change passcode" |
| Settings members section | "Members" / "Add member" / "Edit" / "Remove {name}" |
| Settings member remove confirm | "Remove {name} from the household? Their history stays." |
| Settings theme section | "Theme" / "System" / "Light" / "Dark" |
| Settings about section | "About" / "Kirana {version} ({revision})" |
| Settings sign out | "Sign out" |
| Coach-mark first add | "Tap + to add your first item" |
| Offline queue count | "{n} change(s) waiting to sync" |
| Updated elsewhere | "Updated elsewhere." |

* * *

## 9. Import / export

### 9.1 Formats

**CSV** (UTF-8, header required):

```csv
store,category,name,aliases,qty,unit,note
Indian Store,Grains & Lentils,Basmati Rice,chawal|चावल,5,kg,
Costco,Produce,Tomatoes,,1,kg,
```

*   `aliases` is pipe-separated; language is inferred (Devanagari → `hi`, Latin → `en` or `hi-Latn` if it differs from the normalized name).
    
*   `qty`/`unit` optional. `store` required.
    

**JSON** — the `/export` payload, accepted back verbatim for round-trip restore.

### 9.2 Normalization on import

Trim → collapse whitespace → strip trailing punctuation → `normalizeName` → case-fold comparison. Store and category names are matched case-insensitively and whitespace-insensitively to existing rows; missing ones are created after user confirmation in the preview.

### 9.3 Preview → commit

1.  `POST /import/preview` parses, validates, and computes a diff: `{ new: n, duplicate: n, conflict: n, invalid: n, rows: [...] }`.
    
2.  Each row gets `action: 'create' | 'merge' | 'skip' | 'error'` plus a suggested target for duplicates (fuzzy ≥0.9).
    
3.  The preview is stored in an in-memory map keyed by a signed token with a 10-minute TTL. Nothing is written to the DB.
    
4.  `POST /import/commit` applies the user's decisions in a single transaction. Partial failure rolls back everything.
    

### 9.4 Export

*   `GET /export?format=json` → full household dump including `schemaVersion`.
    
*   `GET /export?format=csv&storeId=` → per-store list.
    
*   Export is always complete and never paginated.
    

* * *

## 10. Non-functional requirements

| ID | Requirement | Budget / Target |
| --- | --- | --- |
| NFR-1 | Board API p95 | ≤50ms with 2,000 items / 500 list items |
| NFR-2 | Any API p95 | ≤100ms |
| NFR-3 | Initial JS bundle | ≤250KB gzip |
| NFR-4 | Time to interactive (mid-range Android, LAN) | ≤1.5s |
| NFR-5 | Client search latency | ≤30ms for 5,000 items |
| NFR-6 | Checkbox toggle → visual feedback | ≤16ms (one frame) |
| NFR-7 | SSE propagation | ≤1s |
| NFR-8 | DB file size | <50MB at 10 years of typical family use |
| NFR-9 | Cold start to first request | ≤2s |
| NFR-10 | Memory footprint | ≤256MB RSS |
| NFR-11 | Backup | Nightly `.backup`, 14 daily + 8 weekly retained |
| NFR-12 | Restore | Documented drill, verified in P5, RTO ≤10 min |
| NFR-13 | Browser support | Last 2 versions of iOS Safari, Chrome Android, Firefox, desktop Chrome/Safari |
| NFR-14 | Uptime expectation | Best-effort homelab; graceful degradation if LLM (P6) is down |
| NFR-15 | Logging | Structured JSON (pino), request id, no PII beyond display names |

* * *

## 11. Security & privacy

*   Single-tenant by design. No telemetry, no analytics, no CDN fonts, no third-party scripts.
    
*   All data stays on the host. P6 LLM calls go only to a user-configured endpoint, defaulting to `http://ollama:11434` on the LAN, disabled until enabled in Settings.
    
*   Parameterized queries only (Drizzle). No string-concatenated SQL.
    
*   All request bodies validated by Zod at the route boundary; unknown keys stripped.
    
*   No `dangerouslySetInnerHTML` anywhere. Item names are rendered as text.
    
*   Rate limits: login 5/5min/IP; mutations 120/min/session; SSE connections max 20/session.
    
*   Cookies: `HttpOnly`, `SameSite=Lax`, `Secure` when `APP_ORIGIN` is https.
    
*   Secrets via environment only; `.env.example` committed, `.env` gitignored.
    
*   The passcode protects against casual access, not a determined attacker on the LAN. Document this honestly in the README.
    

* * *

## 12. Operations

### 12.1 Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` | DB + backups + icons |
| `DATABASE_URL` | `/data/kirana.db` | SQLite path |
| `APP_ORIGIN` | `http://localhost:8080` | Cookie `Secure` + CORS decisions |
| `SESSION_SECRET` | _(required)_ | Cookie signing |
| `LOG_LEVEL` | `info` | pino level |
| `TZ` | `UTC` | Log timestamps only; DB is always UTC |
| `BACKUP_KEEP_DAILY` | `14` | Retention |
| `LLM_BASE_URL` | _(empty)_ | P6 only |
| `LLM_MODEL` | _(empty)_ | P6 only |
| `FEATURE_LLM` | `false` | P6 kill switch |

### 12.2 Password hashing

`scrypt` from `node:crypto`, `N=16384, r=8, p=1, keylen=64`, 16-byte random salt, stored as `scrypt$N$r$p$salt$hash`. Constant-time comparison via `timingSafeEqual`.

### 12.3 Docker Compose

```yaml
services:
  kirana:
    image: ghcr.io/OWNER/kirana:1.0.0
    container_name: kirana
    restart: unless-stopped
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    environment:
      - APP_ORIGIN=https://kirana.home.arpa
      - SESSION_SECRET=${SESSION_SECRET}
      - LOG_LEVEL=info
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3
    deploy:
      resources:
        limits: { memory: 256M }
```

### 12.4 Backup

*   Nightly at 03:00 local: `sqlite3 /data/kirana.db ".backup /data/backups/kirana-YYYYMMDD.db"` then gzip.
    
*   Prune to `BACKUP_KEEP_DAILY` + 8 weekly.
    
*   Optional `rclone copy` to NAS/S3 via a sidecar or host cron.
    
*   `POST /admin/backup` triggers an on-demand backup and returns the filename.
    

### 12.5 Restore drill (P5 gate)

1.  Stop the container.
    
2.  Move the current DB aside.
    
3.  Gunzip the latest backup into `DATA_DIR/kirana.db`.
    
4.  Start the container, verify `/healthz` and that Home renders identical counts.
    
5.  Record the elapsed time in `docs/progress/PHASE-5.md`.
    

* * *

## 13. Phase 2 (original) → Phase 6: Intelligence design hooks

These exist so P6 is additive, not a rewrite. **Nothing in P0–P5 may call an LLM.**
| Hook | Shipped in P0 | Used in P6 |
| --- | --- | --- |
| `jobs` table + polling worker | Table created, worker stub logs "no jobs" | Enrichment, icon generation, clustering |
| `items.attrs_json` | `'{}'` | Brand, pack size, barcode, LLM confidence |
| `items.icon_kind/icon_ref` | `emoji` | `sprite` pointing at `/data/icons/<id>.webp` |
| `item_pairs` | Empty | "Often bought with" pills from basket co-occurrence |
| `item_embeddings` | Empty | Cluster suggestions, semantic search |
| `llm_cache` | Empty | Prompt-hash cache, avoids repeat cost |
| `change_log` | Live | Push async enrichment results to clients |

**P6 sequencing (do it in this order — each is independently shippable):**

1.  **Co-occurrence pills** (no LLM): on add, show 2–5 `item_pairs` suggestions. Pure SQL.
    
2.  **Async enrichment job**: after an item is created, queue `enrich_item`; a worker asks the LLM for `{categoryId, unitCode, emoji}` constrained to enums with an `"other"` fallback; validates with Zod; writes back; emits a change.
    
3.  **Icon generation**: emoji first; sprites only if the user opts in. Store as WebP at 128px in `/data/icons`, served with `Cache-Control: immutable`.
    
4.  **Clustering**: nightly embeddings → cluster → `items.cluster_id` → "you may also need" pills.
    
5.  **NL add**: "add 2 kg atta and a dozen eggs to the Indian store" → structured add calls.
    

**Guardrails:** LLM output never writes directly to the DB without schema validation; every enrichment is reversible; a failed job must never block a user action; the feature flag `FEATURE_LLM=false` must leave the app fully functional.

* * *

## 14. Seed data

### 14.1 Categories (seeded in P0, `is_seed=1`)

**Grocery:** Produce · Dairy & Eggs · Bakery · Meat & Seafood · Grains & Lentils · Spices & Masala · Oils & Ghee · Snacks & Namkeen · Beverages & Tea/Coffee · Frozen · Canned & Packaged · Breakfast · Sweets & Desserts · Other
**Household:** Cleaning Supplies · Laundry · Bathroom · Personal Care · Kitchenware · Storage & Organization · Stationery · Hardware · Electrical · Baby · Pet · Other
Each: `icon` (emoji), `color` (from the 6-color palette), `sort_order` in tens, `scope`.

### 14.2 Sample catalog (40 items, seeded only if the user opts in)

Must include at least: Atta, Basmati Rice, Toor Dal, Chana Dal, Moong Dal, Paneer, Curd, Milk, Ghee, Eggs, Onion, Tomato, Potato, Garlic, Ginger, Green Chilli, Coriander, Cumin, Turmeric, Red Chilli Powder, Garam Masala, Salt, Sugar, Tea, Coffee, Bhujia, Biscuits, Cooking Oil, Mustard Oil, Dish Soap, Laundry Detergent, Toilet Cleaner, Shampoo, Toothpaste, Toilet Paper, Foil, Garbage Bags, Batteries, Light Bulbs, Notebook.
Each row: `{ name, aliases: [{alias, lang}], defaultUnit, category, emoji }`. Example:

```json
{ "name": "Basmati Rice", "category": "Grains & Lentils", "defaultUnit": "kg", "emoji": "🍚",
  "aliases": [
    { "alias": "chawal", "lang": "hi-Latn" },
    { "alias": "chaawal", "lang": "hi-Latn" },
    { "alias": "चावल", "lang": "hi" },
    { "alias": "rice", "lang": "en" }
  ] }
```

Seed data lives in `db/seed/categories.json` and `db/seed/items.json` and is idempotent on re-run.

### 14.3 Category hints (`shared/categoryHints.ts`)

A keyword→category map used as a fallback in §6.5, e.g. `milk|doodh|curd|paneer|ghee → Dairy & Eggs`, `dal|lentil|rice|atta|flour → Grains & Lentils`, `soap|detergent|cleaner → Cleaning Supplies`. Keep it to ~120 entries; it is a hint, not a classifier.

* * *

## 15. Delivery plan

### 15.1 Phase dependency graph

```
                        ┌──────────────────────────────┐
                        │ P0 Foundations & Contracts   │  (blocks everything)
                        └──────────────┬───────────────┘
                                       ▼
                        ┌──────────────────────────────┐
                        │ P1 Core Board                │
                        └──────────────┬───────────────┘
                                       ▼
                        ┌──────────────────────────────┐
                        │ P2 Add Item & Search         │
                        └───────┬──────────────┬───────┘
                                ▼              ▼
                 ┌────────────────────┐  ┌──────────────────────┐
                 │ P3 Management &    │  │ P1.5 Shop Mode       │
                 │ Import/Export      │  │ (parallel-safe)      │
                 └─────────┬──────────┘  └──────────┬───────────┘
                           └──────────┬─────────────┘
                                      ▼
                        ┌──────────────────────────────┐
                        │ P4 Household, Sync, PWA      │
                        └──────────────┬───────────────┘
                                       ▼
                        ┌──────────────────────────────┐
                        │ P5 Hardening & Release       │
                        └──────────────┬───────────────┘
                                       ▼
                        ┌──────────────────────────────┐
                        │ P6 Intelligence (post-1.0)   │
                        └──────────────────────────────┘
```

### 15.2 Parallel work lanes

| Lane | Owns | P0 | P1 | P2 | P3 | P1.5 | P4 | P5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A — Backend** | `server/**`, `db/**` | schema, migrations, seeds, contracts | board + list-item APIs | add/search/dedupe APIs | CRUD + import/export APIs | shop-mode query | auth, SSE | perf fixes |
| **B — Frontend** | `web/**` | tokens, shell, routing, mock data | Home screen | add sheet | management screens | shop mode UI | PWA, offline, a11y | polish |
| **C — Platform** | `infra/**`, `.github/**`, `scripts/**` | Docker, CI, backup script | — | — | — | — | deploy docs | restore drill |
| **D — QA/Docs** | `e2e/**`, `docs/**` | AGENTS.md, STATUS.md | E2E harness | E2E add-item | E2E import | E2E shop mode | E2E sync/offline | release notes |

**Rules for parallel work**

1.  Lanes never write outside their owned directories.
    
2.  `shared/**` is **contract territory**: changes require a PR prefixed `contract:` and must land before either lane proceeds.
    
3.  Migrations are serialized: claim the number in `STATUS.md` first.
    
4.  Merge order within a phase: contracts → backend → frontend → docs/E2E.
    
5.  Frontend may start a phase against **mocked contracts** as soon as contracts are frozen; it must not wait for backend completion.
    
6.  Cross-lane asks go in `docs/REQUESTS.md`, never in chat or commit messages alone.
    

### 15.3 Phase cards

Each card is a self-contained task brief. An agent must be able to complete it without reading other phases.

* * *

#### P0 — Foundations & Contracts

**Goal:** a running skeleton with frozen contracts, so every later phase is additive.  
**In:** monorepo, pnpm workspaces, TS strict, ESLint+Prettier, Vitest+Playwright, Drizzle, full DDL, migrations, seeds, `shared/` contracts + unit registry + category hints, Fastify boot with `/healthz`, React shell with routing + tokens + empty screens, Dockerfile, compose, CI, `AGENTS.md`, `STATUS.md`, `docs/DECISIONS/ADR-0001-stack.md`, `docs/progress/PHASE-0.md`.  
**Out:** any real data flow, any auth, any UI beyond the shell.  
**Contracts frozen at exit:** `shared/contracts.ts` (all Zod schemas), `openapi.json`, DDL.  
**Acceptance gates:**

*   G0.1 `docker compose up` → `GET /healthz` returns 200 with version + revision.
    
*   G0.2 Fresh DB migrates cleanly; a schema-hash test passes.
    
*   G0.3 Seeds load idempotently (run twice → same row counts).
    
*   G0.4 `pnpm verify` (typecheck, lint, unit, build) passes on a clean clone.
    
*   G0.5 CI runs `pnpm verify` on push.
    
*   G0.6 All 8 screens exist as routed placeholders with the nav shell.  
    **Demo:** clone → `docker compose up` → open browser → see empty shell, tab bar, all routes reachable.  
    **Effort:** M (≈8–10h).
    

* * *

#### P1 — Core Board

**Goal:** the Home screen is real. You can see, check, and clear items.  
**In:** `GET /board`, stores CRUD (API + minimal UI), categories read, list items read/patch/delete, check/uncheck, bulk check, progress counts, clear-bought + undo, done/reopen/archive, sorting per §6.8, empty/loading/error states, seed-driven demo data script.  
**Out:** adding items (P2), search, import, auth, SSE, shop mode.  
**Acceptance gates:**

*   G1.1 AC-H1 … AC-H5 pass.
    
*   G1.2 Board p95 ≤50ms with the 2k-item fixture.
    
*   G1.3 Checking is optimistic and survives reload.
    
*   G1.4 Clear-bought + undo round-trips exactly.
    
*   G1.5 Store done blocked when active items exist (`409 STORE_NOT_EMPTY`).
    
*   G1.6 E2E `check-item.spec.ts` and `clear-bought.spec.ts` green.  
    **Demo:** seeded board renders; check items; watch counters move; clear; undo; archive a store.  
    **Effort:** L (≈12–14h).
    

* * *

#### P2 — Add Item & Search

**Goal:** the 3-tap add. This phase determines whether the family adopts the app.  
**In:** `POST /stores/:id/items`, catalog upsert + dedupe (§6.4), alias creation, `GET /items` search with ranking (§8.6), FTS5 wiring, quick-parse (§6.3), unit toggle (§6.2), add-item sheet UI, local Fuse.js index, near-duplicate prompt, `item_store_stats` updates.  
**Out:** item management screens (P3), bulk import, LLM enrichment.  
**Acceptance gates:**

*   G2.1 AC-A1 … AC-A5 pass.
    
*   G2.2 `normalizeName`, `fold`, `parseQty`, `convertUnit`, `resolveItem` have ≥90% unit coverage.
    
*   G2.3 Adding the same name 100× creates exactly 1 item and 1 alias.
    
*   G2.4 Search returns the right item for: `pya`, `pyaz`, `प्याज़`, `chawa`, `dood`, `milk`.
    
*   G2.5 Near-duplicate never auto-creates a second row.
    
*   G2.6 E2E `add-item-known.spec.ts`, `add-item-new.spec.ts`, `duplicate-guard.spec.ts` green.  
    **Demo:** add a known item in 3 taps; add a new item with weight + category; type a Hinglish alias and see it match.  
    **Effort:** L (≈14–16h). **Highest-risk phase — schedule a search spike in the first 20%.**
    

* * *

#### P3 — Management & Import/Export

**Goal:** everything is editable, and the catalog can be bootstrapped from a spreadsheet.  
**In:** items/aliases/stores/categories CRUD screens, merge duplicates, per-store aisle ordering (drag), import preview/commit with diff, export JSON/CSV, backup script + admin endpoint, category usage counts.  
**Out:** auth, sync.  
**Acceptance gates:**

*   G3.1 Full CRUD for all four entities with validation and confirm dialogs.
    
*   G3.2 Import 200-row CSV: preview shows correct new/duplicate counts; commit is atomic; re-importing the same file creates zero duplicates.
    
*   G3.3 Export → wipe → import restores identical row counts and names.
    
*   G3.4 Aisle order persists per store and changes Home ordering.
    
*   G3.5 Merge moves list items and aliases, deletes the source, and is irreversible only after confirmation.
    
*   G3.6 E2E `import-roundtrip.spec.ts` green.  
    **Demo:** import a CSV of 200 items; fix a duplicate; reorder categories for one store; export.  
    **Effort:** L (≈14h).
    

* * *

#### P1.5 — Shop Mode

**Goal:** the in-store experience. Depends on P2; parallel-safe with P3.  
**In:** `/store/:id` route, sticky header with progress, one-category-at-a-time auto-advance, oversized rows, done-shopping action, wake lock, back-to-Home transition.  
**Out:** anything that changes the data model. Shop Mode is a _view_; it may add zero new tables.  
**Acceptance gates:**

*   G15.1 Completing a category auto-expands the next unchecked one.
    
*   G15.2 Row height ≥56px; checkbox ≥28px; all targets ≥44px.
    
*   G15.3 Works offline for reading; checks queue per P4 rules.
    
*   G15.4 Exiting returns to Home with the same scroll position.
    
*   G15.5 E2E `shop-mode.spec.ts` green.  
    **Demo:** open a store, walk through categories, finish, return Home.  
    **Effort:** M (≈6h).
    

* * *

#### P4 — Household, Sync, PWA

**Goal:** it's a shared app the family installs on their phones.  
**In:** first-run wizard, passcode auth, sessions, members + avatars, SSE endpoint + client, offline mutation queue with `client_id` replay, service worker, installability, manifest, icons, a11y pass, offline banner.  
**Out:** P6 intelligence.  
**Acceptance gates:**

*   G4.1 Two browser contexts: add on A → appears on B within 1s.
    
*   G4.2 Offline: check 3 items → reconnect → all 3 persist, no duplicates.
    
*   G4.3 Replaying the same `clientId` twice produces one row.
    
*   G4.4 Lighthouse PWA installable; offline shell loads.
    
*   G4.5 axe-core: zero critical violations on Home, add sheet, Catalog.
    
*   G4.6 Session survives container restart.
    
*   G4.7 E2E `live-sync.spec.ts`, `offline-queue.spec.ts`, `auth.spec.ts` green.  
    **Demo:** two phones, one adds, the other sees it; airplane mode, check items, reconnect.  
    **Effort:** L (≈14h).
    

* * *

#### P5 — Hardening & Release

**Goal:** ship `v1.0.0` with confidence.  
**In:** perf verification against §10, error-state sweep, restore drill, README + operator guide, CHANGELOG, version tag, dependency audit, final a11y pass, mobile device testing (iOS Safari + Chrome Android).  
**Acceptance gates:**

*   G5.1 All NFR-1…NFR-15 verified with recorded numbers.
    
*   G5.2 Restore drill completed and timed (RTO ≤10 min).
    
*   G5.3 No `TODO` without an issue reference anywhere in `src`.
    
*   G5.4 Full E2E suite green on CI, twice consecutively (flakiness check).
    
*   G5.5 README enables a stranger to deploy from scratch in ≤15 minutes.
    
*   G5.6 Tag `v1.0.0` created.  
    **Effort:** M (≈8h).
    

* * *

#### P6 — Intelligence (post-1.0)

Delivered as five independent increments in the order given in §13. Each increment is its own mini-phase with the same gate discipline. No P6 work may begin before `v1.0.0` is tagged.

* * *

## 16. Definition of Done (applies to every task, every phase)

A task is done only when **all** are true:

- [ ] Acceptance criteria in the phase card are demonstrably met (evidence recorded).
- [ ] Unit tests for new domain logic; integration test for each new endpoint.
- [ ] `pnpm verify` passes locally.
- [ ] No new dependency without a one-line justification in the phase log.
- [ ] No `any`, no `@ts-ignore`, no `eslint-disable` without an adjacent comment explaining why.
- [ ] Mobile viewport checked at 375×667 and 390×844.
- [ ] Keyboard-only operation verified for the touched screen.
- [ ] `docs/STATUS.md` updated.
- [ ] Phase log appended with: what was built, decisions, deviations, next.
- [ ] Commit messages cite PRD sections.

**A phase is done only when:** the phase gate checklist below passes, the phase tag is created, and the demo script has been executed end-to-end.

### Phase gate checklist

1.  Every acceptance gate Gx.y has written evidence (test name, command, or screenshot path).
    
2.  Full test suite green from a clean clone.
    
3.  Contracts unchanged — or an ADR is filed and `openapi.json` regenerated.
    
4.  `STATUS.md` reflects the new phase as current.
    
5.  `docs/progress/PHASE-N.md` has a "Handoff" section.
    
6.  Tag `phase-N-complete` pushed.
    
7.  No files outside the lane's ownership were modified (verified by `git diff --stat`).
    

* * *

## 17. Multi-agent coordination

### 17.1 Task card format

Every unit of work handed to a subagent must be a card containing exactly this:

```
TASK-ID:      T-P2-03
PHASE:        P2
LANE:         A (backend)
OBJECTIVE:    Implement POST /stores/:id/items with catalog upsert and dedupe.
REFERENCES:   PRD §6.4, §7.4, §8.6
FILES:        server/routes/listItems.ts, server/services/catalog.ts, db/repos/items.ts
DO NOT TOUCH: web/**, shared/**, db/migrations/**
ACCEPTANCE:   G2.3, G2.5 + unit test catalog.resolveItem covers 6 cases
STOP WHEN:    Tests pass and PR is open. Do not start P2-04.
```

Rules: one card = one branch = one PR. A card never spans two phases. If a card cannot be completed within its file list, the agent stops and writes to `docs/REQUESTS.md` rather than expanding scope.

### 17.2 Branch, commit, tag conventions

**Branches:** `feat/p2/add-item-api`, `fix/p1/progress-count`, `chore/p0/ci`, `contract/p2/board-shape`, `docs/p4/deploy-guide`.
**Commits:** Conventional Commits + a `Refs:` trailer.

```
feat(p2): add catalog upsert with fuzzy duplicate guard

Implements PRD §6.4. Returns 409 ITEM_NEAR_DUPLICATE when the best
fuzzy candidate scores >= 0.90.

Refs: PRD §6.4, §7.4, T-P2-03
Gate: G2.5
```

**Tags:** `phase-0-complete` … `phase-5-complete`, then `v1.0.0`. Annotated tags with a one-paragraph summary of what shipped.
**Merge policy:** squash to `main`, rebase before merge, never force-push `main`, `main` is always deployable.
**Using git as project memory:** `git log --oneline --graph --decorate` must read as the project narrative. Each phase is a visible run of commits ending in a tag. An agent resuming work should be able to reconstruct "where are we" from `git log --oneline -30` plus `STATUS.md`, without reading source.

### 17.3 ADR format (`docs/DECISIONS/ADR-XXXX-title.md`)

```md
# ADR-0007: Store category order as JSON, not a join table
Status: Accepted
Date: 2025-…
Context: …
Decision: …
Consequences: …
Alternatives rejected: …
Refs: PRD §5.2
```

ADRs are required for: contract changes, new dependencies, schema changes after P0, deviations from this document, and any "we'll do it differently" moment. No silent deviations.

### 17.4 Cross-lane requests (`docs/REQUESTS.md`)

```md
## R-012 — Backend: expose category usage counts
From: lane B (frontend)
Needed by: T-P3-05
Ask: GET /categories should include `itemCount` per category.
Blocking: yes
Status: open | accepted | done (PR #)
```

### 17.5 Conflict avoidance

*   The only shared mutable surface is `shared/**` and root `package.json`. Both are contract territory.
    
*   Two agents must never edit the same file in the same phase. If it's unavoidable, one owns it and the other files a request.
    
*   Migrations: strictly serialized, number claimed in `STATUS.md`.
    
*   Lockfiles: only lane C regenerates `pnpm-lock.yaml`.
    

* * *

## 18. Context & progress protocol

Agents lose context; the repo must not.

### 18.1 `docs/STATUS.md` (≤60 lines, rewritten each session, never appended)

```md
# STATUS
Updated: 2025-… by lane A
Current phase: P2 — Add Item & Search
Phase progress: 4/7 tasks

## Done this phase
- T-P2-01 search endpoint + FTS triggers
- T-P2-02 fold + normalize utilities (92% covered)

## In progress
- T-P2-03 catalog upsert (branch feat/p2/add-item-api)

## Blocked
- none

## Next
- T-P2-04 add-item sheet (lane B)

## Contract state
shared/contracts.ts @ v1.2 — frozen for P2

## Migration lock
next available: 0004
```

### 18.2 `docs/progress/PHASE-N.md` (append-only)

```md
## 2025-… — lane A — T-P2-03
Built: catalog.resolveItem + 409 near-duplicate path.
Tests: 8 new unit cases, all green.
Decisions: fuzzy threshold fixed at 0.90 (ADR-0011).
Deviations: none.
Learned: better-sqlite3 transactions must wrap the stats bump or counts drift.
Next: wire route, then hand to B for the sheet.
```

### 18.3 Context budget rules for agents

1.  Never load a file you will not edit or test.
    
2.  Cite `path:line` instead of pasting file contents into prompts or notes.
    
3.  If a file exceeds 400 lines, it is a refactor signal — split it, don't read it whole.
    
4.  Start every session by reading exactly four things: `AGENTS.md`, `STATUS.md`, the current `PHASE-N.md`, and ADRs newer than your last entry.
    
5.  End every session by writing exactly two things: a `PHASE-N.md` entry and a fresh `STATUS.md`.
    
6.  If you are unsure where something lives, `git log --oneline -- <path>` and `grep` — do not open directories.
    

### 18.4 Handoff note (end of every session)

```
Done:        <one line>
Next:        <the single next task card>
Blocked:     <what and why, or "none">
Files:       <paths touched>
Tests:       <pass/fail + command>
Context:     <anything the next agent would otherwise have to rediscover>
```

* * *

## 19. Testing strategy

| Level | Scope | Tool | Gate |
| --- | --- | --- | --- |
| Unit | `normalizeName`, `fold`, `parseQty`, unit conversion, category resolution, dedupe scoring, progress math, import diff | Vitest | ≥90% on `shared/` + `server/services/` |
| Integration | Every endpoint against a fresh in-memory SQLite with seeds | Vitest + supertest | All 33 endpoints covered by P5 |
| E2E | 9 critical flows | Playwright (mobile viewport) | Green on CI per phase |
| A11y | Home, add sheet, Catalog, Shop Mode | axe-core in Playwright | Zero critical |
| Performance | Board with 2k items | Custom script + assertions | NFR-1 |
| Visual | Key screens, light + dark | Playwright screenshots (optional) | Manual review |

**Critical E2E flows**

1.  `first-run.spec.ts` — wizard → first store → empty Home.
    
2.  `add-item-known.spec.ts` — 3-tap add.
    
3.  `add-item-new.spec.ts` — free text + weight + category.
    
4.  `duplicate-guard.spec.ts` — near-duplicate prompt.
    
5.  `check-item.spec.ts` — toggle + counter.
    
6.  `clear-bought.spec.ts` — clear + undo.
    
7.  `import-roundtrip.spec.ts` — CSV in, export out, re-import.
    
8.  `live-sync.spec.ts` — two contexts over SSE.
    
9.  `offline-queue.spec.ts` — offline writes replay.
    

**Fixtures:** `db/seed/fixtures/*.json` — deterministic, no random values, no `Date.now()` in fixtures (use fixed epoch ms).

* * *

## 20. Risk register

| ID | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| R-1 | Hinglish search quality disappoints | High | Alias table is user-editable; 20% spike in P2; accept fuzzy imperfection |
| R-2 | Catalog entropy from free-text adds | High | Near-duplicate guard (§6.4), merge tool (P3), import dedupe |
| R-3 | Scope creep into recipes/prices | Medium | Non-goals §1.5 are contractual; new ideas go to `docs/BACKLOG.md` |
| R-4 | Agent drift across phases | High | Phase gates, frozen contracts, ownership lanes, STATUS.md |
| R-5 | SSE buffered by reverse proxy | Medium | Explicit proxy config in README; `/healthz` exposes `sseClients` count |
| R-6 | Offline queue duplicates | Medium | `client_id` unique index + idempotent replay test |
| R-7 | SQLite write contention | Low | Single writer, WAL, `busy_timeout=5000`, all writes in transactions |
| R-8 | Family doesn't adopt it | High | 3-tap add is a hard gate (G2.1); ship P1.5 quickly; no login friction |
| R-9 | LLM work destabilizes a working app | Medium | P6 only after v1.0.0; feature flag; async jobs; validated output |
| R-10 | Data loss | High | Soft deletes, nightly backups, restore drill in P5 |

* * *

## 21. Assumptions & open questions

| ID | Question | Default if unanswered | Blocking? |
| --- | --- | --- | --- |
| Q-1 | Confirm languages: English, Hinglish (Latin), Hindi (Devanagari)? | Yes, all three | No |
| Q-2 | Household size for perf testing | 6 members, 2k items | No |
| Q-3 | Reverse proxy already in use? | Caddy included in compose | No |
| Q-4 | Domain/TLS method | `*.home.arpa` + internal CA | No |
| Q-5 | Backup target | Local `/data/backups` + optional rclone | No |
| Q-6 | Seed catalog ownership | Maintainer curates; 40 items shipped | No |
| Q-7 | Icon strategy | Emoji in v1; sprites in P6 | No |

**No agent may block on an open question.** Use the default, note it in the phase log, and move on.

* * *

## 22. Appendices

### A. Repository layout

```
kirana/
├── AGENTS.md
├── README.md
├── CHANGELOG.md
├── docker-compose.yml
├── Dockerfile
├── package.json                 # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── openapi.json                 # generated, committed
├── .env.example
├── shared/                      # CONTRACT TERRITORY
│   ├── contracts.ts             # all Zod schemas + inferred types
│   ├── units.ts
│   ├── normalize.ts
│   ├── fold.ts
│   ├── parseQty.ts
│   └── categoryHints.ts
├── db/
│   ├── schema.ts                # Drizzle
│   ├── migrations/0001_init.sql …
│   ├── seed/{categories.json,items.json,fixtures/}
│   └── repos/
├── server/
│   ├── index.ts
│   ├── plugins/{auth,events,errors}.ts
│   ├── routes/{auth,board,stores,listItems,items,categories,io,admin}.ts
│   ├── services/{catalog,list,progress,import,dedupe}.ts
│   └── jobs/worker.ts           # P6 stub
├── web/
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx, App.tsx
│   │   ├── routes/{Home,ShopMode,Catalog,ItemDetail,Stores,Categories,Data,Settings}.tsx
│   │   ├── components/{StoreCard,CategorySection,ItemRow,AddItemSheet,UndoToast,…}.tsx
│   │   ├── lib/{api,query,offline,search,fmt}.ts
│   │   └── styles/tokens.css
│   └── public/manifest.webmanifest
├── e2e/
├── infra/{Caddyfile,backup.sh}
└── docs/
    ├── STATUS.md
    ├── REQUESTS.md
    ├── BACKLOG.md
    ├── progress/PHASE-0.md … PHASE-5.md
    └── DECISIONS/ADR-0001-….md
```

### B. Dependency list (justify any addition in an ADR)

**Server:** `fastify`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/static`, `fastify-type-provider-zod`, `zod`, `drizzle-orm`, `better-sqlite3`, `drizzle-kit`, `pino`, `pino-pretty` (dev).
**Web:** `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `tailwindcss`, `@radix-ui/*` (via shadcn), `vaul`, `fuse.js`, `lucide-react`, `clsx`, `tailwind-merge`, `vite-plugin-pwa`.
**Dev:** `typescript`, `vitest`, `@playwright/test`, `eslint`, `prettier`, `tsx`.
Anything else needs an ADR.

### C. Change log for this document

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | — | Initial frozen spec. Stack: TypeScript full-stack. Shop Mode placed at P1.5. Original "Phase 2" renamed P6. |
