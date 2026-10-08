import type { TeamThreadView as Thread } from '@/libs/teams/thread';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { TeamThreadView } from './TeamThreadView';
import '@/styles/global.css';

/**
 * A team thread on its run page leads with the outcome and the rule that
 * settled it, then whose it is and what it cost against its cap, then the
 * posts by round — and never repeats the outcome among the posts. Fixture
 * thread, fictional.
 */

function thread(over: Partial<Thread> = {}): Thread {
  return {
    runId: 812,
    status: 'completed',
    question: 'Will the Northwind renewal land this quarter?',
    lead: { slug: 'revenue-lead', name: 'Revenue Lead' },
    accountable: { userId: 'usr_owner', name: 'Morgan Hale' },
    members: [
      { slug: 'pipeline-analyst', name: 'Pipeline Analyst', complete: false },
      { slug: 'follow-up-coordinator', name: 'Follow-Up Coordinator', complete: true },
    ],
    turnOrder: 'parallel',
    round: 2,
    maxRounds: 3,
    capCents: 300,
    spentCents: 142,
    settledBy: 'lead',
    settled: 'The lead declared it settled after 2 of 3 rounds.',
    outcome: 'It lands if the terms go out by Thursday.',
    posts: [
      { id: 'r1:pipeline-analyst', kind: 'post', round: 1, agentSlug: 'pipeline-analyst', agentName: 'Pipeline Analyst', status: 'completed', body: '19 days at Negotiation.', error: null, complete: false, at: null },
      { id: 'r1:follow-up-coordinator', kind: 'post', round: 1, agentSlug: 'follow-up-coordinator', agentName: 'Follow-Up Coordinator', status: 'failed', body: null, error: 'TurnRefusedError: Budget exceeded\n  at x', complete: false, at: null },
      { id: 'r1:review', kind: 'review', round: 1, agentSlug: 'revenue-lead', agentName: 'Revenue Lead', status: 'completed', body: 'Coordinator, try again.', error: null, complete: false, at: null },
      { id: 'r2:follow-up-coordinator', kind: 'post', round: 2, agentSlug: 'follow-up-coordinator', agentName: 'Follow-Up Coordinator', status: 'completed', body: 'Our terms reply is owed. Done.', error: null, complete: true, at: null },
      { id: 'outcome', kind: 'outcome', round: null, agentSlug: 'revenue-lead', agentName: 'Revenue Lead', status: 'completed', body: 'It lands if the terms go out by Thursday.', error: null, complete: false, at: null },
    ],
    ...over,
  };
}

describe('TeamThreadView', () => {
  it('leads with the outcome and how it settled, then owner, members and cost against the cap', async () => {
    render(<TeamThreadView thread={thread()} />);

    await expect.element(page.getByTestId('team-thread-outcome')).toHaveTextContent('It lands if the terms go out by Thursday.');
    await expect.element(page.getByTestId('team-thread-settled')).toHaveTextContent('The lead declared it settled after 2 of 3 rounds.');
    await expect.element(page.getByText('Morgan Hale')).toBeVisible();
    await expect.element(page.getByTestId('team-thread-cost')).toHaveTextContent('$1.42 of a $3.00 cap');
    await expect.element(page.getByTestId('team-thread-members')).toHaveTextContent('Follow-Up Coordinator · marked complete');
  });

  it('shows every post by round, a failed one with its reason, and the outcome only once', async () => {
    render(<TeamThreadView thread={thread()} />);

    await expect.element(page.getByText('Failed — TurnRefusedError: Budget exceeded')).toBeVisible();
    await expect.element(page.getByText('lead · steer for the next round')).toBeVisible();
    await expect.poll(() => page.getByTestId('team-thread-post').elements().length).toBe(4);
    await expect.poll(() => page.getByText('It lands if the terms go out by Thursday.').elements().length).toBe(1);
  });

  it('says a running thread is still being discussed, and when it settles', async () => {
    render(<TeamThreadView thread={thread({ status: 'running', outcome: null, settled: null, settledBy: null, spentCents: null })} />);

    await expect.element(page.getByTestId('team-thread-outcome')).toHaveTextContent('The team is still discussing it.');
    await expect.element(page.getByTestId('team-thread-settled')).toHaveTextContent('It settles when Revenue Lead declares it done');
    await expect.element(page.getByTestId('team-thread-cost')).toHaveTextContent('Not recorded');
  });
});
