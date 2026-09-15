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

const CI = !!process.env.CI;

// CI fails fast. Every failure this suite has produced so far was
// deterministic (a fixture that could not seed, a stale assertion, a server
// that would not answer), so the first one is the whole story; letting the
// rest run only pushed the job into its timeout, where Playwright never got
// to print its summary. Locally the full picture is more useful, so these
// stay off. The per-project timeouts below follow the same rule: generous
// locally, tight in CI so a hung spec dies in well under a minute.
const projectTimeout = (localMs: number, ciMs: number) => (CI ? ciMs : localMs);

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
  forbidOnly: CI,
  // Stop at the first failure in CI (see above). 0 means no limit.
  maxFailures: CI ? 1 : 0,
  // A healthy run takes three to five minutes on the CI runner; eight caps a
  // pathological one and still leaves the job time to upload its artifacts.
  globalTimeout: CI ? 8 * 60 * 1000 : 0,
  // Reporter to use. See https://playwright.dev/docs/test-reporters
  // `github` alone prints one dot per test and its annotations only at the
  // end, so a cancelled job leaves nothing readable; `list` streams one line
  // per test as it finishes.
  reporter: CI ? [['list'], ['github']] : 'list',

  expect: {
    // Set timeout for async expect matchers
    timeout: CI ? 10 * 1000 : 15 * 1000,
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
      // Auth.js only trusts the request host when AUTH_URL or AUTH_TRUST_HOST
      // is set, or when NODE_ENV is not production (@auth/core lib/utils/env.js).
      // `next dev` gets the last fallback; CI runs `next start`, so without this
      // every /api/auth call answers UntrustedHost and the browser specs time out.
      AUTH_URL: baseURL,
      // The local credential vault refuses to mint an ephemeral key when
      // NODE_ENV is production (libs/crypto/localVault.ts), and CI runs
      // `next start`, so without a key every "Save key" in the credentials
      // specs answers "could not store key". Fixed, throwaway, and public on
      // purpose: it encrypts test fixtures in a database that lives for the
      // length of one run. Never reuse it anywhere real.
      VOCION_CREDENTIAL_VAULT_KEY: process.env.VOCION_CREDENTIAL_VAULT_KEY ?? 'ZTJlLW9ubHktdmF1bHQta2V5LW5vdC1hLXNlY3JldCE=',
      PORT,
    },
  },

  // Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions.
  use: {
    // Use baseURL so to make navigations relative.
    // More information: https://playwright.dev/docs/api/class-testoptions#test-options-base-url
    baseURL,

    // In CI a single click or navigation that never completes dies on its own
    // and the error names the step, instead of surfacing as the whole test's
    // timeout with no hint of where it stalled. Unlimited locally, as before.
    actionTimeout: CI ? 10 * 1000 : 0,
    navigationTimeout: CI ? 15 * 1000 : 0,

    // Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer
    trace: CI ? 'on' : 'retain-on-failure',

    // Record videos when retrying the failed test.
    video: CI ? 'retain-on-failure' : undefined,

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
    // the first-run admin on a FRESH PGlite DB, so no `setup` project
    // dependency. One long cinematic spec — generous timeout.
    //
    // Defined only outside CI. It records a marketing video rather than
    // guarding behaviour: it holds still on purpose (`dwell`), takes minutes,
    // and nothing reads its webm from a CI run. It is also the one project
    // whose subject is the sample-workspace seeder rather than an app route,
    // so a product change there stops pull requests on a video.
    // Run with: npx playwright test --project=tour  (see e2e/tour/README.md)
    ...(CI
      ? []
      : [
          {
            name: 'tour',
            testDir: './e2e/tour',
            timeout: 240 * 1000,
            retries: 0,
            use: { ...devices['Desktop Chrome'], video: 'on' as const, trace: 'off' as const },
          },
        ]),
    // The review-queue end-to-end specs. Self-seeding like `tour` (the sign-up
    // route is invite-only), so no `setup` project dependency.
    // Run with: npx playwright test --project=queue
    {
      name: 'queue',
      testDir: './e2e/queue',
      timeout: projectTimeout(120 * 1000, 60 * 1000),
      use: { ...devices['Desktop Chrome'] },
    },
    // The feedback-to-learning loop end to end. Self-seeding like `queue`.
    // Run with: npx playwright test --project=learning
    {
      name: 'learning',
      testDir: './e2e/learning',
      timeout: projectTimeout(120 * 1000, 60 * 1000),
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
    // so no `setup` project dependency.
    // Run with: npx playwright test --project=credentials
    {
      name: 'credentials',
      testDir: './e2e/credentials',
      // Generous: each test signs in fresh, and the first few pay for cold
      // Turbopack compiles of the sign-in, dashboard and credentials routes.
      timeout: projectTimeout(120 * 1000, 60 * 1000),
      use: { ...devices['Desktop Chrome'] },
    },
    // VEERIO-252 — mission-run report routes, real HTTP against a real
    // running app. No browser: uses Playwright's `request` fixture only, so
    // it never depends on the `setup` (Clerk) project.
    // Run with: npx playwright test --project=mission-runs
    {
      name: 'mission-runs',
      testDir: './e2e/mission-runs',
      timeout: 60 * 1000,
    },
    // VEERIO-262 — what a proposal did (created / refreshed / already_decided),
    // over real HTTP against a real running app. No browser: uses the
    // `request` fixture only, so it never depends on the `setup` project.
    // Run with: npx playwright test --project=reviews-propose
    {
      name: 'reviews-propose',
      testDir: './e2e/reviews-propose',
      timeout: 60 * 1000,
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
