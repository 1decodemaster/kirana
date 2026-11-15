import type Database from 'better-sqlite3';
import { newUuidV7, normalizeName, type CreateStoreRequest, type UpdateStoreRequest } from '@kirana/shared';
import { httpError } from '../plugins/errors.js';
import type { ActorContext } from './actor.js';
import { appendChange } from './changeLog.js';
import { countActiveListItems, fetchStoreListRows } from './listRows.js';
import { fetchCategoryRows } from './categories.js';
import { sortStoreItems } from './board.js';
import { toListItemDto, toStoreDtoWithNotes, type StoreRow } from './mappers.js';

interface StoreDbRow extends StoreRow {
  readonly deleted_at: number | null;
}

function notFound(id: string): never {
  throw httpError(404, 'NOT_FOUND', `Store ${id} not found`);
}

function getStoreRow(db: Database.Database, householdId: string, id: string): StoreDbRow {
  const row = db
    .prepare(
      `SELECT id, name, name_norm, icon_kind, icon_ref, status, category_order_json, sort_order, notes, deleted_at
       FROM stores WHERE id = ? AND household_id = ?`,
    )
    .get(id, householdId) as StoreDbRow | undefined;
  if (row === undefined || row.deleted_at !== null) notFound(id);
  return row;
}

function storeResponse(db: Database.Database, row: StoreRow, householdId: string) {
  const categoryRows = fetchCategoryRows(db, householdId);
  const categoriesById = new Map(
    categoryRows.map((c) => [c.id, { id: c.id, sortOrder: c.sort_order, name: c.name }]),
  );
  const sorted = sortStoreItems(
    fetchStoreListRows(db, row.id),
    parseOrder(row.category_order_json),
    categoriesById,
  );
  return { store: toStoreDtoWithNotes(row, sorted.map(toListItemDto)) };
}

function parseOrder(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

/** The unique index ux_stores_household_name covers soft-deleted rows too,
 *  so a name is "taken" by any row, deleted or not. */
function nameTaken(db: Database.Database, householdId: string, nameNorm: string, excludeId: string): boolean {
  const row = db
    .prepare('SELECT id FROM stores WHERE household_id = ? AND name_norm = ? AND id != ?')
    .get(householdId, nameNorm, excludeId);
  return row !== undefined;
}

export function createStore(db: Database.Database, actor: ActorContext, input: CreateStoreRequest, now: number) {
  const nameNorm = normalizeName(input.name);
  const iconKind = input.iconKind ?? 'emoji';
  const iconRef = input.iconRef ?? null;

  const existing = db
    .prepare('SELECT id, deleted_at FROM stores WHERE household_id = ? AND name_norm = ?')
    .get(actor.householdId, nameNorm) as { id: string; deleted_at: number | null } | undefined;

  if (existing !== undefined && existing.deleted_at === null) {
    throw httpError(409, 'CONFLICT_STALE', 'A store with this name already exists.');
  }

  let storeId: string;
  if (existing !== undefined) {
    // Re-creating a name held by a soft-deleted store revives that row
    // (§7.2 #8 is soft delete; the unique index blocks a second row).
    storeId = existing.id;
    db.prepare(
      `UPDATE stores SET name = ?, name_norm = ?, icon_kind = ?, icon_ref = ?,
              status = 'active', deleted_at = NULL, updated_at = ? WHERE id = ?`,
    ).run(input.name, nameNorm, iconKind, iconRef, now, storeId);
  } else {
    storeId = newUuidV7(now);
    db.prepare(
      `INSERT INTO stores (id, household_id, name, name_norm, icon_kind, icon_ref,
              status, category_order_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', '[]', 0, ?, ?)`,
    ).run(storeId, actor.householdId, input.name, nameNorm, iconKind, iconRef, now, now);
  }
  appendChange(
    db,
    { entity: 'store', entityId: storeId, op: 'create', storeId, actorId: actor.memberId },
    now,
  );
  return storeResponse(db, getStoreRow(db, actor.householdId, storeId), actor.householdId);
}

export function updateStore(
  db: Database.Database,
  actor: ActorContext,
  id: string,
  patch: UpdateStoreRequest,
  now: number,
) {
  const row = getStoreRow(db, actor.householdId, id);

  if (patch.categoryOrder !== undefined) {
    const known = new Set(fetchCategoryRows(db, actor.householdId).map((c) => c.id));
    const unknown = patch.categoryOrder.filter((cid) => !known.has(cid));
    if (unknown.length > 0) {
      throw httpError(400, 'VALIDATION_FAILED', 'categoryOrder contains unknown category ids', {
        unknown,
      });
    }
  }

  if (patch.status !== undefined && patch.status !== row.status) {
    assertStatusTransition(row.status, patch.status);
    if (patch.status === 'done' || patch.status === 'archived') {
      const active = countActiveListItems(db, row.id);
      if (active > 0) {
        throw httpError(409, 'STORE_NOT_EMPTY', 'This store still has items. Clear them first.');
      }
    }
  }

  if (patch.name !== undefined) {
    const nameNorm = normalizeName(patch.name);
    if (nameTaken(db, actor.householdId, nameNorm, row.id)) {
      throw httpError(409, 'CONFLICT_STALE', 'A store with this name already exists.');
    }
  }

  db.prepare(
    `UPDATE stores SET name = ?, name_norm = ?, icon_kind = ?, icon_ref = ?, status = ?,
            category_order_json = ?, sort_order = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.name ?? row.name,
    patch.name === undefined ? row.name_norm : normalizeName(patch.name),
    patch.iconKind ?? row.icon_kind,
    patch.iconRef === undefined ? row.icon_ref : patch.iconRef,
    patch.status ?? row.status,
    patch.categoryOrder === undefined ? row.category_order_json : JSON.stringify(patch.categoryOrder),
    patch.sortOrder ?? row.sort_order,
    patch.notes === undefined ? row.notes : patch.notes,
    now,
    row.id,
  );

  appendChange(db, { entity: 'store', entityId: row.id, op: 'update', storeId: row.id, actorId: actor.memberId }, now);
  return storeResponse(db, getStoreRow(db, actor.householdId, row.id), actor.householdId);
}

function assertStatusTransition(from: string, to: string): void {
  // §4.6: active → done/archived (zero active enforced by the caller),
  // done → archived/active, archived → active. done-from-archived is not a
  // transition.
  if (from === 'archived' && to === 'done') {
    throw httpError(400, 'VALIDATION_FAILED', 'Cannot mark an archived store as done.');
  }
}

export function deleteStore(db: Database.Database, actor: ActorContext, id: string, now: number) {
  const row = getStoreRow(db, actor.householdId, id);
  const active = countActiveListItems(db, row.id);
  if (active > 0) {
    throw httpError(409, 'STORE_NOT_EMPTY', 'This store still has items. Clear them first.');
  }
  db.prepare('UPDATE stores SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
  appendChange(db, { entity: 'store', entityId: row.id, op: 'delete', storeId: row.id, actorId: actor.memberId }, now);
  return { deleted: true };
}

export function clearBought(db: Database.Database, actor: ActorContext, storeId: string, now: number) {
  const row = getStoreRow(db, actor.householdId, storeId);
  const bought = db
    .prepare("SELECT id FROM list_items WHERE store_id = ? AND status = 'bought'")
    .all(row.id) as Array<{ id: string }>;
  if (bought.length > 0) {
    const update = db.prepare(
      "UPDATE list_items SET status = 'cleared', updated_at = ? WHERE id = ? AND status = 'bought'",
    );
    const log = db.prepare(
      `INSERT INTO change_log (entity, entity_id, op, store_id, payload_json, actor_id, created_at)
       VALUES ('list_item', ?, 'update', ?, '{}', ?, ?)`,
    );
    db.transaction(() => {
      for (const item of bought) {
        update.run(now, item.id);
        log.run(item.id, row.id, actor.memberId, now);
      }
    })();
  }
  return { cleared: bought.length };
}

export function markStoreDone(db: Database.Database, actor: ActorContext, storeId: string, now: number) {
  const row = getStoreRow(db, actor.householdId, storeId);
  const active = countActiveListItems(db, row.id);
  if (active > 0) {
    throw httpError(409, 'STORE_NOT_EMPTY', 'All items must be bought before marking done.');
  }
  if (row.status !== 'done') {
    db.prepare("UPDATE stores SET status = 'done', updated_at = ? WHERE id = ?").run(now, row.id);
    appendChange(db, { entity: 'store', entityId: row.id, op: 'update', storeId: row.id, actorId: actor.memberId }, now);
  }
  return storeResponse(db, getStoreRow(db, actor.householdId, row.id), actor.householdId);
}

export function reopenStore(db: Database.Database, actor: ActorContext, storeId: string, now: number) {
  const row = getStoreRow(db, actor.householdId, storeId);
  if (row.status === 'active') {
    throw httpError(400, 'VALIDATION_FAILED', 'Store is not done or archived.');
  }
  db.prepare("UPDATE stores SET status = 'active', updated_at = ? WHERE id = ?").run(now, row.id);
  appendChange(db, { entity: 'store', entityId: row.id, op: 'update', storeId: row.id, actorId: actor.memberId }, now);
  return storeResponse(db, getStoreRow(db, actor.householdId, row.id), actor.householdId);
}
