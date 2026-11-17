import { expect, test } from '@playwright/test';
import { DEMO_PASSCODE } from '@kirana/db';
import { AUTH_STATE_MOBILE, AUTH_STATE_PIXEL } from '../playwright.config';

/** Login once per viewport project and save the session cookie: each browser
 * project depends on its own setup project and starts authed (§7.6), so
 * specs never spend the 5-per-5-min login budget and never share a §11
 * mutation budget. */
test('authenticate and save the storage state', async ({ request }) => {
  const stateFile =
    test.info().project.name === 'setup-auth-pixel' ? AUTH_STATE_PIXEL : AUTH_STATE_MOBILE;
  const response = await request.post('/api/v1/auth/login', {
    data: { passcode: DEMO_PASSCODE, displayName: 'Alex' },
    headers: { 'x-requested-with': 'kirana' },
  });
  expect(response.ok()).toBeTruthy();
  await request.storageState({ path: stateFile });
});
