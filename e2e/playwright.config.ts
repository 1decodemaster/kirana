import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// A fixed non-8080 port keeps the suite independent of any dev server or
// container that may already be bound to 8080 on this machine.
const PORT = Number(process.env.E2E_PORT ?? 8090);

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
    { name: 'mobile-chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 667 } } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node ../server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      SESSION_SECRET: 'e2e-secret',
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
