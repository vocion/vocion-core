/**
 * What a mission-check fire leaves behind, and what the surfaces can read off
 * it. The properties under test are the ones that were missing:
 *
 *   - `automation_run.result` is non-null for a mission check. The branch used
 *     to discard `startMission`'s summary, so it was always null and the card
 *     had one timestamp to render.
 *   - The counts are deltas on `lead_brief` and the window comes off the
 *     fire's own tool calls — never the agent's prose.
 *   - The cross-automation run query exists at all, filterable and paged.
 *   - A schedule that missed its expected fire says so.
 *   - A fire that can no longer end is closed out.
 *   - A fire refused before dispatch still leaves a row.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 210 })),
}));
vi.mock('@/services/MissionService', () => ({
  getMission: vi.fn(async () => ({ id: 1, name: 'Increase Discovery Calls', goal: 'goal', successCriteria: [] })),
  scheduledCheckBrief: vi.fn((_t: unknown, prompt?: string) => (prompt ? `check brief + ${prompt}` : 'check brief')),
  startMission: vi.fn(async () => ({
    id: 1031,
    status: 'completed',
    plan: { tasks: [{ id: 'scheduled-check', status: 'completed' }] },
  })),
}));

const { db } = await import('@/libs/DB');
const { automationRunSchema, automationSchema, knowledgeSourceSchema, leadBriefSchema, toolCallSchema } = await import('@/models/Schema');
const { startMission } = await import('@/services/MissionService');
const {
  automationRunFacets,
  automationSourceFreshness,
  fireAutomation,
  lastRunBySlug,
  listAutomationRuns,
  reconcileAbandonedRuns,
  scheduleHealth,
} = await import('@/services/AutomationService');
const { summarizeResult } = await import('@/features/dashboard/automationResult');

const ORG = 'org_obs';
const HOUR = 3_600_000;

async function seedAutomation(slug: string, whenConfig: Record<string, unknown>, doConfig: Record<string, unknown>, status = 'active') {
  await db.insert(automationSchema).values({
    orgId: ORG,
    slug,
    name: slug,
    status,
    whenConfig: whenConfig as never,
    doConfig: doConfig as never,
  });
}

/**
 * A `hubspot_count_contacts` payload as `tool_call.output` stores it.
 * @param missionRunId
 * @param opts
 * @param opts.total
 * @param opts.since
 * @param opts.stage
 * @param opts.stale
 */
async function seedCountCall(missionRunId: number, opts: { total: number; since: string; stage?: boolean; stale?: boolean }) {
  await db.insert(toolCallSchema).values({
    orgId: ORG,
    agentSlug: 'revenue-lead',
    tool: 'hubspot_count_contacts',
    input: opts.stage === false ? {} : { lifecycle_stages: ['marketingqualifiedlead'], created_within_days: 7 },
    missionRunId,
    output: JSON.stringify({
      object_type: 'contacts',
      total: opts.total,
      returned: opts.total,
      created_after_applied: opts.since,
      as_of: '2026-09-08T06:00:00.000Z',
      ...(opts.stale ? { mirror_stale: true, mirror_staleness: 'hubspot-contacts last synced 7.0 days ago' } : {}),
      sources_read: ['hubspot-contacts'],
      records: [],
    }),
    durationMs: 900,
  });
}

async function seedLead(contactRef: string, opts: { sections?: boolean; drafts?: boolean } = {}) {
  await db.insert(leadBriefSchema).values({
    orgId: ORG,
    contactRef,
    contactName: contactRef,
    triggerType: 'new',
    ...(opts.sections ? { sections: [{ heading: 'Who', body: 'x' }] } : {}),
    ...(opts.drafts ? { draftSequence: [{ step: 1, subject: 's', body: 'b' }] } : {}),
  });
}

beforeEach(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(toolCallSchema);
  await db.delete(leadBriefSchema);
  await db.delete(knowledgeSourceSchema);
  vi.clearAllMocks();
});

afterAll(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(toolCallSchema);
  await db.delete(leadBriefSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('a mission-check fire records what it did', () => {
  it('writes a typed result instead of null', async () => {
    await seedAutomation('process-new-mqls', { schedule: '5 * * * *' }, { checkMission: 'increase-discovery-calls' });
    await seedCountCall(1031, { total: 2, since: '2026-09-01T00:00:00.000Z' });

    const res = await fireAutomation(ORG, 'process-new-mqls');
    const [row] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, res.automationRunId));

    expect(row?.result).not.toBeNull();
    expect(row?.result).toMatchObject({
      kind: 'mission_check',
      missionRunId: 1031,
      missionRunStatus: 'completed',
      tasks: { ok: 1, failed: 0, total: 1 },
      counts: { contactsInWindow: 2, queued: 0, queueTotal: 0 },
    });
    // And the run it started is on the row, so the report is reachable.
    expect(row?.targetRunId).toBe(1031);
  });

  it('counts what the tables did, not what the agent said', async () => {
    await seedAutomation('process-new-mqls', { schedule: '5 * * * *' }, { checkMission: 'increase-discovery-calls' });
    await seedLead('contacts:1', { sections: true });
    await seedCountCall(1031, { total: 3, since: '2026-09-01T00:00:00.000Z' });
    // The pass queues two leads and briefs one of them.
    vi.mocked(startMission).mockImplementationOnce(async () => {
      await seedLead('contacts:2');
      await seedLead('contacts:3', { sections: true, drafts: true });
      return { id: 1031, status: 'completed', plan: { tasks: [{ id: 'scheduled-check', status: 'completed' }] } } as never;
    });

    const res = await fireAutomation(ORG, 'process-new-mqls');
    const [row] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, res.automationRunId));
    const result = row?.result as { counts: Record<string, number> };

    expect(result.counts).toMatchObject({ queued: 2, briefed: 1, drafted: 1, queueTotal: 3 });
  });

  it('reads the window off the STAGE-FILTERED call, not the stage-discovery one', async () => {
    await seedAutomation('process-new-mqls', { schedule: '5 * * * *' }, { checkMission: 'increase-discovery-calls' });
    // The pass calls the tool once with no filter to learn the stage strings;
    // that call's total is every contact in the CRM, not the MQLs in scope.
    await seedCountCall(1031, { total: 9053, since: '', stage: false });
    await seedCountCall(1031, { total: 2, since: '2026-09-01T00:00:00.000Z' });

    const res = await fireAutomation(ORG, 'process-new-mqls');
    const [row] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, res.automationRunId));
    const result = row?.result as { counts: { contactsInWindow: number }; window: { since: string } };

    expect(result.counts.contactsInWindow).toBe(2);
    expect(result.window.since).toBe('2026-09-01T00:00:00.000Z');
  });

  it('carries the mirror staleness the fire read through to the row', async () => {
    await seedAutomation('process-new-mqls', { schedule: '5 * * * *' }, { checkMission: 'increase-discovery-calls' });
    await seedCountCall(1031, { total: 2, since: '2026-09-01T00:00:00.000Z', stale: true });

    const res = await fireAutomation(ORG, 'process-new-mqls');
    const [row] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, res.automationRunId));
    const result = row?.result as { mirror: { stale: boolean; note: string; sources: string[] } };

    expect(result.mirror.stale).toBe(true);
    expect(result.mirror.note).toContain('7.0 days');
    expect(result.mirror.sources).toEqual(['hubspot-contacts']);
  });

  it('survives a truncated tool payload, because output is capped at storage', async () => {
    await seedAutomation('process-new-mqls', { schedule: '5 * * * *' }, { checkMission: 'increase-discovery-calls' });
    // The counts lead the payload and the record page ends it, so a cap cuts
    // the JSON mid-array — a full parse fails on exactly the calls worth reading.
    await db.insert(toolCallSchema).values({
      orgId: ORG,
      agentSlug: 'revenue-lead',
      tool: 'hubspot_count_contacts',
      input: { lifecycle_stages: ['marketingqualifiedlead'] },
      missionRunId: 1031,
      output: '{\n  "object_type": "contacts",\n  "total": 46,\n  "created_after_applied": "2026-09-01T00:00:00.000Z",\n  "records": [{"ref": "contacts:1", "na',
      durationMs: 900,
    });

    const res = await fireAutomation(ORG, 'process-new-mqls');
    const [row] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, res.automationRunId));
    const result = row?.result as { counts: { contactsInWindow: number } };

    expect(result.counts.contactsInWindow).toBe(46);
  });

  it('titles the run by the automation that fired it', async () => {
    await seedAutomation('discovery-followup-check', { schedule: '30 * * * *' }, { checkMission: 'increase-discovery-calls' });

    await fireAutomation(ORG, 'discovery-followup-check');

    // Both hourly automations check the same mission, so `Check: <mission>`
    // made them identical in Activity with only `created_by` telling them apart.
    expect(vi.mocked(startMission)).toHaveBeenCalledWith(expect.objectContaining({
      title: 'discovery-followup-check: Increase Discovery Calls',
    }));
  });

  it('prefers input.prompt over the authored orders, for this fire only', async () => {
    await seedAutomation(
      'process-new-mqls',
      { schedule: '5 * * * *' },
      { checkMission: 'increase-discovery-calls', prompt: 'Three parts, in this order…' },
    );

    await fireAutomation(ORG, 'process-new-mqls', { input: { prompt: 'PART ONE only, report and stop.' } });

    expect(vi.mocked(startMission)).toHaveBeenCalledWith(expect.objectContaining({
      brief: 'check brief + PART ONE only, report and stop.',
    }));
  });

  it('falls back to the authored orders when the override is blank', async () => {
    await seedAutomation(
      'process-new-mqls',
      { schedule: '5 * * * *' },
      { checkMission: 'increase-discovery-calls', prompt: 'Three parts, in this order…' },
    );

    await fireAutomation(ORG, 'process-new-mqls', { input: { prompt: '   ' } });

    expect(vi.mocked(startMission)).toHaveBeenCalledWith(expect.objectContaining({
      brief: 'check brief + Three parts, in this order…',
    }));
  });
});

describe('the card reads the result', () => {
  it('summarizes a mission check instead of falling through to nothing', async () => {
    await seedAutomation('process-new-mqls', { schedule: '5 * * * *' }, { checkMission: 'increase-discovery-calls' });
    await seedCountCall(1031, { total: 2, since: '2026-09-01T00:00:00.000Z' });

    const res = await fireAutomation(ORG, 'process-new-mqls');
    const [row] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, res.automationRunId));

    const summary = summarizeResult(row?.result);

    expect(summary).toContain('2 contacts in window');
    expect(summary).toContain('0 queued');
  });

  it('still summarizes the sweep job it always knew', () => {
    expect(summarizeResult({ meetingsScanned: 12, matched: 3, classified: 2 }))
      .toBe('12 scanned · 3 matched · 2 classified');
  });

  it('returns null for a shape it does not recognise, rather than guessing', () => {
    expect(summarizeResult({ echoed: { sellerDomain: 'metacto.com' } })).toBeNull();
    expect(summarizeResult(null)).toBeNull();
  });
});

describe('the run log', () => {
  it('spans every automation, which was not queryable at all before', async () => {
    await seedAutomation('a', { schedule: '0 * * * *' }, { checkMission: 'm' });
    await seedAutomation('b', { schedule: '0 * * * *' }, { checkMission: 'm' });
    await fireAutomation(ORG, 'a');
    await fireAutomation(ORG, 'b');
    await fireAutomation(ORG, 'a', { invokedBy: 'dashboard:test-run' });

    const all = await listAutomationRuns(ORG);

    expect(all.total).toBe(3);
    expect(all.runs.map(r => r.slug)).toEqual(['a', 'b', 'a']);
  });

  it('filters by automation, status and what invoked it, and keeps a truthful total', async () => {
    await seedAutomation('a', { schedule: '0 * * * *' }, { checkMission: 'm' });
    await fireAutomation(ORG, 'a');
    await fireAutomation(ORG, 'a', { invokedBy: 'dashboard:test-run' });

    expect((await listAutomationRuns(ORG, { invokedBy: 'test-run' })).total).toBe(1);
    expect((await listAutomationRuns(ORG, { invokedBy: 'schedule' })).total).toBe(1);
    expect((await listAutomationRuns(ORG, { status: 'ok' })).total).toBe(2);
    expect((await listAutomationRuns(ORG, { status: 'error' })).total).toBe(0);
    expect((await listAutomationRuns(ORG, { slug: 'nobody' })).total).toBe(0);
  });

  it('pages on id, so two fires in the same tick cannot repeat or vanish', async () => {
    await seedAutomation('a', { schedule: '0 * * * *' }, { checkMission: 'm' });
    for (let i = 0; i < 5; i += 1) {
      await fireAutomation(ORG, 'a');
    }

    const first = await listAutomationRuns(ORG, { limit: 2 });
    const second = await listAutomationRuns(ORG, { limit: 2, cursor: first.nextCursor! });

    expect(first.runs).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(first.nextCursor).toBe(first.runs[1]!.id);
    expect(second.runs.map(r => r.id).every(id => id < first.nextCursor!)).toBe(true);
    expect(new Set([...first.runs, ...second.runs].map(r => r.id)).size).toBe(4);
  });

  it('offers the filter values actually present, never a hardcoded list', async () => {
    await seedAutomation('a', { schedule: '0 * * * *' }, { checkMission: 'm' });
    await fireAutomation(ORG, 'a');

    expect(await automationRunFacets(ORG)).toEqual({ slugs: ['a'], statuses: ['ok'], kinds: ['mission_check'] });
  });

  it('hands each card its own last fire in one query', async () => {
    await seedAutomation('a', { schedule: '0 * * * *' }, { checkMission: 'm' });
    await seedAutomation('b', { schedule: '0 * * * *' }, { checkMission: 'm' });
    await fireAutomation(ORG, 'a');
    const newestA = await fireAutomation(ORG, 'a');
    const onlyB = await fireAutomation(ORG, 'b');

    const map = await lastRunBySlug(ORG);

    expect(map.get('a')?.id).toBe(newestA.automationRunId);
    expect(map.get('b')?.id).toBe(onlyB.automationRunId);
  });
});

describe('scheduleHealth', () => {
  const now = new Date('2026-09-08T19:42:00Z');

  it('calls a healthy hourly schedule healthy', () => {
    const h = scheduleHealth({ cron: '0 * * * *', lastFireAt: new Date('2026-09-08T19:00:00Z'), now });

    expect(h.overdue).toBe(false);
    expect(h.reason).toBeNull();
  });

  it('calls 3 September what it was: nineteen hours of silence', () => {
    // Fires stopped at 05:00 on the 3rd and resumed at 00:15 on the 4th.
    const h = scheduleHealth({
      cron: '0 * * * *',
      lastFireAt: new Date('2026-09-03T05:00:00Z'),
      now: new Date('2026-09-04T00:00:00Z'),
    });

    expect(h.overdue).toBe(true);
    expect(h.reason).toContain('expected every 60 minutes');
    expect(h.reason).toContain('19.0 hours ago');
  });

  it('gives one whole interval of slack, so a fire in flight is not an outage', () => {
    const h = scheduleHealth({ cron: '0 * * * *', lastFireAt: new Date('2026-09-08T18:00:00Z'), now });

    expect(h.overdue).toBe(false);
  });

  it('says so when a schedule has never fired', () => {
    expect(scheduleHealth({ cron: '0 * * * *', lastFireAt: null, now }).reason).toContain('never fired');
  });

  it('leaves a deliberately paused schedule alone', () => {
    const h = scheduleHealth({ cron: '0 * * * *', lastFireAt: new Date('2026-09-01T05:00:00Z'), paused: true, now });

    expect(h.overdue).toBe(false);
  });

  it('has no expectation of an event-when automation', () => {
    expect(scheduleHealth({ cron: null, lastFireAt: null, now }).overdue).toBe(false);
  });
});

describe('abandoned fires', () => {
  it('closes out a row that can no longer end', async () => {
    await seedAutomation('discovery-followup-check', { schedule: '30 * * * *' }, { checkMission: 'm' });
    // The 4 September row: `running`, no `finished_at`, killed by a worker restart.
    const [stuck] = await db.insert(automationRunSchema).values({
      orgId: ORG,
      slug: 'discovery-followup-check',
      kind: 'mission_check',
      status: 'running',
      startedAt: new Date(Date.now() - 5 * 24 * HOUR),
    }).returning({ id: automationRunSchema.id });

    const { reconciled } = await reconcileAbandonedRuns({ orgId: ORG });
    const [row] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, stuck!.id));

    expect(reconciled).toBe(1);
    expect(row?.status).toBe('error');
    expect(row?.error).toContain('abandoned');
    expect(row?.finishedAt).toBeInstanceOf(Date);
  });

  it('leaves a pass still inside its own timeout running', async () => {
    await db.insert(automationRunSchema).values({
      orgId: ORG,
      slug: 'process-new-mqls',
      kind: 'mission_check',
      status: 'running',
      startedAt: new Date(Date.now() - 10 * 60_000),
    });

    expect((await reconcileAbandonedRuns({ orgId: ORG })).reconciled).toBe(0);
  });
});

describe('a fire refused before dispatch', () => {
  it('still leaves a row, so the fire is not invisible', async () => {
    await seedAutomation('paused-one', { schedule: '0 12 * * *' }, { checkMission: 'm' }, 'disabled');

    await expect(fireAutomation(ORG, 'paused-one')).rejects.toThrow(/not active/);

    const rows = await db.select().from(automationRunSchema).where(eq(automationRunSchema.slug, 'paused-one'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'error' });
    expect(rows[0]?.error).toMatch(/not active/);
  });
});

describe('automationSourceFreshness', () => {
  it('judges the sources the fire actually read against their own crons', async () => {
    await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'hubspot-contacts',
      kind: 'plugin',
      configJson: { _connector: 'hubspot', schedule: '0 6 * * *' },
      lastSyncedAt: new Date(Date.now() - 7 * 24 * HOUR),
    });

    const f = await automationSourceFreshness(ORG, ['hubspot-contacts']);

    expect(f?.stale).toBe(true);
    expect(f?.expectedEveryMs).toBe(24 * HOUR);
  });

  it('is null when the last fire named no mirror', async () => {
    expect(await automationSourceFreshness(ORG, [])).toBeNull();
  });
});
