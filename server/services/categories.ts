import type Database from 'better-sqlite3';
import { toCategoryDto, type CategoryRow } from './mappers.js';
import type { CategoriesResponse } from '@kirana/shared';

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
