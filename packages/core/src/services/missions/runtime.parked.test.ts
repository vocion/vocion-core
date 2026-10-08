/**
 * A mission run whose agent parked it on its questions stops before its next
 * task — no further model calls — and picks the plan up at that task when its
 * resume gate lets it go. `runAgentDeep` is mocked; the DB is PGlite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/AgentService', () => ({ runAgentDeep: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', MISSION_RUN_COMPLETED: 'mission_run.completed', emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [], skipped: [] })) }));

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { askSchema, missionRunSchema, resumeGateSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');
const { upsertAsk } = await import('@/services/AskService');
const { parkOnAsks, resumeParkedMissionRun } = await import('@/services/needsYou/ResumeGateService');
const { executeMissionRun } = await import('./runtime');

const mockRun = vi.mocked(runAgentDeep);
const ORG = 'org_runtime_parked';

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(missionRunSchema);
  await db.delete(askSchema);
  await db.delete(resumeGateSchema);
});

describe('a mission run parked on its questions', () => {
  it('stops before the next task, then finishes from it once resumed', async () => {
    const { ask } = await upsertAsk({ orgId: ORG, ask: { kind: 'input', title: 'Which tier for Northwind?' } });
    const [run] = await db.insert(missionRunSchema).values({
      orgId: ORG,
      title: 'Quarterly pricing',
      brief: 'Price the Northwind renewal',
      status: 'running',
      autonomyPolicy: { level: 3 },
      team: { lead: 'pricing-lead', members: [] },
      plan: { tasks: [
        { id: 't1', title: 'Gather', ownerAgentSlug: 'pricing-lead', type: 'analysis', status: 'pending' },
        { id: 't2', title: 'Price', ownerAgentSlug: 'pricing-lead', type: 'analysis', status: 'pending', dependsOn: ['t1'] },
      ] },
    }).returning();
    let gateId = 0;
    // The first task's agent finds everything left waits on its question, and parks.
    mockRun.mockImplementationOnce(async () => {
      const parked = await parkOnAsks({ orgId: ORG, subject: { kind: 'mission_run', id: run!.id }, waitingOn: [ask.id], agentSlug: 'pricing-lead', reason: 'the Northwind tier' });
      gateId = parked.gate.id;
      return { response: 'Asked for the tier; waiting.', traceId: 'tr-1', toolCalls: [] } as never;
    });

    const status = await executeMissionRun(run!.id, ORG);

    expect(status).toBe('paused');
    expect(mockRun).toHaveBeenCalledTimes(1);

    const [paused] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, run!.id));

    expect(paused).toMatchObject({ status: 'paused', pauseReason: `waiting_on_asks:${gateId}` });
    expect(paused!.plan!.tasks.map(t => t.status)).toEqual(['completed', 'pending']);

    mockRun.mockResolvedValueOnce({ response: 'Priced at tier 2.', traceId: 'tr-2', toolCalls: [] } as never);
    const resumed = await resumeParkedMissionRun({ orgId: ORG, runId: run!.id, gateId });

    expect(resumed).toEqual({ resumed: true, status: 'completed' });
    expect(mockRun).toHaveBeenCalledTimes(2);
  });
});
