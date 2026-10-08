import type { RuntimeContext } from '../types';
/**
 * `open_team_thread` on both loops.
 *
 * In this process the call waits for the thread's outcome. On the agentcore
 * container a tool call is one HTTP round trip under the artifact's timeout,
 * so the call waits a bounded while and, when the thread is still going, says
 * so and returns — the thread settles on its own in core and its outcome lands
 * on its run. Either way the run is announced with `record_created` and each
 * post as a `step_progress` note: the same event contract.
 *
 * Who opens the thread comes from the turn's context — the claim, on the
 * container — never from the model's arguments. The thread loop itself is
 * mocked here; it is tested in `services/teams`.
 */
import type { TeamThreadState } from '@/libs/teams/thread';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

class TeamThreadError extends Error {}
const startTeamThread = vi.fn();
vi.mock('@/services/teams/TeamThreadService', () => ({ startTeamThread, TeamThreadError }));

const { db } = await import('@/libs/DB');
const { agentSchema, missionRunSchema } = await import('@/models/Schema');
const { openTeamThreadTool } = await import('./teamThread');
const { signClaim } = await import('../claims');
const { executeToolCall } = await import('../toolEndpoint');

const ORG = 'proj_thread_tool';

const SETTLED: TeamThreadState = {
  question: 'Will Northwind renew?',
  lead: 'revenue-lead',
  teamSlug: 'revenue-ops',
  accountableUserId: null,
  members: ['pipeline-analyst', 'follow-up-coordinator'],
  turnOrder: 'parallel',
  maxRounds: 3,
  capCents: 300,
  round: 2,
  complete: [],
  settledBy: 'lead',
  settledAt: '2026-10-07T15:00:00.000Z',
  outcome: 'It lands if the terms go out by Thursday.',
  openedBy: 'agent:revenue-lead',
  userId: 'usr_owner',
  allowedSourceSlugs: null,
  parentRunId: null,
  conversationId: null,
};

function ctx(events: Array<Record<string, unknown>>, over: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    orgId: ORG,
    agentSlug: 'revenue-lead',
    userId: 'usr_owner',
    allowedSourceSlugs: ['hubspot'],
    conversationId: 412,
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    provider: 'local',
    emit: (e: unknown) => events.push(e as Record<string, unknown>),
    ...over,
  } as unknown as RuntimeContext;
}

async function seedRun(thread: TeamThreadState | null): Promise<number> {
  const [row] = await db.insert(missionRunSchema).values({
    orgId: ORG,
    title: 'Team thread: Will Northwind renew?',
    brief: 'Will Northwind renew?',
    status: thread ? 'completed' : 'running',
    team: { lead: 'revenue-lead', members: [] },
    thread,
  } as never).returning({ id: missionRunSchema.id });
  return row!.id;
}

/**
 * What `startTeamThread` hands back: the run, the team, and its end.
 * @param runId - The run.
 * @param done - When and how it ends.
 * @param onStart - Called with what the tool passed, for posts to be reported through.
 */
function started(runId: number, done: Promise<unknown>, onStart?: (deps: { onPost?: (p: unknown) => void }) => void) {
  startTeamThread.mockImplementation(async (_input: unknown, deps: { onPost?: (p: unknown) => void }) => {
    onStart?.(deps);
    return { runId, title: 'Team thread: Will Northwind renew?', team: { members: ['pipeline-analyst', 'follow-up-coordinator'], left: ['wiki-researcher'] }, done };
  });
}

beforeEach(async () => {
  startTeamThread.mockReset();
  await db.delete(missionRunSchema).where(eq(missionRunSchema.orgId, ORG));
});

afterEach(() => {
  delete process.env.VOCION_TOOL_TIMEOUT_MS;
});

describe('open_team_thread in this process', () => {
  it('opens the thread as the turn\'s own agent, person and ACL, waits for the outcome, and links the run', async () => {
    const runId = await seedRun(SETTLED);
    const events: Array<Record<string, unknown>> = [];
    started(runId, Promise.resolve({ runId, status: 'completed', settledBy: 'lead', outcome: SETTLED.outcome, rounds: 2, microCents: 142_000_000, error: null }), (deps) => {
      deps.onPost?.({ kind: 'post', round: 1, agentSlug: 'pipeline-analyst', agentName: 'Pipeline Analyst', failed: false });
    });

    const out = JSON.parse(await openTeamThreadTool(ctx(events)).invoke({ question: 'Will Northwind renew?', members: ['pipeline-analyst', 'follow-up-coordinator', 'wiki-researcher'] }) as string);

    expect(startTeamThread).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG,
      lead: 'revenue-lead',
      openedBy: 'agent:revenue-lead',
      userId: 'usr_owner',
      allowedSourceSlugs: ['hubspot'],
      conversationId: 412,
      members: ['pipeline-analyst', 'follow-up-coordinator', 'wiki-researcher'],
    }), expect.anything());
    expect(out).toMatchObject({
      status: 'completed',
      outcome: 'It lands if the terms go out by Thursday.',
      settled: 'The lead declared it settled after 2 of 3 rounds.',
      cost: '$1.42',
      notAssigned: ['wiki-researcher'],
    });
    expect(events).toContainEqual({ type: 'record_created', record: { type: 'mission_run', id: String(runId), label: 'Team thread: Will Northwind renew?', href: `/dashboard/missions/runs/${runId}` } });
    expect(events).toContainEqual({ type: 'step_progress', tool: 'open_team_thread', note: 'Round 1 · Pipeline Analyst' });
  });

  it('says why it was not opened, in the service\'s own words', async () => {
    startTeamThread.mockRejectedValue(new TeamThreadError('Wiki Researcher has no specialists to open a thread with.'));

    const out = await openTeamThreadTool(ctx([], { agentSlug: 'wiki-researcher' })).invoke({ question: 'Anything?' });

    expect(out).toBe('Not opened: Wiki Researcher has no specialists to open a thread with.');
  });

  it('is refused inside a thread: a member or a reviewing lead does not open another', async () => {
    const runId = await seedRun({ ...SETTLED, settledBy: null, outcome: null });

    const out = await openTeamThreadTool(ctx([], { missionRunId: runId })).invoke({ question: 'A thread inside a thread?' });

    expect(out).toMatch(/^Not opened: you are already in a team thread/);
    expect(startTeamThread).not.toHaveBeenCalled();
  });

  it('opens from a mission step, naming the run it came from', async () => {
    const parent = await seedRun(null);
    const runId = await seedRun(SETTLED);
    started(runId, Promise.resolve({ runId, status: 'completed', settledBy: 'lead', outcome: 'x', rounds: 1, microCents: 0, error: null }));

    await openTeamThreadTool(ctx([], { missionRunId: parent, conversationId: undefined })).invoke({ question: 'Will Northwind renew?' });

    expect(startTeamThread).toHaveBeenCalledWith(expect.objectContaining({ parentRunId: parent }), expect.anything());
  });
});

describe('open_team_thread on the agentcore container', () => {
  it('returns inside the artifact\'s tool timeout while the thread is still going, and says so', async () => {
    // A 21s tool timeout leaves the call one second to wait.
    process.env.VOCION_TOOL_TIMEOUT_MS = '21000';
    const runId = await seedRun(null);
    const events: Array<Record<string, unknown>> = [];
    let onPost: ((p: unknown) => void) | undefined;
    started(runId, new Promise(() => {}), (deps) => {
      onPost = deps.onPost;
    });

    const began = Date.now();
    const out = JSON.parse(await openTeamThreadTool(ctx(events, { provider: 'runtime' })).invoke({ question: 'Will Northwind renew?' }) as string);

    expect(Date.now() - began).toBeLessThan(5_000);
    expect(out).toMatchObject({ status: 'still going', members: ['pipeline-analyst', 'follow-up-coordinator'] });
    expect(out.note).toContain('its outcome lands on its run');
    expect(events.some(e => e.type === 'record_created')).toBe(true);

    // The thread goes on; nothing more is emitted into a call that has returned.
    const before = events.length;
    onPost?.({ kind: 'post', round: 2, agentSlug: 'pipeline-analyst', agentName: 'Pipeline Analyst', failed: false });

    expect(events).toHaveLength(before);
  });

  it('runs through the claim-verified tool endpoint as the claimed org and agent, whatever the body says', async () => {
    process.env.VOCION_TOOL_SIGNING_SECRET = 'test-secret-for-team-threads';
    await db.delete(agentSchema);
    await db.insert(agentSchema).values({ orgId: ORG, slug: 'revenue-lead', name: 'Revenue Lead', systemPrompt: 'Lead.', harnessConfig: { runsOn: 'agentcore-container' } } as never);
    const runId = await seedRun(SETTLED);
    started(runId, Promise.resolve({ runId, status: 'completed', settledBy: 'lead', outcome: 'It lands.', rounds: 1, microCents: 0, error: null }));
    const token = signClaim({ orgId: ORG, agentSlug: 'revenue-lead', userId: 'usr_owner', missionRunId: undefined });

    const result = await executeToolCall({ token, tool: 'open_team_thread', input: { question: 'Will Northwind renew?', orgId: 'proj_someone_else', lead: 'their-lead' } });

    expect(result.ok).toBe(true);
    expect(startTeamThread).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, lead: 'revenue-lead', userId: 'usr_owner' }), expect.anything());

    const events = (result as { events: Array<{ type: string }> }).events;

    expect(events.some(e => e.type === 'record_created')).toBe(true);
  });
});
