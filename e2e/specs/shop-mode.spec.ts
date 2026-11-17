import { expect, test } from '@playwright/test';
import { costcoCard, openShopMode, resetCostco } from './support.js';

// beforeEach (not beforeAll): with workers:1 both projects share one worker,
// and Playwright runs beforeAll once per worker — the second project would
// inherit the first one's mutated state.
test.beforeEach(async ({ request }) => {
  await resetCostco(request);
});

// Demo Costco, all active: Cleaning Supplies (Garbage Bags, Dish Soap) →
// Grains & Lentils (Basmati Rice) → Oils & Ghee (Cooking Oil) → Snacks &
// Namkeen (Biscuits) — the §6.8 board order Shop Mode groups (§8.5).

test('G15.1: entry via store menu; header shows name, counter, progress; only the current category is expanded', async ({
  page,
}) => {
  await openShopMode(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Costco' })).toBeVisible();
  await expect(page.getByText('0/5')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Costco progress' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );

  // Current category (first with unchecked items) expanded…
  await expect(page.getByRole('checkbox', { name: /Garbage Bags/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Dish Soap/ })).toBeVisible();
  // …everything else collapsed (headers visible, rows absent).
  await expect(page.getByRole('heading', { name: /Grains & Lentils/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Basmati Rice/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Oils & Ghee/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Cooking Oil/ })).toHaveCount(0);
});

test('G15.1: completing a category auto-expands the next unchecked one and scrolls to it', async ({
  page,
}) => {
  await openShopMode(page);

  // Finish "Cleaning Supplies": two checks; auto-advance fires on the last.
  await page.getByRole('checkbox', { name: /Garbage Bags/ }).click();
  await expect(page.getByText('1/5')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Basmati Rice/ })).toHaveCount(0); // not yet

  await page.getByRole('checkbox', { name: /Dish Soap/ }).click();
  await expect(page.getByText('2/5')).toBeVisible();

  // Grains & Lentils is now the current category: expanded and scrolled to.
  const grains = page.locator('#shop-section-1');
  await expect(grains.getByRole('checkbox', { name: /Basmati Rice/ })).toBeVisible();
  await expect
    .poll(async () => (await grains.boundingBox())?.y ?? Infinity, { timeout: 3_000 })
    .toBeLessThan(667);

  // The walk continues one category at a time.
  await page.getByRole('checkbox', { name: /Basmati Rice/ }).click();
  await expect(page.locator('#shop-section-2').getByRole('checkbox', { name: /Cooking Oil/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /Cooking Oil/ }).click();
  await expect(page.locator('#shop-section-3').getByRole('checkbox', { name: /Biscuits/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /Biscuits/ }).click();

  // Trip complete: header 5/5, progress 100, no collapsed category left unchecked.
  await expect(page.getByText('5/5')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Costco progress' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
});

test('G15.2: rows are ≥56px, the checkbox box ≥28px, and targets ≥44px', async ({ page }) => {
  await openShopMode(page);

  const row = page.getByRole('checkbox', { name: /Garbage Bags/ });
  const rowBox = await row.boundingBox();
  expect(rowBox?.height ?? 0).toBeGreaterThanOrEqual(56);

  // The visual checkbox is the row button's first (aria-hidden) span.
  const box = row.locator('span').first();
  const boxBox = await box.boundingBox();
  expect(boxBox?.height ?? 0).toBeGreaterThanOrEqual(28);
  expect(boxBox?.width ?? 0).toBeGreaterThanOrEqual(28);

  // The header ✕ and the footer button are full-size targets.
  const exit = page.getByRole('button', { name: 'Exit shop mode' });
  const exitBox = await exit.boundingBox();
  expect(exitBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  const done = page.getByRole('button', { name: 'Done shopping' });
  const doneBox = await done.boundingBox();
  expect(doneBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test('AC-H2 analogue: a check made in Shop Mode survives a reload', async ({ page }) => {
  await openShopMode(page);
  await page.getByRole('checkbox', { name: /Garbage Bags/ }).click();
  await expect(page.getByText('1/5')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Costco' })).toBeVisible();
  await expect(page.getByText('1/5')).toBeVisible();
  // Cleaning Supplies still has Dish Soap unchecked → still the current
  // category, and Garbage Bags comes back bought.
  await expect(page.getByRole('checkbox', { name: /Garbage Bags/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('G15.3: offline reading works from the cache; checks queue per P4 rules', async ({
  page,
  context,
}) => {
  await openShopMode(page);

  // Model "network unreachable" by aborting API calls: headless Chromium's
  // CDP offline emulation blackholes localhost fetches (they hang instead of
  // failing), while aborted requests fail fast exactly like a dead WAN. The
  // cached board keeps rendering — offline reading is the first half of the
  // gate (§15.3 G15.3).
  await context.route('**/api/**', (route) => route.abort('internetdisconnected'));

  // Client-side navigation and cached reads keep working (no full page load —
  // the offline app shell is P4 scope).
  await page.keyboard.press('Escape'); // → Home
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  const card = costcoCard(page);
  await card.getByRole('button', { name: 'Store actions for Costco' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Shop here' }).click();
  await page.waitForURL(/\/store\//);
  await expect(page.getByRole('checkbox', { name: /Garbage Bags/ })).toBeVisible();

  // P4 rules: a check while offline persists optimistically and queues for
  // replay (§4.7) — it does NOT roll back.
  await page.getByRole('checkbox', { name: /Garbage Bags/ }).click();
  await expect(page.getByRole('checkbox', { name: /Garbage Bags/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Recovery: the WAN returns; the boot drain replays the queued check.
  await context.unroute('**/api/**');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Garbage Bags/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Garbage Bags/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByText('1/5')).toBeVisible();
});

test.afterEach(async ({ request }) => {
  // This file checks rows for its scenarios — put them back to active so
  // later specs (and the second viewport project) start from the demo state.
  const board = (await (await request.get('/api/v1/board')).json()) as {
    stores: Array<{ items: Array<{ id: string; status: string }> }>;
  };
  for (const store of board.stores) {
    for (const item of store.items) {
      if (item.status === 'bought') {
        await request.patch(`/api/v1/list-items/${item.id}`, {
          data: { status: 'active' },
          headers: { 'x-requested-with': 'kirana' },
        });
      }
    }
  }
});

test('G15.4: exiting returns to Home with the same scroll position', async ({ page }) => {
  await page.goto('/');
  // The scroll target only exists once the board has rendered — skeletons
  // make the document too short to scroll.
  await expect(page.getByRole('heading', { name: 'Indian Store' })).toBeVisible();
  // Scroll the Indian Store's menu button into view WITHOUT Playwright's
  // auto-scroll clobbering the position: 300 keeps it inside the viewport,
  // so the click happens exactly where the shopper left it.
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(300);

  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Indian Store' }) });
  await card.getByRole('button', { name: 'Store actions for Indian Store' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Shop here' }).click();
  await page.waitForURL(/\/store\//);

  await page.getByRole('button', { name: 'Exit shop mode' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(300);
});

test('Done shopping marks the store done and returns Home', async ({ page }) => {
  await openShopMode(page);

  for (const name of [/Garbage Bags/, /Dish Soap/, /Basmati Rice/, /Cooking Oil/, /Biscuits/]) {
    await page.getByRole('checkbox', { name }).click();
  }
  await expect(page.getByText('5/5')).toBeVisible();

  // The footer only enables once nothing is left unchecked (§8.5 marks the
  // trip done; the server rejects done-with-active-items).
  const done = page.getByRole('button', { name: 'Done shopping' });
  await expect(done).toBeEnabled();
  await done.click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Archived (1)')).toBeVisible();
});

test('Footer stays disabled while items remain; ✕ exits without marking done', async ({ page }) => {
  await openShopMode(page);
  await expect(page.getByRole('button', { name: 'Done shopping' })).toBeDisabled();

  await page.getByRole('checkbox', { name: /Garbage Bags/ }).click();
  await expect(page.getByRole('button', { name: 'Done shopping' })).toBeDisabled();

  await page.getByRole('button', { name: 'Exit shop mode' }).click();
  await expect(page).toHaveURL(/\/$/);
  // Back on Home the store is still active; the check persisted (1/5) and
  // the trip was NOT marked done (the card did not move to Archived).
  const card = costcoCard(page);
  await expect(card.getByText('1/5')).toBeVisible();
});

test('Keyboard: Space toggles a row, Escape exits', async ({ page }) => {
  await openShopMode(page);

  // First Tab stop is the header ✕; next is the first row checkbox.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Exit shop mode' })).toBeFocused();
  await page.keyboard.press('Tab');
  const firstRow = page.getByRole('checkbox', { name: /Garbage Bags/ });
  await expect(firstRow).toBeFocused();

  await page.keyboard.press('Space');
  await expect(firstRow).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('1/5')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/$/);
});

test('Empty store shows the §8.7 empty state; Back to Home returns', async ({ page, request }) => {
  const created = await request.post('/api/v1/stores', {
    data: { name: 'Empty Mart', iconKind: 'emoji', iconRef: '🏬' },
    headers: { 'x-requested-with': 'kirana' },
  });
  expect(created.ok()).toBeTruthy();
  const { store } = (await created.json()) as { store: { id: string } };

  try {
    await page.goto(`/store/${store.id}`);
    await expect(page.getByText('Nothing to buy here.')).toBeVisible();
    await page.getByRole('button', { name: 'Back to Home' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  } finally {
    const removed = await request.delete(`/api/v1/stores/${store.id}`, {
      headers: { 'x-requested-with': 'kirana' },
    });
    expect(removed.ok()).toBeTruthy();
  }
});

test('Unknown store id shows the not-found state', async ({ page }) => {
  await page.goto('/store/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('Store not found.')).toBeVisible();
});
