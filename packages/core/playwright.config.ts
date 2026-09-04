import type { ChromaticConfig } from '@chromatic-com/playwright';
import { defineConfig, devices } from '@playwright/test';

// Use process.env.PORT by default and fallback to port 3008
// to avoid conflicts with the Next.js default port 3000.
const PORT = process.env.PORT || '3008';

// Set webServer.url and use.baseURL with the location of the WebServer respecting the correct set port.
// PLAYWRIGHT_BASE_URL overrides the whole thing, host included: a worktree can
// serve the app on its own hostname so its session cookie does not collide
// with another checkout's, and the tests have to talk to that same hostname or
// every sign-in fails the host check. Unset in CI, so nothing changes there.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<ChromaticConfig>({
  testDir: './tests',
  // Look for files with the .spec.js or .e2e.js extension
  testMatch: '*.@(spec|e2e).?(c|m)[jt]s?(x)',
  // Timeout per test, test running locally are slower due to database connections with PGLite
  timeout: 30 * 1000,
  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,
  // Reporter to use. See https://playwright.dev/docs/test-reporters
  reporter: process.env.CI ? 'github' : 'list',

  expect: {
    // Set timeout for async expect matchers
    timeout: 15 * 1000,
  },

  // Run your local dev server before starting the tests:
  // https://playwright.dev/docs/test-advanced#launching-a-development-web-server-during-the-tests
  webServer: {
    command: process.env.CI ? 'npx run-p db-server:memory start --race' : 'npx run-p db-server:memory dev:next --race',
    url: baseURL,
    timeout: 60 * 1000,
    reuseExistingServer: !process.env.CI,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 2 * 1000 },
    env: {
      NEXT_PUBLIC_SENTRY_DISABLED: 'true',
      NEXT_PUBLIC_APP_URL: baseURL,
      PORT,
    },
  },

  // Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions.
  use: {
    // Use baseURL so to make navigations relative.
    // More information: https://playwright.dev/docs/api/class-testoptions#test-options-base-url
    baseURL,

    // Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer
    trace: process.env.CI ? 'on' : 'retain-on-failure',

    // Record videos when retrying the failed test.
    video: process.env.CI ? 'retain-on-failure' : undefined,

    // Disable automatic screenshots at test completion when using Chromatic test fixture.
    disableAutoSnapshot: true,
  },

  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/, teardown: 'teardown' },
    { name: 'teardown', testMatch: /.*\.teardown\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    // The headless usage-video tour (F1 storyboard). Self-seeding: signs up
    // the first-run admin on a FRESH PGlite DB, so no Clerk setup project
    // and no dependencies. One long cinematic spec — generous timeout.
    // Run with: npx playwright test --project=tour  (see e2e/tour/README.md)
    {
      name: 'tour',
      testDir: './e2e/tour',
      timeout: 240 * 1000,
      retries: 0,
      use: { ...devices['Desktop Chrome'], video: 'on', trace: 'off' },
    },
    // The review-queue end-to-end specs. Self-seeding like `tour` (the sign-up
    // route is invite-only), so no Clerk setup project and no dependencies.
    // Run with: npx playwright test --project=queue
    {
      name: 'queue',
      testDir: './e2e/queue',
      timeout: 120 * 1000,
      use: { ...devices['Desktop Chrome'] },
    },
    // The feedback-to-learning loop end to end. Self-seeding like `queue`.
    // Run with: npx playwright test --project=learning
    {
      name: 'learning',
      testDir: './e2e/learning',
      timeout: 120 * 1000,
      use: { ...devices['Desktop Chrome'] },
    },
    // The same loop against a REAL model, end to end. Defined only when
    // LIVE_MODEL_E2E is set, so `npx playwright test` — locally or in CI —
    // never spends money or reaches an external service by default.
    // Run with:
    //   LIVE_MODEL_E2E=1 DATABASE_URL=... npx playwright test --project=learning-live
    ...(process.env.LIVE_MODEL_E2E
      ? [
          {
            name: 'learning-live',
            testDir: './e2e/learning-live',
            // Each assertion waits on a queue round trip plus two model calls.
            timeout: 300 * 1000,
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
    // The API credentials matrix (platforms, validation, expiry rules).
    // Self-seeding like `tour`: bootstraps its own admin on a fresh PGlite DB,
    // so no Clerk setup project and no dependencies.
    // Run with: npx playwright test --project=credentials
    {
      name: 'credentials',
      testDir: './e2e/credentials',
      // Generous: each test signs in fresh, and the first few pay for cold
      // Turbopack compiles of the sign-in, dashboard and credentials routes.
      timeout: 120 * 1000,
      use: { ...devices['Desktop Chrome'] },
    },
    ...(process.env.CI
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
            dependencies: ['setup'],
          },
        ]
      : []),
  ],
});
