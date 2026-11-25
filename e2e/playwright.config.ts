import { defineConfig } from '@playwright/test';

/**
 * Smoke tests against a running stack (./run.sh setup && ./run.sh dev).
 * Install browsers once with `npx playwright install chromium`, then `npm run test:e2e`.
 * Not run in CI: the workflow has no browser binaries (see docs/testing/test-strategy.md).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  outputDir: './test-results',
  reporter: [['list'], ['html', { outputFolder: './report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5109',
    trace: 'retain-on-failure',
  },
});
