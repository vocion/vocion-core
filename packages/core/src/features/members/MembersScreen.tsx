'use client';

import type { ListStateConfig } from '@/components/patterns';
import type { AccessOverview } from '@/services/GroupService';
import type { PendingInvite, TeamMember } from '@/services/MembersService';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { ListPage, ListToolbar, useListUrlState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { client } from '@/libs/Orpc';
import { filterPeople, grantableWorkspaces, groupMatches, groupRows, peopleRows } from './access';
import { GroupSheet } from './GroupSheet';
import { GroupsTab } from './GroupsTab';
import { InviteDialog } from './InviteDialog';
import { PeopleTab } from './PeopleTab';

/**
 * Members — one page, two lanes.
 *
 * **People** is a report: who is on the account and which workspaces they
 * reach. **Groups** is the control: what you change, you change there. That
 * split is the whole shape, and it is why a person's row opens nothing while
 * a group's row opens a sheet.
 *
 * The page owns no layout of its own. `ListPage` is the frame, `ListToolbar`
 * is the lane tabs and the filters, `ListRow` is every row on both lanes, and
 * lane / search / filters live in the URL through `useListUrlState`, so a
 * filtered view is a link you can paste into Slack. The screen this replaced
 * hand-rolled a table with a list inside a cell, and repeated the whole roster
 * once per group — `docs/design/patterns.md` exists to stop exactly that.
 *
 * Reads are the two this screen already had: `groups.overview` for access and
 * `members.list` for the account role and the joining date. No endpoint is new.
 *
 * There is no "not in force" caveat on this screen. Access IS enforced on this
 * deployment (`VOCION_ENFORCE_WORKSPACE_ACCESS=1`, set in
 * `infra/aws/compose.revops.yml`), so what the page shows is what applies, and
 * a banner saying otherwise would be the lie rather than the guard against one.
 * `accessOverview` still reports `enforced` — that is a true fact about the
 * deployment and other callers may want it — this screen simply has nothing to
 * say about it.
 */

const LANES = [
  { key: 'people', label: 'People' },
  { key: 'groups', label: 'Groups' },
] as const;

const LIST: ListStateConfig = {
  defaults: { tab: 'people', q: '', sort: '', dir: 'asc', chips: [], facets: { group: '', workspace: '', role: '' } },
  tabs: LANES.map(l => l.key),
  // Accepted values are filled in from the data below; an unknown value in a
  // stale link falls back to "all" rather than showing an empty list.
  facets: { group: [], workspace: [], role: ['admin', 'member'] },
};

export function MembersScreen(props: { isAdmin: boolean; currentUserId: string }) {
  const [overview, setOverview] = useState<AccessOverview | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();

  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');

  const { isAdmin } = props;

  const refresh = useCallback(async () => {
    try {
      const [o, m, i] = await Promise.all([
        client.groups.overview(),
        client.members.list(),
        isAdmin ? client.members.invites() : Promise.resolve([] as PendingInvite[]),
      ]);
      setOverview(o);
      setMembers(m);
      setInvites(i);
      setError(null);
    } catch {
      setError('Could not load this account.');
    }
    setLoaded(true);
  }, [isAdmin]);

  useEffect(() => {
    // False positive: every setState in refresh() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const run = (fn: () => Promise<unknown>) => {
    startTransition(async () => {
      try {
        await fn();
        await refresh();
        setError(null);
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : 'That did not work.');
      }
    });
  };

  const people = useMemo(() => (overview ? peopleRows(overview, members) : []), [overview, members]);
  const groups = useMemo(() => (overview ? groupRows(overview) : []), [overview]);
  const shared = useMemo(() => (overview ? grantableWorkspaces(overview) : []), [overview]);

  // The accepted facet values are the data's own, so a link naming a group
  // that has since been deleted opens the unfiltered list instead of an empty
  // one.
  const config = useMemo<ListStateConfig>(() => ({
    ...LIST,
    facets: {
      group: groups.map(g => g.slug),
      workspace: shared.map(w => w.name),
      role: ['admin', 'member'],
    },
  }), [groups, shared]);

  const [list, setList] = useListUrlState(config);
  const lane = list.tab === 'groups' ? 'groups' : 'people';

  const visiblePeople = useMemo(
    () => filterPeople(people, { q: list.q, group: list.facets.group ?? '', workspace: list.facets.workspace ?? '', role: list.facets.role ?? '' }),
    [people, list.q, list.facets],
  );
  const visibleGroups = useMemo(() => groups.filter(g => groupMatches(g, list.q)), [groups, list.q]);

  const openGroup = groups.find(g => g.id === openGroupId) ?? null;
  const memberships = groups.reduce((n, g) => n + g.members.length, 0);

  if (!loaded) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }
  if (!overview) {
    return <p className="p-4 text-sm text-destructive">{error ?? 'Could not load this account.'}</p>;
  }

  return (
    <ListPage
      title="Members"
      description="The people in this account, the groups they are in, and the workspaces those groups open."
      actions={isAdmin
        ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => (lane === 'people' ? setInviting(true) : setNewGroup(true))}
            >
              <Plus className="size-3.5" />
              {lane === 'people' ? 'Invite member' : 'New group'}
            </Button>
          )
        : undefined}
    >
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <ListToolbar
        className="mt-4"
        tabs={{
          label: 'Lanes',
          items: [
            { key: 'people', label: 'People', count: people.length },
            { key: 'groups', label: 'Groups', count: groups.length },
          ],
          value: lane,
          onChange: tab => setList({ tab, q: '', facets: { group: '', workspace: '', role: '' } }),
        }}
        search={{
          value: list.q,
          onChange: q => setList({ q }),
          placeholder: lane === 'people' ? 'Find a person…' : 'Find a group…',
        }}
        facets={lane === 'people'
          ? [
              {
                name: 'group',
                label: 'Group',
                value: list.facets.group ?? '',
                onChange: v => setList({ facets: { ...list.facets, group: v } }),
                options: [{ key: '', label: 'Group: all' }, ...groups.map(g => ({ key: g.slug, label: g.name }))],
              },
              {
                name: 'workspace',
                label: 'Workspace',
                value: list.facets.workspace ?? '',
                onChange: v => setList({ facets: { ...list.facets, workspace: v } }),
                options: [{ key: '', label: 'Workspace: all' }, ...shared.map(w => ({ key: w.name, label: w.name }))],
              },
              {
                name: 'role',
                label: 'Account role',
                value: list.facets.role ?? '',
                onChange: v => setList({ facets: { ...list.facets, role: v } }),
                options: [
                  { key: '', label: 'Account role: all' },
                  { key: 'admin', label: 'admin' },
                  { key: 'member', label: 'member' },
                ],
              },
            ]
          : undefined}
        trailing={(
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {lane === 'people'
              ? `${visiblePeople.length} ${visiblePeople.length === 1 ? 'person' : 'people'}`
              : `${visibleGroups.length} ${visibleGroups.length === 1 ? 'group' : 'groups'} · ${memberships} ${memberships === 1 ? 'membership' : 'memberships'}`}
          </span>
        )}
      />

      {lane === 'people'
        ? (
            <PeopleTab
              rows={visiblePeople}
              sharedCount={shared.length}
              isAdmin={isAdmin}
              currentUserId={props.currentUserId}
              pending={pending}
              anyPeople={people.length > 0}
              onChangeRole={(userId, role) => run(() => client.members.changeRole({ userId, role }))}
              onRemoveDirect={(userId, projectId) => run(() => client.groups.removeDirect({ projectId, userId }))}
              onRemoveMember={(userId, email) => {
                // eslint-disable-next-line no-alert
                if (window.confirm(`Remove ${email} from this account? They lose access immediately.`)) {
                  run(() => client.members.remove({ userId }));
                }
              }}
            />
          )
        : (
            <GroupsTab
              rows={visibleGroups}
              anyGroups={groups.length > 0}
              onOpen={setOpenGroupId}
            />
          )}

      <GroupSheet
        group={openGroup}
        overview={overview}
        people={people}
        isAdmin={isAdmin}
        pending={pending}
        onClose={() => setOpenGroupId(null)}
        onSetGrant={(groupId, projectId, open) => run(() => client.groups.setGrant({ groupId, projectId, role: open ? 'member' : null }))}
        onSetMember={(groupId, userId, member) => run(() => client.groups.setMember({ groupId, userId, member }))}
        onDelete={(groupId) => {
          setOpenGroupId(null);
          run(() => client.groups.remove({ groupId }));
        }}
      />

      <InviteDialog
        open={inviting}
        invites={invites}
        pending={pending}
        error={error}
        onOpenChange={setInviting}
        onInvite={async (email, role) => {
          try {
            const created = await client.members.invite({ email, role });
            await refresh();
            return created;
          } catch (err) {
            setError(err instanceof Error && err.message ? err.message : 'Could not create the invite.');
            return null;
          }
        }}
        onRevoke={inviteId => run(() => client.members.revokeInvite({ inviteId }))}
      />

      <Dialog open={newGroup} onOpenChange={setNewGroup}>
        <DialogContent data-testid="new-group-dialog">
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>
              A group opens a set of workspaces for the people in it. Put people
              in it, and pick what it opens, once it exists.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="group-slug">Slug</Label>
              <Input id="group-slug" value={slug} placeholder="delivery" className="w-40" onChange={e => setSlug(e.target.value)} />
            </div>
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="group-name">Name</Label>
              <Input id="group-name" value={name} placeholder="Delivery" onChange={e => setName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewGroup(false)}>Cancel</Button>
            <Button
              disabled={pending || !slug.trim() || !name.trim()}
              onClick={() => {
                run(async () => {
                  await client.groups.create({ slug: slug.trim(), name: name.trim() });
                  setSlug('');
                  setName('');
                  setNewGroup(false);
                });
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ListPage>
  );
}
