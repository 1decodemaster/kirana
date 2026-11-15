import { expect, test } from '@playwright/test';
import type { BoardResponse } from '@kirana/shared';
import { buyCostcoRows, counts, COSTCO, openCostco, resetCostco } from './support.js';

// beforeEach (not beforeAll): with workers:1 both projects share one worker,
// and Playwright runs beforeAll once per worker — the second project would
// inherit the first one's mutated state.
test.beforeEach(async ({ request }) => {
  await resetCostco(request);
  await buyCostcoRows(request, 2);
});

test('G1.4: clear-bought removes bought rows and undo restores them exactly', async ({ page }) => {
  const card = await openCostco(page);
  const before = await counts(card);
  expect(before).toEqual({ bought: 2, total: 5 });

  const boughtNames = await card
    .locator('[role="checkbox"][aria-checked="true"]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label') ?? ''));
  expect(boughtNames).toHaveLength(2);

  await card.getByRole('button', { name: /Clear bought/ }).click();

  // Rows vanish, counter drops (optimistic), toast offers undo (§6.7).
  await expect(card.getByText('3 to buy')).toBeVisible();
  const toast = page.getByRole('status');
  await expect(toast).toContainText('Cleared 2 items');
  await expect(card.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(0);

  await toast.getByRole('button', { name: 'Undo' }).click();

  // Undo restores exactly the same rows to bought.
  await expect(card.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(2);
  const restored = await card
    .locator('[role="checkbox"][aria-checked="true"]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label') ?? ''));
  expect(new Set(restored)).toEqual(new Set(boughtNames));
  expect(await counts(card)).toEqual(before);
});

test('G1.4: undo expires after 5s and the clear stands', async ({ page, request }) => {
  test.setTimeout(20_000);
  // Fresh arrange: the previous test left its rows bought.
  await resetCostco(request);
  await buyCostcoRows(request, 2);

  const card = await openCostco(page);
  expect(await counts(card)).toEqual({ bought: 2, total: 5 });

  // Remember which rows are bought so they can be restored after the test —
  // cleared rows are invisible to the board API and would leak state.
  const board = (await (await request.get('/api/v1/board')).json()) as BoardResponse;
  const costco = board.stores.find((s) => s.name === COSTCO);
  const boughtIds = costco?.items.filter((i) => i.status === 'bought').map((i) => i.id) ?? [];

  await card.getByRole('button', { name: /Clear bought/ }).click();
  const toast = page.getByRole('status');
  await expect(toast).toContainText('Cleared 2 items');

  // Wait out the 5s window without undoing.
  await expect(toast).toBeHidden({ timeout: 8_000 });
  expect(await counts(card)).toEqual({ bought: 0, total: 3 });

  // Cleanup for the next project run: bring the cleared rows back to bought.
  const restore = await request.post('/api/v1/list-items/bulk-check', {
    data: { ids: boughtIds, checked: true },
    headers: { 'x-requested-with': 'kirana' },
  });
  expect(restore.ok()).toBeTruthy();
});
