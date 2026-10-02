/**
 * The production build's memory settings in next.config.ts (#670).
 *
 * The app image is built on the box that serves the app, next to Postgres,
 * Temporal and Langfuse. Losing either setting quietly brings back a build
 * that needs several more gigabytes: one ~450 MB page-data worker per CPU,
 * or a full recompile on every deploy instead of a warm cache.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// next.config.ts clears and re-copies src/wsx-ext when it loads, and a test
// must not do that to a checkout a dev server may be running from. The
// factory is inline because vi.mock is hoisted above the module's own
// declarations, so it cannot call a module-level helper.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, rmSync: vi.fn(), cpSync: vi.fn() };
});

async function loadNextConfig(ciValue: string) {
  vi.resetModules();
  vi.stubEnv('CI', ciValue);
  vi.stubEnv('WORKSPACE_PATH', '');
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DISABLED', '1');
  // next.config.ts validates the env on load; the image build passes the same stub.
  vi.stubEnv('DATABASE_URL', 'postgres://stub@stub/stub');
  const configModule = await import('../../next.config');
  return configModule.default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('next.config production build settings', () => {
  it('collects page data on two workers, not one per CPU', async () => {
    const config = await loadNextConfig('');

    expect(config.experimental?.cpus).toBe(2);
  });

  it('keeps the Turbopack build cache for image and local builds', async () => {
    const config = await loadNextConfig('');

    expect(config.experimental?.turbopackFileSystemCacheForBuild).toBe(true);
  });

  it('skips the build cache in CI, where every runner starts empty', async () => {
    const config = await loadNextConfig('true');

    expect(config.experimental?.turbopackFileSystemCacheForBuild).toBe(false);
  });
});
