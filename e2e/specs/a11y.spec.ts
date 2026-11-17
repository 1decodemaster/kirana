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
