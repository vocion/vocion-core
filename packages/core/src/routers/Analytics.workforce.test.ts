import { call } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));
vi.mock('@/services/adoption/AdoptionService', () => ({
  getAgentDetail: vi.fn(),
  getAgentRows: vi.fn(),
  getOverview: vi.fn(),
  getTrend: vi.fn(),
  getUserDetail: vi.fn(),
  getUserRows: vi.fn(),
}));
vi.mock('@/services/adoption/WorkforceService', () => ({ getWorkforceInventory: vi.fn() }));
const { guardAuth } = await import('./AuthGuards');
const { getWorkforceInventory } = await import('@/services/adoption/WorkforceService');
const { adoptionWorkforceRoute } = await import('./Analytics');

beforeEach(() => vi.clearAllMocks());

function session(admin: boolean) {
  vi.mocked(guardAuth).mockResolvedValue({
    orgId: 'session-workspace',
    accountId: 'account',
    has: () => admin,
  } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

describe('workforce route', () => {
  it('denies members before reading data', async () => {
    session(false);

    await expect(call(adoptionWorkforceRoute, { days: 30 })).rejects.toMatchObject({ status: 403 });
    expect(getWorkforceInventory).not.toHaveBeenCalled();
  });

  it('uses the authenticated workspace and validates the window', async () => {
    session(true);
    await call(adoptionWorkforceRoute, { days: 7, orgId: 'forged' } as { days: 7 });

    expect(getWorkforceInventory).toHaveBeenCalledWith('session-workspace', 7);
    await expect(call(adoptionWorkforceRoute, { days: 999 } as unknown as { days: 7 })).rejects.toThrow();
    expect(getWorkforceInventory).toHaveBeenCalledTimes(1);
  });
});
