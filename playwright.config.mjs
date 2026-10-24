import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8787',
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node server.cjs',
    url: 'http://localhost:8787/api/health',
    reuseExistingServer: true,
    timeout: 30_000
  }
});
