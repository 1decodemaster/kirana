import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 667 } } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node ../server/dist/index.js',
    url: 'http://127.0.0.1:8080/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      PORT: '8080',
      SESSION_SECRET: 'e2e-secret',
      WEB_DIST_DIR: '../web/dist',
      KIRANA_REVISION: 'e2e',
      LOG_LEVEL: 'warn',
    },
  },
});
