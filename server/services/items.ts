import type Database from 'better-sqlite3';
import {
  fold,
  newUuidV7,
  normalizeName,
  type AliasDto,
  type GetItemResponse,
  type MergeItemsRequest,
  type UpdateItemRequest,
} from '@kirana/shared';
import { httpError } from '../plugins/errors.js';
import type { ActorContext } from './actor.js';
import { appendChange } from './changeLog.js';
import { categoryExists } from './categories.js';import { toItemDto, type AliasRecord, type ItemRowFull } from './mappers.js';

interface FullItemRow extends ItemRowFull {
  readonly household_id: string;
}

function getItemRow(db: Database.Database, householdId: string, id: string): FullItemRow {
  const row = db
    .prepare(
      `SELECT id, household_id, name, name_norm, default_category_id, default_unit_code,
              default_qty, icon_kind, icon_ref, attrs_json, created_at, updated_at
       FROM items WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
    )
    .get(id, householdId) as FullItemRow | undefined;
  if (row === undefined) {
    throw httpError(404, 'NOT_FOUND', `Catalog item ${id} not found`);
  }
  return row;
}

function aliasRecords(db: Database.Database, itemId: string): AliasRecord[] {
  return db
    .prepare('SELECT id, alias, lang FROM item_aliases WHERE item_id = ? ORDER BY created_at, id')
    .all(itemId) as AliasRecord[];
}

function itemResponse(db: Database.Database, row: FullItemRow): { item: ReturnType<typeof toItemDto> } {
  return { item: toItemDto(row, aliasRecords(db, row.id)) };
}

/** GET /items/:id — the /catalog/:id detail screen (ADR-0003). */
export function getItem(
  db: Database.Database,
  actor: ActorContext,
  id: string,
): GetItemResponse {
  const row = getItemRow(db, actor.householdId, id);
  const stats = db
    .prepare(
      `SELECT COALESCE(SUM(times_added), 0) AS times_added, MAX(last_added_at) AS last_added_at
       FROM item_store_stats WHERE item_id = ?`,
    )
    .get(row.id) as { times_added: number; last_added_at: number | null };
  const storeIds = (
    db
      .prepare('SELECT DISTINCT store_id FROM item_store_stats WHERE item_id = ?')
      .all(row.id) as Array<{ store_id: string }>
  ).map((r) => r.store_id);
  return {
    item: toItemDto(row, aliasRecords(db, row.id)),
    stats: {
      timesAdded: stats.times_added,
      lastAddedAt: stats.last_added_at,
      storeIds,
    },
  };
}

/** PATCH /items/:id — name (re-normalized, norm-unique), defaults, icon, attrs. */
export function updateItem(
  db: Database.Database,
  actor: ActorContext,
  id: string,
  patch: UpdateItemRequest,
  now: number,
): { item: ReturnType<typeof toItemDto> } {
  const row = getItemRow(db, actor.householdId, id);

  if (patch.defaultCategoryId !== undefined && patch.defaultCategoryId !== null) {
    if (!categoryExists(db, patch.defaultCategoryId)) {
      throw httpError(400, 'VALIDATION_FAILED', 'Unknown defaultCategoryId');
    }
  }

  let nameNorm = row.name_norm;
  if (patch.name !== undefined) {
    nameNorm = normalizeName(patch.name);
    const taken = db
      .prepare(
        'SELECT id FROM items WHERE household_id = ? AND name_norm = ? AND id != ?',
      )
      .get(actor.householdId, nameNorm, row.id);
    if (taken !== undefined) {
      throw httpError(409, 'CONFLICT_STALE', 'An item with this name already exists.');
    }
  }

  db.prepare(
    `UPDATE items SET name = ?, name_norm = ?, default_category_id = ?, default_unit_code = ?,
            default_qty = ?, icon_kind = ?, icon_ref = ?, attrs_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.name ?? row.name,
    nameNorm,
    patch.defaultCategoryId === undefined ? row.default_category_id : patch.defaultCategoryId,
    patch.defaultUnitCode === undefined ? row.default_unit_code : patch.defaultUnitCode,
    patch.defaultQty === undefined ? row.default_qty : patch.defaultQty,
    patch.iconKind ?? row.icon_kind,
    patch.iconRef === undefined ? row.icon_ref : patch.iconRef,
    patch.attrs === undefined ? row.attrs_json : JSON.stringify(patch.attrs),
    now,
    row.id,
  );

  if (patch.name !== undefined && nameNorm !== row.name_norm) {
    // Renaming keeps the old display name findable: it becomes an alias of the
    // renamed item unless it already is one (per-item alias uniqueness only —
    // an old name shared with another item stays that item's business).
    ensureAlias(db, row.id, row.name, row.name_norm, deriveLang(row.name), now);
  }

  appendChange(db, { entity: 'item', entityId: row.id, op: 'update', actorId: actor.memberId }, now);
  return itemResponse(db, getItemRow(db, actor.householdId, row.id));
}

/** DELETE /items/:id — unconditional soft delete (INV-6): list rows stay and
 * render as "Archived item" (the board's catalog omits deleted items, so the
 * client detects it by itemId absence). */
export function deleteItem(
  db: Database.Database,
  actor: ActorContext,
  id: string,
  now: number,
): { deleted: boolean } {
  const row = getItemRow(db, actor.householdId, id);
  db.prepare('UPDATE items SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
  appendChange(db, { entity: 'item', entityId: row.id, op: 'delete', actorId: actor.memberId }, now);
  return { deleted: true };
}

/** POST /items/:id/aliases — idempotent per item; 409 ITEM_NEAR_DUPLICATE when
 * the alias collides with another item's name or alias (§6.4 guard). */
export function createAlias(
  db: Database.Database,
  actor: ActorContext,
  itemId: string,
  input: { alias: string; lang: 'en' | 'hi-Latn' | 'hi' },
  now: number,
): { alias: AliasDto; created: boolean } {
  const row = getItemRow(db, actor.householdId, itemId);
  const aliasNorm = normalizeName(input.alias);

  if (aliasNorm === row.name_norm) {
    throw httpError(400, 'VALIDATION_FAILED', 'Alias matches the item name.');
  }

  const own = db
    .prepare('SELECT id FROM item_aliases WHERE item_id = ? AND alias_norm = ?')
    .get(row.id, aliasNorm) as { id: string } | undefined;
  if (own !== undefined) {
    return { alias: aliasDtoById(db, own.id), created: false };
  }

  const nameCollision = db
    .prepare(
      'SELECT id, name FROM items WHERE household_id = ? AND name_norm = ? AND id != ? AND deleted_at IS NULL',
    )
    .get(actor.householdId, aliasNorm, row.id) as { id: string; name: string } | undefined;
  const aliasCollision = nameCollision === undefined
    ? (db
        .prepare(
          `SELECT i.id, i.name FROM item_aliases a JOIN items i ON i.id = a.item_id
           WHERE i.household_id = ? AND a.alias_norm = ? AND i.id != ? AND i.deleted_at IS NULL`,
        )
        .get(actor.householdId, aliasNorm, row.id) as { id: string; name: string } | undefined)
    : undefined;
  const collision = nameCollision ?? aliasCollision;
  if (collision !== undefined) {
    throw httpError(409, 'ITEM_NEAR_DUPLICATE', 'A very similar item already exists.', {
      suggestions: [{ id: collision.id, name: collision.name, score: 1 }],
    });
  }

  ensureAlias(db, row.id, input.alias, aliasNorm, input.lang, now);
  const created = db
    .prepare('SELECT id FROM item_aliases WHERE item_id = ? AND alias_norm = ?')
    .get(row.id, aliasNorm) as { id: string };
  return { alias: aliasDtoById(db, created.id), created: true };
}

function aliasDtoById(db: Database.Database, id: string): AliasDto {
  const row = db.prepare('SELECT id, alias, lang FROM item_aliases WHERE id = ?').get(id) as {
    id: string;
    alias: string;
    lang: string;
  };
  return {
    id: row.id,
    alias: row.alias,
    lang: row.lang as AliasDto['lang'],
  };
}

/** DELETE /items/:id/aliases/:aliasId — hard row delete (item_aliases has no
 * deleted_at; ADR-0003). Trivially re-addable, UI confirms first. */
export function deleteAlias(
  db: Database.Database,
  actor: ActorContext,
  itemId: string,
  aliasId: string,
  now: number,
): { deleted: boolean } {
  const row = getItemRow(db, actor.householdId, itemId);
  const alias = db
    .prepare('SELECT id FROM item_aliases WHERE id = ? AND item_id = ?')
    .get(aliasId, row.id);
  if (alias === undefined) {
    throw httpError(404, 'NOT_FOUND', `Alias ${aliasId} not found`);
  }
  db.prepare('DELETE FROM item_aliases WHERE id = ?').run(aliasId);
  appendChange(db, { entity: 'alias', entityId: aliasId, op: 'delete', actorId: actor.memberId }, now);
  return { deleted: true };
}

/** POST /items/merge — moves list rows, stats and aliases to the target, then
 * soft-deletes the source. One transaction; G3.5. */
export function mergeItems(
  db: Database.Database,
  actor: ActorContext,
  input: MergeItemsRequest,
  now: number,
): { item: ReturnType<typeof toItemDto> } {
  if (input.sourceId === input.targetId) {
    throw httpError(400, 'VALIDATION_FAILED', 'Cannot merge an item into itself.');
  }
  const source = getItemRow(db, actor.householdId, input.sourceId);
  const target = getItemRow(db, actor.householdId, input.targetId);

  const run = db.transaction(() => {
    // List rows move wholesale (active, bought and cleared — cleared is
    // history and must keep pointing at a real item).
    db.prepare(
      'UPDATE list_items SET item_id = ?, updated_at = ? WHERE item_id = ?',
    ).run(target.id, now, source.id);

    // Stats fold into the target's per-store rows (INV-8: times_added only
    // increases); a source-only store row moves across.
    const sourceStats = db
      .prepare(
        'SELECT store_id, times_added, last_added_at, default_category_id FROM item_store_stats WHERE item_id = ?',
      )
      .all(source.id) as Array<{
      store_id: string;
      times_added: number;
      last_added_at: number | null;
      default_category_id: string | null;
    }>;
    for (const s of sourceStats) {
      db.prepare(
        `INSERT INTO item_store_stats (item_id, store_id, times_added, last_added_at, default_category_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(item_id, store_id) DO UPDATE SET
           times_added = times_added + excluded.times_added,
           last_added_at = CASE
             WHEN item_store_stats.last_added_at IS NULL THEN excluded.last_added_at
             WHEN excluded.last_added_at IS NULL THEN item_store_stats.last_added_at
             ELSE MAX(item_store_stats.last_added_at, excluded.last_added_at)
           END,
           default_category_id = COALESCE(item_store_stats.default_category_id, excluded.default_category_id)`,
      ).run(target.id, s.store_id, s.times_added, s.last_added_at, s.default_category_id);
    }
    db.prepare('DELETE FROM item_store_stats WHERE item_id = ?').run(source.id);

    // Aliases move to the target; ones the target already has are dropped
    // (they resolve to the target anyway). The source's display name becomes
    // a target alias so past names stay searchable (source: 'merge').
    const sourceAliases = db
      .prepare('SELECT id, alias, alias_norm, lang, source FROM item_aliases WHERE item_id = ?')
      .all(source.id) as Array<{
      id: string;
      alias: string;
      alias_norm: string;
      lang: string;
      source: string;
    }>;
    const targetAliasNorms = new Set(
      (
        db
          .prepare('SELECT alias_norm FROM item_aliases WHERE item_id = ?')
          .all(target.id) as Array<{ alias_norm: string }>
      ).map((a) => a.alias_norm),
    );
    targetAliasNorms.add(target.name_norm);
    for (const a of sourceAliases) {
      if (targetAliasNorms.has(a.alias_norm)) {
        db.prepare('DELETE FROM item_aliases WHERE id = ?').run(a.id);
        appendChange(db, { entity: 'alias', entityId: a.id, op: 'delete', actorId: actor.memberId }, now);
      } else {
        db.prepare('UPDATE item_aliases SET item_id = ? WHERE id = ?').run(target.id, a.id);
        targetAliasNorms.add(a.alias_norm);
        appendChange(db, { entity: 'alias', entityId: a.id, op: 'update', actorId: actor.memberId }, now);
      }
    }
    if (source.name_norm !== target.name_norm && !targetAliasNorms.has(source.name_norm)) {
      // 'user' is the closest allowed source (§5.2 CHECK): the merge was a
      // user action, and the alias behaves exactly like a user-added one.
      ensureAlias(db, target.id, source.name, source.name_norm, deriveLang(source.name), now);
    }

    db.prepare('UPDATE items SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, source.id);
    appendChange(db, { entity: 'item', entityId: target.id, op: 'update', actorId: actor.memberId }, now);
    appendChange(db, { entity: 'item', entityId: source.id, op: 'delete', actorId: actor.memberId }, now);
  });
  run();

  return itemResponse(db, getItemRow(db, actor.householdId, target.id));
}

/** Insert an alias row when its norm is new for the item. Returns created. */
function ensureAlias(
  db: Database.Database,
  itemId: string,
  alias: string,
  aliasNorm: string,
  lang: 'en' | 'hi-Latn' | 'hi',
  now: number,
): boolean {
  const existing = db
    .prepare('SELECT id FROM item_aliases WHERE item_id = ? AND alias_norm = ?')
    .get(itemId, aliasNorm);
  if (existing !== undefined) return false;
  const id = newUuidV7(now);
  db.prepare(
    `INSERT INTO item_aliases (id, item_id, alias, alias_norm, search_key, lang, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'user', ?)`,
  ).run(id, itemId, alias, aliasNorm, fold(alias), lang, now);
  appendChange(db, { entity: 'alias', entityId: id, op: 'create', actorId: null }, now);
  return true;
}

const DEVANAGARI = /[\u0900-\u097F]/;

/** Language inference for aliases derived from names, not user-chosen. */
function deriveLang(name: string): 'en' | 'hi-Latn' | 'hi' {
  return DEVANAGARI.test(name) ? 'hi' : 'en';
}
