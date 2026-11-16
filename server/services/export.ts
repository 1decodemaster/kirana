import type Database from 'better-sqlite3';
import { exportPayloadSchema, type ExportPayload } from '@kirana/shared';
import { httpError } from '../plugins/errors.js';
import { fetchCategoryRows } from './categories.js';
import { fetchStoreListRows } from './listRows.js';
import {
  toCategoryDto,
  toListItemDto,
  toStoreDtoWithNotes,
  toItemDto,
  type ListItemRow,
  type StoreRow,
} from './mappers.js';
import { stringifyCsv } from './csv.js';

export const EXPORT_SCHEMA_VERSION = 1;

/** GET /export?format=json — the full household dump (§9.4): live categories,
 * stores, items with aliases, and every list row (any status). Validated
 * against the contract on the way out. */
export function exportJson(db: Database.Database, householdId: string, now: number): ExportPayload {
  const household = db.prepare('SELECT id, name FROM households WHERE id = ?').get(householdId) as
    | { id: string; name: string }
    | undefined;
  if (household === undefined) {
    throw httpError(404, 'NOT_FOUND', 'Household not found');
  }

  const categories = fetchCategoryRows(db, householdId).map(toCategoryDto);

  interface StoreDbRow extends StoreRow {
    readonly created_at: number;
  }
  const storeRows = db
    .prepare(
      `SELECT id, name, name_norm, icon_kind, icon_ref, status, category_order_json, sort_order, notes, created_at
       FROM stores WHERE household_id = ? AND deleted_at IS NULL
       ORDER BY sort_order, created_at, id`,
    )
    .all(householdId) as StoreDbRow[];
  const storeIds = storeRows.map((s) => s.id);

  interface ItemDbRow {
    readonly id: string;
    readonly name: string;
    readonly name_norm: string;
    readonly default_category_id: string | null;
    readonly default_unit_code: string | null;
    readonly default_qty: number | null;
    readonly icon_kind: string;
    readonly icon_ref: string | null;
    readonly attrs_json: string;
    readonly created_at: number;
    readonly updated_at: number;
  }
  const itemRows = db
    .prepare(
      `SELECT id, name, name_norm, default_category_id, default_unit_code, default_qty,
              icon_kind, icon_ref, attrs_json, created_at, updated_at
       FROM items WHERE household_id = ? AND deleted_at IS NULL ORDER BY name_norm, id`,
    )
    .all(householdId) as ItemDbRow[];

  const aliasRows = itemRows.length === 0
    ? []
    : (db
        .prepare(
          `SELECT id, item_id, alias, lang FROM item_aliases
           WHERE item_id IN (${itemRows.map(() => '?').join(', ')})
           ORDER BY created_at, id`,
        )
        .all(...itemRows.map((i) => i.id)) as Array<{ id: string; item_id: string; alias: string; lang: string }>);

  const allListRows = storeIds.length === 0
    ? []
    : (db
        .prepare(
          `SELECT li.id, li.store_id, li.item_id, i.name AS item_name, li.qty_value,
                  li.unit_code, li.category_id, li.status, li.note, li.added_by,
                  li.updated_at, li.sort_order, li.created_at
           FROM list_items li JOIN items i ON i.id = li.item_id
           WHERE li.store_id IN (${storeIds.map(() => '?').join(', ')})
           ORDER BY li.store_id, li.sort_order, li.created_at, li.id`,
        )
        .all(...storeIds) as ListItemRow[]);

  const listRowsByStore = new Map<string, ListItemRow[]>();
  for (const row of allListRows) {
    const bucket = listRowsByStore.get(row.store_id) ?? [];
    bucket.push(row);
    listRowsByStore.set(row.store_id, bucket);
  }

  const aliasesByItem = new Map<string, Array<{ id: string; alias: string; lang: string }>>();
  for (const a of aliasRows) {
    const bucket = aliasesByItem.get(a.item_id) ?? [];
    bucket.push({ id: a.id, alias: a.alias, lang: a.lang });
    aliasesByItem.set(a.item_id, bucket);
  }

  return exportPayloadSchema.parse({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: now,
    household: { id: household.id, name: household.name },
    categories,
    stores: storeRows.map((row) =>
      toStoreDtoWithNotes(
        row,
        (listRowsByStore.get(row.id) ?? []).filter(isActiveOrBought).map(toListItemDto),
      ),
    ),
    items: itemRows.map((row) => toItemDto(row, aliasesByItem.get(row.id) ?? [])),
    listItems: allListRows.map((row) => ({ ...toListItemDto(row), storeId: row.store_id })),
  });
}

function isActiveOrBought(row: ListItemRow): boolean {
  return row.status === 'active' || row.status === 'bought';
}

const CSV_HEADER = ['store', 'category', 'name', 'aliases', 'qty', 'unit', 'note'] as const;

export interface CsvExport {
  readonly csv: string;
  readonly filename: string;
}

/** GET /export?format=csv&storeId= — one store's list as §9.1 CSV (round-trips
 * through /import/preview). Only active+bought rows: the CSV has no status
 * column, and re-importing cleared history as active would corrupt it. */
export function exportStoreCsv(db: Database.Database, householdId: string, storeId: string): CsvExport {
  const store = db
    .prepare('SELECT id, name FROM stores WHERE id = ? AND household_id = ? AND deleted_at IS NULL')
    .get(storeId, householdId) as { id: string; name: string } | undefined;
  if (store === undefined) {
    throw httpError(404, 'NOT_FOUND', `Store ${storeId} not found`);
  }

  const rows = fetchStoreListRows(db, storeId).filter(isActiveOrBought);
  const categoryNames = new Map(fetchCategoryRows(db, householdId).map((c) => [c.id, c.name]));

  const aliases = new Map<string, string>();
  if (rows.length > 0) {
    const aliasRows = db
      .prepare(
        `SELECT item_id, alias FROM item_aliases WHERE item_id IN (${rows.map(() => '?').join(', ')}) ORDER BY created_at, id`,
      )
      .all(...rows.map((r) => r.item_id)) as Array<{ item_id: string; alias: string }>;
    for (const a of aliasRows) {
      const current = aliases.get(a.item_id);
      aliases.set(a.item_id, current === undefined ? a.alias : `${current}|${a.alias}`);
    }
  }

  const table: string[][] = [[...CSV_HEADER]];
  for (const row of rows) {
    const category = row.category_id === null ? '' : (categoryNames.get(row.category_id) ?? '');
    table.push([
      store.name,
      category,
      row.item_name,
      aliases.get(row.item_id) ?? '',
      row.qty_value === null ? '' : String(row.qty_value),
      row.unit_code ?? '',
      row.note ?? '',
    ]);
  }

  const slug = store.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'store';
  return { csv: stringifyCsv(table), filename: `kirana-${slug}.csv` };
}
