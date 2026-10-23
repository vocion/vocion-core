/**
 * review.decline: one card for many decisions, declined only by a person,
 * each as its row's own verb (2026-10-23). Fictional fixtures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { declineTitle, personDeciding, reviewDeclineAction } from './review-decline';

const decideAsk = vi.fn();
const getAsk = vi.fn();
const decide = vi.fn();
const runStatus = vi.fn();

vi.mock('@/services/AskService', () => ({ decideAsk: (...a: unknown[]) => decideAsk(...a), getAsk: (...a: unknown[]) => getAsk(...a) }));
vi.mock('@/services/ReviewService', () => ({ decide: (...a: unknown[]) => decide(...a) }));
vi.mock('@/libs/DB', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => runStatus() }) }) }) } }));

const INPUT = { refs: ['ask:7', 'proposal:12', 'proposal:13'], selection: 'Recommendations waiting 5 days or more', sample: [{ title: 'Update Lucent Labs deal stage', days: 52 }], reason: 'Too old to act on.' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the card', () => {
  it('says how many, chosen how, and waits for a person', async () => {
    const card = await reviewDeclineAction.reviewCard!({ orgId: 'org_nw' }, INPUT);

    expect(declineTitle(INPUT)).toBe('Decline 3 decisions: Recommendations waiting 5 days or more');
    expect(card.title).toBe('Decline 3 decisions: Recommendations waiting 5 days or more');
    expect(card.verbs).toEqual({ approve: 'Decline 3', reject: 'Keep them' });
    expect(card.fields?.find(f => f.label === 'Among them')?.value).toBe('Update Lucent Labs deal stage (52d)');
    expect(reviewDeclineAction.approvalRequired).toBe(true);
    expect(reviewDeclineAction.inputSchema.safeParse({ ...INPUT, refs: ['deal:9'] }).success).toBe(false);
  });
});

describe('approving it', () => {
  it('is a person\'s act: an agent or a token never declines', async () => {
    expect(personDeciding({ reviewedBy: 'user_dana' })).toBe('user_dana');
    expect(personDeciding({ reviewedBy: 'agent:sdr-coordinator' })).toBeNull();
    expect(personDeciding({ origin: { userId: 'user_dana', byPerson: true } })).toBe('user_dana');
    expect(personDeciding({ origin: { userId: 'user_dana' } })).toBeNull();
    await expect(reviewDeclineAction.execute({ orgId: 'org_nw', reviewedBy: 'agent:lead' }, INPUT)).rejects.toThrow(/Only a person/);
  });

  it('declines each as its row would, skips what was decided since, and carries the reason', async () => {
    getAsk.mockResolvedValue({ id: 7, status: 'open' });
    runStatus.mockResolvedValueOnce([{ status: 'pending' }]).mockResolvedValueOnce([{ status: 'rejected' }]);

    const out = await reviewDeclineAction.execute({ orgId: 'org_nw', reviewedBy: 'user_dana' }, INPUT);

    expect(decideAsk).toHaveBeenCalledWith({ orgId: 'org_nw', id: 7, decision: 'reject', note: 'Too old to act on.', decidedBy: 'user_dana', via: 'chat' });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith({ kind: 'action', id: 12 }, 'reject', 'org_nw', { reviewedBy: 'user_dana', reason: 'Too old to act on.', learn: false });
    expect(out).toMatchObject({ declined: 2, skipped: 1, failed: 0, line: 'Declined 2 of 3; 1 were already decided.' });
  });
});
