import type { Principal } from '@/services/authz';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateBearer } from '@/services/ApiTokenService';
import * as ReviewService from '@/services/ReviewService';
import { apiDecideReview, apiListReviews, WriteApiError } from '@/services/writeApi';

vi.mock('@/services/ApiTokenService', () => ({
  authenticateBearer: vi.fn(),
}));
vi.mock('@/services/ReviewService', () => ({
  listPending: vi.fn(),
  decide: vi.fn(),
}));

const owner: Principal = { kind: 'user', id: 'token:t1', role: 'owner', scope: { orgId: 'org1' }, grants: ['*'] };
const specialist: Principal = { kind: 'user', id: 'token:t2', role: 'specialist', scope: { orgId: 'org1' }, grants: ['draft'] };

function ident(principal: Principal) {
  return { orgId: 'org1', tokenId: principal.id.replace('token:', ''), principal };
}

const mockAuth = vi.mocked(authenticateBearer);
const mockList = vi.mocked(ReviewService.listPending);
const mockDecide = vi.mocked(ReviewService.decide);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('writeApi', () => {
  it('throws 401 without a valid bearer token', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(apiListReviews('Bearer nope')).rejects.toBeInstanceOf(WriteApiError);
    await expect(apiListReviews('Bearer nope')).rejects.toMatchObject({ status: 401 });
  });

  it('lists the pending queue for the token org', async () => {
    mockAuth.mockResolvedValue(ident(owner));
    mockList.mockResolvedValue([{ kind: 'mission', id: 1, orgId: 'org1', title: 'M', status: 'awaiting_review' }]);
    const out = await apiListReviews('Bearer ok');

    expect(out.reviews).toHaveLength(1);
    expect(mockList).toHaveBeenCalledWith('org1');
  });

  it('lets an owner token decide → dispatches + returns the refreshed queue', async () => {
    mockAuth.mockResolvedValue(ident(owner));
    mockList.mockResolvedValue([]);
    const out = await apiDecideReview('Bearer ok', { kind: 'mission', id: 7, action: 'approve' });

    expect(mockDecide).toHaveBeenCalledWith(
      { kind: 'mission', id: 7 },
      'approve',
      'org1',
      expect.objectContaining({ reviewedBy: 'token:t1' }),
    );
    expect(out.ok).toBe(true);
    expect(out.reviews).toEqual([]);
  });

  it('forbids a specialist token (no approve grant) and does not dispatch', async () => {
    mockAuth.mockResolvedValue(ident(specialist));

    await expect(apiDecideReview('Bearer ok', { kind: 'mission', id: 7, action: 'approve' }))
      .rejects
      .toMatchObject({ status: 403 });
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('validates the review kind', async () => {
    mockAuth.mockResolvedValue(ident(owner));

    await expect(apiDecideReview('Bearer ok', { kind: 'bogus' as 'mission', id: 1, action: 'approve' }))
      .rejects
      .toMatchObject({ status: 400 });
    expect(mockDecide).not.toHaveBeenCalled();
  });
});
