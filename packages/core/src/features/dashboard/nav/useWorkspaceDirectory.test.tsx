import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { useWorkspaceDirectory } from './useWorkspaceDirectory';

/**
 * The shell is mounted by two layouts (`/dashboard/*`, `/gtm/*`), so picking
 * an app across them mounts the sidebar afresh. The switcher blinked to its
 * loading pulse and back to the same workspace on every such click (Chris,
 * 2026-10-29). A remount now starts from the tab's last read.
 */

let release: () => void = () => {};
const list = vi.fn(async () => {
  await new Promise<void>((resolve) => {
    release = resolve;
  });
  return { projects: [{ id: 'p-revenue', slug: 'revenue', name: 'Revenue Team', agentCount: 6 }], accounts: [], account: null, orgsMode: 'single' as const };
});

vi.mock('@/libs/Orpc', () => ({
  client: {
    projects: { list: () => list() },
    apps: { forUser: async () => ({ apps: [], workspacesByApp: {} }) },
  },
}));

function Where() {
  const directory = useWorkspaceDirectory();
  return <div data-testid="where">{directory === null ? 'loading' : directory.projects.map(p => p.name).join(', ')}</div>;
}

describe('the workspace directory across a remount', () => {
  it('loads once, then a fresh mount renders the last read on its first paint while it refreshes', async () => {
    const first = await render(<Where />);

    await expect.element(page.getByTestId('where')).toHaveTextContent('loading');

    release();

    await expect.element(page.getByTestId('where')).toHaveTextContent('Revenue Team');

    await first.unmount();
    const painted: string[] = [];
    function Watch() {
      const directory = useWorkspaceDirectory();
      painted.push(directory === null ? 'loading' : directory.projects[0]!.name);
      return null;
    }
    await render(<Watch />);

    expect(painted[0]).toBe('Revenue Team');
    expect(painted).not.toContain('loading');
    expect(list).toHaveBeenCalledTimes(2);

    release();
  });
});
