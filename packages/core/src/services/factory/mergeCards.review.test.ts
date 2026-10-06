import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { approveMergeCardsOnReview } from './mergeCards';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');

/** "Human or tool merging in Git directly also constitutes approval … Or approvals in Git" (Chris, 2026-10-05). */
const ORG = 'org_review_approval';
const URL = 'https://github.com/northwind/send/pull/77';

async function card(input: Record<string, unknown>, status = 'pending'): Promise<number> {
  const [row] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'git.merge', status, input: { title: 'Merge', externalRef: { system: 'github', url: URL }, ...input }, invokedBy: 'agent:change-reviewer' } as never).returning({ id: actionRunSchema.id });
  return row!.id;
}

const review = (over: Record<string, unknown> = {}) => ({ url: URL, reviewState: 'approved', reviewer: 'dana-okafor', reviewId: 9001, reviewedSha: 'abc1234def', reviewUrl: `${URL}#pullrequestreview-9001`, ...over });

beforeEach(async () => {
  await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
});

afterAll(async () => {
  await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
});

describe('an approving review in Git approves the merge card', () => {
  it('approves the waiting card for that pull request, as the reviewer, on the commit it would merge', async () => {
    const id = await card({ commitSha: 'abc1234def567' });
    const decide = vi.fn(async () => undefined);

    expect(await approveMergeCardsOnReview(ORG, review(), decide)).toEqual([id]);
    expect(decide).toHaveBeenCalledWith(ORG, id, 'dana-okafor', `Approved in GitHub by dana-okafor (${URL}#pullrequestreview-9001).`);
  });

  it('never counts Vocion\'s own mirrored review, a bot, a comment, or an approval of an older commit', async () => {
    await card({ commitSha: 'abc1234def567' });
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'repo.submit_review', status: 'done', input: {}, result: { reviewId: 9002 }, invokedBy: 'agent:change-reviewer' } as never);
    const decide = vi.fn(async () => undefined);

    expect(await approveMergeCardsOnReview(ORG, review({ reviewId: 9002 }), decide)).toEqual([]);
    expect(await approveMergeCardsOnReview(ORG, review({ reviewer: 'renovate[bot]' }), decide)).toEqual([]);
    expect(await approveMergeCardsOnReview(ORG, review({ reviewState: 'commented' }), decide)).toEqual([]);
    expect(await approveMergeCardsOnReview(ORG, review({ reviewedSha: '0000000aaa' }), decide)).toEqual([]);
    expect(decide).not.toHaveBeenCalled();
  });

  it('leaves another pull request\'s card, and a card already decided, alone', async () => {
    await card({ commitSha: 'abc1234def567' }, 'done');
    await card({ externalRef: { system: 'github', url: 'https://github.com/northwind/send/pull/78' } });
    const decide = vi.fn(async () => undefined);

    expect(await approveMergeCardsOnReview(ORG, review(), decide)).toEqual([]);
  });
});
