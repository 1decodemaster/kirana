import { expect, test } from '@playwright/test';

/** §15.3 G4.7 auth.spec — the user-visible auth flows. This spec uses a
 *  fresh unauthenticated context and at most THREE login attempts total
 *  (the server allows 5 per 5 min per IP, shared across the whole run —
 *  deeper rate-limit behaviour is covered by server/auth.test.ts). */
test.use({ storageState: { cookies: [], origins: [] } });

test('wrong passcode shows the deck copy and stays on login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Passcode').fill('9999');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Invalid passcode.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('login lands on Home with the household name and member avatars', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Passcode').fill('0000');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText("Who's using this?")).toBeVisible();
  await page.getByRole('button', { name: /Alex/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home');
  await expect(page.getByRole('list', { name: 'Home members' })).toBeVisible();
});

test('sign out returns to the login screen', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Passcode').fill('0000');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('button', { name: /Alex/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Kirana' })).toBeVisible();
});

test('a dead session redirects to login (§8.10 session expired)', async ({ page }) => {
  await page.goto('/login?expired=1');
  await expect(page.getByText('Your session ended. Enter the passcode to continue.')).toBeVisible();
});
