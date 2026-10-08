import type { TestProjectInlineConfiguration } from 'vitest/config';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { loadEnv } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import { ENTERPRISE_NONE, linkEnterprise } from './src/libs/enterpriseCheckout';

// Vocion Enterprise, when present, is snapshotted into src/enterprise-ext/
// (src/libs/enterpriseCheckout.ts). Its files are never picked up by the
// globs below; only the tests its package.json lists under
// `vocion.coreTests` run, in core's setup: `.tsx` in the browser project,
// the rest in the `enterprise` project, which is the unit project's setup.
const enterprise = linkEnterprise(import.meta.dirname);
const enterpriseUiTests = enterprise.coreTests.filter(glob => glob.endsWith('.tsx'));
const enterpriseUnitTests = enterprise.coreTests.filter(glob => !glob.endsWith('.tsx'));
const ENTERPRISE_FILES = 'src/enterprise-ext/**';

/**
 * Exact-match aliases for the two specifiers core imports. Core's own projects
 * always get the empty stubs, so its tests test core whether or not a package
 * is built in; the enterprise projects get the package.
 * @param link - What each specifier resolves to, relative to this directory.
 * @param link.server - `@vocion/enterprise/index`.
 * @param link.client - `@vocion/enterprise/client`.
 */
function enterpriseAlias(link: { server: string; client: string }) {
  return {
    alias: [
      { find: /^@vocion\/enterprise\/index$/, replacement: join(import.meta.dirname, link.server) },
      { find: /^@vocion\/enterprise\/client$/, replacement: join(import.meta.dirname, link.client) },
    ],
  };
}
const coreResolve = enterpriseAlias(ENTERPRISE_NONE);
const enterpriseResolve = enterpriseAlias(enterprise);
// An extension's router and pages reach next-auth and next-intl, which import
// `next/server` and `next/navigation` without an extension; Node's ESM loader
// refuses that, and letting Vite transform them resolves it. Core's own tests
// mock what reaches them instead.
const enterpriseDeps = { deps: { inline: ['next-auth', 'next-intl'] } };

type ProjectTest = NonNullable<TestProjectInlineConfiguration['test']>;

const unitSettings: ProjectTest = {
  environment: 'node',
  // Migrates one database before any test file loads and leaves the
  // result in a file for them to restore. See the module's own
  // docstring — it is the difference between 143 migrations once and
  // 143 migrations 219 times.
  globalSetup: ['./src/libs/testing/migratedDatabaseSnapshot.ts'],
  // 219 of these files mock `@/libs/DB`, and that mock stands up its
  // own in-memory PGlite before the first test can run. It restores a
  // dump now rather than replaying every migration, which took the
  // fixture from about 573ms a file to 123ms — but it is still real
  // work, and under parallel load it can outlast vitest's 5s default.
  // The failure then surfaces as a timeout in whichever file lost the
  // race, a different one each run, which reads as flakiness rather
  // than as the fixture cost it actually is.
  testTimeout: 30_000,
  hookTimeout: 30_000,
  // Worker threads rather than the default child processes. Most of
  // this project's time is module import — every file loads its own
  // copy of the app's module graph — and threads load it faster. Three
  // local runs of this project each: 35–38s on threads, 53–57s on
  // forks, every file passing (#631). A test that needs its own
  // process (process.chdir, a native addon that is not thread-safe)
  // would fail here; none does today. `--pool=forks` on the command
  // line switches back for one run.
  pool: 'threads',
};

const uiSettings: ProjectTest = {
  browser: {
    enabled: true,
    headless: true,
    provider: playwright(),
    screenshotDirectory: 'vitest-test-results',
    // vitest's browser default is 414x896 — a phone. The app's desktop
    // layouts only exist above their breakpoints, and the widest one
    // that matters here is the chat rail's RAIL_SHEET_BREAKPOINT
    // (1200px, src/features/dashboard/chat/railState.ts): below it the
    // rail is a Radix Sheet with no `complementary` landmark, so every
    // rail assertion in ChatDock/PageDock/ChatShell fails against a
    // dialog it never meant to test. Run the whole browser project at
    // a desktop size and let a test that wants a phone narrow itself
    // with `page.viewport(...)`.
    viewport: { width: 1440, height: 900 },
    instances: [
      { browser: 'chromium' },
    ],
  },
};

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    coverage: {
      include: ['src/**/*'],
      exclude: ['src/**/*.stories.{js,jsx,ts,tsx}'],
    },
    projects: [
      { extends: true as const, resolve: coreResolve, test: { name: 'unit', include: ['src/**/*.test.{js,ts}'], exclude: ['src/hooks/**/*.test.ts', ENTERPRISE_FILES], ...unitSettings } },
      { extends: true as const, resolve: coreResolve, test: { name: 'ui', include: ['**/*.test.tsx', 'src/hooks/**/*.test.ts'], exclude: ['node_modules/**', 'infra/**', 'dist/**', '.next/**', ENTERPRISE_FILES], ...uiSettings } },
      ...(enterpriseUnitTests.length > 0 ? [{ extends: true as const, resolve: enterpriseResolve, test: { name: 'enterprise', include: enterpriseUnitTests, server: enterpriseDeps, ...unitSettings } }] : []),
      ...(enterpriseUiTests.length > 0 ? [{ extends: true as const, resolve: enterpriseResolve, test: { name: 'enterprise-ui', include: enterpriseUiTests, server: enterpriseDeps, ...uiSettings } }] : []),
    ],
    reporters: [
      'default',
      // conditional reporter
      process.env.CI ? 'github-actions' : {},
    ],
    env: {
      ...loadEnv('', process.cwd(), ''), // Expose .env variables to Node.js
      BILLING_PLAN_ENV: 'test',
      // Default fake LLM keys so getLLMClient() can construct mocked SDK
      // instances without aborting on missing env. Tests that want to assert
      // "missing key throws" override these explicitly.
      OPENAI_API_KEY: 'sk-test-fixture',
      ANTHROPIC_API_KEY: 'sk-ant-test-fixture',
    },
  },
  define: {
    'process.env': JSON.stringify(loadEnv('', process.cwd(), 'NEXT_PUBLIC_')), // Expose .env variables to browser
  },
});
