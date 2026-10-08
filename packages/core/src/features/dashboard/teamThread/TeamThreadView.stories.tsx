import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { TeamThreadState, ThreadRunRow, ThreadTask } from '@/libs/teams/thread';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { threadViewOf } from '@/libs/teams/thread';
import { TeamThreadView } from './TeamThreadView';

/**
 * A team thread on its run page: the lead's outcome first, how it settled and
 * what it cost against its caps, then every post round by round. Built through
 * `threadViewOf`, the same function the page uses, from the run as it is stored.
 */
const meta: Meta<typeof TeamThreadView> = {
  title: 'Teams/Team thread',
  component: TeamThreadView,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <div className="@container mx-auto max-w-5xl">
        <TitleBar title="Team thread: Will the Northwind renewal land this quarter?" description="Team thread · completed" />
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof TeamThreadView>;

const NAMES = new Map([
  ['revenue-lead', 'Revenue Lead'],
  ['pipeline-analyst', 'Pipeline Analyst'],
  ['follow-up-coordinator', 'Follow-Up Coordinator'],
  ['proposal-writer', 'Proposal Writer'],
]);

const QUESTION = 'Will the Northwind retainer renewal land this quarter, and what would move it?';

function state(over: Partial<TeamThreadState> = {}): TeamThreadState {
  return {
    question: QUESTION,
    lead: 'revenue-lead',
    teamSlug: 'revenue-ops',
    accountableUserId: 'usr_owner',
    members: ['pipeline-analyst', 'follow-up-coordinator', 'proposal-writer'],
    turnOrder: 'parallel',
    maxRounds: 3,
    capCents: 300,
    round: 2,
    complete: ['proposal-writer'],
    settledBy: 'lead',
    settledAt: '2026-10-07T15:04:00.000Z',
    outcome: null,
    openedBy: 'agent:revenue-lead',
    userId: 'usr_owner',
    allowedSourceSlugs: null,
    parentRunId: null,
    conversationId: 412,
    ...over,
  };
}

function task(id: string, owner: string, output: string, over: Partial<ThreadTask> = {}): ThreadTask {
  return { id, title: id, ownerAgentSlug: owner, type: 'analysis', status: 'completed', output, startedAt: '2026-10-07T15:00:00.000Z', endedAt: '2026-10-07T15:01:00.000Z', ...over };
}

const ROUND_ONE: ThreadTask[] = [
  task('r1:pipeline-analyst', 'pipeline-analyst', 'Northwind\'s renewal sits at Negotiation with a close date of Nov 14. Deals of this size that reach Negotiation close 68% of the time this year, but this one has been at the stage for 19 days against a median of 9.'),
  task('r1:follow-up-coordinator', 'follow-up-coordinator', 'Agree with the stage read, but the 19 days are not silence: their procurement lead asked for revised payment terms on Oct 2 and we have not answered. That reply is the blocker, not interest.'),
  task('r1:proposal-writer', 'proposal-writer', 'The revised terms are drafted in the renewal proposal (quarterly billing, same rate). Nothing further from me — my part is done once someone sends it.'),
  task('r1:review', 'revenue-lead', 'Pipeline Analyst: re-run the odds assuming the terms reply goes out this week. Follow-Up Coordinator: who should send it, and by when?', { type: 'synthesis' }),
];

const ROUND_TWO: ThreadTask[] = [
  task('r2:pipeline-analyst', 'pipeline-analyst', 'With a reply this week the comparable deals close at 74%, and most of them within three weeks — inside the quarter.'),
  task('r2:follow-up-coordinator', 'follow-up-coordinator', 'The account owner should send it; Thursday keeps us inside their procurement window. I have nothing to add beyond that.'),
];

function run(t: TeamThreadState, tasks: ThreadTask[], over: Partial<ThreadRunRow> = {}): ThreadRunRow {
  return { id: 812, status: 'completed', thread: t, plan: { tasks }, microCents: 142_000_000, ...over };
}

const OUTCOME = 'Settled: it lands this quarter if the revised payment terms go out by Thursday. The blocker is our unanswered terms request from Oct 2, not Northwind\'s interest. Owner: the account owner sends the drafted terms (quarterly billing, same rate) by Thursday; the Pipeline Analyst re-reads the odds next Monday. Not established: whether their procurement lead can approve quarterly billing without finance.';

export const SettledByTheLead: Story = {
  args: {
    thread: threadViewOf(run(state({ outcome: OUTCOME }), [...ROUND_ONE, ...ROUND_TWO, task('outcome', 'revenue-lead', OUTCOME, { type: 'synthesis', title: 'Outcome' })]), NAMES, 'Morgan Hale')!,
  },
};

export const RoundCap: Story = {
  args: {
    thread: threadViewOf(run(state({ settledBy: 'round_cap', round: 2, maxRounds: 2, complete: [], outcome: 'The team did not converge in two rounds. Best read: likely this quarter if the terms reply goes out this week; the Follow-Up Coordinator and Pipeline Analyst disagree on whether procurement needs finance sign-off, and nobody could establish it.' }), [...ROUND_ONE, ...ROUND_TWO, task('outcome', 'revenue-lead', 'The team did not converge in two rounds. Best read: likely this quarter if the terms reply goes out this week; the Follow-Up Coordinator and Pipeline Analyst disagree on whether procurement needs finance sign-off, and nobody could establish it.', { type: 'synthesis', title: 'Outcome' })]), NAMES, 'Morgan Hale')!,
  },
};

export const BudgetCapWithAFailedPost: Story = {
  args: {
    thread: threadViewOf(run(state({ settledBy: 'budget_cap', round: 1, capCents: 100, complete: [], outcome: 'Stopped at its $1.00 cap after one round. From what was posted: the renewal is blocked on our unanswered terms request. The Proposal Writer\'s post failed, so whether the revised terms are drafted is not established.' }), [
      ROUND_ONE[0]!,
      ROUND_ONE[1]!,
      task('r1:proposal-writer', 'proposal-writer', '', { status: 'failed', output: undefined, error: 'TurnRefusedError: Budget exceeded for proposal-writer: $50.00 of a $50.00 daily cap' }),
      task('outcome', 'revenue-lead', 'Stopped at its $1.00 cap after one round. From what was posted: the renewal is blocked on our unanswered terms request. The Proposal Writer\'s post failed, so whether the revised terms are drafted is not established.', { type: 'synthesis', title: 'Outcome' }),
    ], { microCents: 104_000_000 }), NAMES, 'Morgan Hale')!,
  },
};

export const StillDiscussing: Story = {
  args: {
    thread: threadViewOf(run(state({ settledBy: null, settledAt: null, round: 1, complete: ['proposal-writer'] }), [
      ...ROUND_ONE,
      task('r2:pipeline-analyst', 'pipeline-analyst', '', { status: 'running', output: undefined, endedAt: undefined }),
      task('r2:follow-up-coordinator', 'follow-up-coordinator', '', { status: 'running', output: undefined, endedAt: undefined }),
    ], { status: 'running', microCents: 61_000_000 }), NAMES, 'Morgan Hale')!,
  },
};
