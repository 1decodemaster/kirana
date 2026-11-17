import type Database from 'better-sqlite3';
import {
  fold,
  hintCategory,
  mergeAddIntoRow,
  newUuidV7,
  normalizeName,
  type ImportCommitResponse,
  type ImportDecision,
  type ImportRowDto,
} from '@kirana/shared';
import { httpError } from '../plugins/errors.js';
import type { ActorContext } from './actor.js';
import { otherCategoryId } from './categories.js';
import { appendChange } from './changeLog.js';
import { inferAliasLang } from './importParse.js';
import { consumePreviewToken, discardPreview, type StoredPreview } from './importToken.js';

/** POST /import/commit — apply the decisions in one transaction; any failure
 * rolls everything back (§9.3). Rows without an explicit decision keep their
 * preview action. The token is consumed only on success. */
export function commitImport(
  db: Database.Database,
  actor: ActorContext,
  secret: string,
  token: string,
  decisions: readonly ImportDecision[],
  now: number,
): ImportCommitResponse {
  const stored = consumePreviewToken(secret, actor.householdId, token, now);
  validateDecisions(db, actor.householdId, stored, decisions);

  const decided = new Map<number, ImportDecision>();
  for (const decision of decisions) decided.set(decision.line, decision);

  let created = 0;
  let merged = 0;
  let skipped = 0;

  const run = db.transaction(() => {
    const stores = new Map<string, string>();
    const categories = new Map<string, string>();

    for (const row of stored.rows) {
      const decision = decided.get(row.line);
      const action = decision?.action ?? row.action;
      if (action === 'skip') {
        skipped += 1;
        continue;
      }
      if (stored.invalidLines.has(row.line)) {
        // Invalid rows cannot be imported; a decision on one is rejected by
        // validateDecisions, so this only guards the default path.
        skipped += 1;
        continue;
      }

      const storeId = ensureStore(db, actor.householdId, row.store, now, stores);
      const categoryId = row.category === null ? null : ensureCategory(db, actor.householdId, row.category, now, categories);

      if (action === 'create') {
        const norm = normalizeName(row.name);
        const existing = db
          .prepare(
            'SELECT id, name, name_norm, default_category_id, default_unit_code, default_qty, icon_kind, icon_ref, attrs_json, created_at, updated_at FROM items WHERE household_id = ? AND name_norm = ? AND deleted_at IS NULL',
          )
          .get(actor.householdId, norm) as { id: string } | undefined;
        if (existing !== undefined) {
          // The preview's target disappeared or a duplicate line changed
          // action: attaching is the merge outcome either way (logged).
          attachListRow(db, actor, storeId, existing.id, categoryId, row, now);
          merged += 1;
          continue;
        }
        const softDeleted = db
          .prepare(
            'SELECT id FROM items WHERE household_id = ? AND name_norm = ? AND deleted_at IS NOT NULL',
          )
          .get(actor.householdId, norm) as { id: string } | undefined;
        let itemId: string;
        if (softDeleted !== undefined) {
          itemId = softDeleted.id;
          db.prepare('UPDATE items SET name = ?, deleted_at = NULL, updated_at = ? WHERE id = ?').run(row.name, now, itemId);
          appendChange(db, { entity: 'item', entityId: itemId, op: 'update', actorId: actor.memberId }, now);
        } else {
          itemId = createImportedItem(db, actor.householdId, row, categoryId, now);
        }
        for (const alias of row.aliases) {
          insertImportAlias(db, itemId, alias, row.name, now);
        }
        created += 1;
        attachListRow(db, actor, storeId, itemId, categoryId, row, now);
        continue;
      }

      // action === 'merge'
      const target = decision?.targetItemId;
      if (target === undefined) {
        throw httpError(400, 'VALIDATION_FAILED', `Line ${row.line}: merge requires targetItemId`);
      }
      attachListRow(db, actor, storeId, target, categoryId, row, now);
      merged += 1;
    }
  });
  run();

  discardPreview(token);
  return { created, merged, skipped };
}

/** Decisions must reference known, valid lines at most once; merges need a
 * live target in this household. */
function validateDecisions(
  db: Database.Database,
  householdId: string,
  stored: StoredPreview,
  decisions: readonly ImportDecision[],
): void {
  const lines = new Map(stored.rows.map((row) => [row.line, row]));
  const seen = new Set<number>();
  for (const decision of decisions) {
    if (seen.has(decision.line)) {
      throw httpError(400, 'VALIDATION_FAILED', `Line ${decision.line} has more than one decision`);
    }
    seen.add(decision.line);
    const row = lines.get(decision.line);
    if (row === undefined) {
      throw httpError(400, 'VALIDATION_FAILED', `Decision references unknown line ${decision.line}`);
    }
    if (stored.invalidLines.has(decision.line)) {
      throw httpError(400, 'VALIDATION_FAILED', `Line ${decision.line} is invalid and cannot be imported`);
    }
    if (decision.action === 'merge') {
      if (decision.targetItemId === undefined) {
        throw httpError(400, 'VALIDATION_FAILED', `Line ${decision.line}: merge requires targetItemId`);
      }
      const target = db
        .prepare('SELECT id FROM items WHERE id = ? AND household_id = ? AND deleted_at IS NULL')
        .get(decision.targetItemId, householdId);
      if (target === undefined) {
        throw httpError(404, 'NOT_FOUND', `Line ${decision.line}: target item not found`);
      }
    }
  }
}

function ensureStore(
  db: Database.Database,
  householdId: string,
  name: string,
  now: number,
  cache: Map<string, string>,
): string {
  const norm = normalizeName(name);
  const cached = cache.get(norm);
  if (cached !== undefined) return cached;

  const existing = db
    .prepare('SELECT id, deleted_at FROM stores WHERE household_id = ? AND name_norm = ?')
    .get(householdId, norm) as { id: string; deleted_at: number | null } | undefined;

  let id: string;
  if (existing !== undefined && existing.deleted_at === null) {
    id = existing.id;
  } else if (existing !== undefined) {
    id = existing.id;
    db.prepare(
      `UPDATE stores SET name = ?, status = 'active', deleted_at = NULL, updated_at = ? WHERE id = ?`,
    ).run(name, now, id);
    appendChange(db, { entity: 'store', entityId: id, op: 'update', storeId: id }, now);
  } else {
    id = newUuidV7(now);
    const maxOrder = (db
      .prepare('SELECT COALESCE(MAX(sort_order), -10) AS m FROM stores WHERE household_id = ? AND deleted_at IS NULL')
      .get(householdId) as { m: number }).m;
    db.prepare(
      `INSERT INTO stores (id, household_id, name, name_norm, icon_kind, icon_ref, status, category_order_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'emoji', '🏬', 'active', '[]', ?, ?, ?)`,
    ).run(id, householdId, name, norm, maxOrder + 10, now, now);
    appendChange(db, { entity: 'store', entityId: id, op: 'create', storeId: id }, now);
  }
  cache.set(norm, id);
  return id;
}

function ensureCategory(
  db: Database.Database,
  householdId: string,
  name: string,
  now: number,
  cache: Map<string, string>,
): string {
  const norm = normalizeName(name);
  const cached = cache.get(norm);
  if (cached !== undefined) return cached;

  const existing = db
    .prepare(
      `SELECT id, household_id, deleted_at FROM categories
       WHERE scope = 'grocery' AND name_norm = ?
         AND (household_id = ? OR (household_id IS NULL AND deleted_at IS NULL))
       ORDER BY (household_id IS NULL) LIMIT 1`,
    )
    .get(norm, householdId) as { id: string; household_id: string | null; deleted_at: number | null } | undefined;

  let id: string;
  if (existing !== undefined && existing.deleted_at === null) {
    id = existing.id;
  } else if (existing !== undefined) {
    // Soft-deleted household row: revive it with the CSV spelling.
    id = existing.id;
    db.prepare(
      'UPDATE categories SET name = ?, deleted_at = NULL, updated_at = ? WHERE id = ?',
    ).run(name, now, id);
    appendChange(db, { entity: 'category', entityId: id, op: 'update', actorId: null }, now);
  } else {
    id = newUuidV7(now);
    const maxOrder = (db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -10) AS m FROM categories
         WHERE deleted_at IS NULL AND (household_id IS NULL OR household_id = ?)`,
      )
      .get(householdId) as { m: number }).m;
    db.prepare(
      `INSERT INTO categories (id, household_id, name, name_norm, scope, icon, color, sort_order, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'grocery', NULL, NULL, ?, 0, ?, ?)`,
    ).run(id, householdId, name, norm, maxOrder + 10, now, now);
    appendChange(db, { entity: 'category', entityId: id, op: 'create', actorId: null }, now);
  }
  cache.set(norm, id);
  return id;
}

function createImportedItem(
  db: Database.Database,
  householdId: string,
  row: ImportRowDto,
  categoryId: string | null,
  now: number,
): string {
  // §6.4 step 5 defaults: explicit category, else hint; icon from the category.
  let resolvedCategoryId = categoryId;
  let iconRef: string | null = null;
  if (resolvedCategoryId !== null) {
    iconRef = (db.prepare('SELECT icon FROM categories WHERE id = ?').get(resolvedCategoryId) as { icon: string | null }).icon;
  } else {
    const hinted = hintCategory(row.name);
    if (hinted !== null) {
      const hintedRow = db
        .prepare(
          `SELECT id, icon FROM categories
           WHERE name = ? AND deleted_at IS NULL AND (household_id IS NULL OR household_id = ?)
           ORDER BY (household_id IS NULL), sort_order LIMIT 1`,
        )
        .get(hinted, householdId) as { id: string; icon: string | null } | undefined;
      if (hintedRow !== undefined) {
        resolvedCategoryId = hintedRow.id;
        iconRef = hintedRow.icon;
      }
    }
  }
  const id = newUuidV7(now);
  db.prepare(
    `INSERT INTO items (id, household_id, name, name_norm, default_category_id, default_unit_code,
            default_qty, icon_kind, icon_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'emoji', ?, ?, ?)`,
  ).run(id, householdId, row.name, normalizeName(row.name), resolvedCategoryId, row.unit, row.qty, iconRef ?? '🛒', now, now);
  appendChange(db, { entity: 'item', entityId: id, op: 'create', storeId: null, actorId: null }, now);
  return id;
}

function insertImportAlias(db: Database.Database, itemId: string, alias: string, itemName: string, now: number): void {
  const aliasNorm = normalizeName(alias);
  if (aliasNorm.length === 0) return;
  const itemNorm = (db.prepare('SELECT name_norm FROM items WHERE id = ?').get(itemId) as { name_norm: string }).name_norm;
  if (aliasNorm === itemNorm) return;
  const existing = db
    .prepare('SELECT id FROM item_aliases WHERE item_id = ? AND alias_norm = ?')
    .get(itemId, aliasNorm);
  if (existing !== undefined) return;
  const id = newUuidV7(now);
  db.prepare(
    `INSERT INTO item_aliases (id, item_id, alias, alias_norm, search_key, lang, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'import', ?)`,
  ).run(id, itemId, alias, aliasNorm, fold(alias), inferAliasLang(alias, itemName), now);
  appendChange(db, { entity: 'alias', entityId: id, op: 'create' }, now);
}

/** The list row + per-store stats bump (INV-8), mirroring finishAdd. */
function attachListRow(
  db: Database.Database,
  actor: ActorContext,
  storeId: string,
  itemId: string,
  categoryId: string | null,
  row: ImportRowDto,
  now: number,
): void {
  // §6.5 resolution: explicit CSV category → item default → hint → Other.
  let resolvedCategoryId = categoryId;
  if (resolvedCategoryId === null) {
    const itemRow = db
      .prepare('SELECT name, default_category_id FROM items WHERE id = ?')
      .get(itemId) as { name: string; default_category_id: string | null } | undefined;
    if (itemRow !== undefined) {
      resolvedCategoryId = itemRow.default_category_id;
      if (resolvedCategoryId === null) {
        const hinted = hintCategory(itemRow.name);
        resolvedCategoryId = hinted === null
          ? otherCategoryId(db, actor.householdId)
          : (db
              .prepare(
                `SELECT id FROM categories
                 WHERE name = ? AND deleted_at IS NULL AND (household_id IS NULL OR household_id = ?)
                 ORDER BY (household_id IS NULL), sort_order LIMIT 1`,
              )
              .get(hinted, actor.householdId) as { id: string } | undefined)?.id ?? otherCategoryId(db, actor.householdId);
      }
    }
  }

  const id = newUuidV7(now);
  const maxOrder = (db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM list_items WHERE store_id = ?')
    .get(storeId) as { m: number }).m;

  // ADR-0007 parity: an import row lands on the store's existing active row
  // for the item when there is one — importing onto a live board must not
  // mint duplicates.
  const existing = db
    .prepare(
      `SELECT id, qty_value, unit_code, category_id, note FROM list_items
       WHERE store_id = ? AND item_id = ? AND status = 'active'
       ORDER BY sort_order, created_at, id LIMIT 1`,
    )
    .get(storeId, itemId) as
    | { id: string; qty_value: number | null; unit_code: string | null; category_id: string | null; note: string | null }
    | undefined;

  if (existing !== undefined) {
    const merged = mergeAddIntoRow(
      {
        qtyValue: existing.qty_value,
        unitCode: existing.unit_code,
        categoryId: existing.category_id,
        note: existing.note,
      },
      {
        clientId: id, // unused by the merge; the add never carries one here
        ...(row.qty !== null ? { qtyValue: row.qty } : {}),
        ...(row.unit !== null ? { unitCode: row.unit } : {}),
        note: row.note,
      },
    );
    db.prepare(
      `UPDATE list_items SET qty_value = ?, unit_code = ?, category_id = ?, note = ?, updated_at = ?
       WHERE id = ?`,
    ).run(merged.qtyValue, merged.unitCode, merged.categoryId, merged.note, now, existing.id);
    appendChange(
      db,
      { entity: 'list_item', entityId: existing.id, op: 'update', storeId, actorId: actor.memberId },
      now,
    );
    return;
  }

  db.prepare(
    `INSERT INTO list_items (id, client_id, store_id, item_id, qty_value, unit_code, category_id,
            note, status, added_by, sort_order, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).run(id, storeId, itemId, row.qty, row.unit, resolvedCategoryId, row.note, actor.memberId, maxOrder + 1, now, now);

  db.prepare(
    `INSERT INTO item_store_stats (item_id, store_id, times_added, last_added_at, default_category_id)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(item_id, store_id) DO UPDATE SET
       times_added = times_added + 1,
       last_added_at = excluded.last_added_at,
       default_category_id = COALESCE(item_store_stats.default_category_id, excluded.default_category_id)`,
  ).run(itemId, storeId, now, resolvedCategoryId);

  appendChange(db, { entity: 'list_item', entityId: id, op: 'create', storeId, actorId: actor.memberId }, now);
}
