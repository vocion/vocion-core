/**
 * review.decline: one card for many decisions, declined only by a person,
 * each as its row's own verb (2026-10-23). Fictional fixtures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLEAR_OUT_NOTE, declineTitle, personDeciding, resultLine, reviewDeclineAction } from './review-decline';

const decideAsk = vi.fn();
const getAsk = vi.fn();
const decide = vi.fn();
const runStatus = vi.fn();
const decideCandidate = vi.fn();
const selectQueue = vi.fn();

vi.mock('@/services/AskService', () => ({ decideAsk: (...a: unknown[]) => decideAsk(...a), getAsk: (...a: unknown[]) => getAsk(...a) }));
vi.mock('@/services/ReviewService', () => ({ decide: (...a: unknown[]) => decide(...a) }));
vi.mock('@/services/LearningCandidateService', () => ({ decideCandidate: (...a: unknown[]) => decideCandidate(...a) }));
vi.mock('@/services/inbox/queueSelection', async orig => ({ ...(await orig<typeof import('@/services/inbox/queueSelection')>()), selectQueue: (...a: unknown[]) => selectQueue(...a) }));
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
    expect(out).toMatchObject({ declined: 2, skipped: 1, failed: 0, line: 'Declined 2 of the 3 on the card; 1 were already decided.' });
  });

  it('rejects a suggested rule with a note that says it was not judged, and dismisses a failed run', async () => {
    decideCandidate.mockResolvedValue({ ok: true });
    runStatus.mockResolvedValueOnce([{ status: 'failed' }]);

    const out = await reviewDeclineAction.execute({ orgId: 'org_nw', reviewedBy: 'user_dana' }, { refs: ['learning:5', 'proposal:44'], selection: 'Open decisions waiting 7 days or more' });

    expect(decideCandidate).toHaveBeenCalledWith({ orgId: 'org_nw', id: 5, decision: 'reject', reason: CLEAR_OUT_NOTE, decidedBy: 'user_dana' });
    expect(decide).toHaveBeenCalledWith({ kind: 'action', id: 44 }, 'reject', 'org_nw', { reviewedBy: 'user_dana', learn: false });
    expect(out).toMatchObject({ declined: 2, skipped: 0 });
  });

  // 2026-10-23: the reply said "Done. Cleared 100" beside a queue still
  // holding rows of 30 to 51 days. The result reads the selection again.
  it('says what is still open in the same selection afterwards, so done is only said when it is', async () => {
    getAsk.mockResolvedValue({ id: 7, status: 'open' });
    runStatus.mockResolvedValue([{ status: 'pending' }]);
    selectQueue.mockResolvedValue({ targets: [{ ref: 'ask:70' }], rows: 1, open: 35, failed: 11, leftOpen: [{ kind: 'run', count: 6, why: 'a paused run is resumed or cancelled on its own page' }] });

    const out = await reviewDeclineAction.execute({ orgId: 'org_nw', reviewedBy: 'user_dana' }, { ...INPUT, filter: { older_than_days: 7 } }) as { line: string; stillOpen: unknown };

    expect(selectQueue).toHaveBeenCalledWith('org_nw', { olderThanDays: 7 });
    expect(out.line).toBe('Declined 3 of the 3 on the card. Still open in that selection: 1 that another card can decline; 6 runs (a paused run is resumed or cancelled on its own page). The Review queue now holds 24 decisions and 11 failed runs to retry or dismiss.');
    expect(out.stillOpen).toMatchObject({ declinable: 1, open: 35, failed: 11 });
  });

  it('says nothing is left only when nothing is', () => {
    expect(resultLine({ declined: 40, chosen: 40, skipped: 0, failed: [], after: { declinable: 0, leftOpen: [], open: 3, failed: 0 } })).toBe('Declined 40 of the 40 on the card. Nothing in that selection is still open. The Review queue now holds 3 decisions.');
  });

  it('counts its records for the turn that reports it', () => {
    expect(reviewDeclineAction.recordCount!(INPUT)).toBe(3);
  });
});

describe('the card says what it leaves out', () => {
  it('names the kinds a decline cannot take, and the first N of M when more match', async () => {
    const card = await reviewDeclineAction.reviewCard!({ orgId: 'org_nw' }, { ...INPUT, beyond: 12, left_open: [{ label: 'exceptions', count: 2, why: 'a failure is retried or dismissed on its own page' }] });

    expect(card.headline).toContain('These are the first 3 of 15; 12 more match.');
    expect(card.headline).toContain('Not included: 2 exceptions (a failure is retried or dismissed on its own page).');
    expect(card.fields?.find(f => f.label === 'Not included')?.value).toBe('2 exceptions (a failure is retried or dismissed on its own page)');
  });
});
