import { describe, expect, it } from 'vitest';

// Runs only against a real Postgres: DURABLE_PG_URL=postgres://… (never the
// production tunnel). Proves background jobs on DBOS end to end: a one-off
// start runs once per id, a delayed start waits, a schedule fires each tick
// once, pause stops it, resume starts it, remove ends it, and prune clears
// finished runs.
const URL = process.env.DURABLE_PG_URL;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe.skipIf(!URL)('background jobs on DBOS', () => {
  it('starts once per id, delays, fires each schedule tick once, pauses, resumes, removes and prunes', async () => {
    process.env.DURABLE_DATABASE_URL = URL;
    process.env.DURABLE_MODE = 'dbos';
    const fired: string[] = [];
    const { defineJob, describeSchedule, listSchedules, pauseSchedule, resumeSchedule, scheduleJob, startJob, unscheduleJob } = await import('./jobs');
    defineJob<{ tag: string }>('it.record', async (input, ctx) => {
      fired.push(`${input.tag}:${ctx.runId}`);
    });
    const { dbosEngine, launchDurableExecutor } = await import('./dbos');
    await launchDurableExecutor();
    const e = dbosEngine();

    // One-off: the same id twice is one run.
    const id = `it-job-${Date.now()}`;
    await startJob(id, { job: 'it.record', input: { tag: 'once' } });
    await startJob(id, { job: 'it.record', input: { tag: 'once' } });
    for (let i = 0; i < 100 && (await e.state(id)) !== 'succeeded'; i++) {
      await sleep(100);
    }

    expect(fired.filter(f => f.startsWith('once:'))).toHaveLength(1);

    // Delayed: pending through the delay, then done.
    const later = `it-later-${Date.now()}`;
    await startJob(later, { job: 'it.record', input: { tag: 'later' }, afterMs: 1500 });
    await sleep(500);

    expect(fired.some(f => f.startsWith('later:'))).toBe(false);

    for (let i = 0; i < 100 && (await e.state(later)) !== 'succeeded'; i++) {
      await sleep(100);
    }

    expect(fired.filter(f => f.startsWith('later:'))).toHaveLength(1);

    // Schedule: every second; each tick runs once under its own id.
    const name = `it-every-second-${Date.now()}`;
    await scheduleJob({ name, cron: '* * * * * *', job: 'it.record', input: { tag: 'tick' } });
    await scheduleJob({ name, cron: '* * * * * *', job: 'it.record', input: { tag: 'tick' } });

    expect((await listSchedules('it-every-second-')).map(s => s.name)).toEqual([name]);

    for (let i = 0; i < 150 && fired.filter(f => f.startsWith('tick:')).length < 3; i++) {
      await sleep(100);
    }
    const ticks = fired.filter(f => f.startsWith('tick:'));

    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ticks).size).toBe(ticks.length);

    await pauseSchedule(name);

    expect((await describeSchedule(name))?.paused).toBe(true);

    await resumeSchedule(name);

    expect((await describeSchedule(name))?.paused).toBe(false);

    await unscheduleJob(name);
    await unscheduleJob(name);

    expect(await describeSchedule(name)).toBeNull();

    // Prune: finished job runs older than the cutoff go.
    const { pruneFinishedJobRuns } = await import('./prune');
    const { pruned } = await pruneFinishedJobRuns(-1);

    expect(pruned).toBeGreaterThanOrEqual(2);
    expect(await e.state(id)).toBe('unknown');

    const { DBOS } = await import('@dbos-inc/dbos-sdk');
    await DBOS.shutdown();
  }, 120_000);
});
