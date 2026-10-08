/**
 * `do: { job: team-thread }` — an automation step opens a team thread: the
 * team's lead opens and owns it, the job waits for its outcome and returns
 * where to find it, which the automation's own run keeps. The loop is mocked;
 * it is tested in `services/teams`.
 */
import { inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const startTeamThread = vi.fn(async (input: { lead: string }) => ({
  runId: 51,
  title: 'Team thread',
  team: { lead: input.lead, members: ['pipeline-analyst'], left: [] },
  done: Promise.resolve({ runId: 51, status: 'completed', settledBy: 'round_cap', outcome: 'Hold the forecast at $1.2M.', rounds: 3, microCents: 87_400_000, error: null }),
}));
vi.mock('@/services/teams/TeamThreadService', () => ({ startTeamThread }));

const { db } = await import('@/libs/DB');
const { teamSchema } = await import('@/models/Schema');
const { isBuiltInJob, runBuiltInJob } = await import('./registry');

const ORG = 'proj_thread_job';

beforeEach(async () => {
  startTeamThread.mockClear();
  await db.delete(teamSchema).where(inArray(teamSchema.orgId, [ORG, 'proj_elsewhere']));
  await db.insert(teamSchema).values([
    { orgId: ORG, slug: 'revenue-ops', name: 'Revenue Ops', leadAgentSlug: 'revenue-lead' },
    { orgId: ORG, slug: 'founder-gtm', name: 'Founder GTM', leadAgentSlug: null },
    { orgId: 'proj_elsewhere', slug: 'deal-desk', name: 'Deal Desk', leadAgentSlug: 'deal-desk-lead' },
  ]);
});

describe('the team-thread job', () => {
  it('is a built-in job an automation can name', () => {
    expect(isBuiltInJob('team-thread')).toBe(true);
  });

  it('opens the thread under the team\'s lead and returns its outcome, cost and run', async () => {
    const result = await runBuiltInJob('team-thread', ORG, { team: 'revenue-ops', question: 'Where will the quarter land?', maxRounds: 3, capCents: 200 });

    expect(startTeamThread).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, lead: 'revenue-lead', question: 'Where will the quarter land?', maxRounds: 3, capCents: 200, openedBy: 'job:team-thread' }));
    expect(result).toEqual({ runId: 51, status: 'completed', settledBy: 'round_cap', rounds: 3, cents: 87, outcome: 'Hold the forecast at $1.2M.', error: null });
  });

  it('takes a lead by slug too', async () => {
    await runBuiltInJob('team-thread', ORG, { lead: 'revenue-lead', question: 'Where will the quarter land?' });

    expect(startTeamThread).toHaveBeenCalledWith(expect.objectContaining({ lead: 'revenue-lead' }));
  });

  it('refuses, in words, a missing question, a team with no lead, and another workspace\'s team', async () => {
    await expect(runBuiltInJob('team-thread', ORG, { team: 'revenue-ops' })).rejects.toThrow('team-thread needs input.question');
    await expect(runBuiltInJob('team-thread', ORG, { team: 'founder-gtm', question: 'q' })).rejects.toThrow('the Founder GTM team has no lead yet');
    await expect(runBuiltInJob('team-thread', ORG, { team: 'deal-desk', question: 'q' })).rejects.toThrow('there is no team "deal-desk" in this workspace');
    expect(startTeamThread).not.toHaveBeenCalled();
  });
});
