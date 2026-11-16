import { expect, test, type APIRequestContext } from '@playwright/test';
import { openDatabase } from '@kirana/db';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression specs for user-reported add-flow + Home UX bugs.
// State hygiene: probe stores are hard-deleted (before + after) — the stores
// table's unique name index covers soft-deleted rows, so an API delete would
// block the next run. Same DB-reset pattern as support.ts.

const PROBE_STORES = 20;

const DB_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'kirana.db');

function purgeProbeStores(): void {
  const db = openDatabase(DB_FILE);
  try {
    db.transaction(() => {
      const rows = db
        .prepare("SELECT id FROM stores WHERE name LIKE 'UX Probe%'")
        .all() as Array<{ id: string }>;
      for (const { id } of rows) {
        db.prepare('DELETE FROM change_log WHERE store_id = ?').run(id);
        db.prepare('DELETE FROM stores WHERE id = ?').run(id);
      }
    })();
  } finally {
    db.close();
  }
}

test.beforeAll(() => {
  purgeProbeStores();
});

test.afterAll(() => {
  purgeProbeStores();
});

async function createProbeStores(
  request: APIRequestContext,
  prefix: string,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const res = await request.post('/api/v1/stores', {
      data: { name: `UX Probe ${prefix} ${i}`, iconKind: 'emoji', iconRef: '🏬' },
      headers: { 'x-requested-with': 'kirana' },
    });
    if (res.status() !== 201) {
      throw new Error(`create store ${prefix} ${i} → ${res.status()} ${await res.text()}`);
    }
    ids.push(((await res.json()) as { store: { id: string } }).store.id);
  }
  return ids;
}

test('pick-store sheet scrolls to reach every store', async ({ page, request }) => {
  await createProbeStores(request, 'A', PROBE_STORES);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add item' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // The pane must cap at the viewport (not grow past it) and scroll.
  const metrics = await dialog.evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  expect(metrics.overflowY).toBe('auto');
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  const last = dialog.getByRole('button', { name: `🏬 UX Probe A ${PROBE_STORES}` });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();

  // Swiped to the very end, the bottom row keeps breathing room above the
  // pane's bottom edge (the sheet's 32px + the list's 8px end padding), so it
  // never looks truncated.
  const gap = await dialog.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    const buttons = el.querySelectorAll('ul button');
    const lastButton = buttons[buttons.length - 1];
    if (lastButton === undefined) return -1;
    return el.getBoundingClientRect().bottom - lastButton.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(36);
});

test('category pill row stays inside the add sheet', async ({ page, request }) => {
  await createProbeStores(request, 'B', 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add item' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /UX Probe B 1/ }).click();
  const addSheet = page.getByRole('dialog');
  await expect(addSheet.getByText('Item', { exact: true })).toBeVisible();

  const pillRow = addSheet.locator('div.overflow-x-auto').first();
  const metrics = await pillRow.evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  // The row is constrained to the drawer (the fieldset min-width bug used to
  // let it grow to its full scroll width and shove the sheet off-screen).
  expect(metrics.clientWidth).toBeLessThanOrEqual(page.viewportSize()?.width ?? 375);
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

  // The page itself never gains horizontal scroll…
  const pageX = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(pageX).toBe(false);
  // …and the last pill is reachable inside the row's own scroll. Two seeded
  // 'Other' rows exist (grocery + household) — take the last one.
  const lastPill = pillRow.getByRole('button', { name: /Other/ }).last();
  await lastPill.scrollIntoViewIfNeeded();
  await expect(lastPill).toBeVisible();
});

test('add sheet text is legible in dark mode', async ({ page, request }) => {
  await createProbeStores(request, 'C', 1);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add item' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /UX Probe C 1/ }).click();
  const addSheet = page.getByRole('dialog');
  await expect(addSheet.getByText('Item', { exact: true })).toBeVisible();

  const colors = await addSheet.evaluate((el) => ({
    sheetColor: getComputedStyle(el).color,
    sheetBg: getComputedStyle(el).backgroundColor,
  }));
  // Dark surface (#111827) must carry light text, never the UA black.
  expect(colors.sheetColor).not.toBe('rgb(0, 0, 0)');
  expect(colors.sheetBg).toBe('rgb(17, 24, 39)');
});

test('the + button slides away at the bottom of Home', async ({ page, request }) => {
  // One archived store guarantees the Archived section exists below.
  await createProbeStores(request, 'D', 1);
  const board = (await (await request.get('/api/v1/board')).json()) as {
    stores: Array<{ id: string; name: string }>;
  };
  const probe = board.stores.find((s) => s.name === 'UX Probe D 1');
  if (probe === undefined) throw new Error('probe store missing');
  await request.patch(`/api/v1/stores/${probe.id}`, {
    data: { status: 'archived' },
    headers: { 'x-requested-with': 'kirana' },
  });

  await page.goto('/');
  const fab = page.getByRole('button', { name: 'Add item' });
  await expect(fab).toBeVisible();

  await page.mouse.wheel(0, 100_000);
  await page.waitForTimeout(250);
  await expect(fab).toBeHidden(); // visibility:hidden → out of the tab order too

  await page.mouse.wheel(0, -100_000);
  await page.waitForTimeout(250);
  await expect(fab).toBeVisible();
});
