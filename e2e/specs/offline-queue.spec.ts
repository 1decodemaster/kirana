import { expect, test, type Page } from '@playwright/test';
import type { BoardResponse } from '@kirana/shared';
import { removeReplayArtifact } from './support';

/** §15.3 G4.2/G4.3: offline writes queue and replay; the same clientId
 *  never duplicates a row. */

const REPLAY_CLIENT_ID = '01913b5e-7d5a-7000-8000-0000000abcde';

async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Costco' })).toBeVisible();
}

async function expandAllStores(page: Page): Promise<void> {
  const sections = page.locator('section[aria-label]');
  const count = await sections.count();
  for (let i = 0; i < count; i++) {
    const header = sections.nth(i).locator('button[aria-expanded]').first();
    if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
  }
}

test.afterEach(async ({ request }) => {
  // Restore whatever this file changed: replay-probe rows (G4.3) and any
  // rows left bought by the offline drill (G4.2).
  removeReplayArtifact(REPLAY_CLIENT_ID);
  const board = (await (await request.get('/api/v1/board')).json()) as BoardResponse;
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

test('three offline checks persist after reconnect, no duplicates (G4.2)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await context.newPage();
  await openHome(page);

  // Three unchecked rows, pinned by accessible name (rows reorder when
  // checked, §6.8).
  const boxes = page.getByRole('checkbox');
  const total = await boxes.count();
  const labels: string[] = [];
  for (let i = 0; i < total && labels.length < 3; i++) {
    const box = boxes.nth(i);
    if ((await box.getAttribute('aria-checked')) === 'false') {
      const label = await box.getAttribute('aria-label');
      if (label !== null) labels.push(label);
    }
  }
  expect(labels).toHaveLength(3);

  await context.setOffline(true);
  await expect(page.getByText('Offline — changes will sync when you reconnect.')).toBeVisible();
  for (const label of labels) {
    await page.getByRole('checkbox', { name: label }).click();
  }
  await expandAllStores(page);
  for (const label of labels) {
    await expect(page.getByRole('checkbox', { name: label })).toHaveAttribute('aria-checked', 'true');
  }
  await expect(page.getByText('3 change(s) waiting to sync')).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('Offline — changes will sync')).toBeHidden({ timeout: 5000 });
  // Server truth after a reload: all three bought, each exactly once.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Costco' })).toBeVisible();
  await expandAllStores(page);
  for (const label of labels) {
    await expect(page.getByRole('checkbox', { name: label })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('checkbox', { name: label })).toHaveCount(1);
  }
  await context.close();
});

test('replaying the same clientId twice produces one row (G4.3)', async ({ request }) => {
  const board = (await (await request.get('/api/v1/board')).json()) as BoardResponse;
  const store = board.stores[0];
  expect(store).toBeDefined();

  const body = {
    clientId: REPLAY_CLIENT_ID,
    name: 'Replay Probe',
    qtyValue: 1,
    unitCode: 'ea' as const,
  };
  const first = await request.post(`/api/v1/stores/${store?.id}/items`, {
    data: body,
    headers: { 'x-requested-with': 'kirana' },
  });
  expect(first.status()).toBe(201);
  const replay = await request.post(`/api/v1/stores/${store?.id}/items`, {
    data: body,
    headers: { 'x-requested-with': 'kirana' },
  });
  expect(replay.status()).toBe(200);

  const after = (await (await request.get('/api/v1/board')).json()) as BoardResponse;
  const rows = after.stores.flatMap((s) => s.items).filter((item) => item.name === 'Replay Probe');
  expect(rows).toHaveLength(1);
});
