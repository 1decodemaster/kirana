import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { BoardResponse } from '@kirana/shared';

export const COSTCO = 'Costco';

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
