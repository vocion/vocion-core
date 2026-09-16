import { describe, expect, it } from 'vitest';
import { buildCrumbs } from './breadcrumbModel';

describe('buildCrumbs', () => {
  it('names a registered page after the registry, led by the workspace', () => {
    expect(buildCrumbs({ pathname: '/en/dashboard/missions', docTitle: '', workspaceName: 'Revenue' })).toEqual([
      { url: '/dashboard', label: 'Revenue' },
      { url: '/dashboard/missions', label: 'Missions' },
    ]);
  });

  it('inserts the combined page before one of its tabs', () => {
    expect(buildCrumbs({ pathname: '/dashboard/agents', docTitle: '' })).toEqual([
      { url: '/dashboard/teams', label: 'Teams & agents' },
      { url: '/dashboard/agents', label: 'Agents' },
    ]);
    expect(buildCrumbs({ pathname: '/dashboard/models', docTitle: '' })?.map(c => c.label)).toEqual(['Skills & tools', 'Vision models']);
  });

  it('carries the tab crumbs into a detail page and uses the document title for its leaf', () => {
    expect(buildCrumbs({ pathname: '/dashboard/agents/revenue-lead', docTitle: 'Revenue Lead' })?.map(c => c.label))
      .toEqual(['Teams & agents', 'Agents', 'Revenue Lead']);
  });

  it('shows only the workspace on the full-page chat, and nothing outside the dashboard', () => {
    expect(buildCrumbs({ pathname: '/dashboard/chat', docTitle: '', workspaceName: 'Revenue' })).toEqual([{ url: '/dashboard', label: 'Revenue' }]);
    expect(buildCrumbs({ pathname: '/dashboard/chat', docTitle: '' })).toBeNull();
    expect(buildCrumbs({ pathname: '/sign-in', docTitle: '' })).toBeNull();
  });
});
