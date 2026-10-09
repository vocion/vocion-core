import type { PageWorkspace } from './workspacesPage';
import { describe, expect, it } from 'vitest';
import { arrangeWorkspaces, rowLine } from './workspacesPage';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const ws = (over: Partial<PageWorkspace> & Pick<PageWorkspace, 'id' | 'name'>): PageWorkspace => ({ accountId: 'acct-nw', slug: over.id, kind: 'shared', agentCount: 1, leadName: null, lastActiveAt: null, ...over });

const NW = { id: 'acct-nw', name: 'Northwind', slug: 'northwind' };
const KC = { id: 'acct-kc', name: 'Kestrel Capital', slug: 'kestrel' };

describe('arrangeWorkspaces', () => {
  const all = [
    ws({ id: 'ghost', name: 'Northwind (placeholder)', placeholder: true, agentCount: 0 }),
    ws({ id: 'empty', name: 'Bellwater Hall', agentCount: 0 }),
    ws({ id: 'old', name: 'Kestrel Ops', lastActiveAt: ago(72), leadName: 'Ops Lead' }),
    ws({ id: 'busy', name: 'Northwind', lastActiveAt: ago(1), agentCount: 7, leadName: 'Atlas' }),
    ws({ id: 'me', name: 'Personal', kind: 'personal', lastActiveAt: ago(500) }),
    ws({ id: 'arch', name: 'Old Pilot', archived: true }),
    ws({ id: 'kc', name: 'Deal Desk', accountId: 'acct-kc', lastActiveAt: ago(5) }),
  ];

  it('puts Personal first, real workspaces by recent use, and empty or placeholder ones last', () => {
    const out = arrangeWorkspaces(all, { accounts: [NW, KC], multiOrg: false });

    expect(out.personal.map(w => w.id)).toEqual(['me']);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]!.account).toBeNull();
    expect(out.groups[0]!.workspaces.map(w => w.id)).toEqual(['busy', 'kc', 'old', 'empty', 'ghost']);
    expect(out.archived.map(w => w.id)).toEqual(['arch']);
  });

  it('groups by Org, in membership order, only on a multi-Org install', () => {
    const out = arrangeWorkspaces(all, { accounts: [NW, KC], multiOrg: true });

    expect(out.groups.map(g => g.account?.name)).toEqual(['Northwind', 'Kestrel Capital']);
    expect(out.groups[1]!.workspaces.map(w => w.id)).toEqual(['kc']);
  });

  it('searches the name, the Org and the lead', () => {
    expect(arrangeWorkspaces(all, { accounts: [NW, KC], multiOrg: true, query: 'atlas' }).groups.flatMap(g => g.workspaces).map(w => w.id)).toEqual(['busy']);
    expect(arrangeWorkspaces(all, { accounts: [NW, KC], multiOrg: true, query: 'kestrel cap' }).groups.flatMap(g => g.workspaces).map(w => w.id)).toEqual(['kc']);
  });
});

describe('rowLine', () => {
  it('joins what is known and says Empty for nothing', () => {
    expect(rowLine({ leadName: 'Atlas', agentCount: 7 }, { agents: '7 agents', active: 'active 1h ago', empty: 'Empty' })).toBe('Atlas · 7 agents · active 1h ago');
    expect(rowLine({ leadName: null, agentCount: 0 }, { agents: '0 agents', active: null, empty: 'Empty' })).toBe('Empty');
  });
});
