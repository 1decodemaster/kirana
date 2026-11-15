import type {
  AliasDto,
  CategoryDto,
  CatalogItemDto,
  ItemDto,
  ListItemDto,
  MemberDto,
  StoreCounts,
  StoreDto,
  StoreDtoWithNotes,
} from '@kirana/shared';
import { isUnitCode } from '@kirana/shared';

// Cheap membership guards instead of per-row Zod parses: the board is the hot
// path (G1.2) and these enums are closed sets. Violations are data corruption
// and fail fast (500) rather than being silently coerced.
const LIST_STATUSES: ReadonlySet<string> = new Set(['active', 'bought', 'cleared']);
const STORE_STATUSES: ReadonlySet<string> = new Set(['active', 'done', 'archived']);
const ICON_KINDS: ReadonlySet<string> = new Set(['emoji', 'sprite', 'url', 'none']);
const SCOPES: ReadonlySet<string> = new Set(['grocery', 'household', 'general']);
const LANGS: ReadonlySet<string> = new Set(['en', 'hi-Latn', 'hi']);

function enumValue(set: ReadonlySet<string>, value: string, what: string): string {
  if (!set.has(value)) throw new Error(`corrupt ${what}: ${value}`);
  return value;
}

function unitValue(code: string | null): string | null {
  if (code === null) return null;
  if (!isUnitCode(code)) throw new Error(`corrupt unit_code: ${code}`);
  return code;
}

export interface ListItemRow {
  readonly id: string;
  readonly store_id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly qty_value: number | null;
  readonly unit_code: string | null;
  readonly category_id: string | null;
  readonly status: string;
  readonly note: string | null;
  readonly added_by: string | null;
  readonly updated_at: number;
  readonly sort_order: number;
  readonly created_at: number;
}

export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly scope: string;
  readonly icon: string | null;
  readonly color: string | null;
  readonly sort_order: number;
}

export interface StoreRow {
  readonly id: string;
  readonly name: string;
  readonly name_norm: string;
  readonly icon_kind: string;
  readonly icon_ref: string | null;
  readonly status: string;
  readonly category_order_json: string;
  readonly sort_order: number;
  readonly notes: string | null;
}

export interface MemberRecord {
  readonly id: string;
  readonly displayName: string;
  readonly color: string;
}

export function toListItemDto(row: ListItemRow): ListItemDto {
  return {
    id: row.id,
    itemId: row.item_id,
    name: row.item_name,
    qtyValue: row.qty_value,
    unitCode: unitValue(row.unit_code) as ListItemDto['unitCode'],
    categoryId: row.category_id,
    status: enumValue(LIST_STATUSES, row.status, 'list status') as ListItemDto['status'],
    note: row.note,
    addedBy: row.added_by,
    updatedAt: row.updated_at,
  };
}

export function toCategoryDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    name: row.name,
    scope: enumValue(SCOPES, row.scope, 'category scope') as CategoryDto['scope'],
    icon: row.icon,
    color: row.color,
    sortOrder: row.sort_order,
  };
}

export function toMemberDto(record: MemberRecord): MemberDto {
  return { id: record.id, displayName: record.displayName, color: record.color };
}

export function toStoreCounts(items: readonly { status: string }[]): StoreCounts {
  let bought = 0;
  for (const item of items) {
    if (item.status === 'bought') bought += 1;
  }
  return { total: items.length, bought };
}

export function parseCategoryOrder(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

export function toStoreDto(row: StoreRow, items: readonly ListItemDto[]): StoreDto {
  return {
    id: row.id,
    name: row.name,
    iconKind: enumValue(ICON_KINDS, row.icon_kind, 'store icon_kind') as StoreDto['iconKind'],
    iconRef: row.icon_ref,
    status: enumValue(STORE_STATUSES, row.status, 'store status') as StoreDto['status'],
    categoryOrder: parseCategoryOrder(row.category_order_json),
    sortOrder: row.sort_order,
    counts: toStoreCounts(items),
    items: [...items],
  };
}

export function toStoreDtoWithNotes(row: StoreRow, items: readonly ListItemDto[]): StoreDtoWithNotes {
  return { ...toStoreDto(row, items), notes: row.notes };
}

export interface CatalogStats {
  readonly timesAdded: number;
  readonly lastAddedAt: number | null;
  readonly storeIds: string[];
}

export interface AliasRecord {
  readonly id: string;
  readonly alias: string;
  readonly lang: string;
}

export interface ItemRowFull {
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

export function toItemDto(row: ItemRowFull, aliases: readonly AliasRecord[]): ItemDto {
  let attrs: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.attrs_json);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      attrs = parsed as Record<string, unknown>;
    }
  } catch {
    attrs = {};
  }
  return {
    id: row.id,
    name: row.name,
    norm: row.name_norm,
    defaultCategoryId: row.default_category_id,
    defaultUnitCode: unitValue(row.default_unit_code) as ItemDto['defaultUnitCode'],
    defaultQty: row.default_qty,
    iconKind: enumValue(ICON_KINDS, row.icon_kind, 'item icon_kind') as ItemDto['iconKind'],
    iconRef: row.icon_ref,
    attrs,
    aliases: aliases.map((a) => ({
      id: a.id,
      alias: a.alias,
      lang: enumValue(LANGS, a.lang, 'alias lang') as AliasDto['lang'],
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCatalogItemDto(
  row: {
    readonly id: string;
    readonly name: string;
    readonly name_norm: string;
    readonly default_unit_code: string | null;
    readonly default_category_id: string | null;
    readonly icon_ref: string | null;
  },
  aliases: readonly string[],
  stats?: CatalogStats,
): CatalogItemDto {
  return {
    id: row.id,
    name: row.name,
    norm: row.name_norm,
    aliases: [...aliases],
    defaultUnit: unitValue(row.default_unit_code) as CatalogItemDto['defaultUnit'],
    defaultCategoryId: row.default_category_id,
    iconRef: row.icon_ref,
    ...(stats === undefined ? {} : { stats }),
  };
}
