import { expect, test, type Page } from '@playwright/test';
import { newUuidV7 } from '@kirana/shared';
import { resetAddItemState, resetCostco } from './support.js';

// Add-item specs run against Indian Store; keep Costco rows untouched so the
// sibling suites see their expected board state.
test.beforeEach(async ({ request }) => {
  await resetCostco(request);
  resetAddItemState();
});

/** §8.3: the FAB asks which store when more than one is active. */
async function openAddSheet(page: Page, storeName = 'Indian Store'): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(storeName) }).click();
  await expect(page.getByRole('heading', { name: `Add to ${storeName}` })).toBeVisible();
}

test('AC-A1 + G2.1: typing "mil" suggests Milk; tap + Add completes in 3 taps', async ({ page }) => {
  await openAddSheet(page);

  const name = page.getByLabel('Item name');
  await name.fill('mil');

  const suggestion = page.getByRole('button', { name: /Milk/ }).first();
  await expect(suggestion).toBeVisible();

  // AC-A1: tap the suggestion, then Add — the row lands with no other steps.
  await suggestion.click();
  await expect(page.getByLabel('Item name')).toHaveValue('Milk');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Add to Indian Store' })).toBeHidden();
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Indian Store' }) });
  await expect(card.getByRole('checkbox', { name: /Milk/ })).toBeVisible();
});

test('AC-A1: the suggestion group header separates in-store from catalog matches', async ({ page, request }) => {
  // Make Milk a store staple so it ranks into the "In this store" group.
  const board = (await (await request.get('/api/v1/board')).json()) as {
    stores: Array<{ id: string; name: string }>;
    catalog: Array<{ id: string; name: string }>;
  };
  const store = board.stores.find((s) => s.name === 'Indian Store');
  const milk = board.catalog.find((c) => c.name === 'Milk');
  if (store === undefined || milk === undefined) throw new Error('fixture missing');
  const add = await request.post(`/api/v1/stores/${store.id}/items`, {
    data: { clientId: newUuidV7(Date.now()), itemId: milk.id },
    headers: { 'x-requested-with': 'kirana' },
  });
  expect(add.ok()).toBeTruthy();

  await openAddSheet(page);
  await page.getByLabel('Item name').fill('m');
  await expect(page.getByText('In this store')).toBeVisible();
  await expect(page.getByText('Also in your catalog')).toBeVisible();
});

test('keyboard path: Enter submits the add form (§8.8)', async ({ page }) => {
  await openAddSheet(page);
  const name = page.getByLabel('Item name');
  await name.fill('mil');
  await page.getByRole('button', { name: /Milk/ }).first().click();
  await name.press('Enter');
  await expect(page.getByRole('heading', { name: 'Add to Indian Store' })).toBeHidden();
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Indian Store' }) });
  await expect(card.getByRole('checkbox', { name: /Milk/ })).toBeVisible();
});

test('AC-A3: adding the same known item twice reuses it — no duplicate catalog row', async ({ page, request }) => {
  await openAddSheet(page);
  await page.getByLabel('Item name').fill('mil');
  await page.getByRole('button', { name: /Milk/ }).first().click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add to Indian Store' })).toBeHidden();

  await openAddSheet(page);
  await page.getByLabel('Item name').fill('milk');
  // Typed exactly (not picked): AC-A4 prompts; Use it reuses the same item.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByTestId('near-duplicate-card').getByRole('button', { name: 'Use it' }).click();
  await expect(page.getByRole('heading', { name: 'Add to Indian Store' })).toBeHidden();

  const res = await request.get('/api/v1/items?q=milk');
  const body = (await res.json()) as { items: Array<{ name: string }> };
  expect(body.items.filter((i) => i.name === 'Milk')).toHaveLength(1);
});
