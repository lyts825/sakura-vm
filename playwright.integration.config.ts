import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './integration',
  workers: 1,
  fullyParallel: false,
  timeout: 600000,
  expect: { timeout: 15000 },
  use: { browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: 'test-results/integration',
});
