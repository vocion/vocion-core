/**
 * A team thread on the run page (`/dashboard/p/runs/agent-<id>`): one run,
 * its posts as its steps, its cost on the header and the lead's outcome as
 * its summary — the same page every agent run is read on, nothing beside it.
 */
import type { TeamThreadState } from '@/libs/teams/thread';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveSteps } from '@/libs/worker/runLog';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { missionRunSchema } = await import('@/models/Schema');
const { readRunLog } = await import('./RunLogService');

const ORG = 'proj_thread_run_page';

const THREAD: TeamThreadState = {
  question: 'Will Northwind renew?',
  lead: 'revenue-lead',
  teamSlug: 'revenue-ops',
  accountableUserId: null,
  members: ['pipeline-analyst', 'follow-up-coordinator'],
  turnOrder: 'parallel',
  maxRounds: 3,
  capCents: 300,
  round: 1,
  complete: ['pipeline-analyst', 'follow-up-coordinator'],
  settledBy: 'all_complete',
  settledAt: '2026-10-07T15:03:00.000Z',
  outcome: 'It lands if the terms go out by Thursday.',
  openedBy: 'agent:revenue-lead',
  userId: null,
  allowedSourceSlugs: null,
  parentRunId: null,
  conversationId: null,
};

beforeEach(async () => {
  await db.delete(missionRunSchema).where(eq(missionRunSchema.orgId, ORG));
});

describe('a team thread on the run page', () => {
  it('reads as one run: posts as steps, the cost on the header, the outcome as the summary', async () => {
    const [run] = await db.insert(missionRunSchema).values({
      orgId: ORG,
      title: 'Team thread: Will Northwind renew?',
      brief: THREAD.question,
      status: 'completed',
      team: { lead: 'revenue-lead', members: THREAD.members },
      plan: { tasks: [
        { id: 'r1:pipeline-analyst', title: 'Round 1 — marked complete', ownerAgentSlug: 'pipeline-analyst', type: 'analysis', status: 'completed', output: '19 days at Negotiation. Done.' },
        { id: 'r1:follow-up-coordinator', title: 'Round 1 — marked complete', ownerAgentSlug: 'follow-up-coordinator', type: 'analysis', status: 'completed', output: 'Our terms reply is owed. Done.' },
        { id: 'outcome', title: 'Outcome', ownerAgentSlug: 'revenue-lead', type: 'synthesis', status: 'completed', output: THREAD.outcome! },
      ] },
      microCents: 87_400_000,
      thread: THREAD,
    }).returning();

    const data = (await readRunLog(ORG, `agent-${run!.id}`))!;

    expect(data.header).toMatchObject({ kind: 'agent', cents: 87, summary: 'It lands if the terms go out by Thursday.' });
    expect(deriveSteps(data).map(s => s.name)).toEqual([
      'Round 1 — marked complete · pipeline-analyst',
      'Round 1 — marked complete · follow-up-coordinator',
      'Outcome · revenue-lead',
    ]);
    // Another workspace cannot read it.
    expect(await readRunLog('proj_someone_else', `agent-${run!.id}`)).toBeNull();
  });

  it('leaves an ordinary mission run without a summary, and says nothing of a cost it never recorded', async () => {
    const [run] = await db.insert(missionRunSchema).values({
      orgId: ORG,
      title: 'Weekly check',
      brief: 'Check the queue.',
      status: 'completed',
      team: { lead: 'revenue-lead', members: [] },
      microCents: null,
    } as never).returning();

    const data = (await readRunLog(ORG, `agent-${run!.id}`))!;

    expect(data.header.summary).toBeNull();
    expect(data.header.cents).toBeNull();
  });
});
