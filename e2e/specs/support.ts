import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, seedDemoBoard } from '@kirana/db';
import type { BoardResponse } from '@kirana/shared';

export const COSTCO = 'Costco';

const DB_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'kirana.db');

/** Reset the add-item specs' artifacts so both viewport projects start from
 * the demo state (workers:1 shares one server DB across projects). Deletes
 * the catalog items the specs create and any test-added Milk rows in the
 * Indian Store; the demo Milk item itself stays. */
export function resetAddItemState(): void {
  const db = openDatabase(DB_FILE);
  try {
    db.transaction(() => {
      const artifacts = db
        .prepare(
          "SELECT id FROM items WHERE name_norm IN ('tapioca starch', 'arrowroot flour', 'basmati ric')",
        )
        .all() as Array<{ id: string }>;
      const ids = artifacts.map((r) => r.id);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(', ');
        db.prepare(`DELETE FROM list_items WHERE item_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM item_store_stats WHERE item_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM item_aliases WHERE item_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM item_search WHERE item_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM items WHERE id IN (${placeholders})`).run(...ids);
      }
      db.prepare(
        `DELETE FROM list_items
         WHERE store_id = (SELECT id FROM stores WHERE name_norm = 'indian store')
           AND item_id IN (
             (SELECT id FROM items WHERE name_norm = 'milk'),
             (SELECT id FROM items WHERE name_norm = 'basmati rice')
           )`,
      ).run();
    })();
  } finally {
    db.close();
  }
}

function deleteItemsByIds(
  db: ReturnType<typeof openDatabase>,
  ids: readonly string[],
): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`DELETE FROM list_items WHERE item_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM item_store_stats WHERE item_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM item_aliases WHERE item_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM item_search WHERE item_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM items WHERE id IN (${placeholders})`).run(...ids);
}

/** Remove the import-roundtrip spec's artifacts: the stores it created, every
 *  item named `Import …`, and the household categories import created.
 *  Direct DB access (same pattern as resetAddItemState) — there is no bulk
 *  delete API, and hard deletes keep the demo baseline exact. */
export function removeImportArtifacts(): void {
  const db = openDatabase(DB_FILE);
  try {
    db.transaction(() => {
      const stores = db
        .prepare("SELECT id FROM stores WHERE name IN ('Import Mart', 'Import Bazaar')")
        .all() as Array<{ id: string }>;
      if (stores.length > 0) {
        const placeholders = stores.map(() => '?').join(', ');
        const ids = stores.map((s) => s.id);
        db.prepare(`DELETE FROM list_items WHERE store_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM item_store_stats WHERE store_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM stores WHERE id IN (${placeholders})`).run(...ids);
      }
      const items = db
        .prepare("SELECT id FROM items WHERE name LIKE 'Import %'")
        .all() as Array<{ id: string }>;
      deleteItemsByIds(db, items.map((i) => i.id));
      db.prepare(
        "DELETE FROM categories WHERE household_id IS NOT NULL AND name LIKE 'Import Aisle %'",
      ).run();
    })();
  } finally {
    db.close();
  }
}

/** Remove the merge-items spec's artifacts (source, target, and the rows the
 *  merge moved — they all reference one of the two items). */
export function removeMergeArtifacts(): void {
  const db = openDatabase(DB_FILE);
  try {
    db.transaction(() => {
      const items = db
        .prepare("SELECT id FROM items WHERE name LIKE 'Merge Source %' OR name LIKE 'Merge Target %'")
        .all() as Array<{ id: string }>;
      deleteItemsByIds(db, items.map((i) => i.id));
    })();
  } finally {
    db.close();
  }
}

/** Live catalog item count (soft-deletes excluded). */
export function catalogItemCount(): number {
  const db = openDatabase(DB_FILE);
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM items WHERE deleted_at IS NULL').get() as { n: number }).n;
  } finally {
    db.close();
  }
}

/** Count of live items with an exact display name. */
export function itemCountByName(name: string): number {
  const db = openDatabase(DB_FILE);
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM items WHERE name = ? AND deleted_at IS NULL').get(name) as { n: number }).n;
  } finally {
    db.close();
  }
}

/** §15.3 G3.3 wipe: remove every household-owned row so a JSON import has to
 *  rebuild the board. Households, members, and the global seed categories
 *  (the §6.5 'Other' fallback lives there) survive. item_search is maintained
 *  by its triggers. */
export function wipeHouseholdData(): void {
  const db = openDatabase(DB_FILE);
  try {
    wipeHouseholdDataIn(db);
  } finally {
    db.close();
  }
}

function wipeHouseholdDataIn(db: ReturnType<typeof openDatabase>): void {
  db.transaction(() => {
    db.prepare('DELETE FROM list_items').run();
    db.prepare('DELETE FROM item_store_stats').run();
    db.prepare('DELETE FROM item_aliases').run();
    db.prepare('DELETE FROM item_search').run();
    db.prepare('DELETE FROM items').run();
    db.prepare('DELETE FROM stores').run();
    db.prepare('DELETE FROM categories WHERE household_id IS NOT NULL').run();
  })();
}

/** Back to the canonical demo board after the G3.3 wipe/restore drill. The
 *  import model rebuilds list rows but not the full catalog (seed items with
 *  no list rows have nothing to import from) and re-creates categories with
 *  fresh sort orders, so the specs that follow must start from the seed.
 *  seedDemoBoard is idempotent: it only acts when the household has no
 *  stores, and every insert is INSERT OR IGNORE. */
export async function restoreDemoBoard(): Promise<void> {
  const db = openDatabase(DB_FILE);
  try {
    wipeHouseholdDataIn(db);
    await seedDemoBoard(db, Date.now());
  } finally {
    db.close();
  }
}

export async function boardOf(request: APIRequestContext): Promise<BoardResponse> {
  const res = await request.get('/api/v1/board');
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as BoardResponse;
}

async function bulkCheck(
  request: APIRequestContext,
  ids: readonly string[],
  checked: boolean,
): Promise<void> {
  const res = await request.post('/api/v1/list-items/bulk-check', {
    data: { ids, checked },
    headers: { 'x-requested-with': 'kirana' },
  });
  expect(res.ok()).toBeTruthy();
}

/** Deterministic start for a suite: every Costco row back to active and the
 *  store itself back to active (a previous test may have marked it done). */
export async function resetCostco(request: APIRequestContext): Promise<void> {
  const board = await boardOf(request);
  const costco = board.stores.find((s) => s.name === COSTCO);
  if (costco === undefined) throw new Error('Costco missing from the demo board');
  if (costco.status !== 'active') {
    const reopen = await request.patch(`/api/v1/stores/${costco.id}`, {
      data: { status: 'active' },
      headers: { 'x-requested-with': 'kirana' },
    });
    expect(reopen.ok()).toBeTruthy();
  }
  const ids = costco.items.map((i) => i.id);
  if (ids.length > 0) await bulkCheck(request, ids, false);
}

/** Buy the first `count` active Costco rows; returns their ids. */
export async function buyCostcoRows(
  request: APIRequestContext,
  count: number,
): Promise<string[]> {
  const board = await boardOf(request);
  const costco = board.stores.find((s) => s.name === COSTCO);
  if (costco === undefined) throw new Error('Costco missing from the demo board');
  const active = costco.items.filter((i) => i.status === 'active').slice(0, count);
  if (active.length < count) throw new Error(`expected ${count} active rows, found ${active.length}`);
  const ids = active.map((i) => i.id);
  await bulkCheck(request, ids, true);
  return ids;
}

export function costcoCard(page: Page): Locator {
  const card = page.locator('section', { has: page.getByRole('heading', { name: COSTCO }) });
  expect(card).toBeVisible();
  return card;
}

export async function openCostco(page: Page): Promise<Locator> {
  await page.goto('/');
  const card = costcoCard(page);
  // Default state has active items → expanded (§8.3).
  await expect(card.getByRole('checkbox').first()).toBeVisible();
  return card;
}

/** Enter Shop Mode the way a shopper does: Home → store ⋯ menu → Shop here
 *  (§8.5). Returns after the focused store screen has loaded. */
export async function openShopMode(page: Page, storeName: string = COSTCO): Promise<void> {
  await page.goto('/');
  const card = costcoCard(page);
  await card.getByRole('button', { name: `Store actions for ${storeName}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Shop here' }).click();
  await page.waitForURL(/\/store\//);
  await expect(page.getByRole('heading', { level: 1, name: storeName })).toBeVisible();
}

/** The header badge reads "N to buy" (nothing bought) or "b/N" (§6.6). */
export async function counts(card: Locator): Promise<{ bought: number; total: number }> {
  const badge = card.locator('h2').getByText(/to buy|\d+\/\d+/);
  const text = (await badge.textContent()) ?? '';
  const slash = /(\d+)\/(\d+)/.exec(text);
  if (slash !== null) return { bought: Number(slash[1]), total: Number(slash[2]) };
  const toBuy = /(\d+) to buy/.exec(text);
  if (toBuy !== null) return { bought: 0, total: Number(toBuy[1]) };
  throw new Error(`unexpected counter text: ${text}`);
}
