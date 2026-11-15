import { expect, test } from '@playwright/test';

test('healthz returns the contract shape (G0.1)', async ({ request }) => {
  const res = await request.get('/healthz');
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ status: 'ok' });
  expect(typeof body['version']).toBe('string');
  expect(typeof body['revision']).toBe('string');
  expect(typeof body['uptime']).toBe('number');
});

test('home renders the nav shell with the tab bar (G0.6)', async ({ page }) => {
  await page.goto('/');
  const tabBar = page.getByRole('navigation', { name: 'Primary' });
  await expect(tabBar).toBeVisible();
  await expect(tabBar.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(tabBar.getByRole('link', { name: 'Catalog' })).toBeVisible();
  await expect(tabBar.getByRole('link', { name: 'Stores' })).toBeVisible();
  await expect(tabBar.getByRole('button', { name: 'More' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
});

test('all primary routes are reachable (G0.6)', async ({ page }) => {
  for (const route of ['/', '/catalog', '/stores', '/categories', '/data', '/settings']) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1')).toBeVisible();
  }
});

test('More sheet opens, navigates, and closes on Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'More' }).click();
  const dialog = page.getByRole('dialog', { name: 'More' });
  await expect(dialog).toBeVisible();
  for (const label of ['Categories', 'Data', 'Settings']) {
    await expect(dialog.getByRole('link', { name: label })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('SPA deep links fall back to index.html', async ({ page }) => {
  await page.goto('/store/01913b5e-7d5a-7000-8000-000000000001');
  await expect(page.getByRole('heading', { name: /Shop Mode/ })).toBeVisible();
});

test('keyboard path reaches the skip link first', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});
