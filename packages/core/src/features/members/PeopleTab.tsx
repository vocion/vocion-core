'use client';

import type { InviteRow as InviteRowData, PersonRow } from './access';
import { MoreHorizontal, Users } from 'lucide-react';
import { Column, ListEmpty, ListRow, ListRows, Subline } from '@/components/patterns';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { reachLabel } from './access';
import { Chips } from './Chips';
import { day } from './day';
import { InviteRow } from './InviteRow';

/**
 * People — the report half of the members screen.
 *
 * It answers "who reaches what" and reads top to bottom. There is no person
 * sheet and no row to click into: everything a person's row has to say is on
 * the row, which is the whole reason the reach column is workspace NAMES and
 * nothing else. The old column printed a role code beside every name and a
 * "why" beside that, three sub-rows deep inside one table cell, and grew a
 * line per workspace per person.
 *
 * Group membership is not changed here. Adding somebody to a group happens in
 * the group, where the roster is drawn once instead of once per person. The
 * only per-person verb is removing access they hold on their OWN — a direct
 * grant, which no group covers and which has no other home.
 *
 * Under the people come the invites nobody has accepted yet (admins only —
 * nobody else can act on one, and an invite carries its link). They are the
 * same row in the same columns; accepting one turns it into a person row, and
 * an invite for somebody already in the Org never shows (`inviteRows`).
 */

export function PeopleTab(props: {
  rows: readonly PersonRow[];
  /** Open invites, after the filters; empty for anybody but an admin. */
  invites?: readonly InviteRowData[];
  /** How many shared workspaces the account has, for the "all" collapse. */
  sharedCount: number;
  isAdmin: boolean;
  currentUserId: string;
  pending: boolean;
  /** Whether anything — a person or an invite — was on the lane before the filters narrowed it. */
  anyPeople: boolean;
  onChangeRole: (userId: string, role: 'admin' | 'member') => void;
  onRemoveDirect: (userId: string, projectId: string, workspace: string) => void;
  onRemoveMember: (userId: string, email: string) => void;
  onRevokeInvite?: (invite: InviteRowData) => void;
  onReinvite?: (invite: InviteRowData) => void;
}) {
  const invites = props.invites ?? [];
  if (props.rows.length === 0 && invites.length === 0) {
    return props.anyPeople
      ? <ListEmpty variant="inline" title="Nobody matches that." description="Clear the search or a filter." />
      : <ListEmpty variant="page" icon={Users} title="Nobody here yet" description="Invite somebody and they show up on this list." />;
  }

  return (
    <ListRows>
      {props.rows.map((p) => {
        const reach = reachLabel(p.reaches, props.sharedCount);
        const self = p.userId === props.currentUserId;
        return (
          <ListRow
            key={p.userId}
            data-testid={`person-row-${p.userId}`}
            title={(
              <>
                {p.name ?? p.email}
                {self && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
              </>
            )}
            subline={<Subline separator="·" segments={[p.email]} />}
            columnsAside={(
              <>
                {/* The account role is a control for an admin and a fact for
                    everyone else, so the whole set of columns renders beside
                    the row rather than inside a link. */}
                <Column kind="status" align="left" always>
                  {props.isAdmin && !self
                    ? (
                        <select
                          value={p.accountRole}
                          disabled={props.pending}
                          aria-label={`Org role for ${p.email}`}
                          onChange={e => props.onChangeRole(p.userId, e.target.value as 'admin' | 'member')}
                          className="h-7 w-full rounded-md bg-surface-soft px-1.5 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                      )
                    : <Badge variant={p.accountRole === 'admin' ? 'default' : 'secondary'}>{p.accountRole}</Badge>}
                </Column>
                <Column kind="chip" align="left" className="max-w-40">
                  <Chips items={p.groups} empty="no group" />
                </Column>
                {/* The one column that survives a phone besides the role.
                    "Who reaches what" is what this lane is for, and `Chips`
                    folds to a count when the width will not take names, so a
                    narrow row says "+5" rather than saying nothing. */}
                <Column kind="score" align="left" grow always>
                  <Chips items={reach.chips} empty="nothing" />
                </Column>
                <Column kind="date">{day(p.joinedAt)}</Column>
              </>
            )}
            actionsAlways
            actions={props.isAdmin
              ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Actions for ${p.email}`}
                      disabled={props.pending}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                      {/* Only access this person holds on their OWN. What a
                          group opens is changed in the group; offering it here
                          too would be two places to do one thing, and the one
                          here could not describe the rule it was breaking. */}
                      <DropdownMenuLabel className="text-[11px] tracking-wide text-muted-foreground uppercase">
                        Remove access
                      </DropdownMenuLabel>
                      {p.direct.length === 0
                        ? (
                            <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
                              Nothing held outside a group.
                            </p>
                          )
                        : p.direct.map(d => (
                            <DropdownMenuItem
                              key={d.projectId}
                              onSelect={() => props.onRemoveDirect(p.userId, d.projectId, d.name)}
                            >
                              {d.name}
                            </DropdownMenuItem>
                          ))}
                      {!self && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => props.onRemoveMember(p.userId, p.email)}
                          >
                            Remove from Org
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              : undefined}
          />
        );
      })}
      {invites.map(inv => (
        <InviteRow
          key={inv.inviteId}
          invite={inv}
          pending={props.pending}
          onRevoke={i => props.onRevokeInvite?.(i)}
          onReinvite={i => props.onReinvite?.(i)}
        />
      ))}
    </ListRows>
  );
}
