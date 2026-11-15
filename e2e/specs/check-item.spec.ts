import { expect, test } from '@playwright/test';
import { costcoCard, counts, openCostco, resetCostco } from './support.js';

// beforeEach (not beforeAll): with workers:1 both projects share one worker,
// and Playwright runs beforeAll once per worker — the second project would
// inherit the first one's mutated state.
test.beforeEach(async ({ request }) => {
  await resetCostco(request);
});

test('AC-H1: header shows bought/total and a proportional progress bar', async ({ page }) => {
  const card = await openCostco(page);
  await expect(card.getByText('5 to buy')).toBeVisible();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

  await card.getByRole('checkbox').first().click();
  await expect(card.getByText('1/5')).toBeVisible();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');
});

test('AC-H2 + G1.3: checking is optimistic and survives reload', async ({ page }) => {
  const card = await openCostco(page);
  // Locate by name, not by checked-state: the attribute flips on click and a
  // state-filtered locator would silently re-resolve to another row.
  const firstItem = card.locator('[role="checkbox"][aria-checked="false"]').first();
  const itemName = (await firstItem.getAttribute('aria-label')) ?? '';
  expect(itemName.length).toBeGreaterThan(0);

  await firstItem.click();
  // Optimistic: checked within one frame, no network wait.
  await expect(card.getByRole('checkbox', { name: itemName })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await page.reload();
  const cardAfter = await openCostco(page);
  await expect(
    cardAfter.getByRole('checkbox', { name: itemName }),
  ).toHaveAttribute('aria-checked', 'true');
  const after = await counts(cardAfter);
  expect(after).toEqual({ bought: 1, total: 5 });
});

test('AC-H5: expanded/collapsed state survives a reload', async ({ page }) => {
  await page.goto('/');
  // The header toggle's accessible name starts with the store name; the ⋯
  // button is "Store actions for {name}".
  const card = costcoCard(page);
  await card.getByRole('button', { name: /^Costco/ }).click();
  await expect(card.getByRole('checkbox').first()).toBeHidden();

  await page.reload();
  const cardAfter = costcoCard(page);
  await expect(cardAfter.getByRole('checkbox').first()).toBeHidden();
  await cardAfter.getByRole('button', { name: /^Costco/ }).click();
  await expect(cardAfter.getByRole('checkbox').first()).toBeVisible();
});
