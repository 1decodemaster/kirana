import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { newUuidV7 } from '@kirana/shared';
import { resetAddItemState, resetCostco } from './support.js';

test.beforeEach(async ({ request }) => {
  await resetCostco(request);
  resetAddItemState();
});

async function openAddSheet(page: Page, storeName = 'Indian Store'): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(storeName) }).click();
  await expect(page.getByRole('heading', { name: `Add to ${storeName}` })).toBeVisible();
}

/** Make Basmati Rice a store staple (§6.4's threshold needs §8.6 signals). */
async function addBasmatiTimes(request: APIRequestContext, times: number): Promise<void> {
  const board = (await (await request.get('/api/v1/board')).json()) as {
    stores: Array<{ id: string; name: string }>;
    catalog: Array<{ id: string; name: string }>;
  };
  const store = board.stores.find((s) => s.name === 'Indian Store');
  const basmati = board.catalog.find((c) => c.name === 'Basmati Rice');
  if (store === undefined || basmati === undefined) throw new Error('fixture missing');
  for (let i = 0; i < times; i++) {
    const res = await request.post(`/api/v1/stores/${store.id}/items`, {
      data: { clientId: newUuidV7(Date.now()), itemId: basmati.id },
      headers: { 'x-requested-with': 'kirana' },
    });
    expect(res.ok()).toBeTruthy();
  }
}

test('AC-A4: typing an existing name exactly prompts instead of adding', async ({ page }) => {
  await openAddSheet(page);
  await page.getByLabel('Item name').fill('Basmati Rice');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const card = page.getByTestId('near-duplicate-card');
  await expect(card).toBeVisible();
  await expect(card.getByText(/You already have Basmati Rice/)).toBeVisible();
  // Exact matches can only reuse — INV-5 makes "create new" impossible.
  await expect(card.getByRole('button', { name: 'Use it' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Create new anyway' })).toBeHidden();

  await card.getByRole('button', { name: 'Use it' }).click();
  await expect(page.getByRole('heading', { name: 'Add to Indian Store' })).toBeHidden();
  const list = page.locator('section', { has: page.getByRole('heading', { name: 'Indian Store' }) });
  await expect(list.getByRole('checkbox', { name: /Basmati Rice/ })).toBeVisible();
});

test('G2.5: a fuzzy staple prompt never creates a second catalog row (Use it path)', async ({ page, request }) => {
  await addBasmatiTimes(request, 20);
  await openAddSheet(page);
  await page.getByLabel('Item name').fill('basmati ric');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const card = page.getByTestId('near-duplicate-card');
  await expect(card).toBeVisible();
  await expect(card.getByText(/You already have Basmati Rice/)).toBeVisible();
  await card.getByRole('button', { name: 'Use it' }).click();
  await expect(page.getByRole('heading', { name: 'Add to Indian Store' })).toBeHidden();

  const res = await request.get('/api/v1/items?q=basmati');
  const body = (await res.json()) as { items: Array<{ name: string }> };
  expect(body.items.filter((i) => i.name === 'Basmati Rice')).toHaveLength(1);
  expect(body.items.filter((i) => i.name === 'basmati ric')).toHaveLength(0);
});

test('G2.5: "Create new anyway" deliberately creates a distinct item', async ({ page, request }) => {
  await addBasmatiTimes(request, 20);
  await openAddSheet(page);
  await page.getByLabel('Item name').fill('basmati ric');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const card = page.getByTestId('near-duplicate-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Create new anyway' }).click();
  await expect(page.getByRole('heading', { name: 'Add to Indian Store' })).toBeHidden();

  const res = await request.get('/api/v1/items?q=basmati');
  const body = (await res.json()) as { items: Array<{ name: string }> };
  expect(body.items.filter((i) => i.name === 'Basmati Rice')).toHaveLength(1);
  expect(body.items.filter((i) => i.name === 'basmati ric')).toHaveLength(1);
});
