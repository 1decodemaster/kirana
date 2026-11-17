import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// A fixed non-8080 port keeps the suite independent of any dev server or
// container that may already be bound to 8080 on this machine.
const PORT = Number(process.env.E2E_PORT ?? 8090);

/** Saved sessions from the setup-auth projects; every browser project starts
 * logged in (§7.6) with its OWN session, so the §11 per-session mutation
 * budget (120/min) is never shared across the two viewport runs. */
export const AUTH_STATE_MOBILE = path.join(process.cwd(), '.tmp', 'auth-mobile.json');
export const AUTH_STATE_PIXEL = path.join(process.cwd(), '.tmp', 'auth-pixel.json');

export default defineConfig({
  testDir: './specs',
  // Mutation specs share one server-side DB and depend on in-file ordering;
  // a single worker with sequential files keeps runs deterministic (the 2
  // projects still cover both viewports).
  workers: 1,
  fullyParallel: false,
  globalSetup: './global-setup.ts',
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    // Declaration order = execution order (workers:1): mobile's whole run —
    // including first-run's identity wipes — completes before the pixel
    // project logs in, so its session can never be wiped mid-run.
    { name: 'setup-auth-mobile', testMatch: /auth-setup\.spec\.ts/ },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        storageState: AUTH_STATE_MOBILE,
      },
      dependencies: ['setup-auth-mobile'],
    },
    { name: 'setup-auth-pixel', testMatch: /auth-setup\.spec\.ts/, dependencies: ['mobile-chrome'] },
    {
      name: 'pixel-7',
      use: { ...devices['Pixel 7'], storageState: AUTH_STATE_PIXEL },
      dependencies: ['setup-auth-pixel'],
    },
  ],
  webServer: {
    command: 'node ../server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      SESSION_SECRET: 'e2e-secret',
      // One IP serves every spec in the run — the §11 defaults (5 logins and
      // 120 mutations per minute) would starve a whole suite sharing one
      // session; the production defaults are pinned by server unit tests.
      LOGIN_RATE_LIMIT: '50',
      MUTATION_RATE_LIMIT: '2000',
      WEB_DIST_DIR: '../web/dist',
      KIRANA_REVISION: 'e2e',
      LOG_LEVEL: 'warn',
      DATABASE_URL: path.join(process.cwd(), '.tmp', 'kirana.db'),
      // R-013: the server defaults dataDir to /data (the container volume),
      // which EACCESes on this host — POST /admin/backup needs a writable dir.
      DATA_DIR: path.join(process.cwd(), '.tmp'),
    },
  },
});
