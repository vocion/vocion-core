import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { loadEnv } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    coverage: {
      include: ['src/**/*'],
      exclude: ['src/**/*.stories.{js,jsx,ts,tsx}'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{js,ts}'],
          exclude: ['src/hooks/**/*.test.ts'],
          environment: 'node',
          // 65 of these files mock `@/libs/DB`, and that mock stands up its
          // own in-memory PGlite and applies all 76 migrations to it before
          // the first test can run. Under parallel load that fixture alone
          // can outlast vitest's 5s default, and the failure surfaces as a
          // timeout in whichever file lost the race — a different one each
          // run, which reads as flakiness rather than as the fixture cost it
          // actually is. The tests are not slow; the database they need is.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          include: ['**/*.test.tsx', 'src/hooks/**/*.test.ts'],
          exclude: ['node_modules/**', 'infra/**', 'dist/**', '.next/**'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            screenshotDirectory: 'vitest-test-results',
            instances: [
              { browser: 'chromium' },
            ],
          },
        },
      },
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
