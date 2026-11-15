import type Database from 'better-sqlite3';
import {
  compareMatches,
  fold,
  ftsPhraseQueries,
  hintCategory,
  newUuidV7,
  normalizeName,
  prepareQuery,
  resolveItem,
  searchScore,
  FUZZY_SUGGESTION_COUNT,
  type AddListItemRequest,
  type AddListItemResponse,
  type CreateItemRequest,
  type GetItemsQuery,
  type GetItemsResponse,
  type ResolveCandidate,
  type SearchCandidate,
  type SearchSignals,
  type SearchResultDto,
} from '@kirana/shared';
import { httpError } from '../plugins/errors.js';
import type { ActorContext } from './actor.js';
import { appendChange } from './changeLog.js';
import { categoryExists, otherCategoryId } from './categories.js';
import { toCatalogItemDto, toItemDto } from './mappers.js';

interface ItemCoreRow {
  readonly id: string;
  readonly name: string;
  readonly name_norm: string;
  readonly default_unit_code: string | null;
  readonly default_category_id: string | null;
  readonly icon_ref: string | null;
}

interface AliasKeyRow {
  readonly item_id: string;
  readonly alias: string;
  readonly alias_norm: string;
  readonly search_key: string;
}

interface StatsRow {
  readonly item_id: string;
  readonly store_id: string;
  readonly times_added: number;
  readonly last_added_at: number | null;
}

const ITEM_CORE_COLUMNS =
  'id, name, name_norm, default_unit_code, default_category_id, icon_ref';

/** fold() memoized per name string — the same name always folds the same way,
 * so entries never go stale. Bounded by the catalog size (≤5,000). */
const foldCache = new Map<string, string>();
function memoFold(name: string): string {
  const cached = foldCache.get(name);
  if (cached !== undefined) return cached;
  const folded = fold(name);
  if (foldCache.size < 10_000) foldCache.set(name, folded);
  return folded;
}

function fetchItemCore(db: Database.Database, id: string): ItemCoreRow | undefined {
  return db
    .prepare(`SELECT ${ITEM_CORE_COLUMNS} FROM items WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as ItemCoreRow | undefined;
}

function aliasesForItems(db: Database.Database, ids: readonly string[]): AliasKeyRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT item_id, alias, alias_norm, search_key FROM item_aliases WHERE item_id IN (${placeholders})`,
    )
    .all(...ids) as AliasKeyRow[];
}

function statsForItems(db: Database.Database, ids: readonly string[]): Map<string, SearchSignals> {
  const map = new Map<string, SearchSignals>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT item_id, store_id, times_added, last_added_at FROM item_store_stats WHERE item_id IN (${placeholders})`,
    )
    .all(...ids) as StatsRow[];
  for (const r of rows) {
    const current = map.get(r.item_id);
    map.set(r.item_id, {
      timesAdded: (current?.timesAdded ?? 0) + r.times_added,
      lastAddedAt: maxNullable(current?.lastAddedAt ?? null, r.last_added_at),
      storeIds: [...(current?.storeIds ?? []), r.store_id],
    });
  }
  return map;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function toCandidate(row: ItemCoreRow, aliases: readonly AliasKeyRow[]): SearchCandidate {
  return {
    nameNorm: row.name_norm,
    nameFold: memoFold(row.name),
    aliasNorms: aliases.map((a) => a.alias_norm),
    aliasFolds: aliases.map((a) => a.search_key),
  };
}

function toSearchResultDto(
  row: ItemCoreRow,
  signals: SearchSignals,
  match: { score: number; quality: number; via: 'name' | 'alias' | 'fuzzy' },
  storeId: string | null,
): SearchResultDto {
  return {
    id: row.id,
    name: row.name,
    norm: row.name_norm,
    defaultUnit: row.default_unit_code as SearchResultDto['defaultUnit'],
    defaultCategoryId: row.default_category_id,
    iconRef: row.icon_ref,
    matchedVia: match.via,
    inStore: storeId !== null && signals.storeIds.includes(storeId),
    score: match.score,
  };
}

const RETRIEVAL_CAP = 5000;

/**
 * GET /items — §8.6 ranking. Candidates come from the SQL tiers (exact name,
 * exact alias, prefix) plus the FTS5 trigram prefilter (ADR-0002); the JS
 * edit-distance tier runs over the whole catalog only when the higher tiers
 * return fewer than `limit` matches, which keeps the top page identical to
 * the client's full-scan index in every result-bearing case.
 */
export function searchItems(
  db: Database.Database,
  householdId: string,
  query: GetItemsQuery,
  now: number,
): GetItemsResponse {
  const limit = query.limit ?? 20;
  const offset = parseCursor(query.cursor);
  const storeId = query.storeId ?? null;

  const q = query.q?.trim() ?? '';
  if (q.length === 0) {
    return browse(db, householdId, query, limit, offset, storeId);
  }

  const prepared = prepareQuery(q);
  const ids = new Set<string>();

  const exact = db
    .prepare(
      `SELECT ${ITEM_CORE_COLUMNS} FROM items
       WHERE household_id = ? AND name_norm = ? AND deleted_at IS NULL`,
    )
    .all(householdId, prepared.norm) as ItemCoreRow[];
  for (const row of exact) ids.add(row.id);

  const aliasExact = db
    .prepare(
      `SELECT i.id, i.name, i.name_norm, i.default_unit_code, i.default_category_id, i.icon_ref
       FROM items i JOIN item_aliases a ON a.item_id = i.id
       WHERE i.household_id = ? AND a.alias_norm = ? AND i.deleted_at IS NULL`,
    )
    .all(householdId, prepared.norm) as ItemCoreRow[];
  for (const row of aliasExact) ids.add(row.id);

  if (prepared.norm.length > 0) {
    const prefix = db
      .prepare(
        `SELECT ${ITEM_CORE_COLUMNS} FROM items
         WHERE household_id = ? AND deleted_at IS NULL AND name_norm LIKE ? || '%'`,
      )
      .all(householdId, prepared.norm) as ItemCoreRow[];
    for (const row of prefix) ids.add(row.id);

    const aliasPrefix = db
      .prepare(
        `SELECT i.id, i.name, i.name_norm, i.default_unit_code, i.default_category_id, i.icon_ref
         FROM items i JOIN item_aliases a ON a.item_id = i.id
         WHERE i.household_id = ? AND i.deleted_at IS NULL AND a.alias_norm LIKE ? || '%'`,
      )
      .all(householdId, prepared.norm) as ItemCoreRow[];
    for (const row of aliasPrefix) ids.add(row.id);
  }

  const fts = ftsPhraseQueries(q);
  const ftsStatement = db.prepare(
    'SELECT item_id FROM item_search WHERE keys MATCH ? LIMIT ?',
  );
  for (const match of [fts.norm, fts.folded]) {
    if (match === null) continue;
    const rows = ftsStatement.all(match, RETRIEVAL_CAP) as Array<{ item_id: string }>;
    for (const r of rows) {
      // FTS may reference soft-deleted items; existence is re-checked on load.
      ids.add(r.item_id);
    }
  }

  const coreRows = loadCoreRows(db, householdId, [...ids]);
  const scored = scoreAndSort(db, coreRows, prepared, householdId, storeId, now);

  if (scored.length < limit) {
    // The edit-distance tier over the full catalog: an exact-ish typo matches
    // no trigram and no prefix, so only a full scan can find it.
    const all = db
      .prepare(
        `SELECT ${ITEM_CORE_COLUMNS} FROM items WHERE household_id = ? AND deleted_at IS NULL`,
      )
      .all(householdId) as ItemCoreRow[];
    const known = new Set(scored.map((s) => s.row.id));
    const extra = all.filter((r) => !known.has(r.id));
    const fuzzyScored = scoreAndSort(db, extra, prepared, householdId, storeId, now, true);
    scored.push(...fuzzyScored);
  }

  const filtered = scored.filter((s) => {
    if (query.categoryId !== undefined && s.row.default_category_id !== query.categoryId) return false;
    return true;
  });

  const page = filtered.slice(offset, offset + limit);
  return {
    items: page.map((s) =>
      toSearchResultDto(s.row, s.signals, { score: s.score, quality: s.quality, via: s.via }, storeId),
    ),
    ...(offset + limit < filtered.length ? { nextCursor: String(offset + limit) } : {}),
  };
}

function browse(
  db: Database.Database,
  householdId: string,
  query: GetItemsQuery,
  limit: number,
  offset: number,
  storeId: string | null,
): GetItemsResponse {
  const rows = (
    query.categoryId !== undefined
      ? db
          .prepare(
            `SELECT ${ITEM_CORE_COLUMNS} FROM items
             WHERE household_id = ? AND deleted_at IS NULL AND default_category_id = ?
             ORDER BY name_norm, id LIMIT ? OFFSET ?`,
          )
          .all(householdId, query.categoryId, limit, offset)
      : db
          .prepare(
            `SELECT ${ITEM_CORE_COLUMNS} FROM items
             WHERE household_id = ? AND deleted_at IS NULL
             ORDER BY name_norm, id LIMIT ? OFFSET ?`,
          )
          .all(householdId, limit, offset)
  ) as ItemCoreRow[];

  const total = (db
    .prepare(
      query.categoryId !== undefined
        ? 'SELECT COUNT(*) AS n FROM items WHERE household_id = ? AND deleted_at IS NULL AND default_category_id = ?'
        : 'SELECT COUNT(*) AS n FROM items WHERE household_id = ? AND deleted_at IS NULL',
    )
    .get(...(query.categoryId !== undefined ? [householdId, query.categoryId] : [householdId])) as {
    n: number;
  }).n;

  const stats = statsForItems(db, rows.map((r) => r.id));
  return {
    items: rows.map((row) => {
      const signals = stats.get(row.id) ?? { timesAdded: 0, lastAddedAt: null, storeIds: [] };
      return toSearchResultDto(row, signals, { score: 0, quality: 0, via: 'name' }, storeId);
    }),
    ...(offset + limit < total ? { nextCursor: String(offset + limit) } : {}),
  };
}

interface ScoredRow {
  readonly row: ItemCoreRow;
  readonly signals: SearchSignals;
  readonly score: number;
  readonly quality: number;
  readonly via: 'name' | 'alias' | 'fuzzy';
}

const ID_CHUNK = 500;

function loadCoreRows(db: Database.Database, householdId: string, ids: readonly string[]): ItemCoreRow[] {
  const rows: ItemCoreRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    rows.push(
      ...(db
        .prepare(
          `SELECT ${ITEM_CORE_COLUMNS} FROM items WHERE household_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`,
        )
        .all(householdId, ...chunk) as ItemCoreRow[]),
    );
  }
  return rows;
}

function scoreAndSort(
  db: Database.Database,
  rows: readonly ItemCoreRow[],
  prepared: ReturnType<typeof prepareQuery>,
  householdId: string,
  storeId: string | null,
  now: number,
  fuzzyOnly = false,
): ScoredRow[] {
  if (rows.length === 0) return [];
  const aliases = aliasesForItems(db, rows.map((r) => r.id));
  const aliasesByItem = new Map<string, AliasKeyRow[]>();
  for (const a of aliases) {
    const bucket = aliasesByItem.get(a.item_id) ?? [];
    bucket.push(a);
    aliasesByItem.set(a.item_id, bucket);
  }
  const stats = statsForItems(db, rows.map((r) => r.id));

  const scored: ScoredRow[] = [];
  for (const row of rows) {
    const signals = stats.get(row.id) ?? { timesAdded: 0, lastAddedAt: null, storeIds: [] };
    const match = searchScore(
      prepared,
      toCandidate(row, aliasesByItem.get(row.id) ?? []),
      signals,
      storeId,
      now,
    );
    if (match === null) continue;
    if (fuzzyOnly && match.via !== 'fuzzy') continue;
    scored.push({ row, signals, score: match.score, quality: match.quality, via: match.via });
  }
  scored.sort((a, b) =>
    compareMatches(
      { score: a.score, quality: a.quality, nameNorm: a.row.name_norm, id: a.row.id },
      { score: b.score, quality: b.quality, nameNorm: b.row.name_norm, id: b.row.id },
    ),
  );
  return scored;
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const value = Number(cursor);
  if (!Number.isInteger(value) || value < 0) {
    throw httpError(400, 'VALIDATION_FAILED', 'Invalid cursor');
  }
  return value;
}

/** Top fuzzy candidates for the §6.4 near-duplicate guard: the full catalog,
 * ranked by the §8.6 score, capped at FUZZY_SUGGESTION_COUNT. */
function topFuzzyCandidates(
  db: Database.Database,
  householdId: string,
  name: string,
  storeId: string,
  now: number,
): ResolveCandidate[] {
  const prepared = prepareQuery(name);
  const rows = db
    .prepare(
      `SELECT ${ITEM_CORE_COLUMNS} FROM items WHERE household_id = ? AND deleted_at IS NULL`,
    )
    .all(householdId) as ItemCoreRow[];
  const scored = scoreAndSort(db, rows, prepared, householdId, storeId, now);
  return scored.slice(0, FUZZY_SUGGESTION_COUNT).map((s) => ({
    id: s.row.id,
    name: s.row.name,
    score: s.score,
  }));
}

interface StoreExistenceRow {
  readonly id: string;
  readonly deleted_at: number | null;
}

function getActiveStore(db: Database.Database, householdId: string, storeId: string): void {
  const row = db
    .prepare('SELECT id, deleted_at FROM stores WHERE id = ? AND household_id = ?')
    .get(storeId, householdId) as StoreExistenceRow | undefined;
  if (row === undefined || row.deleted_at !== null) {
    throw httpError(404, 'NOT_FOUND', `Store ${storeId} not found`);
  }
}

const DEVANAGARI = /[\u0900-\u097F]/;

/** POST /stores/:id/items — §6.4 upsert + §7.4 contract. Returns the body and
 * whether this was an idempotent replay (200) or a fresh add (201). */
export function addListItem(
  db: Database.Database,
  actor: ActorContext,
  storeId: string,
  input: AddListItemRequest,
  now: number,
): { body: AddListItemResponse; replayed: boolean } {
  getActiveStore(db, actor.householdId, storeId);

  // §7.4 idempotency: replaying a clientId returns the original row.
  const replay = db
    .prepare(
      `SELECT li.id, li.store_id, li.item_id, li.qty_value, li.unit_code, li.category_id,
              li.status, li.note, li.added_by, li.updated_at, i.name AS item_name
       FROM list_items li JOIN items i ON i.id = li.item_id
       WHERE li.client_id = ?`,
    )
    .get(input.clientId) as
    | {
        id: string;
        store_id: string;
        item_id: string;
        qty_value: number | null;
        unit_code: string | null;
        category_id: string | null;
        status: string;
        note: string | null;
        added_by: string | null;
        updated_at: number;
        item_name: string;
      }
    | undefined;
  if (replay !== undefined) {
    const itemRow = fetchItemCore(db, replay.item_id);
    if (itemRow === undefined) throw httpError(500, 'INTERNAL', 'Replayed list row has no item');
    return {
      replayed: true,
      body: {
        listItem: {
          id: replay.id,
          itemId: replay.item_id,
          name: replay.item_name,
          qtyValue: replay.qty_value,
          unitCode: replay.unit_code as AddListItemResponse['listItem']['unitCode'],
          categoryId: replay.category_id,
          status: replay.status as AddListItemResponse['listItem']['status'],
          note: replay.note,
          addedBy: replay.added_by,
          updatedAt: replay.updated_at,
        },
        item: toCatalogItemDto(itemRow, aliasDisplayNames(db, itemRow.id)),
        createdItem: false,
        createdAlias: false,
      },
    };
  }

  if (input.itemId !== undefined) {
    const itemRow = fetchItemCore(db, input.itemId);
    if (itemRow === undefined) {
      throw httpError(404, 'NOT_FOUND', `Catalog item ${input.itemId} not found`);
    }
    return finishAdd(db, actor, storeId, itemRow, input, now, false, false);
  }

  const name = input.name;
  if (name === undefined) {
    throw httpError(400, 'VALIDATION_FAILED', 'name is required when itemId is absent');
  }
  const norm = normalizeName(name);

  const exact = db
    .prepare(
      `SELECT ${ITEM_CORE_COLUMNS} FROM items
       WHERE household_id = ? AND name_norm = ? AND deleted_at IS NULL`,
    )
    .get(actor.householdId, norm) as ItemCoreRow | undefined;

  const aliasHit = exact === undefined
    ? (db
        .prepare(
          `SELECT i.id, i.name, i.name_norm, i.default_unit_code, i.default_category_id, i.icon_ref
           FROM items i JOIN item_aliases a ON a.item_id = i.id
           WHERE i.household_id = ? AND a.alias_norm = ? AND i.deleted_at IS NULL`,
        )
        .get(actor.householdId, norm) as ItemCoreRow | undefined)
    : undefined;

  let itemRow: ItemCoreRow;
  let createdItem = false;
  let createdAlias = false;

  if (exact !== undefined || aliasHit !== undefined) {
    itemRow = (exact ?? aliasHit) as ItemCoreRow;
  } else {
    const fuzzyTop = topFuzzyCandidates(db, actor.householdId, name, storeId, now);
    const decision = resolveItem(null, null, fuzzyTop);
    if (decision.kind === 'near-duplicate') {
      throw httpError(409, 'ITEM_NEAR_DUPLICATE', 'You already have a very similar item.', {
        suggestions: decision.suggestions,
      });
    }
    // 'create' — but a soft-deleted row holds the name_norm (INV-5 index covers
    // deleted rows): revive it like P1 revives store names.
    const deleted = db
      .prepare(
        `SELECT ${ITEM_CORE_COLUMNS} FROM items WHERE household_id = ? AND name_norm = ? AND deleted_at IS NOT NULL`,
      )
      .get(actor.householdId, norm) as ItemCoreRow | undefined;
    if (deleted !== undefined) {
      db.prepare('UPDATE items SET name = ?, deleted_at = NULL, updated_at = ? WHERE id = ?').run(
        name,
        now,
        deleted.id,
      );
      itemRow = { ...deleted, name };
      createdItem = true;
      createdAlias = ensureAlias(db, itemRow.id, name, norm, now);
    } else {
      const id = createItemRow(db, actor.householdId, name, norm, input, now);
      itemRow = fetchItemCore(db, id) as ItemCoreRow;
      createdItem = true;
      createdAlias = ensureAlias(db, id, name, norm, now);
      appendChange(db, { entity: 'item', entityId: id, op: 'create', storeId, actorId: actor.memberId }, now);
    }
  }

  return finishAdd(db, actor, storeId, itemRow, input, now, createdItem, createdAlias);
}

function aliasDisplayNames(db: Database.Database, itemId: string): string[] {
  return (
    db.prepare('SELECT alias FROM item_aliases WHERE item_id = ?').all(itemId) as Array<{
      alias: string;
    }>
  ).map((r) => r.alias);
}

function ensureAlias(
  db: Database.Database,
  itemId: string,
  alias: string,
  aliasNorm: string,
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
  ).run(id, itemId, alias, aliasNorm, fold(alias), DEVANAGARI.test(alias) ? 'hi' : 'en', now);
  appendChange(db, { entity: 'alias', entityId: id, op: 'create' }, now);
  return true;
}

function createItemRow(
  db: Database.Database,
  householdId: string,
  name: string,
  norm: string,
  input: AddListItemRequest,
  now: number,
): string {
  // §6.4 step 5 defaults: category from hints, icon from the category row.
  const hinted = hintCategory(name);
  const categoryRow = hinted === null
    ? undefined
    : (db
        .prepare(
          `SELECT id, icon FROM categories
           WHERE name = ? AND deleted_at IS NULL AND (household_id IS NULL OR household_id = ?)
           ORDER BY (household_id IS NULL), sort_order LIMIT 1`,
        )
        .get(hinted, householdId) as { id: string; icon: string | null } | undefined);
  const iconRef = categoryRow?.icon ?? '🛒';
  const id = newUuidV7(now);
  db.prepare(
    `INSERT INTO items (id, household_id, name, name_norm, default_unit_code, default_qty,
            icon_kind, icon_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'emoji', ?, ?, ?)`,
  ).run(id, householdId, name, norm, input.unitCode ?? 'ea', input.qtyValue ?? null, iconRef, now, now);
  return id;
}

/** §6.5 category resolution + the list row + stats bump + write-backs. */
function finishAdd(
  db: Database.Database,
  actor: ActorContext,
  storeId: string,
  itemRow: ItemCoreRow,
  input: AddListItemRequest,
  now: number,
  createdItem: boolean,
  createdAlias: boolean,
): { body: AddListItemResponse; replayed: boolean } {
  if (input.categoryId !== undefined && !categoryExists(db, input.categoryId)) {
    throw httpError(400, 'VALIDATION_FAILED', 'Unknown categoryId');
  }

  const statsRow = db
    .prepare(
      'SELECT default_category_id FROM item_store_stats WHERE item_id = ? AND store_id = ?',
    )
    .get(itemRow.id, storeId) as { default_category_id: string | null } | undefined;

  // §6.5 resolution order.
  let categoryId: string | null;
  if (input.categoryId !== undefined) {
    categoryId = input.categoryId;
  } else if (statsRow !== undefined && statsRow.default_category_id !== null) {
    categoryId = statsRow.default_category_id;
  } else if (itemRow.default_category_id !== null) {
    categoryId = itemRow.default_category_id;
  } else {
    const hinted = hintCategory(itemRow.name);
    categoryId = hinted === null
      ? otherCategoryId(db, actor.householdId)
      : (db
          .prepare(
            `SELECT id FROM categories
             WHERE name = ? AND deleted_at IS NULL AND (household_id IS NULL OR household_id = ?)
             ORDER BY (household_id IS NULL), sort_order LIMIT 1`,
          )
          .get(hinted, actor.householdId) as { id: string } | undefined)?.id ?? otherCategoryId(db, actor.householdId);
  }

  // "Last unit used" (§6.4 step 5): remember the unit this add carried.
  if (input.unitCode !== undefined && input.unitCode !== itemRow.default_unit_code) {
    db.prepare('UPDATE items SET default_unit_code = ?, updated_at = ? WHERE id = ?').run(
      input.unitCode,
      now,
      itemRow.id,
    );
    appendChange(db, { entity: 'item', entityId: itemRow.id, op: 'update', storeId, actorId: actor.memberId }, now);
  }
  if (categoryId !== null && itemRow.default_category_id === null) {
    db.prepare('UPDATE items SET default_category_id = ?, updated_at = ? WHERE id = ?').run(
      categoryId,
      now,
      itemRow.id,
    );
    appendChange(db, { entity: 'item', entityId: itemRow.id, op: 'update', storeId, actorId: actor.memberId }, now);
  }

  const listId = newUuidV7(now);
  const maxOrder = (db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM list_items WHERE store_id = ?')
    .get(storeId) as { m: number }).m;
  db.prepare(
    `INSERT INTO list_items (id, client_id, store_id, item_id, qty_value, unit_code,
            category_id, note, status, added_by, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).run(
    listId,
    input.clientId,
    storeId,
    itemRow.id,
    input.qtyValue ?? null,
    input.unitCode ?? null,
    categoryId,
    input.note ?? null,
    actor.memberId,
    maxOrder + 1,
    now,
    now,
  );

  // INV-8: times_added only increases.
  db.prepare(
    `INSERT INTO item_store_stats (item_id, store_id, times_added, last_added_at, default_category_id)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(item_id, store_id) DO UPDATE SET
       times_added = times_added + 1,
       last_added_at = excluded.last_added_at,
       default_category_id = excluded.default_category_id`,
  ).run(itemRow.id, storeId, now, categoryId);

  appendChange(
    db,
    { entity: 'list_item', entityId: listId, op: 'create', storeId, actorId: actor.memberId },
    now,
  );

  const itemRowAfter = fetchItemCore(db, itemRow.id) as ItemCoreRow;
  return {
    replayed: false,
    body: {
      listItem: {
        id: listId,
        itemId: itemRow.id,
        name: itemRow.name,
        qtyValue: input.qtyValue ?? null,
        unitCode: input.unitCode ?? null,
        categoryId,
        status: 'active',
        note: input.note ?? null,
        addedBy: actor.memberId,
        updatedAt: now,
      },
      item: toCatalogItemDto(itemRowAfter, aliasDisplayNames(db, itemRow.id)),
      createdItem,
      createdAlias,
    },
  };
}

/** POST /items — create a catalog item (the sheet's "Create new anyway"), or
 * return the existing item when the norm already exists (INV-5). */
export function createCatalogItem(
  db: Database.Database,
  actor: ActorContext,
  input: CreateItemRequest,
  now: number,
): { body: { item: ReturnType<typeof toItemDto> }; created: boolean } {
  const norm = normalizeName(input.name);

  if (input.defaultCategoryId !== undefined && !categoryExists(db, input.defaultCategoryId)) {
    throw httpError(400, 'VALIDATION_FAILED', 'Unknown defaultCategoryId');
  }

  const existing = db
    .prepare(
      `SELECT ${ITEM_CORE_COLUMNS} FROM items WHERE household_id = ? AND name_norm = ? AND deleted_at IS NULL`,
    )
    .get(actor.householdId, norm) as ItemCoreRow | undefined;

  let id: string;
  let created = false;
  if (existing !== undefined) {
    id = existing.id;
  } else {
    const softDeleted = db
      .prepare(
        `SELECT ${ITEM_CORE_COLUMNS} FROM items WHERE household_id = ? AND name_norm = ? AND deleted_at IS NOT NULL`,
      )
      .get(actor.householdId, norm) as ItemCoreRow | undefined;
    if (softDeleted !== undefined) {
      id = softDeleted.id;
      db.prepare('UPDATE items SET name = ?, deleted_at = NULL, updated_at = ? WHERE id = ?').run(
        input.name,
        now,
        id,
      );
    } else {
      id = newUuidV7(now);
      const hinted = hintCategory(input.name);
      const categoryRow = input.defaultCategoryId !== undefined
        ? undefined
        : hinted === null
          ? undefined
          : (db
              .prepare(
                `SELECT id, icon FROM categories
                 WHERE name = ? AND deleted_at IS NULL AND (household_id IS NULL OR household_id = ?)
                 ORDER BY (household_id IS NULL), sort_order LIMIT 1`,
              )
              .get(hinted, actor.householdId) as { id: string; icon: string | null } | undefined);
      const iconRef = input.iconRef ?? categoryRow?.icon ?? '🛒';
      db.prepare(
        `INSERT INTO items (id, household_id, name, name_norm, default_category_id,
                default_unit_code, default_qty, icon_kind, icon_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'emoji', ?, ?, ?)`,
      ).run(
        id,
        actor.householdId,
        input.name,
        norm,
        input.defaultCategoryId ?? categoryRow?.id ?? null,
        input.defaultUnitCode ?? null,
        input.defaultQty ?? null,
        iconRef,
        now,
        now,
      );
    }
    created = true;
    appendChange(db, { entity: 'item', entityId: id, op: 'create', actorId: actor.memberId }, now);
  }

  let createdAnyAlias = false;
  for (const alias of input.aliases ?? []) {
    const aliasNorm = normalizeName(alias.alias);
    const inserted = ensureAlias(db, id, alias.alias, aliasNorm, now);
    createdAnyAlias = createdAnyAlias || inserted;
  }
  void createdAnyAlias;

  const row = db
    .prepare(
      `SELECT id, name, name_norm, default_category_id, default_unit_code, default_qty,
              icon_kind, icon_ref, attrs_json, created_at, updated_at
       FROM items WHERE id = ?`,
    )
    .get(id) as Parameters<typeof toItemDto>[0];
  const aliasRecords = db
    .prepare('SELECT id, alias, lang FROM item_aliases WHERE item_id = ?')
    .all(id) as Array<{ id: string; alias: string; lang: string }>;
  return { body: { item: toItemDto(row, aliasRecords) }, created };
}
