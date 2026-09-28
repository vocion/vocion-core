/**
 * What the members screen shows, assembled from the two reads it already had.
 *
 * `groups.overview` answers "who reaches what" and `members.list` carries the
 * account role and the joining date. Neither is new, and neither grew a field
 * for this screen; this is the join between them, kept out of the components
 * so the filtering and the counts are testable without a browser.
 */

import type { AccessOverview, GroupSummary } from '@/services/GroupService';
import type { TeamMember } from '@/services/MembersService';

/** A workspace this person reaches on their own, outside any group. */
export type DirectReach = { projectId: string; name: string };

export type PersonRow = {
  userId: string;
  name: string | null;
  email: string;
  /** 'admin' | 'member' — what they may do inside any workspace they reach. */
  accountRole: string;
  /** Group slugs they belong to. */
  groups: string[];
  /** Workspace names they reach, in display order. */
  reaches: string[];
  /**
   * The workspaces they reach on their OWN — a direct grant, which is what
   * migration 0145 left behind. Access that comes from a group is changed in
   * the group, so only these are offered on the row.
   */
  direct: DirectReach[];
  joinedAt: Date | null;
};

export type GroupRow = GroupSummary & {
  /** Workspace names this group opens, in display order. */
  opens: string[];
};

/**
 * One people row per person on the account, with the account role and joining
 * date joined on by user id. A person present in one read and not the other
 * still gets a row: the screen's job is to show everybody.
 * @param overview - `groups.overview`.
 * @param members - `members.list`.
 */
export function peopleRows(overview: AccessOverview, members: readonly TeamMember[]): PersonRow[] {
  const byId = new Map(members.map(m => [m.userId, m]));
  return overview.people.map(p => ({
    userId: p.userId,
    name: p.name,
    email: p.email,
    accountRole: byId.get(p.userId)?.role ?? p.accountRole,
    groups: p.groups,
    reaches: p.reaches.map(r => r.name),
    direct: p.reaches.filter(r => r.via === 'direct').map(r => ({ projectId: r.projectId, name: r.name })),
    joinedAt: byId.get(p.userId)?.joinedAt ?? null,
  }));
}

export function groupRows(overview: AccessOverview): GroupRow[] {
  return overview.groups.map(g => ({ ...g, opens: g.grants.map(x => x.name) }));
}

/**
 * The workspaces a group can be given. Personal workspaces are never offered:
 * one holds that person's own mail, and `setGroupGrant` refuses it anyway.
 * @param overview - `groups.overview`.
 */
export function grantableWorkspaces(overview: AccessOverview) {
  return overview.workspaces.filter(w => w.kind === 'shared');
}

/**
 * Does a person match what was typed? Name and email, case-insensitively.
 * @param p - The person.
 * @param q - What was typed.
 */
export function personMatches(p: PersonRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return `${p.name ?? ''} ${p.email}`.toLowerCase().includes(needle);
}

export function groupMatches(g: GroupRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return `${g.name} ${g.slug} ${g.description ?? ''}`.toLowerCase().includes(needle);
}

/**
 * The people lane's three facets, applied together. Each is one value, empty
 * meaning "all", which is what `useListUrlState` keeps in the URL.
 * @param rows - Every person on the account.
 * @param filter - The search box and the three facets; empty means all.
 * @param filter.q - The search box.
 * @param filter.group - A group slug.
 * @param filter.workspace - A workspace name.
 * @param filter.role - An account role.
 */
export function filterPeople(
  rows: readonly PersonRow[],
  filter: { q: string; group: string; workspace: string; role: string },
): PersonRow[] {
  return rows.filter(p => personMatches(p, filter.q)
    && (!filter.group || p.groups.includes(filter.group))
    && (!filter.workspace || p.reaches.includes(filter.workspace))
    && (!filter.role || p.accountRole === filter.role));
}

/**
 * A person's reach as chips, collapsed when they reach everything shared.
 *
 * Somebody who reaches every shared workspace is the common case on this
 * deployment — six of nine people are account admins — and spelling five
 * names out on every one of those rows is what made the old column unreadable.
 * @param reaches - Workspace names they reach.
 * @param sharedCount - How many shared workspaces the account has.
 */
export function reachLabel(reaches: readonly string[], sharedCount: number): { all: boolean; chips: string[] } {
  if (sharedCount > 1 && reaches.length >= sharedCount) {
    return { all: true, chips: [`All ${sharedCount} workspaces`] };
  }
  return { all: false, chips: [...reaches] };
}
