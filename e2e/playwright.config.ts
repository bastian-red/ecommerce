import { defineConfig, devices } from '@playwright/test';

const WEB_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  // Serial on purpose. The oversell spec races two browsers for one unit of
  // stock, and a parallel run of the other specs would consume that stock from
  // underneath it. The suite is small enough that the wall-clock cost is minor
  // and much cheaper than a flaky proof.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The demo spec writes screenshot frames for the README GIF and is slowed
  // down on purpose, so the normal suite skips it. scripts/demo-gif.sh sets
  // DEMO=1 to let it through. A CLI --grep cannot override grepInvert, which is
  // why this is an env check rather than a constant.
  grepInvert: process.env.DEMO ? undefined : /@demo/,
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  // The stack (web, api, postgres, redis) is started before this runs:
  // by scripts/e2e.sh locally, by the workflow in CI.
});
