/**
 * The members screen's filtering and its two collapses, without a browser.
 *
 * The reach cell is the thing worth testing here: on this deployment most
 * people reach every shared workspace, and printing five names on every one of
 * those rows is what made the column the screen shipped with unreadable.
 */
import type { AccessOverview } from '@/services/GroupService';
import type { TeamMember } from '@/services/MembersService';
import { describe, expect, it } from 'vitest';
import { filterPeople, fitToLine, grantableWorkspaces, groupMatches, groupRows, peopleRows, personMatches, reachLabel } from './access';

const WORKSPACES = [
  { id: 'p-rev', slug: 'revenue', name: 'Revenue Team', kind: 'shared' },
  { id: 'p-del', slug: 'delivery-stack', name: 'Delivery Stack', kind: 'shared' },
  { id: 'p-own', slug: 'personal-alex', name: 'Alex', kind: 'personal' },
];

const OVERVIEW: AccessOverview = {
  enforced: false,
  workspaces: WORKSPACES,
  groups: [
    {
      id: 'g-rev',
      slug: 'revops',
      name: 'RevOps',
      description: 'Revenue Operations.',
      managedFrom: 'yaml',
      grants: [{ projectId: 'p-rev', slug: 'revenue', name: 'Revenue Team', role: 'member' }],
      members: [{ userId: 'u-alex', name: 'Alex Morrow', email: 'alex@northwind.example' }],
    },
  ],
  people: [
    {
      userId: 'u-alex',
      name: 'Alex Morrow',
      email: 'alex@northwind.example',
      accountRole: 'member',
      groups: ['revops'],
      reaches: [{ projectId: 'p-rev', slug: 'revenue', name: 'Revenue Team', role: 'member', via: 'group' }],
    },
    {
      userId: 'u-brit',
      name: 'Brit Nakamura',
      email: 'brit@northwind.example',
      accountRole: 'admin',
      groups: [],
      reaches: [
        { projectId: 'p-rev', slug: 'revenue', name: 'Revenue Team', role: 'admin', via: 'account-admin' },
        { projectId: 'p-del', slug: 'delivery-stack', name: 'Delivery Stack', role: 'admin', via: 'direct' },
      ],
    },
  ],
};

const MEMBERS: TeamMember[] = [
  { userId: 'u-alex', name: 'Alex Morrow', email: 'alex@northwind.example', role: 'member', joinedAt: new Date('2026-09-15T00:00:00Z') },
  { userId: 'u-brit', name: 'Brit Nakamura', email: 'brit@northwind.example', role: 'admin', joinedAt: null },
];

describe('peopleRows', () => {
  const rows = peopleRows(OVERVIEW, MEMBERS);

  it('joins the account role and the joining date on by user id', () => {
    expect(rows[0]).toMatchObject({ userId: 'u-alex', accountRole: 'member' });
    expect(rows[0]!.joinedAt?.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('carries the reach as workspace names and nothing else', () => {
    // No role code, no "why". Those are what turned five workspaces into
    // fifteen things to read on one row.
    expect(rows[1]!.reaches).toEqual(['Revenue Team', 'Delivery Stack']);
  });

  it('offers only access held outside a group on the row', () => {
    // What a group opens is changed in the group. Alex reaches Revenue through
    // RevOps, so the row menu has nothing to offer.
    expect(rows[0]!.direct).toEqual([]);
    expect(rows[1]!.direct).toEqual([{ projectId: 'p-del', name: 'Delivery Stack' }]);
  });

  it('still shows somebody the members read has not heard of', () => {
    const only = peopleRows(OVERVIEW, []);

    expect(only).toHaveLength(2);
    expect(only[0]!.accountRole).toBe('member');
    expect(only[0]!.joinedAt).toBeNull();
  });
});

describe('grantableWorkspaces', () => {
  it('never offers a personal workspace, which holds that person\'s own mail', () => {
    expect(grantableWorkspaces(OVERVIEW).map(w => w.slug)).toEqual(['revenue', 'delivery-stack']);
  });
});

describe('reachLabel', () => {
  it('collapses somebody who reaches everything to one chip', () => {
    expect(reachLabel(['Revenue Team', 'Delivery Stack'], 2)).toEqual({ all: true, chips: ['All 2 workspaces'] });
  });

  it('names them when they do not', () => {
    expect(reachLabel(['Revenue Team'], 2)).toEqual({ all: false, chips: ['Revenue Team'] });
  });

  it('does not say "all 1 workspaces" on an account with one', () => {
    expect(reachLabel(['Revenue Team'], 1)).toEqual({ all: false, chips: ['Revenue Team'] });
  });

  it('says nothing about a person who reaches nothing', () => {
    expect(reachLabel([], 2)).toEqual({ all: false, chips: [] });
  });
});

describe('fitToLine', () => {
  it('shows everything that fits', () => {
    expect(fitToLine(['a', 'b'], 4)).toEqual({ shown: ['a', 'b'], more: 0 });
  });

  it('truncates the rest to a count, so the row stays one line', () => {
    expect(fitToLine(['a', 'b', 'c', 'd', 'e'], 2)).toEqual({ shown: ['a', 'b'], more: 3 });
  });
});

describe('filterPeople', () => {
  const rows = peopleRows(OVERVIEW, MEMBERS);
  const all = { q: '', group: '', workspace: '', role: '' };

  it('is everybody when nothing is set', () => {
    expect(filterPeople(rows, all)).toHaveLength(2);
  });

  it('matches a name or an email, case-insensitively', () => {
    expect(filterPeople(rows, { ...all, q: 'NAKAMURA' }).map(p => p.userId)).toEqual(['u-brit']);
    expect(filterPeople(rows, { ...all, q: 'alex@' }).map(p => p.userId)).toEqual(['u-alex']);
  });

  it('narrows by group, by workspace and by account role', () => {
    expect(filterPeople(rows, { ...all, group: 'revops' }).map(p => p.userId)).toEqual(['u-alex']);
    expect(filterPeople(rows, { ...all, workspace: 'Delivery Stack' }).map(p => p.userId)).toEqual(['u-brit']);
    expect(filterPeople(rows, { ...all, role: 'admin' }).map(p => p.userId)).toEqual(['u-brit']);
  });

  it('applies the facets together, not one at a time', () => {
    expect(filterPeople(rows, { ...all, group: 'revops', role: 'admin' })).toEqual([]);
  });
});

describe('groups', () => {
  it('carries what a group opens as workspace names', () => {
    expect(groupRows(OVERVIEW)[0]!.opens).toEqual(['Revenue Team']);
  });

  it('finds a group by name, slug or description', () => {
    const [g] = groupRows(OVERVIEW);

    expect(groupMatches(g!, 'RevOps')).toBe(true);
    expect(groupMatches(g!, 'revenue operations')).toBe(true);
    expect(groupMatches(g!, 'delivery')).toBe(false);
  });
});

describe('personMatches', () => {
  it('is true for an empty search rather than false', () => {
    expect(personMatches(peopleRows(OVERVIEW, MEMBERS)[0]!, '   ')).toBe(true);
  });
});
