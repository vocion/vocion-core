import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), across: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: mocks.auth }));
vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn() }));
vi.mock('@/services/inbox/acrossWorkspaces', () => ({ listInboxForUser: mocks.across }));
vi.mock('@/services/InboxService', () => ({
  INBOX_SORTS: ['oldest', 'newest'],
  INBOX_TABS: ['open', 'decided', 'snoozed'],
  isInboxKind: () => false,
  listInbox: mocks.list,
}));
vi.mock('@/services/TeamService', () => ({ listTeamAgents: vi.fn(async () => []) }));
vi.mock('@/services/needsYou/batches', () => ({ recommendationBatches: vi.fn(async () => []) }));
vi.mock('@/features/dashboard/context/PageViewContext', () => ({ PageViewContext: () => null }));
vi.mock('@/features/dashboard/inbox/InboxControls', () => ({ InboxControls: () => null }));
vi.mock('@/features/dashboard/inbox/InboxList', () => ({ InboxList: () => null }));
vi.mock('@/features/dashboard/inbox/RecommendationBatches', () => ({ RecommendationBatches: () => null }));
vi.mock('@/features/dashboard/LiveRefresh', () => ({ LiveRefresh: () => null }));
vi.mock('@/features/dashboard/TitleBar', () => ({ TitleBar: () => null }));
vi.mock('@/components/ui/empty-state', () => ({ EmptyState: () => null }));
const { default: InboxPage } = await import('./page');

it('ignores legacy cross-workspace selectors and reads only URL-resolved workspace A', async () => {
  mocks.auth.mockResolvedValue({ userId: 'member-of-both', orgId: 'workspace-a' });
  mocks.across.mockImplementation(() => {
    throw new Error('Must not aggregate memberships');
  });
  mocks.list.mockResolvedValue({ total: 0, items: [], tabs: { open: 0, snoozed: 0, decided: 0 }, failedOpen: 0, facets: {}, counts: {} });
  await InboxPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ scope: 'all', workspace: 'workspace-b' }) });

  expect(mocks.across).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith('workspace-a', expect.any(Object));
});
