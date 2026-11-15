-- Kirana initial schema — PRD §5.2 (verbatim) + §5.3 FTS synchronization triggers.
-- All timestamps are UTC epoch ms integers. All IDs are UUIDv7 strings.

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

-- ─────────────── FTS synchronization (PRD §5.3) ─────────────────
-- Maintained by triggers, not application code, so it cannot drift.

CREATE TRIGGER trg_items_fts_insert
AFTER INSERT ON items
BEGIN
  INSERT INTO item_search(name, aliases, search_keys, item_id)
  SELECT NEW.name, '', '', NEW.id;
END;

CREATE TRIGGER trg_items_fts_update
AFTER UPDATE ON items
BEGIN
  DELETE FROM item_search WHERE item_id = OLD.id;
  INSERT INTO item_search(name, aliases, search_keys, item_id)
  SELECT
    NEW.name,
    COALESCE((SELECT GROUP_CONCAT(a.alias, ' ') FROM item_aliases a WHERE a.item_id = NEW.id), ''),
    COALESCE((SELECT GROUP_CONCAT(a.search_key, ' ') FROM item_aliases a WHERE a.item_id = NEW.id), ''),
    NEW.id;
END;

CREATE TRIGGER trg_items_fts_delete
AFTER DELETE ON items
BEGIN
  DELETE FROM item_search WHERE item_id = OLD.id;
END;

CREATE TRIGGER trg_aliases_fts_insert
AFTER INSERT ON item_aliases
BEGIN
  DELETE FROM item_search WHERE item_id = NEW.item_id;
  INSERT INTO item_search(name, aliases, search_keys, item_id)
  SELECT
    i.name,
    COALESCE((SELECT GROUP_CONCAT(a.alias, ' ') FROM item_aliases a WHERE a.item_id = NEW.item_id), ''),
    COALESCE((SELECT GROUP_CONCAT(a.search_key, ' ') FROM item_aliases a WHERE a.item_id = NEW.item_id), ''),
    NEW.item_id
  FROM items i
  WHERE i.id = NEW.item_id;
END;

CREATE TRIGGER trg_aliases_fts_update
AFTER UPDATE ON item_aliases
BEGIN
  DELETE FROM item_search WHERE item_id = OLD.item_id;
  INSERT INTO item_search(name, aliases, search_keys, item_id)
  SELECT
    i.name,
    COALESCE((SELECT GROUP_CONCAT(a.alias, ' ') FROM item_aliases a WHERE a.item_id = NEW.item_id), ''),
    COALESCE((SELECT GROUP_CONCAT(a.search_key, ' ') FROM item_aliases a WHERE a.item_id = NEW.item_id), ''),
    NEW.item_id
  FROM items i
  WHERE i.id = NEW.item_id;
END;

CREATE TRIGGER trg_aliases_fts_delete
AFTER DELETE ON item_aliases
BEGIN
  DELETE FROM item_search WHERE item_id = OLD.item_id;
  INSERT INTO item_search(name, aliases, search_keys, item_id)
  SELECT
    i.name,
    COALESCE((SELECT GROUP_CONCAT(a.alias, ' ') FROM item_aliases a WHERE a.item_id = OLD.item_id), ''),
    COALESCE((SELECT GROUP_CONCAT(a.search_key, ' ') FROM item_aliases a WHERE a.item_id = OLD.item_id), ''),
    OLD.item_id
  FROM items i
  WHERE i.id = OLD.item_id;
END;
