import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock('./AuthGuards', () => ({ guardAuth: mocks.auth }));
vi.mock('@/services/inbox/acrossWorkspaces', () => ({ listInboxForUser: mocks.read }));
const { mineRoute, mineCountRoute } = await import('./Inbox');

function call(route: unknown, input: unknown = {}) {
  return (route as { '~orpc': { handler: (args: { input: unknown; context: object }) => Promise<unknown> } })['~orpc'].handler({ input, context: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'member-of-both', orgId: 'workspace-a' });
  mocks.read.mockResolvedValue({ items: [], total: 0, yours: 0, workspaces: [], unavailable: [], withheld: [] });
});

it('reads only the authenticated workspace, never the complete membership set', async () => {
  await call(mineRoute);

  expect(mocks.read).toHaveBeenCalledExactlyOnceWith('member-of-both', { onlyWorkspaceId: 'workspace-a' });
});

it('rejects a foreign workspace selector before reading any queue', async () => {
  await expect(call(mineRoute, { workspaceId: 'workspace-b' })).rejects.toMatchObject({ code: 'not-found' });
  expect(mocks.read).not.toHaveBeenCalled();
});

it('keeps counts inside the same boundary as rows', async () => {
  await call(mineCountRoute);

  expect(mocks.read).toHaveBeenCalledExactlyOnceWith('member-of-both', { onlyWorkspaceId: 'workspace-a', cap: 0 });
});
