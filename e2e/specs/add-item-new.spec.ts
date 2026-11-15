import { expect, test, type Page } from '@playwright/test';
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

test('AC-A2: typing "tapioca starch 500 g" parses name, qty and unit live', async ({ page }) => {
  await openAddSheet(page);
  const name = page.getByLabel('Item name');
  await name.fill('tapioca starch 500 g');

  // The quantity moved into the controls and the name field is clean.
  await expect(name).toHaveValue('tapioca starch');
  await expect(page.getByRole('status', { name: 'Quantity' })).toHaveText('500');
  await expect(page.getByRole('combobox')).toHaveValue('g');

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add to Indian Store' })).toBeHidden();

  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Indian Store' }) });
  await expect(card.getByRole('checkbox', { name: /tapioca starch/ })).toBeVisible();
});

test('AC-A3: a brand-new item creates exactly one catalog row and one alias', async ({ page, request }) => {
  await openAddSheet(page);
  await page.getByLabel('Item name').fill('arrowroot flour');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add to Indian Store' })).toBeHidden();

  const res = await request.get('/api/v1/items?q=arrowroot');
  const body = (await res.json()) as { items: Array<{ name: string }> };
  expect(body.items).toHaveLength(1);
  expect(body.items[0]?.name).toBe('arrowroot flour');
});

test('AC-A5: toggling unit type preserves the value and stays valid', async ({ page }) => {
  await openAddSheet(page);
  await page.getByLabel('Item name').fill('tapioca starch 500 g');
  await expect(page.getByRole('status', { name: 'Quantity' })).toHaveText('500');
  await expect(page.getByRole('combobox')).toHaveValue('g');

  // Weight → Volume: the value stays 500, the unit becomes ml (500 < 1000).
  await page.getByRole('radio', { name: 'Volume' }).click();
  await expect(page.getByRole('combobox')).toHaveValue('ml');
  await expect(page.getByRole('status', { name: 'Quantity' })).toHaveText('500');

  // Volume → Count: value still 500, unit ea.
  await page.getByRole('radio', { name: 'Count' }).click();
  await expect(page.getByRole('combobox')).toHaveValue('ea');
  await expect(page.getByRole('status', { name: 'Quantity' })).toHaveText('500');
});

test('Add another keeps the sheet open and clears only the name', async ({ page, request }) => {
  await openAddSheet(page);
  await page.getByLabel('Item name').fill('arrowroot flour');
  await page.getByRole('button', { name: 'Add another' }).click();

  await expect(page.getByRole('heading', { name: 'Add to Indian Store' })).toBeVisible();
  await expect(page.getByLabel('Item name')).toHaveValue('');

  // The first add already landed on the board.
  const res = await request.get('/api/v1/items?q=arrowroot');
  const body = (await res.json()) as { items: Array<{ name: string }> };
  expect(body.items).toHaveLength(1);
});
