import type Database from 'better-sqlite3';
import type { BoardResponse, ListItemDto, StoreDto } from '@kirana/shared';
import { changedStoreIdsSince, currentRevision } from './changeLog.js';
import type { ActorContext } from './actor.js';
import {
  toCatalogItemDto,
  toCategoryDto,
  toListItemDto,
  toMemberDto,
  toStoreDto,
  type CategoryRow,
  type ListItemRow,
  type MemberRecord,
  type StoreRow,
} from './mappers.js';

export const CATALOG_CAP = 5000;

const STATUS_RANK: Readonly<Record<string, number>> = { active: 0, bought: 1, cleared: 2 };

/** §6.8: unchecked first, then checked; within a group by sort_order, then created_at. */
export function compareListItems(a: ListItemRow, b: ListItemRow): number {
  const rank = (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3);
  if (rank !== 0) return rank;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface CategoryMeta {
  readonly id: string;
  readonly sortOrder: number;
  readonly name: string;
}

/**
 * §6.8: categories within a store follow `category_order_json`, else
 * `categories.sort_order`; unknown categories append at the end. Items
 * without a category form the final group.
 */
export function orderCategoryGroups(
  categoryOrder: readonly string[],
  categoriesById: ReadonlyMap<string, CategoryMeta>,
  usedCategoryIds: ReadonlySet<string | null>,
): Array<string | null> {
  const used = (id: string | null): boolean => usedCategoryIds.has(id);
  const ordered: Array<string | null> = [];
  const seen = new Set<string>();
  for (const id of categoryOrder) {
    if (seen.has(id) || !used(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  const rest: CategoryMeta[] = [];
  for (const meta of categoriesById.values()) {
    if (!seen.has(meta.id) && used(meta.id)) rest.push(meta);
  }
  rest.sort((a, b) => a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const meta of rest) ordered.push(meta.id);
  if (used(null)) ordered.push(null);
  return ordered;
}

/** Pure §6.8 sort of a store's rows into their final board order. */
export function sortStoreItems(
  rows: readonly ListItemRow[],
  categoryOrder: readonly string[],
  categoriesById: ReadonlyMap<string, CategoryMeta>,
): ListItemRow[] {
  const byCategory = new Map<string | null, ListItemRow[]>();
  for (const row of rows) {
    const bucket = byCategory.get(row.category_id) ?? [];
    bucket.push(row);
    byCategory.set(row.category_id, bucket);
  }
  const groups = orderCategoryGroups(categoryOrder, categoriesById, new Set(byCategory.keys()));
  const sorted: ListItemRow[] = [];
  for (const categoryId of groups) {
    const bucket = byCategory.get(categoryId);
    if (bucket === undefined) continue;
    bucket.sort(compareListItems);
    sorted.push(...bucket);
  }
  return sorted;
}

export interface BoardOptions {
  readonly since?: number;
  readonly catalogCap?: number;
}

interface HouseholdNameRow {
  readonly name: string;
}

export function buildBoard(
  db: Database.Database,
  actor: ActorContext,
  opts: BoardOptions = {},
): BoardResponse {
  const cap = opts.catalogCap ?? CATALOG_CAP;
  const revision = currentRevision(db);
  const since = opts.since;

  let includeStoreIds: Set<string> | undefined;
  if (since !== undefined && since <= revision) {
    const changed = changedStoreIdsSince(db, since);
    includeStoreIds = changed;
  }

  const householdName = (
    db.prepare('SELECT name FROM households WHERE id = ?').get(actor.householdId) as
      | HouseholdNameRow
      | undefined
  )?.name;
  if (householdName === undefined) {
    throw new Error(`household not found: ${actor.householdId}`);
  }

  const memberRecords = db
    .prepare(
      `SELECT id, display_name AS displayName, color FROM members
       WHERE household_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
    )
    .all(actor.householdId) as unknown as MemberRecord[];

  const categoryRows = db
    .prepare(
      `SELECT id, name, scope, icon, color, sort_order FROM categories
       WHERE deleted_at IS NULL AND (household_id IS NULL OR household_id = ?)
       ORDER BY sort_order, name`,
    )
    .all(actor.householdId) as CategoryRow[];

  const storeRows = (
    db
      .prepare(
        `SELECT id, name, name_norm, icon_kind, icon_ref, status, category_order_json, sort_order, notes
         FROM stores WHERE household_id = ? AND deleted_at IS NULL
         ORDER BY sort_order, created_at, id`,
      )
      .all(actor.householdId) as StoreRow[]
  ).filter((s) => includeStoreIds === undefined || includeStoreIds.has(s.id));

  const listRows =
    includeStoreIds === undefined
      ? (db
          .prepare(
            `SELECT li.id, li.store_id, li.item_id, i.name AS item_name, li.qty_value,
                  li.unit_code, li.category_id, li.status, li.note, li.added_by,
                  li.updated_at, li.sort_order, li.created_at
           FROM list_items li
           JOIN items i ON i.id = li.item_id
           JOIN stores s ON s.id = li.store_id
           WHERE s.household_id = ? AND s.deleted_at IS NULL
             AND li.status IN ('active', 'bought')`,
          )
          .all(actor.householdId) as ListItemRow[])
      : listRowsForStores(db, includeStoreIds);

  const categoriesById = new Map<string, { id: string; sortOrder: number; name: string }>();
  for (const c of categoryRows) {
    categoriesById.set(c.id, { id: c.id, sortOrder: c.sort_order, name: c.name });
  }

  const rowsByStore = new Map<string, ListItemRow[]>();
  for (const row of listRows) {
    const bucket = rowsByStore.get(row.store_id) ?? [];
    bucket.push(row);
    rowsByStore.set(row.store_id, bucket);
  }

  const stores: StoreDto[] = storeRows.map((store) => {
    const rows = sortStoreItems(
      rowsByStore.get(store.id) ?? [],
      parseOrder(store.category_order_json),
      categoriesById,
    );
    const items: ListItemDto[] = rows.map(toListItemDto);
    return toStoreDto(store, items);
  });

  const { catalog, truncated } = buildCatalog(db, actor.householdId, cap);

  const meRecord = memberRecords.find((m) => m.id === actor.memberId);
  if (meRecord === undefined) {
    throw new Error(`member not found in household: ${actor.memberId}`);
  }

  return {
    revision,
    household: { id: actor.householdId, name: householdName },
    me: toMemberDto(meRecord),
    members: memberRecords.map(toMemberDto),
    categories: categoryRows.map(toCategoryDto),
    stores,
    catalog,
    ...(truncated ? { catalogTruncated: true } : {}),
  };
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

function listRowsForStores(db: Database.Database, storeIds: ReadonlySet<string>): ListItemRow[] {
  const ids = [...storeIds];
  if (ids.length === 0) return [];
  const rows: ListItemRow[] = [];
  const statement = db.prepare(
    `SELECT li.id, li.store_id, li.item_id, i.name AS item_name, li.qty_value,
            li.unit_code, li.category_id, li.status, li.note, li.added_by,
            li.updated_at, li.sort_order, li.created_at
     FROM list_items li JOIN items i ON i.id = li.item_id
     WHERE li.store_id = ? AND li.status IN ('active', 'bought')
     ORDER BY li.sort_order, li.created_at, li.id`,
  );
  for (const id of ids) {
    rows.push(...(statement.all(id) as ListItemRow[]));
  }
  return rows;
}

interface CatalogRow {
  readonly id: string;
  readonly name: string;
  readonly name_norm: string;
  readonly default_unit_code: string | null;
  readonly default_category_id: string | null;
  readonly icon_ref: string | null;
}

function buildCatalog(
  db: Database.Database,
  householdId: string,
  cap: number,
): { catalog: BoardResponse['catalog']; truncated: boolean } {
  // Under the cap the whole catalog is sent and no ordering is needed;
  // ordering only matters when truncating (oldest kept).
  const total = (db
    .prepare('SELECT COUNT(*) AS n FROM items WHERE household_id = ? AND deleted_at IS NULL')
    .get(householdId) as { n: number }).n;
  if (total === 0) return { catalog: [], truncated: false };

  const itemRows =
    total <= cap
      ? (db
          .prepare(
            `SELECT id, name, name_norm, default_unit_code, default_category_id, icon_ref
             FROM items WHERE household_id = ? AND deleted_at IS NULL`,
          )
          .all(householdId) as CatalogRow[])
      : (db
          .prepare(
            `SELECT id, name, name_norm, default_unit_code, default_category_id, icon_ref
             FROM items WHERE household_id = ? AND deleted_at IS NULL
             ORDER BY created_at, id LIMIT ?`,
          )
          .all(householdId, cap) as CatalogRow[]);
  if (itemRows.length === 0) return { catalog: [], truncated: false };

  const aliasRows = db
    .prepare(
      `SELECT a.item_id, a.alias FROM item_aliases a
       JOIN items i ON i.id = a.item_id
       WHERE i.household_id = ? AND i.deleted_at IS NULL`,
    )
    .all(householdId) as Array<{ item_id: string; alias: string }>;
  const aliasesByItem = new Map<string, string[]>();
  const selected = new Set(itemRows.map((r) => r.id));
  for (const alias of aliasRows) {
    if (!selected.has(alias.item_id)) continue;
    const bucket = aliasesByItem.get(alias.item_id) ?? [];
    bucket.push(alias.alias);
    aliasesByItem.set(alias.item_id, bucket);
  }
  return {
    catalog: itemRows.map((row) => toCatalogItemDto(row, aliasesByItem.get(row.id) ?? [])),
    truncated: total > cap,
  };
}
