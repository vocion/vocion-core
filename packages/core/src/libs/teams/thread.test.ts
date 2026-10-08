/**
 * The settle rule, the bounds and the words a thread's turns are given — the
 * pure half of team threads (`libs/teams/thread.ts`). The loop is tested in
 * `services/teams/TeamThreadService.test.ts`.
 */
import type { SettleInput, TeamThreadState, ThreadTask } from './thread';
import { describe, expect, it } from 'vitest';
import {
  boundThreadOptions,
  leadReviewMessage,
  memberMessage,
  outcomeMessage,
  readPostId,
  settleLine,
  settleReason,
  THREAD_LIMITS,
  threadTranscript,
  threadViewOf,
} from './thread';

const MEMBERS = ['pipeline-analyst', 'follow-up-coordinator'];
const NAMES = new Map([['revenue-lead', 'Revenue Lead'], ['pipeline-analyst', 'Pipeline Analyst'], ['follow-up-coordinator', 'Follow-Up Coordinator']]);

function at(over: Partial<SettleInput> = {}): SettleInput {
  return { round: 1, maxRounds: 3, members: MEMBERS, complete: [], leadSettled: false, spentMicroCents: 0, capCents: 300, ...over };
}

function post(id: string, owner: string, output: string, over: Partial<ThreadTask> = {}): ThreadTask {
  return { id, title: id, ownerAgentSlug: owner, type: 'analysis', status: 'completed', output, ...over };
}

describe('the settle rule', () => {
  it('keeps a thread open while no rule holds', () => {
    expect(settleReason(at())).toBeNull();
  });

  it('ends on the lead\'s word', () => {
    expect(settleReason(at({ leadSettled: true }))).toBe('lead');
  });

  it('ends when every assigned member has marked complete, and not when only some have', () => {
    expect(settleReason(at({ complete: ['pipeline-analyst'] }))).toBeNull();
    expect(settleReason(at({ complete: ['follow-up-coordinator', 'pipeline-analyst'] }))).toBe('all_complete');
  });

  it('never reads a thread with no members as all complete', () => {
    expect(settleReason(at({ members: [], complete: [] }))).toBeNull();
  });

  it('ends at the budget cap, counting what was spent to the micro-cent', () => {
    expect(settleReason(at({ capCents: 100, spentMicroCents: 99_999_999 }))).toBeNull();
    expect(settleReason(at({ capCents: 100, spentMicroCents: 100_000_000 }))).toBe('budget_cap');
  });

  it('ends at the round cap', () => {
    expect(settleReason(at({ round: 2, maxRounds: 3 }))).toBeNull();
    expect(settleReason(at({ round: 3, maxRounds: 3 }))).toBe('round_cap');
  });

  it('records the most meaningful rule that holds: cancel, lead, members, budget, rounds', () => {
    const everything = at({ cancelled: true, leadSettled: true, complete: MEMBERS, spentMicroCents: 1e12, round: 9 });

    expect(settleReason(everything)).toBe('cancelled');
    expect(settleReason({ ...everything, cancelled: false })).toBe('lead');
    expect(settleReason({ ...everything, cancelled: false, leadSettled: false })).toBe('all_complete');
    expect(settleReason({ ...everything, cancelled: false, leadSettled: false, complete: [] })).toBe('budget_cap');
    expect(settleReason({ ...everything, cancelled: false, leadSettled: false, complete: [], spentMicroCents: 0 })).toBe('round_cap');
  });

  it('says why in a sentence a person reads', () => {
    expect(settleLine('lead', { round: 2, maxRounds: 3, capCents: 300 })).toBe('The lead declared it settled after 2 of 3 rounds.');
    expect(settleLine('budget_cap', { round: 1, maxRounds: 3, capCents: 150 })).toBe('It reached its budget cap of $1.50 after 1 of 3 rounds.');
    expect(settleLine('round_cap', { round: 1, maxRounds: 1, capCents: 300 })).toBe('It reached its round cap: 1 of 1 round.');
  });
});

describe('the bounds', () => {
  it('defaults to three rounds, $3 and parallel turns', () => {
    expect(boundThreadOptions()).toEqual({ maxRounds: THREAD_LIMITS.defaultRounds, capCents: THREAD_LIMITS.defaultCapCents, turnOrder: 'parallel' });
  });

  it('holds whatever the opener asked for inside the caps', () => {
    expect(boundThreadOptions({ maxRounds: 50, capCents: 1_000_000, turnOrder: 'sequential' })).toEqual({ maxRounds: THREAD_LIMITS.maxRounds, capCents: THREAD_LIMITS.maxCapCents, turnOrder: 'sequential' });
    expect(boundThreadOptions({ maxRounds: 0, capCents: -5 })).toMatchObject({ maxRounds: 1, capCents: 1 });
    expect(boundThreadOptions({ maxRounds: 2.7 })).toMatchObject({ maxRounds: 2 });
  });
});

describe('what each turn reads', () => {
  const tasks: ThreadTask[] = [
    post('r1:pipeline-analyst', 'pipeline-analyst', 'Northwind has been at Negotiation for 19 days.'),
    post('r1:follow-up-coordinator', 'follow-up-coordinator', 'The 19 days are our unanswered terms request.'),
    post('r1:review', 'revenue-lead', 'Analyst: re-run the odds.', { type: 'synthesis' }),
    post('r2:pipeline-analyst', 'pipeline-analyst', '', { status: 'running', output: undefined }),
  ];

  it('shows every finished post with who wrote it, and leaves out a post still being written', () => {
    const text = threadTranscript(tasks, NAMES);

    expect(text).toContain('[Round 1 · Pipeline Analyst (pipeline-analyst)]\nNorthwind has been at Negotiation for 19 days.');
    expect(text).toContain('[Round 1 · Follow-Up Coordinator (follow-up-coordinator)]\nThe 19 days are our unanswered terms request.');
    expect(text).toContain('[Round 1 review · Revenue Lead (revenue-lead) · lead]\nAnalyst: re-run the odds.');
    expect(text).not.toContain('Round 2');
  });

  it('says a failed post failed, and why, instead of dropping it', () => {
    const text = threadTranscript([post('r1:pipeline-analyst', 'pipeline-analyst', '', { status: 'failed', output: undefined, error: 'TurnRefusedError: Budget exceeded\n  at x' })], NAMES);

    expect(text).toContain('(This post failed and was not written: TurnRefusedError: Budget exceeded)');
  });

  it('keeps the newest posts whole and names the oldest when the thread is too long to read at once', () => {
    const long = Array.from({ length: 14 }, (_, i) => post(`r${i + 1}:pipeline-analyst`, 'pipeline-analyst', `${i + 1}:${'x'.repeat(3_990)}`));
    const text = threadTranscript(long, NAMES);

    expect(text).toContain('14:xxx');
    expect(text).toContain('an earlier post of');
    expect(text.startsWith('[Round 1 · Pipeline Analyst (pipeline-analyst)]\n(an earlier post')).toBe(true);
  });

  it('gives a member the others\' posts and the round it is in', () => {
    const message = memberMessage({ question: 'Will Northwind renew this quarter?', lead: 'revenue-lead', members: MEMBERS, round: 2, maxRounds: 3, names: NAMES, tasks }, 'pipeline-analyst');

    expect(message).toContain('You are Pipeline Analyst (pipeline-analyst), posting in a TEAM THREAD');
    expect(message).toContain('Question: Will Northwind renew this quarter?');
    expect(message).toContain('round 2 of at most 3');
    expect(message).toContain('The 19 days are our unanswered terms request.');
  });

  it('asks the lead to settle it with the outcome or steer the next round, naming who is complete', () => {
    const message = leadReviewMessage({ question: 'Will Northwind renew?', lead: 'revenue-lead', members: MEMBERS, round: 1, maxRounds: 3, names: NAMES, tasks }, ['follow-up-coordinator']);

    expect(message).toContain('Round 1 of at most 3 has just finished');
    expect(message).toContain('Marked their part complete: Follow-Up Coordinator (follow-up-coordinator).');
    expect(message).toContain('declare it settled and write the outcome now');
  });

  it('tells the lead which rule settled it when the outcome is owed', () => {
    const message = outcomeMessage({ question: 'Will Northwind renew?', lead: 'revenue-lead', members: MEMBERS, round: 3, maxRounds: 3, names: NAMES, tasks }, 'round_cap', { capCents: 300 });

    expect(message).toContain('It reached its round cap: 3 of 3 rounds.');
    expect(message).toContain('Write the outcome now');
  });
});

describe('the view a page draws', () => {
  function state(over: Partial<TeamThreadState> = {}): TeamThreadState {
    return {
      question: 'Will Northwind renew?',
      lead: 'revenue-lead',
      teamSlug: 'revenue-ops',
      accountableUserId: 'usr_owner',
      members: MEMBERS,
      turnOrder: 'parallel',
      maxRounds: 3,
      capCents: 300,
      round: 2,
      complete: ['follow-up-coordinator'],
      settledBy: 'lead',
      settledAt: '2026-10-07T15:00:00.000Z',
      outcome: 'It lands if the terms go out by Thursday.',
      openedBy: 'agent:revenue-lead',
      userId: 'usr_owner',
      allowedSourceSlugs: null,
      parentRunId: null,
      conversationId: null,
      ...over,
    };
  }

  it('is null for a run that is not a thread', () => {
    expect(threadViewOf({ id: 1, status: 'completed', thread: null, plan: { tasks: [] }, microCents: 0 })).toBeNull();
  });

  it('leads with the outcome and the rule, marks the post that completed a member, and counts the cost in cents', () => {
    const view = threadViewOf({
      id: 9,
      status: 'completed',
      thread: state(),
      plan: { tasks: [
        post('r1:pipeline-analyst', 'pipeline-analyst', 'a'),
        post('r1:follow-up-coordinator', 'follow-up-coordinator', 'b — nothing more from me'),
        post('r1:review', 'revenue-lead', 'steer'),
        post('r2:pipeline-analyst', 'pipeline-analyst', 'c'),
        post('outcome', 'revenue-lead', 'It lands if the terms go out by Thursday.'),
      ] },
      microCents: 142_400_000,
    }, NAMES, 'Morgan Hale')!;

    expect(view.outcome).toBe('It lands if the terms go out by Thursday.');
    expect(view.settled).toBe('The lead declared it settled after 2 of 3 rounds.');
    expect(view.spentCents).toBe(142);
    expect(view.accountable).toEqual({ userId: 'usr_owner', name: 'Morgan Hale' });
    expect(view.members).toEqual([
      { slug: 'pipeline-analyst', name: 'Pipeline Analyst', complete: false },
      { slug: 'follow-up-coordinator', name: 'Follow-Up Coordinator', complete: true },
    ]);
    expect(view.posts.map(p => [p.id, p.kind, p.round, p.complete])).toEqual([
      ['r1:pipeline-analyst', 'post', 1, false],
      ['r1:follow-up-coordinator', 'post', 1, true],
      ['r1:review', 'review', 1, false],
      ['r2:pipeline-analyst', 'post', 2, false],
      ['outcome', 'outcome', null, false],
    ]);
  });

  it('says a cost was not recorded rather than zero', () => {
    expect(threadViewOf({ id: 9, status: 'running', thread: state({ settledBy: null }), plan: null, microCents: null })!.spentCents).toBeNull();
  });

  it('reads its own step ids back, and nothing else', () => {
    expect(readPostId('r3:pipeline-analyst')).toEqual({ kind: 'post', round: 3 });
    expect(readPostId('r2:review')).toEqual({ kind: 'review', round: 2 });
    expect(readPostId('outcome')).toEqual({ kind: 'outcome', round: null });
    expect(readPostId('t1')).toBeNull();
    expect(readPostId('scheduled-check')).toBeNull();
  });
});
