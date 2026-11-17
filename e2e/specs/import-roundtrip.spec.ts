import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { ExportPayload } from '@kirana/shared';
import {
  boardOf,
  catalogItemCount,
  itemCountByName,
  removeImportArtifacts,
  restoreDemoBoard,
  wipeHouseholdData,
} from './support.js';

const MART = 'Import Mart';
const BAZAAR = 'Import Bazaar';
const CONFLICT_ROW = 'Import Conflict Chips';
const BROKEN_ROW = 'Import Broken Qty';

interface FixtureRow {
  readonly store: string;
  readonly category: string;
  readonly name: string;
  readonly aliases: string;
  readonly qty: string;
  readonly unit: string;
  readonly note: string;
}

function fixtureRow(partial: Omit<FixtureRow, 'aliases' | 'note'> & Partial<FixtureRow>): FixtureRow {
  return { aliases: '', note: '', ...partial };
}

/** The G3.2 fixture: exactly 200 data rows — 189 new items (94 + 95 across
 *  two new stores), 1 new row that appears twice on the same store (the
 *  §9.3 in-file conflict), 8 rows matching demo items by name (merge), and
 *  1 row with a non-numeric qty (invalid). */
function build200RowCsv(): string {
  const rows: FixtureRow[] = [];
  const pad = (n: number): string => String(n).padStart(3, '0');
  for (let i = 1; i <= 94; i += 1) {
    rows.push(fixtureRow({ store: MART, category: 'Import Aisle A', name: `Import Widget ${pad(i)}`, qty: '2', unit: 'ea' }));
  }
  rows.push(fixtureRow({ store: MART, category: 'Import Aisle B', name: CONFLICT_ROW, qty: '1', unit: 'pack' }));
  const duplicates = ['Basmati Rice', 'Cooking Oil', 'Biscuits', 'Dish Soap', 'Toor Dal', 'Paneer', 'Toothpaste', 'Tea'];
  for (const [index, name] of duplicates.entries()) {
    rows.push(fixtureRow({ store: MART, category: index < 4 ? 'Import Aisle A' : 'Produce', name, qty: '1', unit: 'ea' }));
  }
  rows.push(fixtureRow({ store: MART, category: 'Import Aisle B', name: CONFLICT_ROW, qty: '1', unit: 'pack' }));
  rows.push(fixtureRow({ store: MART, category: '', name: BROKEN_ROW, qty: 'abc', unit: '' }));
  for (let i = 95; i <= 189; i += 1) {
    rows.push(fixtureRow({ store: BAZAAR, category: 'Import Aisle A', name: `Import Widget ${pad(i)}`, qty: '3', unit: 'ea' }));
  }
  const lines = ['store,category,name,aliases,qty,unit,note', ...rows.map((r) => [r.store, r.category, r.name, r.aliases, r.qty, r.unit, r.note].join(','))];
  return lines.join('\n');
}

test.beforeEach(() => {
  removeImportArtifacts();
});

test.afterEach(async () => {
  removeImportArtifacts();
  // The G3.3 drill wipes and rebuilds the board through the import model,
  // which cannot restore the full picture (see that test) — every test in
  // this file leaves the canonical demo board behind for the next spec.
  await restoreDemoBoard();
});

test('G3.2: 200-row CSV — preview counts, commit, re-import creates zero duplicates', async ({ page }) => {
  test.setTimeout(90_000);
  const csv = build200RowCsv();
  const upload = { name: 'import-200.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') };

  await page.goto('/data');
  await page.getByRole('button', { name: 'Choose file…' }).click();
  await page.locator('input[type="file"]').setInputFiles(upload);

  // §9.3 diff counts, verbatim §8.10 copy.
  await expect(page.getByText('190 new · 8 duplicates · 1 conflicts · 1 invalid')).toBeVisible();
  await expect(page.getByText('9 rows look like duplicates. Review them below.')).toBeVisible();
  await expect(page.getByText('File: import-200.csv')).toBeVisible();

  // Merge rows point at their target; the error row explains itself and gets
  // no decision control. The in-file conflict pair stays decidable: the first
  // occurrence defaults to create, the second to the §9.3 skip.
  await expect(page.getByText('→ Basmati Rice')).toBeVisible();
  await expect(page.getByText('qty "abc" is not a number')).toBeVisible();
  await expect(page.getByLabel(`Decision for ${BROKEN_ROW}`)).toHaveCount(0);
  const conflictSelects = page.getByLabel(`Decision for ${CONFLICT_ROW}`);
  await expect(conflictSelects).toHaveCount(2);
  await expect(conflictSelects.nth(0)).toHaveValue('create');
  await expect(conflictSelects.nth(1)).toHaveValue('skip');

  // Per-row decisions are editable and drive the commit count.
  const firstWidget = page.getByLabel('Decision for Import Widget 001');
  await firstWidget.selectOption({ label: 'Skip' });
  await expect(page.getByRole('button', { name: 'Import 197 items' })).toBeVisible();
  await firstWidget.selectOption({ label: 'Create new' });
  await expect(page.getByRole('button', { name: 'Import 198 items' })).toBeVisible();

  await page.getByRole('button', { name: 'Import 198 items' }).click();
  await expect(page.getByRole('status')).toHaveText('Imported 198 items across 2 stores.');

  // Re-import the same file: nothing is new any more, and committing again
  // leaves the catalog item count (and the conflict pair's single item)
  // untouched — zero duplicate items.
  await page.getByRole('button', { name: 'Import another file' }).click();
  await page.locator('input[type="file"]').setInputFiles(upload);
  await expect(page.getByText('0 new · 198 duplicates · 1 conflicts · 1 invalid')).toBeVisible();

  const itemsBefore = catalogItemCount();
  await page.getByRole('button', { name: 'Import 198 items' }).click();
  await expect(page.getByRole('status')).toHaveText('Imported 198 items across 2 stores.');
  expect(catalogItemCount()).toBe(itemsBefore);
  expect(itemCountByName(CONFLICT_ROW)).toBe(1);
});

test('backup writes a gz snapshot under the configured DATA_DIR (§12.4, R-013)', async ({ page }) => {
  await page.goto('/data');
  await page.getByRole('button', { name: 'Create backup' }).click();
  const status = page.getByRole('status');
  await expect(status).toHaveText(/^Backup saved: kirana-\d{8}-\d{6}\.db\.gz$/);
  const file = (await status.textContent())?.replace('Backup saved: ', '') ?? '';
  expect(fs.existsSync(path.join(process.cwd(), '.tmp', 'backups', file))).toBe(true);
});

test('CSV export downloads §9.1 for a store (§9.4)', async ({ page, request }) => {
  const board = await boardOf(request);
  const costco = board.stores.find((s) => s.name === 'Costco');
  if (costco === undefined) throw new Error('Costco missing from the demo board');

  await page.goto('/data');
  await page.getByLabel('Store for CSV export').selectOption(costco.id);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export store CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('kirana-costco.csv');
  const text = fs.readFileSync(await download.path(), 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  expect(lines[0]).toBe('store,category,name,aliases,qty,unit,note');
  expect(text).toContain('Basmati Rice');
  expect(lines.length).toBeGreaterThanOrEqual(6);
});

test('G3.3: export → wipe → import restores identical row counts and names', async ({ page, request }) => {
  // Export through the real client path (blob download), then use that exact
  // file as the import input.
  await page.goto('/data');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export everything (JSON)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^kirana-export-\d{4}-\d{2}-\d{2}\.json$/);
  const exportPath = await download.path();
  const before = JSON.parse(fs.readFileSync(exportPath, 'utf8')) as ExportPayload;
  expect(before.schemaVersion).toBe(1);

  // Wipe every household-owned row (the app has no wipe endpoint; §12.5
  // restore drills are P5). Household, members and seed categories survive.
  wipeHouseholdData();
  const wiped = await boardOf(request);
  expect(wiped.stores).toHaveLength(0);
  await page.goto('/');
  await expect(page.getByText('No stores yet. Add the places you shop.')).toBeVisible();

  // Import the downloaded file through the UI.
  await page.goto('/data');
  await page.locator('input[type="file"]').setInputFiles(exportPath);
  const expectedRows = before.listItems.length;
  await expect(page.getByText(`${expectedRows} new · 0 duplicates · 0 conflicts · 0 invalid`)).toBeVisible();
  await page.getByRole('button', { name: `Import ${expectedRows} items` }).click();
  await expect(page.getByRole('status')).toHaveText(`Imported ${expectedRows} items across 3 stores.`);

  // Identical row counts and names (G3.3): every list row (per store) and
  // store name matches the pre-wipe dump, and every restored row is backed
  // by a live catalog item. (The import model restores items that have list
  // rows — seed catalog items with no rows are not restorable and are not
  // part of the gate.)
  const res = await request.get('/api/v1/export?format=json');
  expect(res.ok()).toBeTruthy();
  const after = (await res.json()) as ExportPayload;
  const storeNameOf = (payload: ExportPayload, storeId: string): string =>
    payload.stores.find((s) => s.id === storeId)?.name ?? '';
  expect(after.listItems).toHaveLength(before.listItems.length);
  const itemNames = new Set(after.items.map((i) => i.name));
  expect(after.listItems.map((r) => r.name).sort()).toEqual(before.listItems.map((r) => r.name).sort());
  for (const name of after.listItems.map((r) => r.name)) {
    expect(itemNames.has(name)).toBe(true);
  }
  const rowKey = (payload: ExportPayload): string[] =>
    payload.listItems.map((r) => `${storeNameOf(payload, r.storeId)} · ${r.name}`).sort();
  expect(rowKey(after)).toEqual(rowKey(before));
  expect(after.stores.map((s) => s.name).sort()).toEqual(before.stores.map((s) => s.name).sort());

  // Home renders the restored board — every row active, so the counters are
  // the full demo totals.
  await page.goto('/');
  await expect(page.locator('section[aria-label="Costco"]')).toContainText('5 to buy');
  await expect(page.locator('section[aria-label="Indian Store"]')).toContainText('9 to buy');
  await expect(page.locator('section[aria-label="Target"]')).toContainText('6 to buy');
});
