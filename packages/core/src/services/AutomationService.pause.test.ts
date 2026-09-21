/**
 * Pause and resume — a person's hold on an automation, on the record.
 *
 *   - A pause writes who, when and why on the row, and a `control` run row
 *     in the log naming the same person; a resume clears the row and records
 *     whose pause it lifted.
 *   - A paused automation does not fire: the event matcher skips it and a
 *     fire that reaches `beginAutomationFire` anyway is refused and recorded.
 *   - A schedule-when's Temporal Schedule is paused and unpaused alongside,
 *     and Temporal being away does not undo the pause.
 *   - A `control` row is not a fire: it is not a card's "last run".
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 210 })),
}));

const schedule = {
  pause: vi.fn(async () => {}),
  unpause: vi.fn(async () => {}),
  update: vi.fn(async (_updater: unknown) => {}),
  describe: vi.fn(async () => ({ info: { nextActionTimes: [] }, state: { paused: false } })),
};
const temporal = {
  reachable: true,
  create: vi.fn(async () => {}),
};
vi.mock('@/libs/temporal/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/temporal/client')>();
  return {
    ...actual,
    getTemporalClient: vi.fn(async () => {
      if (!temporal.reachable) {
        throw new Error('temporal unavailable');
      }
      return { schedule: { create: temporal.create, getHandle: () => schedule } };
    }),
  };
});

const { db } = await import('@/libs/DB');
const { automationRunSchema, automationSchema, eventLogSchema, userSchema } = await import('@/models/Schema');
const { startWorkflow } = await import('@/services/WorkflowService');
const {
  AutomationPauseStateError,
  buildAutomationScheduleOptions,
  CONTROL_RUN_KIND,
  ensureAutomationSchedule,
  fireAutomation,
  lastRunBySlug,
  listAutomationRuns,
  pauseAutomation,
  pausesFor,
  resumeAutomation,
} = await import('@/services/AutomationService');
const { emitEvent } = await import('@/services/EventService');
const { summarizeResult } = await import('@/features/dashboard/automationResult');

const ORG = 'org_pause';
const CHRIS = { id: 'usr-chris', name: 'Chris' };

async function seed(slug: string, whenConfig: Record<string, unknown>, doConfig: Record<string, unknown> = { workflow: 'wf' }) {
  await db.insert(automationSchema).values({ orgId: ORG, slug, name: slug, status: 'active', whenConfig: whenConfig as never, doConfig: doConfig as never });
}

async function row(slug: string) {
  const [r] = await db.select().from(automationSchema).where(eq(automationSchema.slug, slug));
  return r!;
}

beforeEach(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(eventLogSchema);
  await db.delete(userSchema);
  temporal.reachable = true;
  vi.clearAllMocks();
});

afterAll(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(eventLogSchema);
  await db.delete(userSchema);
});

describe('pauseAutomation', () => {
  it('records who, when and why on the row, and a control run naming the same person', async () => {
    await seed('hourly-check', { schedule: '0 * * * *' });
    const now = new Date('2026-09-20T15:00:00Z');

    const pause = await pauseAutomation(ORG, 'hourly-check', { by: CHRIS, note: '  holding until the CRM sync is fixed ', now });

    expect(pause).toEqual({ by: { id: 'usr-chris', name: 'Chris' }, at: now, note: 'holding until the CRM sync is fixed' });

    const r = await row('hourly-check');

    expect(r.pausedAt).toEqual(now);
    expect(r.pausedBy).toBe('usr-chris');
    expect(r.pausedNote).toBe('holding until the CRM sync is fixed');
    // The authored status is untouched — the pause is a different statement.
    expect(r.status).toBe('active');

    const { runs } = await listAutomationRuns(ORG, { slug: 'hourly-check' });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      kind: CONTROL_RUN_KIND,
      status: 'ok',
      invokedBy: 'user:usr-chris',
      startedAt: now,
      finishedAt: now,
      result: {
        kind: 'control',
        action: 'pause',
        by: { id: 'usr-chris', name: 'Chris' },
        note: 'holding until the CRM sync is fixed',
        schedule: 'paused',
      },
    });
    expect(summarizeResult(runs[0]!.result)).toBe('Paused by Chris — holding until the CRM sync is fixed');
  });

  it('pauses the Temporal Schedule of a schedule-when, with the person and note on it', async () => {
    await seed('hourly-check', { schedule: '0 * * * *' });

    await pauseAutomation(ORG, 'hourly-check', { by: CHRIS, note: 'CRM' });

    expect(schedule.pause).toHaveBeenCalledWith('Chris: CRM');
  });

  it('touches no Temporal Schedule for an event-when — there is none', async () => {
    await seed('on-reply', { event: 'prospect.reply' });

    await pauseAutomation(ORG, 'on-reply', { by: CHRIS });

    expect(schedule.pause).not.toHaveBeenCalled();

    const { runs } = await listAutomationRuns(ORG, { slug: 'on-reply' });

    expect((runs[0]!.result as { schedule: unknown }).schedule).toBeNull();
  });

  it('still pauses when Temporal is away, and says so on the record', async () => {
    await seed('hourly-check', { schedule: '0 * * * *' });
    temporal.reachable = false;

    await pauseAutomation(ORG, 'hourly-check', { by: CHRIS });

    expect((await row('hourly-check')).pausedAt).not.toBeNull();

    const { runs } = await listAutomationRuns(ORG, { slug: 'hourly-check' });

    expect((runs[0]!.result as { schedule: unknown }).schedule).toBe('unreachable');
    expect(summarizeResult(runs[0]!.result)).toMatch(/Temporal was unreachable/);
  });

  it('refuses a second pause rather than overwriting whose pause it is', async () => {
    await seed('hourly-check', { schedule: '0 * * * *' });
    await pauseAutomation(ORG, 'hourly-check', { by: CHRIS });

    await expect(pauseAutomation(ORG, 'hourly-check', { by: { id: 'usr-other', name: 'Other' } })).rejects.toBeInstanceOf(AutomationPauseStateError);
    expect((await row('hourly-check')).pausedBy).toBe('usr-chris');
  });

  it('is scoped to the org', async () => {
    await seed('hourly-check', { schedule: '0 * * * *' });

    await expect(pauseAutomation('org_other', 'hourly-check', { by: CHRIS })).rejects.toThrow(/not found/);
  });
});

describe('resumeAutomation', () => {
  it('clears the pause, unpauses the Schedule, and records whose pause it lifted', async () => {
    await seed('hourly-check', { schedule: '0 * * * *' });
    const pausedAt = new Date('2026-09-20T15:00:00Z');
    await pauseAutomation(ORG, 'hourly-check', { by: CHRIS, note: 'CRM', now: pausedAt });

    await resumeAutomation(ORG, 'hourly-check', { by: { id: 'usr-sam', name: 'Sam' }, note: 'sync is back' });

    const r = await row('hourly-check');

    expect(r.pausedAt).toBeNull();
    expect(r.pausedBy).toBeNull();
    expect(r.pausedNote).toBeNull();
    expect(schedule.unpause).toHaveBeenCalledWith('Sam: sync is back');

    const { runs } = await listAutomationRuns(ORG, { slug: 'hourly-check' });

    expect(runs.map(x => (x.result as { action: string }).action)).toEqual(['resume', 'pause']);
    expect(runs[0]!.result).toMatchObject({
      action: 'resume',
      by: { id: 'usr-sam', name: 'Sam' },
      note: 'sync is back',
      schedule: 'resumed',
      lifted: { by: 'usr-chris', at: pausedAt.toISOString(), note: 'CRM' },
    });
    expect(summarizeResult(runs[0]!.result)).toBe('Resumed by Sam — sync is back');
  });

  it('refuses to resume an automation that is not paused', async () => {
    await seed('hourly-check', { schedule: '0 * * * *' });

    await expect(resumeAutomation(ORG, 'hourly-check', { by: CHRIS })).rejects.toBeInstanceOf(AutomationPauseStateError);
  });
});

describe('a paused automation does not fire', () => {
  it('is skipped by the event matcher — silently, not as a refused row per event', async () => {
    await seed('on-reply', { event: 'prospect.reply' });
    await pauseAutomation(ORG, 'on-reply', { by: CHRIS });

    const res = await emitEvent({ orgId: ORG, type: 'prospect.reply', payload: { dealId: 1 } });

    expect(res.triggered).toEqual([]);
    expect(vi.mocked(startWorkflow)).not.toHaveBeenCalled();

    const { runs } = await listAutomationRuns(ORG, { slug: 'on-reply' });

    expect(runs.map(r => r.kind)).toEqual([CONTROL_RUN_KIND]);
  });

  it('refuses a fire that reaches it anyway, and records the refusal', async () => {
    await seed('hourly-check', { schedule: '0 * * * *' });
    await pauseAutomation(ORG, 'hourly-check', { by: CHRIS, note: 'CRM' });

    await expect(fireAutomation(ORG, 'hourly-check', { invokedBy: 'dashboard:test-run' })).rejects.toThrow(/is paused — CRM/);
    expect(vi.mocked(startWorkflow)).not.toHaveBeenCalled();

    const { runs } = await listAutomationRuns(ORG, { slug: 'hourly-check', status: 'error' });

    expect(runs).toHaveLength(1);
    expect(runs[0]!.error).toMatch(/paused/);
  });

  it('fires again once resumed', async () => {
    await seed('hourly-check', { schedule: '0 * * * *' });
    await pauseAutomation(ORG, 'hourly-check', { by: CHRIS });
    await resumeAutomation(ORG, 'hourly-check', { by: CHRIS });

    await expect(fireAutomation(ORG, 'hourly-check')).resolves.toMatchObject({ kind: 'workflow', runId: 210 });
  });
});

describe('control rows in the log', () => {
  it('are not a card\'s "last run"', async () => {
    await seed('hourly-check', { schedule: '0 * * * *' });
    await fireAutomation(ORG, 'hourly-check');
    await pauseAutomation(ORG, 'hourly-check', { by: CHRIS, now: new Date(Date.now() + 60_000) });

    const last = (await lastRunBySlug(ORG)).get('hourly-check');

    expect(last?.kind).toBe('workflow');
  });

  it('are filterable as kind=control', async () => {
    await seed('hourly-check', { schedule: '0 * * * *' });
    await fireAutomation(ORG, 'hourly-check');
    await pauseAutomation(ORG, 'hourly-check', { by: CHRIS });

    const { runs, total } = await listAutomationRuns(ORG, { kind: 'control' });

    expect(total).toBe(1);
    expect(runs[0]!.kind).toBe(CONTROL_RUN_KIND);
  });
});

describe('pausesFor', () => {
  it('resolves the person\'s name for the surfaces, falling back to their email', async () => {
    await db.insert(userSchema).values([
      { id: 'usr-chris', name: 'Chris', email: 'chris@example.com' },
      { id: 'usr-noname', name: null, email: 'noname@example.com' },
    ]);
    await seed('a', { schedule: '0 * * * *' });
    await seed('b', { event: 'x' });
    await seed('c', { event: 'y' });
    await pauseAutomation(ORG, 'a', { by: CHRIS, note: 'CRM' });
    await pauseAutomation(ORG, 'b', { by: { id: 'usr-noname' } });

    const rows = await db.select().from(automationSchema).where(eq(automationSchema.orgId, ORG));
    const pauses = await pausesFor(rows);

    expect(pauses.get('a')).toMatchObject({ by: { id: 'usr-chris', name: 'Chris' }, note: 'CRM' });
    expect(pauses.get('b')).toMatchObject({ by: { id: 'usr-noname', name: 'noname@example.com' }, note: null });
    expect(pauses.has('c')).toBe(false);
  });
});

describe('the Schedule carries the pause through an apply', () => {
  it('creates the Schedule paused, with the note, when the row is paused', () => {
    const options = buildAutomationScheduleOptions({ orgId: ORG, slug: 'hourly-check', cron: '0 * * * *', paused: { note: 'CRM' } });

    expect(options.state).toEqual({ paused: true, note: 'CRM' });
  });

  it('states nothing about pause when the row is not paused', () => {
    const options = buildAutomationScheduleOptions({ orgId: ORG, slug: 'hourly-check', cron: '0 * * * *' });

    expect(options.state).toBeUndefined();
  });

  it('re-asserts the pause on an existing Schedule, and never unpauses one', async () => {
    temporal.create.mockRejectedValueOnce(Object.assign(new Error('schedule already exists'), { name: 'ScheduleAlreadyRunning' }));

    await ensureAutomationSchedule({ orgId: ORG, slug: 'hourly-check', cron: '0 * * * *', paused: { note: null } });

    const updater = schedule.update.mock.calls[0]![0] as unknown as (prev: { state: { paused: boolean; note?: string } }) => { state: unknown };

    expect(updater({ state: { paused: false } }).state).toEqual({ paused: true, note: undefined });

    temporal.create.mockRejectedValueOnce(Object.assign(new Error('schedule already exists'), { name: 'ScheduleAlreadyRunning' }));
    await ensureAutomationSchedule({ orgId: ORG, slug: 'hourly-check', cron: '0 * * * *' });
    const plain = schedule.update.mock.calls[1]![0] as unknown as (prev: { state: { paused: boolean; note?: string } }) => { state: unknown };

    // The row says nothing; a Schedule someone paused in Temporal stays paused.
    expect(plain({ state: { paused: true, note: 'by hand' } }).state).toEqual({ paused: true, note: 'by hand' });
  });
});
