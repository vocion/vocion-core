import type { Principal } from '@/services/authz';
import type { ApiCaller } from '@/services/writeApi';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateBearer } from '@/services/ApiTokenService';
import * as ReviewService from '@/services/ReviewService';
import {
  apiAssignReview,
  apiDecideReview,
  apiGetReview,
  apiListAutoExecuted,
  apiListReviews,
  apiProposeReview,
  apiRecordSignal,
  apiRewriteDraft,
  apiSnoozeReview,
  callerFromBearer,
  WriteApiError,
} from '@/services/writeApi';

vi.mock('@/services/ApiTokenService', () => ({
  authenticateBearer: vi.fn(),
}));
vi.mock('@/services/ReviewService', () => ({
  listPending: vi.fn(),
  listPendingPage: vi.fn(),
  getReviewDetail: vi.fn(),
  listAutoExecuted: vi.fn(),
  decide: vi.fn(),
  assign: vi.fn(),
  snooze: vi.fn(),
  recordActionSignal: vi.fn(),
  rewriteDraft: vi.fn(),
}));

const proposeAction = vi.fn();
vi.mock('@/services/ActionService', () => ({
  proposeAction: (...args: unknown[]) => proposeAction(...args),
}));

const ownerPrincipal: Principal = { kind: 'user', id: 'token:t1', role: 'owner', scope: { orgId: 'org1' }, grants: ['*'] };
const specialistPrincipal: Principal = { kind: 'user', id: 'token:t2', role: 'specialist', scope: { orgId: 'org1' }, grants: ['draft'] };

/**
 * A resolved caller, the way a route hands one to the write API.
 * @param principal
 */
function callerFor(principal: Principal): ApiCaller {
  return {
    orgId: 'org1',
    actorId: principal.id,
    principal,
    source: 'token',
  };
}

const owner = callerFor(ownerPrincipal);
const specialist = callerFor(specialistPrincipal);

const mockAuth = vi.mocked(authenticateBearer);
const mockList = vi.mocked(ReviewService.listPending);
const mockListPage = vi.mocked(ReviewService.listPendingPage);
const mockDetail = vi.mocked(ReviewService.getReviewDetail);
const mockAutoExecuted = vi.mocked(ReviewService.listAutoExecuted);
const mockDecide = vi.mocked(ReviewService.decide);
const mockAssign = vi.mocked(ReviewService.assign);
const mockSnooze = vi.mocked(ReviewService.snooze);
const mockSignal = vi.mocked(ReviewService.recordActionSignal);
const mockRewrite = vi.mocked(ReviewService.rewriteDraft);

const emptyPage = { items: [], total: 0, limit: 50, offset: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([]);
  mockListPage.mockResolvedValue(emptyPage);
});

describe('callerFromBearer', () => {
  it('throws 401 without a valid bearer token', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(callerFromBearer('Bearer nope')).rejects.toBeInstanceOf(WriteApiError);
    await expect(callerFromBearer('Bearer nope')).rejects.toMatchObject({ status: 401 });
  });

  it('resolves a valid token to a token-sourced caller', async () => {
    mockAuth.mockResolvedValue({ orgId: 'org1', tokenId: 't1', principal: ownerPrincipal });

    await expect(callerFromBearer('Bearer ok')).resolves.toEqual({
      orgId: 'org1',
      actorId: 'token:t1',
      principal: ownerPrincipal,
      source: 'token',
    });
  });
});

describe('apiListReviews', () => {
  it('lists the pending queue for the caller org', async () => {
    mockListPage.mockResolvedValue({
      items: [{ kind: 'mission', id: 1, orgId: 'org1', title: 'M', status: 'awaiting_review' }],
      total: 1,
      limit: 50,
      offset: 0,
    });

    const out = await apiListReviews(owner);

    expect(out.items).toHaveLength(1);
    expect(out.total).toBe(1);
  });

  it('filters to a person, and maps "unassigned" to the null queue', async () => {
    await apiListReviews(owner, { assignedTo: 'u_andrew' });

    expect(mockListPage).toHaveBeenCalledWith('org1', expect.objectContaining({ assignedTo: 'u_andrew' }));

    await apiListReviews(owner, { assignedTo: 'unassigned' });

    expect(mockListPage).toHaveBeenCalledWith('org1', expect.objectContaining({ assignedTo: null }));
  });

  it('passes kind, snooze and the page window straight through', async () => {
    await apiListReviews(owner, { kind: 'action', includeSnoozed: true, limit: 5, offset: 10 });

    expect(mockListPage).toHaveBeenCalledWith('org1', expect.objectContaining({
      kind: 'action',
      includeSnoozed: true,
      limit: 5,
      offset: 10,
    }));
  });

  it('rejects an unknown kind', async () => {
    await expect(apiListReviews(owner, { kind: 'bogus' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('apiGetReview', () => {
  it('returns the full record', async () => {
    mockDetail.mockResolvedValue({
      kind: 'action',
      id: 7,
      orgId: 'org1',
      title: 'Action · crm.update',
      status: 'pending',
      input: { field: 'value' },
      proposal: { confidence: 0.8, rationale: 'because' },
      card: null,
      record: {},
    });

    const out = await apiGetReview(owner, 'action', 7);

    expect(out.proposal).toEqual({ confidence: 0.8, rationale: 'because' });
    expect(mockDetail).toHaveBeenCalledWith('org1', 'action', 7);
  });

  it('is a 404 when the org does not own the item', async () => {
    mockDetail.mockResolvedValue(null);

    await expect(apiGetReview(owner, 'action', 7)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a non-integer id', async () => {
    await expect(apiGetReview(owner, 'action', Number.NaN)).rejects.toMatchObject({ status: 400 });
    expect(mockDetail).not.toHaveBeenCalled();
  });
});

describe('apiListAutoExecuted', () => {
  it('reads the auto-executed audit list for the caller org', async () => {
    mockAutoExecuted.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });

    await apiListAutoExecuted(owner, { limit: 10, offset: 0 });

    expect(mockAutoExecuted).toHaveBeenCalledWith('org1', { limit: 10, offset: 0 });
  });
});

describe('apiDecideReview', () => {
  it('dispatches an approval and stamps the caller', async () => {
    const out = await apiDecideReview(owner, { kind: 'mission', id: 7, action: 'approve' });

    expect(mockDecide).toHaveBeenCalledWith(
      { kind: 'mission', id: 7 },
      'approve',
      'org1',
      expect.objectContaining({ reviewedBy: 'token:t1' }),
    );
    expect(out.ok).toBe(true);
  });

  it('passes editedInput through on approve', async () => {
    await apiDecideReview(owner, { kind: 'action', id: 7, action: 'approve', editedInput: { subject: 'edited' } });

    expect(mockDecide).toHaveBeenCalledWith(
      { kind: 'action', id: 7 },
      'approve',
      'org1',
      expect.objectContaining({ editedInput: { subject: 'edited' } }),
    );
  });

  it('drops editedInput on reject — a rejection changes nothing', async () => {
    await apiDecideReview(owner, { kind: 'action', id: 7, action: 'reject', editedInput: { subject: 'edited' } });

    expect(mockDecide).toHaveBeenCalledWith(
      { kind: 'action', id: 7 },
      'reject',
      'org1',
      expect.objectContaining({ editedInput: undefined }),
    );
  });

  it('forbids a specialist and does not dispatch', async () => {
    await expect(apiDecideReview(specialist, { kind: 'mission', id: 7, action: 'approve' }))
      .rejects
      .toMatchObject({ status: 403 });
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('validates the review kind', async () => {
    await expect(apiDecideReview(owner, { kind: 'bogus' as 'mission', id: 1, action: 'approve' }))
      .rejects
      .toMatchObject({ status: 400 });
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('validates the action', async () => {
    await expect(apiDecideReview(owner, { kind: 'mission', id: 1, action: 'maybe' as 'approve' }))
      .rejects
      .toMatchObject({ status: 400 });
    expect(mockDecide).not.toHaveBeenCalled();
  });
});

describe('apiAssignReview', () => {
  it('routes an item and returns the refreshed queue', async () => {
    const out = await apiAssignReview(owner, { kind: 'mission', id: 7, assignedTo: 'u_andrew', note: 'SDR follow-up' });

    expect(mockAssign).toHaveBeenCalledWith(
      'org1',
      { kind: 'mission', id: 7 },
      expect.objectContaining({ assignedTo: 'u_andrew', assignedBy: 'token:t1' }),
    );
    expect(out.ok).toBe(true);
  });

  it('forbids a specialist from routing', async () => {
    await expect(apiAssignReview(specialist, { kind: 'mission', id: 7, assignedTo: 'u_andrew' }))
      .rejects
      .toMatchObject({ status: 403 });
    expect(mockAssign).not.toHaveBeenCalled();
  });
});

describe('apiSnoozeReview', () => {
  it('delays an item until the given timestamp', async () => {
    await apiSnoozeReview(owner, { kind: 'action', id: 3, until: '2030-01-01T00:00:00.000Z' });

    expect(mockSnooze).toHaveBeenCalledWith(
      'org1',
      { kind: 'action', id: 3 },
      new Date('2030-01-01T00:00:00.000Z'),
      'token:t1',
    );
  });

  it('rejects an unparseable timestamp', async () => {
    await expect(apiSnoozeReview(owner, { kind: 'action', id: 3, until: 'next tuesday' }))
      .rejects
      .toMatchObject({ status: 400 });
    expect(mockSnooze).not.toHaveBeenCalled();
  });
});

describe('apiRecordSignal', () => {
  it('records a triage signal without touching queue state', async () => {
    await apiRecordSignal(owner, { id: 12, signal: 'save' });

    expect(mockSignal).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org1',
      runId: 12,
      signal: 'save',
      userId: 'token:t1',
    }));
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('rejects a signal it does not know', async () => {
    await expect(apiRecordSignal(owner, { id: 12, signal: 'shrug' })).rejects.toMatchObject({ status: 400 });
    expect(mockSignal).not.toHaveBeenCalled();
  });

  it('forbids a specialist', async () => {
    await expect(apiRecordSignal(specialist, { id: 12, signal: 'save' })).rejects.toMatchObject({ status: 403 });
    expect(mockSignal).not.toHaveBeenCalled();
  });
});

describe('apiRewriteDraft', () => {
  it('returns the rewrite without saving it', async () => {
    mockRewrite.mockResolvedValue({ input: { body: 'new' }, body: 'new' });

    const out = await apiRewriteDraft(owner, { id: 5, hint: 'shorter' });

    expect(out.body).toBe('new');
    expect(mockRewrite).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org1', runId: 5, hint: 'shorter' }));
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('forbids a specialist', async () => {
    await expect(apiRewriteDraft(specialist, { id: 5 })).rejects.toMatchObject({ status: 403 });
    expect(mockRewrite).not.toHaveBeenCalled();
  });
});

describe('apiProposeReview', () => {
  it('proposes with an agent principal so the item lands pending', async () => {
    proposeAction.mockResolvedValue({ runId: 42, status: 'pending' });

    const out = await apiProposeReview(owner, { actionId: 'crm.update', input: { id: 1 }, agentSlug: 'sweeper' });

    expect(out).toEqual({ runId: 42, status: 'pending' });
    expect(proposeAction).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org1',
      actionId: 'crm.update',
      invokedBy: 'token:t1',
      principal: expect.objectContaining({ kind: 'agent', id: 'agent:sweeper' }),
    }));
  });

  it('requires an actionId', async () => {
    await expect(apiProposeReview(owner, { actionId: '', input: {} })).rejects.toMatchObject({ status: 400 });
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it('rejects a confidence outside 0–1', async () => {
    await expect(apiProposeReview(owner, { actionId: 'crm.update', input: {}, confidence: 1.5 }))
      .rejects
      .toMatchObject({ status: 400 });
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it('rejects an expiry beyond the cap', async () => {
    await expect(apiProposeReview(owner, { actionId: 'crm.update', input: {}, expiresInDays: 365 }))
      .rejects
      .toMatchObject({ status: 400 });
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it('turns an unknown action into a 400, not a 500', async () => {
    proposeAction.mockRejectedValue(new Error('No registered action: nope'));

    await expect(apiProposeReview(owner, { actionId: 'nope', input: {} })).rejects.toMatchObject({ status: 400 });
  });

  it('forbids a specialist', async () => {
    await expect(apiProposeReview(specialist, { actionId: 'crm.update', input: {} }))
      .rejects
      .toMatchObject({ status: 403 });
    expect(proposeAction).not.toHaveBeenCalled();
  });
});
