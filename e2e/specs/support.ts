import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@kirana/db';
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

async function boardOf(request: APIRequestContext): Promise<BoardResponse> {
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
