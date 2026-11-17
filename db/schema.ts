import { sql } from 'drizzle-orm';
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const households = sqliteTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  passcodeHash: text('passcode_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const members = sqliteTable('members', {
  id: text('id').primaryKey(),
  householdId: text('household_id')
    .notNull()
    .references(() => households.id),
  displayName: text('display_name').notNull(),
  color: text('color').notNull(),
  pinHash: text('pin_hash'),
  createdAt: integer('created_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export const stores = sqliteTable(
  'stores',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    name: text('name').notNull(),
    nameNorm: text('name_norm').notNull(),
    iconKind: text('icon_kind').notNull().default('emoji'),
    iconRef: text('icon_ref'),
    status: text('status').notNull().default('active'),
    categoryOrderJson: text('category_order_json').notNull().default('[]'),
    sortOrder: integer('sort_order').notNull().default(0),
    notes: text('notes'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('ux_stores_household_name').on(t.householdId, t.nameNorm),
    index('idx_stores_status').on(t.householdId, t.status, t.sortOrder).where(sql`deleted_at IS NULL`),
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').references(() => households.id),
    name: text('name').notNull(),
    nameNorm: text('name_norm').notNull(),
    scope: text('scope').notNull(),
    icon: text('icon'),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    isSeed: integer('is_seed').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('idx_categories_scope_sort').on(t.scope, t.sortOrder)],
);

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    name: text('name').notNull(),
    nameNorm: text('name_norm').notNull(),
    defaultCategoryId: text('default_category_id').references(() => categories.id),
    defaultUnitCode: text('default_unit_code'),
    defaultQty: real('default_qty'),
    iconKind: text('icon_kind').notNull().default('emoji'),
    iconRef: text('icon_ref'),
    attrsJson: text('attrs_json').notNull().default('{}'),
    clusterId: text('cluster_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('ux_items_household_name').on(t.householdId, t.nameNorm),
    index('idx_items_category').on(t.defaultCategoryId).where(sql`deleted_at IS NULL`),
  ],
);

export const itemAliases = sqliteTable(
  'item_aliases',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    aliasNorm: text('alias_norm').notNull(),
    searchKey: text('search_key').notNull(),
    lang: text('lang').notNull(),
    source: text('source').notNull().default('user'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('ux_aliases_item_norm').on(t.itemId, t.aliasNorm),
    index('idx_aliases_search').on(t.searchKey),
  ],
);

export const itemStoreStats = sqliteTable(
  'item_store_stats',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    timesAdded: integer('times_added').notNull().default(0),
    lastAddedAt: integer('last_added_at'),
    defaultCategoryId: text('default_category_id').references(() => categories.id),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.storeId] })],
);

export const listItems = sqliteTable(
  'list_items',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id'),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    qtyValue: real('qty_value'),
    unitCode: text('unit_code'),
    categoryId: text('category_id').references(() => categories.id),
    note: text('note'),
    status: text('status').notNull().default('active'),
    checkedAt: integer('checked_at'),
    checkedBy: text('checked_by').references(() => members.id),
    addedBy: text('added_by').references(() => members.id),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('ux_list_client').on(t.clientId).where(sql`client_id IS NOT NULL`),
    index('idx_list_store_status').on(t.storeId, t.status),
    index('idx_list_item').on(t.itemId),
  ],
);

export const changeLog = sqliteTable(
  'change_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    op: text('op').notNull(),
    storeId: text('store_id'),
    payloadJson: text('payload_json').notNull(),
    actorId: text('actor_id'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_change_created').on(t.createdAt)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (t) => [index('idx_sessions_member').on(t.memberId), index('idx_sessions_expires').on(t.expiresAt)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payloadJson: text('payload_json').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    runAfter: integer('run_after'),
    resultJson: text('result_json'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_jobs_pick').on(t.status, t.runAfter)],
);

export const itemEmbeddings = sqliteTable('item_embeddings', {
  itemId: text('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  dim: integer('dim').notNull(),
  vector: blob('vector', { mode: 'buffer' }).notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const itemPairs = sqliteTable(
  'item_pairs',
  {
    aId: text('a_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    bId: text('b_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    coCount: integer('co_count').notNull().default(0),
    lastSeen: integer('last_seen'),
  },
  (t) => [primaryKey({ columns: [t.aId, t.bId] })],
);

export const llmCache = sqliteTable('llm_cache', {
  promptHash: text('prompt_hash').primaryKey(),
  model: text('model').notNull(),
  responseJson: text('response_json').notNull(),
  createdAt: integer('created_at').notNull(),
});
