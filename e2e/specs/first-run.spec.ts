import { expect, test } from '@playwright/test';
import { DEMO_PASSCODE } from '@kirana/db';
import { AUTH_STATE_MOBILE, AUTH_STATE_PIXEL } from '../playwright.config';
import { restoreDemoBoard, wipeIdentityData } from './support';

/** §19 first-run.spec — wizard → first store → empty Home (§8.9).
 *  The harness db is seeded, so the identity rows are wiped for the wizard
 *  and the canonical demo board (plus a fresh auth state) is restored
 *  afterwards. Unauthenticated context: the wizard is the pre-session flow. */
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(() => {
  wipeIdentityData();
});

test.afterEach(async ({ request }) => {
  wipeIdentityData();
  await restoreDemoBoard();
  // The wipe killed every session — re-login and refresh THIS project's
  // storage state. The other project's setup-auth runs later in the run and
  // saves its own fresh session.
  const response = await request.post('/api/v1/auth/login', {
    data: { passcode: DEMO_PASSCODE, displayName: 'Alex' },
    headers: { 'x-requested-with': 'kirana' },
  });
  expect(response.ok()).toBeTruthy();
  const stateFile =
    test.info().project.name === 'pixel-7' ? AUTH_STATE_PIXEL : AUTH_STATE_MOBILE;
  await request.storageState({ path: stateFile });
});

test('wizard → first store → empty Home with the coach-mark', async ({ page }) => {
  await page.goto('/welcome');
  await page.getByRole('textbox', { name: 'Household name' }).fill('E2E Home');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('textbox', { name: 'Create a passcode' }).fill('4321');
  await page.getByRole('textbox', { name: 'Confirm passcode' }).fill('4321');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Priya');
  await page.getByRole('radio', { name: /Color #059669/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  // Step 4: seed starter categories (default on) — proceed.
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('textbox', { name: 'Store name' }).fill('Corner Shop');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E Home');
  await expect(page.getByText('Corner Shop')).toBeVisible();
  // §8.9 step 6: the coach-mark on the + until the first add.
  await expect(page.getByText('Tap + to add your first item')).toBeVisible();
});

test('a second household is refused with the deck copy', async ({ page, request }) => {
  // Self-contained: a household already exists (the wizard would 403 even
  // if this test ran in isolation).
  const created = await request.post('/api/v1/household', {
    data: { name: 'First', passcode: '4321', displayName: 'Priya', color: '#4F46E5' },
    headers: { 'x-requested-with': 'kirana' },
  });
  expect(created.status()).toBe(201);
  await page.goto('/welcome');
  await page.getByRole('textbox', { name: 'Household name' }).fill('Second');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('textbox', { name: 'Create a passcode' }).fill('4321');
  await page.getByRole('textbox', { name: 'Confirm passcode' }).fill('4321');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Zed');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByText('A household already exists.')).toBeVisible();
  // The refusal comes with an obvious exit (§8.10 deck string reused).
  await expect(page.getByRole('link', { name: 'Already set up? Sign in' })).toBeVisible();
});
