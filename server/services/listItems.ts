import type Database from 'better-sqlite3';
import { newUuidV7, type PatchListItemRequest } from '@kirana/shared';
import { httpError } from '../plugins/errors.js';
import type { ActorContext } from './actor.js';
import { appendChange } from './changeLog.js';
import { categoryExists } from './categories.js';
import { toListItemDto, type ListItemRow } from './mappers.js';

interface ListRowWithHousehold extends ListItemRow {
  readonly household_id: string;
  readonly checked_at: number | null;
  readonly checked_by: string | null;
}

function fetchRow(db: Database.Database, householdId: string, id: string): ListRowWithHousehold {
  const row = db
    .prepare(
      `SELECT li.id, li.store_id, li.item_id, i.name AS item_name, li.qty_value,
              li.unit_code, li.category_id, li.status, li.note, li.added_by,
              li.updated_at, li.sort_order, li.created_at, li.checked_at, li.checked_by,
              s.household_id
       FROM list_items li
       JOIN items i ON i.id = li.item_id
       JOIN stores s ON s.id = li.store_id
       WHERE li.id = ?`,
    )
    .get(id) as ListRowWithHousehold | undefined;
  if (row === undefined || row.household_id !== householdId) {
    throw httpError(404, 'NOT_FOUND', `List item ${id} not found`);
  }
  return row;
}

/** INV-2: status='bought' ⟺ checked_at IS NOT NULL; 'active' ⟹ checked_at NULL.
 *  'cleared' preserves the original check (rows stay for history, §6.7). */
function resolveCheckFields(
  db: Database.Database,
  row: ListRowWithHousehold,
  patch: PatchListItemRequest,
  actor: ActorContext,
  now: number,
): { status: string; checkedAt: number | null; checkedBy: string | null } {
  if (patch.status === undefined) {
    return { status: row.status, checkedAt: row.checked_at, checkedBy: row.checked_by };
  }
  if (patch.status === 'bought') {
    return { status: patch.status, checkedAt: now, checkedBy: actor.memberId };
  }
  if (patch.status === 'active') {
    return { status: patch.status, checkedAt: null, checkedBy: null };
  }
  const current = db.prepare('SELECT checked_at FROM list_items WHERE id = ?').get(row.id) as {
    checked_at: number | null;
  };
  return { status: patch.status, checkedAt: current.checked_at, checkedBy: row.checked_by };
}

export function patchListItem(
  db: Database.Database,
  actor: ActorContext,
  id: string,
  patch: PatchListItemRequest,
  now: number,
) {
  const row = fetchRow(db, actor.householdId, id);

  if (
    patch.categoryId !== undefined &&
    patch.categoryId !== null &&
    !categoryExists(db, patch.categoryId)
  ) {
    throw httpError(400, 'VALIDATION_FAILED', 'Unknown categoryId');
  }

  const check = resolveCheckFields(db, row, patch, actor, now);

  db.prepare(
    `UPDATE list_items SET qty_value = ?, unit_code = ?, category_id = ?, note = ?,
            status = ?, checked_at = ?, checked_by = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.qtyValue === undefined ? row.qty_value : patch.qtyValue,
    patch.unitCode === undefined ? row.unit_code : patch.unitCode,
    patch.categoryId === undefined ? row.category_id : patch.categoryId,
    patch.note === undefined ? row.note : patch.note,
    check.status,
    check.checkedAt,
    check.checkedBy,
    patch.sortOrder === undefined ? row.sort_order : patch.sortOrder,
    now,
    id,
  );

  appendChange(
    db,
    { entity: 'list_item', entityId: id, op: 'update', storeId: row.store_id, actorId: actor.memberId },
    now,
  );
  return { listItem: toListItemDto(fetchRow(db, actor.householdId, id)) };
}

/** Hard delete of the list row (§7.2 #14). The catalog item is untouched.
 *  undoToken doubles as the clientId for the P2 re-add (idempotent replay). */
export function deleteListItem(db: Database.Database, actor: ActorContext, id: string, now: number) {
  const row = fetchRow(db, actor.householdId, id);
  db.prepare('DELETE FROM list_items WHERE id = ?').run(id);
  appendChange(
    db,
    { entity: 'list_item', entityId: id, op: 'delete', storeId: row.store_id, actorId: actor.memberId },
    now,
  );
  return { undoToken: newUuidV7(now) };
}

export function bulkCheck(
  db: Database.Database,
  actor: ActorContext,
  ids: readonly string[],
  checked: boolean,
  now: number,
) {
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT li.id, li.store_id, li.status, s.household_id
       FROM list_items li JOIN stores s ON s.id = li.store_id
       WHERE li.id IN (${placeholders})`,
    )
    .all(...ids) as Array<{ id: string; store_id: string; status: string; household_id: string }>;

  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id) || rows.find((r) => r.id === id)?.household_id !== actor.householdId);
  if (missing.length > 0) {
    throw httpError(404, 'NOT_FOUND', 'One or more list items not found');
  }

  const target = checked ? 'bought' : 'active';
  const update = db.prepare(
    `UPDATE list_items SET status = ?, checked_at = ?, checked_by = ?, updated_at = ? WHERE id = ?`,
  );
  const log = db.prepare(
    `INSERT INTO change_log (entity, entity_id, op, store_id, payload_json, actor_id, created_at)
     VALUES ('list_item', ?, 'update', ?, '{}', ?, ?)`,
  );

  let updated = 0;
  db.transaction(() => {
    for (const row of rows) {
      if (row.status === target) continue;
      // Undo path: cleared rows return to bought via checked=true (G1.4).
      update.run(
        target,
        checked ? now : null,
        checked ? actor.memberId : null,
        now,
        row.id,
      );
      log.run(row.id, row.store_id, actor.memberId, now);
      updated += 1;
    }
  })();

  return { updated };
}
