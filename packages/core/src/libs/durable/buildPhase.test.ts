import { afterEach, describe, expect, it, vi } from 'vitest';

// `next build` prerenders with a stub DATABASE_URL (packages/core/Dockerfile).
// Nothing durable may open a connection there: a DBOS client retries against
// an unreachable host instead of failing, and the build hangs.
const create = vi.fn();
const launch = vi.fn();
vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOSClient: { create },
  DBOS: { launch, setConfig: vi.fn(), registerWorkflow: vi.fn(), registerQueue: vi.fn() },
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('during next build', () => {
  it('imports every durable module, starts, schedules and reads without touching the database', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DURABLE_MODE', 'dbos');
    vi.stubEnv('VOCION_SCHEDULE_OWNER', '1');
    vi.stubEnv('DATABASE_URL', 'postgres://stub@stub/stub');
    const { durableMode, durable } = await import('./index');
    const { scheduleJob, listSchedules } = await import('./jobs');
    const { startDurableExecutor } = await import('./executor');
    await import('@/services/background/catalog');

    expect(durableMode()).toBe('memory');

    await startDurableExecutor();
    await scheduleJob({ name: 'build-probe', cron: '* * * * *', job: 'durable.prune' });
    await listSchedules();
    await durable().state('build-probe');

    expect(create).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it('refuses a direct DBOS client rather than retrying against the stub', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    const { dbosClientForAdmin } = await import('./dbos');

    await expect(dbosClientForAdmin()).rejects.toThrow(/next build/);
    expect(create).not.toHaveBeenCalled();
  });
});
