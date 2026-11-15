-- 0002: rebuild item_search on canonical forms (ADR-0002).
-- The P0 table indexed raw name/aliases with the trigram tokenizer, which is
-- case-sensitive by default and lacked fold(name); a virtual table's tokenizer
-- cannot be altered in place. The new shape stores one keys blob per item:
--   normalizeName(name) + normalizeName(alias)… + fold(name) + fold(alias)…
-- maintained by triggers via the registered kirana_norm/kirana_fold functions
-- (registered by db/connection.ts — §5.3 "cannot drift").
-- Derived data only: no user rows are dropped, no backup step required.

DROP TRIGGER IF EXISTS trg_items_fts_insert;
DROP TRIGGER IF EXISTS trg_items_fts_update;
DROP TRIGGER IF EXISTS trg_items_fts_delete;
DROP TRIGGER IF EXISTS trg_aliases_fts_insert;
DROP TRIGGER IF EXISTS trg_aliases_fts_update;
DROP TRIGGER IF EXISTS trg_aliases_fts_delete;
DROP TABLE IF EXISTS item_search;

CREATE VIRTUAL TABLE item_search USING fts5(
  keys,
  item_id UNINDEXED,
  tokenize = 'trigram'
);

CREATE TRIGGER trg_items_fts_insert
AFTER INSERT ON items
BEGIN
  INSERT INTO item_search(keys, item_id)
  SELECT kirana_norm(NEW.name) || ' ' || kirana_fold(NEW.name) || ' ' ||
         COALESCE(
           (SELECT GROUP_CONCAT(kirana_norm(a.alias) || ' ' || a.search_key, ' ')
            FROM item_aliases a WHERE a.item_id = NEW.id),
           ''
         ),
         NEW.id
  WHERE NEW.deleted_at IS NULL;
END;

CREATE TRIGGER trg_items_fts_update
AFTER UPDATE ON items
BEGIN
  DELETE FROM item_search WHERE item_id = OLD.id;
  INSERT INTO item_search(keys, item_id)
  SELECT kirana_norm(NEW.name) || ' ' || kirana_fold(NEW.name) || ' ' ||
         COALESCE(
           (SELECT GROUP_CONCAT(kirana_norm(a.alias) || ' ' || a.search_key, ' ')
            FROM item_aliases a WHERE a.item_id = NEW.id),
           ''
         ),
         NEW.id
  WHERE NEW.deleted_at IS NULL;
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
  INSERT INTO item_search(keys, item_id)
  SELECT kirana_norm(i.name) || ' ' || kirana_fold(i.name) || ' ' ||
         COALESCE(
           (SELECT GROUP_CONCAT(kirana_norm(a.alias) || ' ' || a.search_key, ' ')
            FROM item_aliases a WHERE a.item_id = i.id),
           ''
         ),
         i.id
  FROM items i
  WHERE i.id = NEW.item_id AND i.deleted_at IS NULL;
END;

CREATE TRIGGER trg_aliases_fts_update
AFTER UPDATE ON item_aliases
BEGIN
  DELETE FROM item_search WHERE item_id = OLD.item_id;
  INSERT INTO item_search(keys, item_id)
  SELECT kirana_norm(i.name) || ' ' || kirana_fold(i.name) || ' ' ||
         COALESCE(
           (SELECT GROUP_CONCAT(kirana_norm(a.alias) || ' ' || a.search_key, ' ')
            FROM item_aliases a WHERE a.item_id = i.id),
           ''
         ),
         i.id
  FROM items i
  WHERE i.id = OLD.item_id AND i.deleted_at IS NULL;
END;

CREATE TRIGGER trg_aliases_fts_delete
AFTER DELETE ON item_aliases
BEGIN
  DELETE FROM item_search WHERE item_id = OLD.item_id;
  INSERT INTO item_search(keys, item_id)
  SELECT kirana_norm(i.name) || ' ' || kirana_fold(i.name) || ' ' ||
         COALESCE(
           (SELECT GROUP_CONCAT(kirana_norm(a.alias) || ' ' || a.search_key, ' ')
            FROM item_aliases a WHERE a.item_id = i.id),
           ''
         ),
         i.id
  FROM items i
  WHERE i.id = OLD.item_id AND i.deleted_at IS NULL;
END;

-- Rebuild the content for existing rows (fresh installs have none).
INSERT INTO item_search(keys, item_id)
SELECT kirana_norm(i.name) || ' ' || kirana_fold(i.name) || ' ' ||
       COALESCE(
         (SELECT GROUP_CONCAT(kirana_norm(a.alias) || ' ' || a.search_key, ' ')
          FROM item_aliases a WHERE a.item_id = i.id),
         ''
       ),
       i.id
FROM items i
WHERE i.deleted_at IS NULL;
