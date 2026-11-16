import { expect, test, type APIRequestContext } from '@playwright/test';
import { boardOf, COSTCO, resetCostco } from './support.js';

const SNACKS = 'Snacks & Namkeen';

/** Costco's aisle order back to the default so both viewport projects (and
 *  the specs that run after this file) start from the demo state. */
async function resetAisleOrder(request: APIRequestContext): Promise<void> {
  const board = await boardOf(request);
  const costco = board.stores.find((s) => s.name === COSTCO);
  if (costco === undefined || costco.categoryOrder.length === 0) return;
  const res = await request.patch(`/api/v1/stores/${costco.id}`, {
    data: { categoryOrder: [] },
    headers: { 'x-requested-with': 'kirana' },
  });
  expect(res.ok()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  await resetCostco(request);
  await resetAisleOrder(request);
});

test.afterEach(async ({ request }) => {
  await resetAisleOrder(request);
});

test('G3.4: aisle order persists per store and changes Home ordering', async ({ page, request }) => {
  const board = await boardOf(request);
  const costco = board.stores.find((s) => s.name === COSTCO);
  if (costco === undefined) throw new Error('Costco missing from the demo board');
  const snacks = board.categories.find((c) => c.name === SNACKS);
  if (snacks === undefined) throw new Error(`${SNACKS} missing from the demo categories`);

  // Baseline: with the default aisle order the first group in the Costco
  // card is Cleaning Supplies (household 'Cleaning Supplies' sorts before
  // grocery 'Produce' at sortOrder 0), so Garbage Bags leads.
  await page.goto('/');
  const card = page.locator('section', { has: page.getByRole('heading', { name: COSTCO }) });
  await expect(card.getByRole('checkbox').first()).toHaveAttribute('aria-label', /^Garbage Bags/);

  // Keyboard reorder (§8.10): Space grabs the handle, arrows move, Space
  // drops. Move Snacks & Namkeen from wherever the seed order puts it to
  // the top (read the position from the DOM — the default order interleaves
  // the grocery and household seeds).
  await page.goto(`/categories?store=${costco.id}`);
  const aisleSection = page.locator('section[aria-label="Aisle order"]');
  const aisleList = page.getByRole('list', { name: 'Aisle order' });
  const expectedHandle = `Reorder ${SNACKS}`;
  const position = await aisleList
    .getByRole('button', { name: /^Reorder / })
    .evaluateAll((nodes, expected) => nodes.findIndex((n) => n.getAttribute('aria-label') === expected), expectedHandle);
  if (position < 0) throw new Error(`${SNACKS} not found in the aisle order list`);
  await aisleList.getByRole('button', { name: `Reorder ${SNACKS}` }).focus();
  await page.keyboard.press('Space');
  // Both ReorderLists on this screen have a live region — scope to the
  // aisle section's.
  await expect(aisleSection.getByRole('status')).toContainText(`${SNACKS} grabbed.`);
  for (let i = 0; i < position; i += 1) await page.keyboard.press('ArrowUp');
  await expect(aisleSection.getByRole('status')).toContainText('Position 1 of');
  await page.keyboard.press('Space');
  await expect(aisleSection.getByRole('status')).toContainText(`${SNACKS} dropped.`);

  // Persisted per store: the server's categoryOrder leads with the moved
  // category, and a reload renders it first.
  await expect.poll(async () => {
    const fresh = await boardOf(request);
    return fresh.stores.find((s) => s.name === COSTCO)?.categoryOrder[0];
  }).toBe(snacks.id);
  await page.reload();
  await expect(aisleList.locator('li').first()).toContainText(SNACKS);

  // Home ordering follows the aisle order: Biscuits (Snacks) now leads.
  await page.goto('/');
  await expect(card.getByRole('checkbox').first()).toHaveAttribute('aria-label', /^Biscuits/);

  // "Per store": another store's aisle order is untouched by Costco's.
  const after = await boardOf(request);
  const indian = after.stores.find((s) => s.name === 'Indian Store');
  expect(indian?.categoryOrder).toEqual([]);
});
