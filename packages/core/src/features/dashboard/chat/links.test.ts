import { describe, expect, it } from 'vitest';
import { classifyDashboardLink } from './links';

describe('classifyDashboardLink', () => {
  it('recognises dashboard routes, with and without a locale prefix or origin', () => {
    expect(classifyDashboardLink('/dashboard/agents/revenue-lead')).toEqual({ href: '/dashboard/agents/revenue-lead', kind: 'agent', id: 'revenue-lead' });
    expect(classifyDashboardLink('/en/dashboard/missions/runs/42')).toEqual({ href: '/dashboard/missions/runs/42', kind: 'mission-run', id: '42' });
    expect(classifyDashboardLink('https://agents.metacto.com/dashboard/inbox/g/workforce:sheet:merges', 'https://agents.metacto.com'))
      .toEqual({ href: '/dashboard/inbox/g/workforce:sheet:merges', kind: 'ask', id: 'workforce:sheet:merges' });
    expect(classifyDashboardLink('/dashboard/review?filter=pending')).toMatchObject({ kind: 'review' });
    expect(classifyDashboardLink('/dashboard/missions/new')).toMatchObject({ kind: 'page' });
  });

  it('leaves external and non-dashboard links alone', () => {
    expect(classifyDashboardLink('https://hubspot.com/deal/1', 'https://agents.metacto.com')).toBeNull();
    expect(classifyDashboardLink('https://other.example/dashboard/agents/x', 'https://agents.metacto.com')).toBeNull();
    expect(classifyDashboardLink('/sign-in')).toBeNull();
    expect(classifyDashboardLink(undefined)).toBeNull();
  });
});
