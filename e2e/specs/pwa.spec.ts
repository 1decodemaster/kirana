import { expect, test } from '@playwright/test';

/** §15.3 G4.4: the installability primitives — a complete manifest, an
 *  activated service worker, and an offline shell that loads. (A Lighthouse
 *  installability run is manual; it checks exactly these primitives plus
 *  HTTPS, which is a deployment property, not an app one.) */

test('the manifest is complete and served', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('link[rel="manifest"]');
  await expect(link).toHaveAttribute('href', '/manifest.webmanifest');
  const manifest = await page.evaluate(async () => {
    const response = await fetch('/manifest.webmanifest');
    return (await response.json()) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      display?: string;
      theme_color?: string;
      icons?: Array<{ src: string; sizes: string; purpose: string }>;
    };
  });
  expect(manifest.name).toBe('Kirana');
  expect(manifest.short_name).toBe('Kirana');
  expect(manifest.start_url).toBe('/');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons).toHaveLength(4);
  // 192 + 512 in both any and maskable flavours (Chrome installability).
  const sizes = manifest.icons?.map((icon) => icon.sizes) ?? [];
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(manifest.icons?.filter((icon) => icon.purpose === 'maskable')).toHaveLength(2);
  // Every icon actually resolves.
  for (const icon of manifest.icons ?? []) {
    const head = await page.request.head(icon.src ?? '');
    expect(head.ok(), icon.src ?? 'icon').toBeTruthy();
  }
});

test('the service worker activates and the offline shell loads (G4.4)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await new Promise<void>((resolve) => {
      if (registration.active?.state === 'activated') return resolve();
      registration.active?.addEventListener('statechange', () => {
        if (registration.active?.state === 'activated') resolve();
      });
    });
  });
  // The precache holds the shell and its hashed assets (parsed from
  // index.html at install — a cold first visit must open offline).
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const name = names[0];
    if (name === undefined) return [];
    const keys = await (await caches.open(name)).keys();
    return keys.map((request) => request.url);
  });
  expect(cached.some((url) => url.endsWith('/'))).toBe(true);
  expect(cached.some((url) => url.includes('/assets/') && url.endsWith('.js'))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  // The shell renders from the SW cache — offline reading works (§8.7).
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await context.setOffline(false);
  await context.close();
});
