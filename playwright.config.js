import { defineConfig, devices } from '@playwright/test';

/**
 * Overridable so a worktree or a second checkout can run its own server
 * instead of colliding on one port: `PORT=8181 npm run test:e2e`.
 */
const PORT = Number(process.env.PORT) || 8080;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only. One retry still absorbs a runner hiccup; two just
   * hid flakiness and tripled the cost of a real failure. */
  retries: process.env.CI ? 1 : 0,
  /* Two workers per runner (GitHub-hosted runners have 2+ cores); sharding
   * across jobs in test.yml supplies the rest of the parallelism. */
  workers: process.env.CI ? 2 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: BASE_URL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Snapshots are compared against a fixed platform, not the machine that ran
   * them: rendering differs enough between macOS and Linux that per-OS
   * baselines would drift apart and nobody would trust either. CI is Linux, so
   * Linux is the reference — regenerate with `npm run test:visual:update`,
   * which runs the same Playwright image in Docker. */
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',

  projects: [
    {
      // Everything that is not viewport- or pixel-specific.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/responsive/**', '**/visual/**'],
    },
    {
      // 393px — well inside the ≤768px branch.
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: '**/responsive/**',
    },
    {
      // Exactly on the boundary: `(max-width: 1023px)` still matches here, so
      // this pins the last mobile width, the one off-by-one CSS edits break.
      // (A tablet gets the mobile layout; there is no tablet layout.)
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1023, height: 1024 },
        hasTouch: true,
      },
      testMatch: '**/responsive/**',
    },
    {
      // Safari's engine (the one iOS / iPadOS users run) on the specs that
      // exercise editing, pagination and export. Run with `npm run test:webkit`;
      // CI runs it on every pull request.
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: [
        '**/diary-pagination.spec.js',
        '**/diary-navigation.spec.js',
        '**/diary-undo.spec.js',
        '**/print-parity.spec.js',
        '**/editor-spaces.spec.js',
        '**/unsupported-docs.spec.js',
        '**/history.spec.js',
        '**/startup-document.spec.js',
        '**/tables-images.spec.js',
      ],
    },
    {
      // Linux-baseline only — see snapshotPathTemplate above. Run separately
      // (`npm run test:visual`) so a Mac checkout is not red by default.
      name: 'visual',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/visual/**',
    },
  ],

  /* Run your local dev server before starting the tests.
   *
   * Never reuse a server we did not start. Playwright only checks that
   * *something* answers on the port — it cannot tell whose `editor/` is being
   * served. A dev server left running by another checkout (or by the editor
   * preview) will happily serve that other tree while these tests report
   * green, which is the worst possible failure: a passing suite that never ran
   * against the code under test. Failing loudly with "port in use" is correct;
   * set PORT to run alongside something else. */
  webServer: {
    command: `python3 scripts/serve.py ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
  },
});
