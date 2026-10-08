/**
 * A team thread whose members run on the agentcore container.
 *
 * Every turn of a thread goes through `runAgentDeep`, the seam a chat turn and
 * a mission task go through, so each member answers wherever its own
 * `harness.runsOn` says. What is pinned here is that the thread's identity
 * crosses with each turn — the container's tool calls come back to core
 * carrying only what the claim carries, so a turn sent without the thread's
 * `missionRunId` would write tool calls that belong to no run — and that the
 * thread reads the container's answers exactly as it reads the in-process
 * loop's: same contract, same settle rule, same one run.
 *
 * No live model and no container: the providers are mocked, the DB is the
 * PGlite test mock, the dispatch and the thread loop are real.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const runAgentOnRuntime = vi.fn(async (opts: { agentSlug: string; message: string }) => ({
  response: opts.agentSlug === 'revenue-lead' ? 'Outcome from the container: answer the terms request by Thursday.' : `${opts.agentSlug} on the container: posted.`,
  traceId: `t-${opts.agentSlug}`,
  toolCalls: [],
}));
vi.mock('@/services/agents/providers/runtime', () => ({ runAgentOnRuntime }));
vi.mock('@/services/agents/providers/agentcore', () => ({ runAgentOnAgentCoreHarness: vi.fn() }));
vi.mock('@/services/agents/harness', () => ({
  chatModelOptionsFor: () => ({}),
  chatModelOptionsWithOverride: () => ({}),
  buildInitialFiles: vi.fn(async () => ({})),
  compileAgentForRequest: vi.fn(async () => {
    throw new Error('in-process loop reached');
  }),
}));
vi.mock('@/libs/Langfuse', () => ({ createLangfuseCallback: vi.fn(() => undefined) }));
vi.mock('@/services/BudgetService', () => ({
  preflightCheck: vi.fn(async () => ({ ok: true })),
  chargeUsage: vi.fn(async () => {}),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, missionRunSchema, teamSchema } = await import('@/models/Schema');
const { openTeamThread, runTeamThread } = await import('./TeamThreadService');

const ORG = 'proj_thread_on_container';
const CONTAINER = { runsOn: 'agentcore-container' };

beforeEach(async () => {
  runAgentOnRuntime.mockClear();
  delete process.env.VOCION_AGENT_PROVIDER;
  delete process.env.VOCION_DISABLE_RUNTIME;
  await db.delete(missionRunSchema).where(eq(missionRunSchema.orgId, ORG));
  await db.delete(teamSchema).where(eq(teamSchema.orgId, ORG));
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
  await db.insert(teamSchema).values({ orgId: ORG, slug: 'revenue-ops', name: 'Revenue Ops', leadAgentSlug: 'revenue-lead' });
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'revenue-lead', name: 'Revenue Lead', systemPrompt: 'Lead.', teamSlug: 'revenue-ops', harnessConfig: CONTAINER },
    { orgId: ORG, slug: 'pipeline-analyst', name: 'Pipeline Analyst', systemPrompt: 'Analyse.', teamSlug: 'revenue-ops', harnessConfig: CONTAINER },
    { orgId: ORG, slug: 'follow-up-coordinator', name: 'Follow-Up Coordinator', systemPrompt: 'Follow up.', teamSlug: 'revenue-ops', harnessConfig: CONTAINER },
  ] as never);
});

describe('a team thread whose agents run on the container', () => {
  it('sends every turn there with the thread\'s run on it, and settles on the container\'s answers', async () => {
    const { runId } = await openTeamThread({ orgId: ORG, lead: 'revenue-lead', question: 'Will the Northwind renewal land?', openedBy: 'agent:revenue-lead', userId: 'usr_owner', maxRounds: 1 });

    const result = await runTeamThread(ORG, runId, {
      // Both members say they are done: the thread settles on that rule.
      readMember: async ({ post }) => ({ complete: post.endsWith('posted.') }),
      readLead: async () => ({ settled: false }),
    });

    expect(result).toMatchObject({ status: 'completed', settledBy: 'all_complete', outcome: 'Outcome from the container: answer the terms request by Thursday.' });
    expect(runAgentOnRuntime.mock.calls.map(c => c[0])).toEqual([
      expect.objectContaining({ orgId: ORG, agentSlug: 'pipeline-analyst', missionRunId: runId, userId: 'usr_owner' }),
      expect.objectContaining({ orgId: ORG, agentSlug: 'follow-up-coordinator', missionRunId: runId, userId: 'usr_owner' }),
      expect.objectContaining({ orgId: ORG, agentSlug: 'revenue-lead', missionRunId: runId, userId: 'usr_owner' }),
    ]);
    // The lead's outcome turn on the container read both members' posts.
    expect((runAgentOnRuntime.mock.calls[2]![0] as { message: string }).message).toContain('pipeline-analyst on the container: posted.');

    const [row] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, runId));

    expect(row!.plan!.tasks.map(t => [t.id, t.traceId])).toEqual([
      ['r1:pipeline-analyst', 't-pipeline-analyst'],
      ['r1:follow-up-coordinator', 't-follow-up-coordinator'],
      ['outcome', 't-revenue-lead'],
    ]);
  });

  it('comes back to this process when the kill switch is on, and a failed loop is a failed post, not a crash', async () => {
    process.env.VOCION_DISABLE_RUNTIME = '1';
    const { runId } = await openTeamThread({ orgId: ORG, lead: 'revenue-lead', question: 'Will the Northwind renewal land?', openedBy: 'agent:revenue-lead', maxRounds: 1 });

    const result = await runTeamThread(ORG, runId, { readMember: async () => ({ complete: false }), readLead: async () => ({ settled: false }) });

    expect(runAgentOnRuntime).not.toHaveBeenCalled();
    // Every turn reached the (stubbed) in-process loop and failed there; the
    // thread records each failure where it happened and ends failed, saying why.
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/in-process loop reached/);
  });
});
