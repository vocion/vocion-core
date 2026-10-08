'use client';

import type { GroupRow } from './access';
import { UsersRound } from 'lucide-react';
import { Column, ListEmpty, ListRow, ListRows, Subline } from '@/components/patterns';
import { Chips } from './Chips';

/**
 * Groups — the control half of the members screen.
 *
 * A row is a reference: it opens the group's configuration, which is where
 * access is changed. Nothing is edited on the row itself, and Delete is not
 * on it either — it moved behind a confirm dialog inside the sheet, because
 * on the old screen one click removed a group and every grant it carried.
 * @param props - The rows and what opening one does.
 * @param props.rows - The groups to show, already filtered.
 * @param props.anyGroups - Whether the account has any group at all.
 * @param props.onOpen - Open a group's configuration.
 */
export function GroupsTab(props: {
  rows: readonly GroupRow[];
  anyGroups: boolean;
  onOpen: (groupId: string) => void;
}) {
  if (props.rows.length === 0) {
    return props.anyGroups
      ? <ListEmpty variant="inline" title="No group matches that." description="Clear the search." />
      : (
          <ListEmpty
            variant="page"
            icon={UsersRound}
            title="No groups yet"
            description="A group opens a set of workspaces to everyone in it."
          />
        );
  }

  return (
    <ListRows>
      {props.rows.map(g => (
        <ListRow
          key={g.id}
          data-testid={`group-row-${g.id}`}
          icon={UsersRound}
          title={g.name}
          onSelect={() => props.onOpen(g.id)}
          subline={<Subline separator="·" segments={[g.description ?? g.slug, g.managedFrom === 'yaml' && 'seeded']} />}
          columns={(
            <>
              <Column kind="score" align="left" grow>
                <Chips items={g.opens} empty="opens nothing" />
              </Column>
              <Column kind="number">{g.members.length}</Column>
            </>
          )}
        />
      ))}
    </ListRows>
  );
}
