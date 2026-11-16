import { expect, test, type APIRequestContext } from '@playwright/test';
import type { AddListItemResponse } from '@kirana/shared';
import { boardOf, removeMergeArtifacts } from './support.js';

const SOURCE = 'Merge Source Chai';
const TARGET = 'Merge Target Tea Blend';
const SOURCE_ALIAS = 'Merge Source Alias';
const STORE = 'Target';
const CLIENT_ID_SOURCE = '0e2e0000-0000-7000-8000-0000000000a1';
const CLIENT_ID_TARGET = '0e2e0000-0000-7000-8000-0000000000a2';

let sourceId = '';
let targetId = '';

/** Disposable fixture: one list row each for source and target on the Target
 *  store, plus an alias on the source that the merge must carry over. */
async function seedMergeFixture(request: APIRequestContext): Promise<void> {
  const board = await boardOf(request);
  const store = board.stores.find((s) => s.name === STORE);
  if (store === undefined) throw new Error(`${STORE} missing from the demo board`);
  const add = async (name: string, clientId: string): Promise<string> => {
    const res = await request.post(`/api/v1/stores/${store.id}/items`, {
      data: { clientId, name },
      headers: { 'x-requested-with': 'kirana' },
    });
    expect(res.ok()).toBeTruthy();
    return ((await res.json()) as AddListItemResponse).item.id;
  };
  sourceId = await add(SOURCE, CLIENT_ID_SOURCE);
  targetId = await add(TARGET, CLIENT_ID_TARGET);
  const alias = await request.post(`/api/v1/items/${sourceId}/aliases`, {
    data: { alias: SOURCE_ALIAS, lang: 'en' },
    headers: { 'x-requested-with': 'kirana' },
  });
  expect(alias.ok()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  removeMergeArtifacts();
  await seedMergeFixture(request);
});

test.afterEach(() => {
  removeMergeArtifacts();
});

test('G3.5: merge requires confirmation, moves rows and aliases, deletes the source', async ({ page, request }) => {
  // Arrange evidence: exactly one row each before the merge.
  const board = await boardOf(request);
  const rows = board.stores.find((s) => s.name === STORE)?.items ?? [];
  expect(rows.filter((i) => i.name === SOURCE)).toHaveLength(1);
  expect(rows.filter((i) => i.name === TARGET)).toHaveLength(1);

  const openMergeSheet = async (): Promise<void> => {
    await page.goto(`/catalog/${sourceId}`);
    await page.getByRole('button', { name: 'Merge with another item…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Merge item' });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel('Search catalog').fill('Merge Target');
    await sheet.getByRole('button', { name: TARGET }).click();
  };

  // Irreversible only after confirmation: Escape aborts and both items
  // survive untouched.
  await openMergeSheet();
  const confirm = page.getByRole('dialog', { name: 'Merge item' });
  await expect(confirm.getByText('This cannot be undone.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  const stillThere = await request.get(`/api/v1/items/${sourceId}`);
  expect(stillThere.ok()).toBeTruthy();

  // Confirming performs the merge and lands on the kept item's detail.
  await openMergeSheet();
  const confirm2 = page.getByRole('dialog', { name: 'Merge item' });
  await confirm2.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/catalog/${targetId}`));

  // Aliases moved: the source's alias now lives on the kept item.
  await expect(page.getByText(SOURCE_ALIAS)).toBeVisible();

  // The source is gone — 404 on the read, and the catalog search no longer
  // offers it. (It surfaces the kept item instead: the merge carried the
  // source's alias over, so search continuity points at the target.)
  const gone = await request.get(`/api/v1/items/${sourceId}`);
  expect(gone.status()).toBe(404);
  await page.goto('/catalog');
  await page.getByLabel('Search catalog').fill(SOURCE);
  await expect(page.locator(`a[href="/catalog/${sourceId}"]`)).toHaveCount(0);
  await expect(page.getByRole('link', { name: TARGET })).toBeVisible();

  // List rows moved: Target now serves two rows of the kept item and none
  // of the source.
  await expect.poll(async () => {
    const fresh = await boardOf(request);
    const freshRows = fresh.stores.find((s) => s.name === STORE)?.items ?? [];
    return freshRows.filter((i) => i.name === TARGET).length - freshRows.filter((i) => i.name === SOURCE).length;
  }).toBe(2);
});
