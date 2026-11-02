import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listTools } from './lists';

const mocks = vi.hoisted(() => ({ memberWorkspace: vi.fn(), listLists: vi.fn() }));
vi.mock('@/services/WorkspaceAccessService', () => ({ memberWorkspace: mocks.memberWorkspace }));
vi.mock('@/services/lists/service', async (original) => {
  const actual = await original<typeof import('@/services/lists/service')>();
  return { ...actual, listLists: mocks.listLists };
});

const ctx = { orgId: 'workspace-a', userId: 'person-a' } as RuntimeContext;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listLists.mockResolvedValue({ items: [], nextOffset: null, canManageWorkspace: false });
});

describe('List chat privacy boundary', () => {
  it('does not offer person-owned tools to unattended runs', () => {
    expect(listTools({ orgId: 'workspace-a' } as RuntimeContext)).toEqual([]);
  });

  it('excludes personal records from a shared conversation', async () => {
    mocks.memberWorkspace.mockResolvedValue({ kind: 'shared' });
    await listTools(ctx).find(t => t.name === 'list_lists')!.invoke({ offset: 0 });

    expect(mocks.listLists).toHaveBeenCalledWith({ orgId: 'workspace-a', userId: 'person-a', personalAccess: false }, 0);
  });

  it('permits personal records only in the personal assistant workspace', async () => {
    mocks.memberWorkspace.mockResolvedValue({ kind: 'personal' });
    await listTools(ctx).find(t => t.name === 'list_lists')!.invoke({ offset: 0 });

    expect(mocks.listLists).toHaveBeenCalledWith({ orgId: 'workspace-a', userId: 'person-a', personalAccess: true }, 0);
  });

  it('fails closed when workspace lookup returns no membership', async () => {
    mocks.memberWorkspace.mockResolvedValue(null);
    await listTools(ctx).find(t => t.name === 'list_lists')!.invoke({ offset: 0 });

    expect(mocks.listLists).toHaveBeenCalledWith({ orgId: 'workspace-a', userId: 'person-a', personalAccess: false }, 0);
  });
});
