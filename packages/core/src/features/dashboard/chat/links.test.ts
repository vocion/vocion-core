import { describe, expect, it } from 'vitest';
import { classifyDashboardLink, previewRefFor } from './links';

describe('classifyDashboardLink', () => {
  it('recognises dashboard routes, with and without a locale prefix or origin', () => {
    expect(classifyDashboardLink('/dashboard/agents/revenue-lead')).toEqual({ href: '/dashboard/agents/revenue-lead', kind: 'agent', id: 'revenue-lead' });
    expect(classifyDashboardLink('/en/dashboard/missions/runs/42')).toEqual({ href: '/dashboard/missions/runs/42', kind: 'mission-run', id: '42' });
    expect(classifyDashboardLink('https://agents.metacto.com/dashboard/inbox/g/workforce:sheet:merges', 'https://agents.metacto.com'))
      .toEqual({ href: '/dashboard/inbox/g/workforce:sheet:merges', kind: 'ask', id: 'workforce:sheet:merges' });
    expect(classifyDashboardLink('/dashboard/review?filter=pending')).toMatchObject({ kind: 'review' });
    expect(classifyDashboardLink('/dashboard/missions/new')).toMatchObject({ kind: 'page' });
  });

  it('knows a vendor login for a source, and nothing else under /api', () => {
    expect(classifyDashboardLink('/api/connect/github/start?source=github')).toEqual({ href: '/api/connect/github/start?source=github', kind: 'connect', id: 'github' });
    expect(classifyDashboardLink('https://agents.metacto.com/api/connect/atlassian/start?source=jira', 'https://agents.metacto.com')).toMatchObject({ kind: 'connect', id: 'atlassian' });
    expect(classifyDashboardLink('/api/connect/github/callback?code=1')).toBeNull();
    expect(classifyDashboardLink('/api/v1/objects/1')).toBeNull();
  });

  it('leaves external and non-dashboard links alone', () => {
    expect(classifyDashboardLink('https://hubspot.com/deal/1', 'https://agents.metacto.com')).toBeNull();
    expect(classifyDashboardLink('https://other.example/dashboard/agents/x', 'https://agents.metacto.com')).toBeNull();
    expect(classifyDashboardLink('/sign-in')).toBeNull();
    expect(classifyDashboardLink(undefined)).toBeNull();
  });

  it('knows a data room, and offers it as a preview instead of a navigation', () => {
    const room = classifyDashboardLink('/dashboard/rooms/22');

    expect(room).toEqual({ href: '/dashboard/rooms/22', kind: 'room', id: '22' });
    expect(previewRefFor(room!)).toEqual({ type: 'object', id: '22' });
    expect(previewRefFor(classifyDashboardLink('/dashboard/agents/lead')!)).toBeNull();
  });

  it('peeks a record\'s history at the version the "Changed …" line names (backlog 035)', () => {
    const link = classifyDashboardLink('/dashboard/objects/214?preview=record_history%3A214%405');

    expect(link).toMatchObject({ kind: 'object', id: '214' });
    expect(previewRefFor(link!)).toEqual({ type: 'record_history', id: '214@5' });
  });
});
