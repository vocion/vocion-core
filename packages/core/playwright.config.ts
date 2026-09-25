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

// PLAYWRIGHT_PGLITE_PORT moves the local in-memory PGlite off 5432, so a
// plain run works on a machine where Docker Postgres already holds that port
// (`npm run dev:up` publishes it there). The app, its migrations
// and the seed scripts the specs spawn all have to reach the same database,
// so DATABASE_URL is set here, in the runner's own environment: the web
// server and every worker inherit it, and the `dotenv -c` scripts leave a
// DATABASE_URL that is already set alone rather than reading .env.local's.
// Unset, nothing changes: PGlite takes 5432 and DATABASE_URL comes from
// .env.local. Ignored in CI, which runs against its own Postgres service.
const pglitePort = CI ? undefined : process.env.PLAYWRIGHT_PGLITE_PORT || undefined;
if (pglitePort !== undefined && !/^\d{1,5}$/.test(pglitePort)) {
  throw new Error(`PLAYWRIGHT_PGLITE_PORT must be a port number, got "${pglitePort}"`);
}
if (pglitePort) {
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${pglitePort}/postgres`;
}
const localServerCommand = pglitePort
  ? `npx run-p "db-server:memory -- --port=${pglitePort}" dev:next --race`
  : 'npx run-p db-server:memory dev:next --race';

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
  //
  // PLAYWRIGHT_SKIP_WEB_SERVER=1 leaves the app alone and tests whatever is
  // already serving PLAYWRIGHT_BASE_URL. The case it exists for: a worktree
  // running against a real Postgres, where the command below cannot be used —
  // `db-server:memory` starts pglite on 5432, the port that Postgres already
  // holds, and `--race` then takes the Next process down with it. To run the
  // suite on its own throwaway PGlite instead, set PLAYWRIGHT_PGLITE_PORT
  // (see the top of this file).
  //
  // CI runs against the Postgres service container each E2E shard gets
  // (.github/workflows/CI.yml), not PGlite: PGlite accepts one connection,
  // and the app's pool holds it for 10s after its last query, so every seed
  // script a spec spawned waited those 10s to connect (#631). Locally the
  // command still boots in-memory PGlite, so a plain `npx playwright test`
  // needs no database of its own.
  webServer: process.env.PLAYWRIGHT_SKIP_WEB_SERVER
    ? undefined
    : {
        command: process.env.CI ? 'npm run db:migrate && npm run start' : localServerCommand,
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
          // The worker-run routes ship dark behind this flag, so the
          // worker-run-usage project's requests would all answer 501 without
          // it. Nothing else in the suite asserts the disabled behaviour.
          VOCION_EXTERNAL_WORKERS: '1',
          // Claiming a worker run mints a signed tool claim, and the signer
          // refuses to run without a key. Fixed, throwaway and public on
          // purpose, exactly like the vault key above: it signs claims in a
          // database that lives for the length of one run. Never reuse it.
          VOCION_TOOL_SIGNING_SECRET: process.env.VOCION_TOOL_SIGNING_SECRET ?? 'e2e-only-tool-signing-secret-not-a-real-key',
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
    // the first-run admin on a FRESH database, so no `setup` project
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
      // The same 120s in CI as locally. Every spec here bootstraps its own
      // admin and seeds through `npx` child processes (the sign-up route is
      // invite-only), and the review route compiles a rich-text editor on
      // first paint — a runner's cold start spends most of a 60s budget
      // before an assertion runs. Raised after the phone spec timed out on
      // CI at work that takes 5s locally.
      timeout: 120 * 1000,
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
    // #114 — a turn that dies part-way: the fragment is kept, marked, and
    // still marked after a reload. Needs the scripted model, which is the
    // only way to make a run fail with text already on screen, so it is
    // defined only when the server is running one.
    // Run with: npm run e2e:chat-incomplete
    ...(process.env.VOCION_LLM_PROVIDER === 'scripted'
      ? [
          {
            name: 'chat-incomplete',
            testDir: './e2e/chat-incomplete',
            timeout: projectTimeout(180 * 1000, 120 * 1000),
            retries: 0,
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
    // The API credentials matrix (platforms, validation, expiry rules).
    // Self-seeding like `tour`: bootstraps its own admin on a fresh database,
    // so no `setup` project dependency.
    // Run with: npx playwright test --project=credentials
    // The document loop by chat — draft, edit by chat, highlight → change,
    // export — replayed against the scripted model with a screenshot per
    // step. The server must run with the scripted model and the sample
    // workspace: `npm run e2e:documents` sets both.
    // Defined only when the server is the scripted model
    // (`VOCION_LLM_PROVIDER=scripted`), so a plain `npx playwright test` — locally
    // or in CI — never drives the chat at a stub key.
    ...(process.env.VOCION_LLM_PROVIDER === 'scripted'
      ? [
          {
            name: 'documents',
            testDir: './e2e/documents',
            timeout: projectTimeout(240 * 1000, 120 * 1000),
            retries: 0,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
          },
        ]
      : []),
    {
      name: 'credentials',
      testDir: './e2e/credentials',
      // Generous: each test signs in fresh, and the first few pay for cold
      // Turbopack compiles of the sign-in, dashboard and credentials routes.
      timeout: projectTimeout(120 * 1000, 60 * 1000),
      use: { ...devices['Desktop Chrome'] },
    },
    // LARK-252 — mission-run report routes, real HTTP against a real
    // running app. No browser: uses Playwright's `request` fixture only, so
    // it never depends on the `setup` (Clerk) project.
    // Run with: npx playwright test --project=mission-runs
    {
      name: 'mission-runs',
      testDir: './e2e/mission-runs',
      timeout: 60 * 1000,
    },
    // LARK-262 — what a proposal did (created / refreshed / already_decided),
    // over real HTTP against a real running app. No browser: uses the
    // `request` fixture only, so it never depends on the `setup` project.
    // Run with: npx playwright test --project=reviews-propose
    {
      name: 'reviews-propose',
      testDir: './e2e/reviews-propose',
      timeout: 60 * 1000,
    },
    // #343 — the eval section with more than one grader: empty state, the
    // provider filter, the version boundary on the trend chart, and the eval
    // score on the adoption row. Self-seeding like `credentials`.
    // Run with: npx playwright test --project=evals-providers
    {
      name: 'evals-providers',
      testDir: './e2e/evals-providers',
      timeout: projectTimeout(120 * 1000, 60 * 1000),
      use: { ...devices['Desktop Chrome'] },
    },
    // #343 — the eval refresh route, real HTTP against a real running app.
    // No browser: uses the `request` fixture only, so it never depends on the
    // `setup` project.
    // Run with: npx playwright test --project=eval-refresh
    {
      name: 'eval-refresh',
      testDir: './e2e/eval-refresh',
      timeout: 60 * 1000,
    },
    // #320 — querying the queue by what the agent recommended (approve /
    // reject / snooze), over real HTTP against a real running app. No browser:
    // uses the `request` fixture only, so it never depends on `setup`.
    // Run with: npx playwright test --project=reviews-suggested-decision
    {
      name: 'reviews-suggested-decision',
      testDir: './e2e/reviews-suggested-decision',
      timeout: 60 * 1000,
    },
    // #342 — the agent scorecard as a non-admin member sees it: signs in as a
    // member seeded by its own support script, so it never depends on `setup`.
    // Run with: npx playwright test --project=scorecard
    {
      name: 'scorecard',
      testDir: './e2e/scorecard',
      timeout: 60 * 1000,
    },
    // Run with: npx playwright test --project=reviews-approved-by-agent
    {
      name: 'reviews-approved-by-agent',
      testDir: './e2e/reviews-approved-by-agent',
      timeout: 60 * 1000,
    },
    // LARK-261 — prompt-cache token counts reported by an external worker,
    // over real HTTP against a real running app. No browser: uses the
    // `request` fixture only, so it never depends on the `setup` project.
    // Needs VOCION_EXTERNAL_WORKERS=1 on the server (set in webServer above).
    // Run with: npx playwright test --project=worker-run-usage
    {
      name: 'worker-run-usage',
      testDir: './e2e/worker-run-usage',
      timeout: 60 * 1000,
    },
    // #272 — every agent's cap and spend over real HTTP, including agents
    // with no budget row that run on the default cap. `request` fixture only.
    // Run with: npx playwright test --project=agent-budgets
    {
      name: 'agent-budgets',
      testDir: './e2e/agent-budgets',
      timeout: 60 * 1000,
    },
    // #396 — the generated OpenAPI document, and the reference page that
    // renders it. Mostly the `request` fixture; one browser check that the
    // page is behind the login.
    // Run with: npx playwright test --project=api-docs
    {
      name: 'api-docs',
      testDir: './e2e/api-docs',
      timeout: projectTimeout(120 * 1000, 60 * 1000),
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
