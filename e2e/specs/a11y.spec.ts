import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** §15.3 G4.5: axe-core, zero critical violations on Home, the add sheet
 *  and Catalog. Serious violations are held to the same bar (the scan that
 *  shaped this phase found and fixed three). */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoCriticalOrSerious(
  page: import('@playwright/test').Page,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(blocking, `${label}: ${JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })))}`).toEqual([]);
}

test('Home has zero critical axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Costco' })).toBeVisible();
  await expectNoCriticalOrSerious(page, 'Home');
});

test('the add sheet has zero critical axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Costco' })).toBeVisible();
  // More than one active store → the + opens the pick-store sheet first.
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Costco/ }).click();
  await expect(page.getByRole('dialog', { name: 'Add to Costco' })).toBeVisible();
  await expectNoCriticalOrSerious(page, 'Add sheet');
});

test('Catalog has zero critical axe violations', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
  await expectNoCriticalOrSerious(page, 'Catalog');
});

// ── P5 final pass: the remaining screens, same bar (T-P5-02) ──────────────

test('Stores has zero critical axe violations', async ({ page }) => {
  await page.goto('/stores');
  await expect(page.getByRole('heading', { name: 'Stores' })).toBeVisible();
  await expectNoCriticalOrSerious(page, 'Stores');
});

test('Categories has zero critical axe violations', async ({ page }) => {
  await page.goto('/categories');
  await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
  await expectNoCriticalOrSerious(page, 'Categories');
});

test('Item detail has zero critical axe violations', async ({ page, request }) => {
  const res = await request.get('/api/v1/items?limit=1');
  const { items } = (await res.json()) as { items: Array<{ id: string }> };
  const first = items[0];
  if (first === undefined) throw new Error('catalog is empty');
  await page.goto(`/catalog/${first.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoCriticalOrSerious(page, 'Item detail');
});

test('Data has zero critical axe violations', async ({ page }) => {
  await page.goto('/data');
  await expect(page.getByRole('heading', { name: 'Data' })).toBeVisible();
  await expectNoCriticalOrSerious(page, 'Data');
});

test('Settings has zero critical axe violations', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expectNoCriticalOrSerious(page, 'Settings');
});

test('Login has zero critical axe violations', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Kirana' })).toBeVisible();
  await expectNoCriticalOrSerious(page, 'Login');
  await context.close();
});
