import type Database from 'better-sqlite3';
import type { ListItemRow } from './mappers.js';

/** Active + bought rows for one store (cleared rows are history, §6.7). */
export function fetchStoreListRows(db: Database.Database, storeId: string): ListItemRow[] {
  return db
    .prepare(
      `SELECT li.id, li.store_id, li.item_id, i.name AS item_name, li.qty_value,
              li.unit_code, li.category_id, li.status, li.note, li.added_by,
              li.updated_at, li.sort_order, li.created_at
       FROM list_items li JOIN items i ON i.id = li.item_id
       WHERE li.store_id = ? AND li.status IN ('active', 'bought')
       ORDER BY li.sort_order, li.created_at, li.id`,
    )
    .all(storeId) as ListItemRow[];
}

export function countActiveListItems(db: Database.Database, storeId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM list_items WHERE store_id = ? AND status = 'active'")
    .get(storeId) as { n: number };
  return row.n;
}
