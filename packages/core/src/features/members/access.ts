/**
 * What the members screen shows, assembled from the reads it already had.
 *
 * `groups.overview` answers "who reaches what", `members.list` carries the
 * account role and the joining date, and `members.invites` (admins only) the
 * invites nobody has accepted yet. This is the join between them, kept out of
 * the components so the filtering and the counts are testable without a
 * browser.
 */

import type { AccessOverview, GroupSummary } from '@/services/GroupService';
import type { PendingInvite, TeamMember } from '@/services/MembersService';

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

/**
 * Somebody invited and not yet in the Org. They sit on the People lane
 * beside the people who have joined, because "who is in this Org" has to
 * include who is about to be — the invite dialog was the only place they
 * showed, and you had to open it to find out.
 */
export type InviteRow = {
  inviteId: string;
  email: string;
  /** 'admin' | 'member' — the account role they join with. */
  accountRole: string;
  /** For the copy-link action. Admins only ever receive invites at all. */
  token: string;
  invitedAt: Date | null;
  /** Who sent it, by name when they have one; null when nobody is named. */
  invitedBy: string | null;
  expiresAt: Date;
  /** Past its expiry: the link no longer works, and the row offers Re-invite. */
  expired: boolean;
};

/**
 * The People lane's Status facet: everybody, only the people who have joined,
 * or only the invites. An expired invite is still an invite — it shows under
 * "invited", marked Expired.
 */
export const PEOPLE_STATUSES = ['active', 'invited'] as const;

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

/**
 * One row per open invite. An invite whose email already belongs to somebody
 * in the Org is dropped: that person has a row of their own, and a second
 * one saying "Invited" would contradict it. Accepting an invite stamps it, so
 * this only happens when somebody joined another way while their invite was
 * still open.
 * @param invites - `members.invites`, newest first.
 * @param people - The Org's people, from `peopleRows`.
 */
export function inviteRows(invites: readonly PendingInvite[], people: readonly PersonRow[]): InviteRow[] {
  const onAccount = new Set(people.map(p => p.email.toLowerCase()));
  return invites
    .filter(i => !onAccount.has(i.email.toLowerCase()))
    .map(i => ({
      inviteId: i.id,
      email: i.email,
      accountRole: i.role,
      token: i.token,
      invitedAt: i.createdAt,
      invitedBy: i.invitedBy ? (i.invitedBy.name || i.invitedBy.email || null) : null,
      expiresAt: i.expiresAt,
      expired: i.expired,
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
 * The People lane's filters: the search box and four facets, each one value,
 * empty meaning "all" — which is what `useListUrlState` keeps in the URL.
 */
export type PeopleFilter = {
  /** The search box. */
  q: string;
  /** A group slug. */
  group: string;
  /** A workspace name. */
  workspace: string;
  /** An account role. */
  role: string;
  /** '' | 'active' | 'invited'. Absent means all. */
  status?: string;
};

/**
 * The people lane's facets, applied together.
 * @param rows - Every person on the account.
 * @param filter - The search box and the facets; empty means all.
 */
export function filterPeople(rows: readonly PersonRow[], filter: PeopleFilter): PersonRow[] {
  if (filter.status === 'invited') {
    return [];
  }
  return rows.filter(p => personMatches(p, filter.q)
    && (!filter.group || p.groups.includes(filter.group))
    && (!filter.workspace || p.reaches.includes(filter.workspace))
    && (!filter.role || p.accountRole === filter.role));
}

/**
 * The same filters, applied to the invites. Somebody invited is in no group
 * and reaches no workspace until they join, so a group or a workspace filter
 * leaves no invite standing — that is the true answer to "who is in RevOps",
 * not a gap. Search reads the email, and the role is the one they join with.
 * @param rows - The open invites, from `inviteRows`.
 * @param filter - The same filter the people rows take.
 */
export function filterInvites(rows: readonly InviteRow[], filter: PeopleFilter): InviteRow[] {
  if (filter.status === 'active' || filter.group || filter.workspace) {
    return [];
  }
  const needle = filter.q.trim().toLowerCase();
  return rows.filter(i => (!needle || i.email.toLowerCase().includes(needle))
    && (!filter.role || i.accountRole === filter.role));
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
