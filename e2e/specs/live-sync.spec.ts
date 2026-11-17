import { expect, test, type Page } from '@playwright/test';

/** §15.3 G4.1: add (check) on browser A appears on browser B within 1s —
 * two contexts over the §7.5 SSE stream. Both reuse the saved session. */

async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Costco' })).toBeVisible();
}

test('a check on A reaches B within one second', async ({ browser }) => {
  const contextA = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const contextB = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await openHome(pageA);
  await openHome(pageB);

  // Pick an unchecked row and toggle it on A; B must reflect it ≤1s later.
  const boxes = pageA.getByRole('checkbox');
  const count = await boxes.count();
  let label: string | null = null;
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    if ((await box.getAttribute('aria-checked')) === 'false') {
      label = await box.getAttribute('aria-label');
      break;
    }
  }
  expect(label).not.toBeNull();
  const rowA = pageA.getByRole('checkbox', { name: label ?? '' });
  const rowB = pageB.getByRole('checkbox', { name: label ?? '' });
  const before = await rowB.getAttribute('aria-checked');

  const start = Date.now();
  await rowA.click();
  await expect
    .poll(async () => await rowB.getAttribute('aria-checked'), { timeout: 2000 })
    .not.toBe(before);
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(1000);

  // Restore the demo state for the specs that follow (checked_by etc.).
  await rowA.click();
  await contextA.close();
  await contextB.close();
});
