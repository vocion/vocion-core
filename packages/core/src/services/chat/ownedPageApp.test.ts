import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceAppNav = vi.hoisted(() => vi.fn());
vi.mock('@/features/dashboard/workspaceAppNav', () => ({ workspaceAppNav }));
const { loadOwnedPageApp, ownedPageApp } = await import('./ownedPageApp');
const apps = [
  { id: 'core', core: true, owns: ['/dashboard'] },
  { id: 'editorial', core: false, owns: ['/dashboard/p/client-pages', '/dashboard/apps/editorial/home'] },
  { id: 'specialized', core: false, owns: ['/dashboard/p/client-pages/reviews'] },
];

beforeEach(() => {
  workspaceAppNav.mockReset();
});

describe('tab-owned app routing', () => {
  it('uses manifest ownership without app query or a remembered cookie', () => {
    expect(ownedPageApp('https://agents.example.com/w/team-a/dashboard/p/client-pages', 'team-a', apps)).toBe('editorial');
    expect(ownedPageApp('https://agents.example.com/w/team-a/dashboard/apps/editorial/home', 'team-a', apps)).toBe('editorial');
    expect(ownedPageApp('https://agents.example.com/w/team-a/dashboard/p/client-pages/reviews/42', 'team-a', apps)).toBe('specialized');
  });

  it('never infers ownership from a shared route, a lookalike prefix, or a foreign workspace', () => {
    expect(ownedPageApp('https://agents.example.com/w/team-a/dashboard/objects/42', 'team-a', apps)).toBeNull();
    expect(ownedPageApp('https://agents.example.com/w/team-a/dashboard/p/client-pages-evil', 'team-a', apps)).toBeNull();
    expect(ownedPageApp('https://agents.example.com/w/team-b/dashboard/p/client-pages', 'team-a', apps)).toBeNull();
    expect(ownedPageApp('https://agents.example.com/dashboard/p/client-pages', 'team-a', apps)).toBeNull();
    expect(ownedPageApp('bad url', 'team-a', apps)).toBeNull();
  });

  it('loads installed ownership only for the authenticated workspace and returns null when unavailable', async () => {
    const input = { orgId: 'project-a', workspaceSlug: 'team-a', referer: 'https://agents.example.com/w/team-a/dashboard/p/client-pages', enabledPlugins: ['content-plugin'], enabledSurfaces: [] };
    workspaceAppNav.mockResolvedValue({ apps });

    expect(await loadOwnedPageApp(input)).toBe('editorial');
    expect(workspaceAppNav).toHaveBeenCalledExactlyOnceWith({ orgId: 'project-a', enabledPlugins: ['content-plugin'], enabledSurfaces: [] });

    workspaceAppNav.mockClear();

    expect(await loadOwnedPageApp({ ...input, referer: 'https://agents.example.com/w/team-b/dashboard/p/client-pages' })).toBeNull();
    expect(workspaceAppNav).not.toHaveBeenCalled();

    workspaceAppNav.mockResolvedValue({ apps: [] });

    expect(await loadOwnedPageApp(input)).toBeNull();

    workspaceAppNav.mockRejectedValue(new Error('unavailable'));

    expect(await loadOwnedPageApp(input)).toBeNull();
  });
});
