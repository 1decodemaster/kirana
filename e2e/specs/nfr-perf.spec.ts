import { expect, test } from '@playwright/test';

/** §10 NFR-4 / NFR-6 measurements (G5.1, T-P5-02).
 *
 * NFR-6 probes the click → `aria-checked` mutation delta entirely inside the
 * page (a synthetic click + MutationObserver), so the number is the app's
 * optimistic-update path, not Playwright protocol overhead.
 *
 * NFR-4 is a proxy for "TTI ≤ 1.5s on a mid-range Android over LAN": 4× CPU
 * throttling (CDP) on the local server, measured to the first Home content.
 * Real-device numbers belong to the manual device pass (see PHASE-5).
 */

test('NFR-6: checkbox toggle reaches the DOM in ≤ 16ms (in-page probe)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Costco' })).toBeVisible();

  const label = await page.getByRole('checkbox').first().getAttribute('aria-label');
  if (label === null) throw new Error('the first checkbox has no aria-label');

  const deltas: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    // Re-locate every iteration: §6.8 re-sorts rows on toggle, so a stale
    // handle could point at a moved row.
    await page.getByRole('checkbox', { name: label }).waitFor();
    const delta = await probeToggle(page, label);
    deltas.push(delta);
  }
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const max = Math.max(...deltas);
  console.info(`NFR-6 toggle→DOM: mean ${mean.toFixed(2)}ms max ${max.toFixed(2)}ms over ${deltas.length} toggles`);
  expect(mean).toBeLessThanOrEqual(16);
});

function probeToggle(page: import('@playwright/test').Page, label: string): Promise<number> {
  return page.evaluate(
    (ariaLabel) =>
      new Promise<number>((resolve, reject) => {
        const btn = document.querySelector(
          `[role="checkbox"][aria-label="${CSS.escape(ariaLabel)}"]`,
        ) as HTMLButtonElement | null;
        if (btn === null) {
          reject(new Error('checkbox not found'));
          return;
        }
        const observer = new MutationObserver(() => {
          observer.disconnect();
          clearTimeout(giveUp);
          resolve(performance.now() - t0);
        });
        observer.observe(btn, { attributes: true, attributeFilter: ['aria-checked'] });
        const giveUp = setTimeout(() => {
          observer.disconnect();
          reject(new Error('no aria-checked mutation within 500ms'));
        }, 500);
        const t0 = performance.now();
        btn.click();
      }),
    label,
  );
}

test('NFR-4 proxy: throttled warm load renders Home in ≤ 1.5s (4× CPU, LAN)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Costco' })).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const t0 = Date.now();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Costco' })).toBeVisible();
  const warmMs = Date.now() - t0;

  // Cold (empty cache, throttled from the first byte) — recorded, not gated:
  // a first visit also pays SW registration, which the NFR's "returning
  // user over LAN" scenario does not.
  await cdp.send('Network.clearBrowserCache');
  const t1 = Date.now();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Costco' })).toBeVisible();
  const coldMs = Date.now() - t1;

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.info(`NFR-4 proxy @4× CPU: warm ${warmMs}ms, cold(no cache) ${coldMs}ms`);
  expect(warmMs).toBeLessThanOrEqual(1500);
});
