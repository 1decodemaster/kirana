import type Database from 'better-sqlite3';
import {
  newUuidV7,
  normalizeName,
  type CategoriesResponse,
  type CategoryDto,
  type CreateCategoryRequest,
  type UpdateCategoryRequest,
} from '@kirana/shared';
import { httpError } from '../plugins/errors.js';
import type { ActorContext } from './actor.js';
import { appendChange } from './changeLog.js';
import { toCategoryDto, type CategoryRow } from './mappers.js';

export function fetchCategoryRows(db: Database.Database, householdId: string): CategoryRow[] {
  return db
    .prepare(
      `SELECT id, name, scope, icon, color, sort_order FROM categories
       WHERE deleted_at IS NULL AND (household_id IS NULL OR household_id = ?)
       ORDER BY sort_order, name`,
    )
    .all(householdId) as CategoryRow[];
}

/** Usage counts: active+bought list rows referencing the category (board usage). */
export function categoriesWithUsage(
  db: Database.Database,
  householdId: string,
): CategoriesResponse['categories'] {
  const rows = fetchCategoryRows(db, householdId);
  const counts = db
    .prepare(
      `SELECT li.category_id AS id, COUNT(*) AS n
       FROM list_items li JOIN stores s ON s.id = li.store_id
       WHERE s.household_id = ? AND s.deleted_at IS NULL
         AND li.status IN ('active', 'bought') AND li.category_id IS NOT NULL
       GROUP BY li.category_id`,
    )
    .all(householdId) as Array<{ id: string; n: number }>;
  const countById = new Map(counts.map((c) => [c.id, c.n]));
  return rows.map((row) => ({ ...toCategoryDto(row), itemCount: countById.get(row.id) ?? 0 }));
}

export function categoryExists(db: Database.Database, categoryId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM categories WHERE id = ? AND deleted_at IS NULL')
    .get(categoryId);
  return row !== undefined;
}

/** The §6.5 fallback: the grocery 'Other' row (household-owned first), else
 * null. Kept here so catalog.ts and deleteCategory share one definition. */
export function otherCategoryId(db: Database.Database, householdId: string): string | null {
  const row = db
    .prepare(
      `SELECT id FROM categories
       WHERE name = 'Other' AND scope = 'grocery' AND deleted_at IS NULL AND (household_id IS NULL OR household_id = ?)
       ORDER BY (household_id IS NULL), sort_order LIMIT 1`,
    )
    .get(householdId) as { id: string } | undefined;
  return row?.id ?? null;
}

/** Rows visible to this household: its own plus the global seed rows. */
function getVisibleCategoryRow(
  db: Database.Database,
  householdId: string,
  id: string,
): CategoryRow & { readonly name_norm: string } {
  const row = db
    .prepare(
      `SELECT id, name, name_norm, scope, icon, color, sort_order FROM categories
       WHERE id = ? AND deleted_at IS NULL AND (household_id IS NULL OR household_id = ?)`,
    )
    .get(id, householdId) as (CategoryRow & { readonly name_norm: string }) | undefined;
  if (row === undefined) {
    throw httpError(404, 'NOT_FOUND', `Category ${id} not found`);
  }
  return row;
}

/** Collision rule for ux_categories_name: a household name is taken when a
 * household row (live or soft-deleted — deleted ones are revived, like
 * stores) or a live global seed row holds it in the same scope. A
 * soft-deleted seed row blocks nothing (it is not this household's row). */
function nameCollision(
  db: Database.Database,
  householdId: string,
  scope: string,
  nameNorm: string,
  excludeId?: string,
): { id: string; household_id: string | null; deleted_at: number | null } | undefined {
  const row = db
    .prepare(
      `SELECT id, household_id, deleted_at FROM categories
       WHERE scope = ? AND name_norm = ? AND id != COALESCE(?, '')
         AND (household_id = ? OR (household_id IS NULL AND deleted_at IS NULL))
       ORDER BY (household_id IS NULL) LIMIT 1`,
    )
    .get(scope, nameNorm, excludeId ?? null, householdId) as
    | { id: string; household_id: string | null; deleted_at: number | null }
    | undefined;
  return row;
}

function categoryResponse(db: Database.Database, id: string): { category: CategoryDto } {
  const row = db
    .prepare('SELECT id, name, scope, icon, color, sort_order FROM categories WHERE id = ?')
    .get(id) as CategoryRow;
  return { category: toCategoryDto(row) };
}

/** POST /categories — household-owned rows only; a name colliding with a
 * household row (revived if soft-deleted) or a live seed row is 409. */
export function createCategory(
  db: Database.Database,
  actor: ActorContext,
  input: CreateCategoryRequest,
  now: number,
): { category: CategoryDto } {
  const nameNorm = normalizeName(input.name);
  const collision = nameCollision(db, actor.householdId, input.scope, nameNorm);

  if (collision !== undefined && collision.household_id !== null && collision.deleted_at !== null) {
    // Re-creating a name held by a soft-deleted household row revives it
    // (§7.2 #26 is soft delete; the same name keeps its history).
    db.prepare(
      'UPDATE categories SET name = ?, scope = ?, icon = ?, color = ?, deleted_at = NULL, updated_at = ? WHERE id = ?',
    ).run(input.name, input.scope, input.icon ?? null, input.color ?? null, now, collision.id);
    appendChange(db, { entity: 'category', entityId: collision.id, op: 'update', actorId: actor.memberId }, now);
    return categoryResponse(db, collision.id);
  }
  if (collision !== undefined) {
    throw httpError(409, 'CONFLICT_STALE', 'A category with this name already exists.');
  }

  const maxOrder = (db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -10) AS m FROM categories
       WHERE deleted_at IS NULL AND (household_id IS NULL OR household_id = ?)`,
    )
    .get(actor.householdId) as { m: number }).m;
  const id = newUuidV7(now);
  db.prepare(
    `INSERT INTO categories (id, household_id, name, name_norm, scope, icon, color, sort_order, is_seed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, actor.householdId, input.name, nameNorm, input.scope, input.icon ?? null, input.color ?? null, maxOrder + 10, now, now);
  appendChange(db, { entity: 'category', entityId: id, op: 'create', actorId: actor.memberId }, now);
  return categoryResponse(db, id);
}

/** PATCH /categories/:id — seed rows are editable too: this deployment is
 * single-household, so G3.1's "everything is editable" wins. */
export function updateCategory(
  db: Database.Database,
  actor: ActorContext,
  id: string,
  patch: UpdateCategoryRequest,
  now: number,
): { category: CategoryDto } {
  const row = getVisibleCategoryRow(db, actor.householdId, id);
  const scope = patch.scope ?? row.scope;

  if (patch.name !== undefined) {
    const nameNorm = normalizeName(patch.name);
    if (nameCollision(db, actor.householdId, scope, nameNorm, row.id) !== undefined) {
      throw httpError(409, 'CONFLICT_STALE', 'A category with this name already exists.');
    }
  }

  db.prepare(
    `UPDATE categories SET name = ?, name_norm = ?, scope = ?, icon = ?, color = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.name ?? row.name,
    patch.name === undefined ? normalizeName(row.name) : normalizeName(patch.name),
    scope,
    patch.icon === undefined ? row.icon : patch.icon,
    patch.color === undefined ? row.color : patch.color,
    patch.sortOrder ?? row.sort_order,
    now,
    row.id,
  );
  appendChange(db, { entity: 'category', entityId: row.id, op: 'update', actorId: actor.memberId }, now);
  return categoryResponse(db, row.id);
}

/** DELETE /categories/:id — soft delete; every referencing row (list items,
 * item defaults, per-store stat defaults) reassigns to the §6.5 'Other'
 * fallback, or NULL when no fallback exists. The fallback itself cannot be
 * deleted — it is what #26 reassigns to. */
export function deleteCategory(
  db: Database.Database,
  actor: ActorContext,
  id: string,
  now: number,
): { deleted: boolean } {
  const row = getVisibleCategoryRow(db, actor.householdId, id);
  if (row.name_norm === 'other' && row.scope === 'grocery') {
    throw httpError(409, 'VALIDATION_FAILED', "The 'Other' category is the fallback and cannot be deleted.");
  }
  const fallback = otherCategoryId(db, actor.householdId);

  const reassignList = db.prepare(
    'UPDATE list_items SET category_id = ?, updated_at = ? WHERE category_id = ?',
  );
  const reassignItems = db.prepare(
    'UPDATE items SET default_category_id = ?, updated_at = ? WHERE default_category_id = ?',
  );
  const reassignStats = db.prepare(
    'UPDATE item_store_stats SET default_category_id = ? WHERE default_category_id = ?',
  );
  db.transaction(() => {
    reassignList.run(fallback, now, row.id);
    reassignItems.run(fallback, now, row.id);
    reassignStats.run(fallback, row.id);
    db.prepare('UPDATE categories SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
    appendChange(db, { entity: 'category', entityId: row.id, op: 'delete', actorId: actor.memberId }, now);
  })();
  return { deleted: true };
}
