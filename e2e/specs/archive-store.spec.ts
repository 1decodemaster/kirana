import { expect, test } from '@playwright/test';
import { buyCostcoRows, costcoCard, resetCostco } from './support.js';

test.beforeEach(async ({ request }) => {
  await resetCostco(request);
  // Buy everything: zero active items (AC-H4 precondition).
  await buyCostcoRows(request, 5);
});

test('AC-H4: fully-bought store auto-collapses and shows the archive prompt', async ({
  page,
}) => {
  await page.goto('/');
  const card = costcoCard(page);
  // Auto-collapsed (§8.3) even though the user never collapsed it.
  await expect(card.getByRole('checkbox').first()).toBeHidden();

  await card.getByRole('button', { name: /^Costco/ }).click();
  await expect(card.getByRole('button', { name: /Clear bought/ })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Done ✓' })).toBeVisible();
  await expect(card.getByText('All done! Archive this store?')).toBeVisible();
});

test('AC-H4: tapping Done ✓ moves the card to the Archived section', async ({ page }) => {
  await page.goto('/');
  const card = costcoCard(page);
  await card.getByRole('button', { name: /^Costco/ }).click();
  await card.getByRole('button', { name: 'Done ✓' }).click();

  const archived = page.getByRole('button', { name: 'Archived (1)' });
  await expect(archived).toBeVisible();
  await archived.click();
  await expect(page.getByRole('region', { name: 'Costco' })).toBeVisible();
  // The main list no longer contains the store card.
  await expect(page.getByRole('region', { name: 'Costco' }).getByRole('button', { name: 'Done ✓' })).toBeHidden();
});

test('done store can be restored from the Archived section', async ({ page }) => {
  await page.goto('/');
  const card = costcoCard(page);
  await card.getByRole('button', { name: /^Costco/ }).click();
  await card.getByRole('button', { name: 'Done ✓' }).click();

  const archived = page.getByRole('button', { name: 'Archived (1)' });
  await expect(archived).toBeVisible();
  await archived.click();

  const archivedCard = page.getByRole('region', { name: 'Costco' });
  await archivedCard.getByRole('button', { name: 'Store actions for Costco' }).click();
  await page.getByRole('dialog', { name: /Costco/ }).getByRole('button', { name: 'Restore' }).click();

  // Back in the main list with its bought rows intact. The expansion from
  // the start of this test persists (AC-H5), so the card is already open.
  await expect(archived).toBeHidden();
  const restored = page.getByRole('region', { name: 'Costco' });
  await expect(restored.getByRole('button', { name: /^Costco/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(restored.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(5);
});
