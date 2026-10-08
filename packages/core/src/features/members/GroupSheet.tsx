'use client';

import type { PersonRow } from './access';
import type { AccessOverview, GroupSummary } from '@/services/GroupService';
import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/utils/Helpers';
import { grantableWorkspaces, personMatches } from './access';

/**
 * One group's configuration: what it opens, and who is in it.
 *
 * This is the view that replaces the group card, and the two defects it fixes
 * are the same defect twice. The card redrew the whole nine-person roster
 * inside EVERY group, with no search, so finding one person meant scrolling
 * the account once per group; and it offered a role select per workspace, four
 * options deep, for a distinction the system never made. Here the roster is
 * drawn once and searchable, and a grant is a checkbox: the group opens the
 * workspace or it does not.
 *
 * The admin badge is the honest part. Six of nine people on this deployment
 * are account admins, and an account admin already reaches every shared
 * workspace, so adding one to a group changes nothing today. The screen says
 * so rather than letting somebody believe they just granted something
 * (decision Q5, 25 Sep 2026).
 */

export function GroupSheet(props: {
  group: GroupSummary | null;
  overview: AccessOverview;
  people: readonly PersonRow[];
  isAdmin: boolean;
  pending: boolean;
  onClose: () => void;
  onSetGrant: (groupId: string, projectId: string, open: boolean) => void;
  onSetMember: (groupId: string, userId: string, member: boolean) => void;
  onDelete: (groupId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const group = props.group;

  const workspaces = useMemo(() => grantableWorkspaces(props.overview), [props.overview]);
  const roster = useMemo(() => props.people.filter(p => personMatches(p, q)), [props.people, q]);

  if (!group) {
    return null;
  }

  const granted = new Set(group.grants.map(g => g.projectId));
  const members = new Set(group.members.map(m => m.userId));
  const readOnly = !props.isAdmin || props.pending;

  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) {
            props.onClose();
          }
        }}
      >
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg" data-testid="group-sheet">
          <SheetHeader className="p-5 pb-4">
            <SheetTitle className="text-lg">{group.name}</SheetTitle>
            <SheetDescription>
              {group.description ?? `The ${group.slug} group.`}
            </SheetDescription>
          </SheetHeader>

          <section className="border-t border-rule px-5 py-4">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Access</h3>
            <div className="mt-3 flex flex-col">
              {workspaces.map((w) => {
                const on = granted.has(w.id);
                const reach = group.members.length;
                return (
                  <label
                    key={w.id}
                    className={cn(
                      'flex items-center gap-2.5 border-b border-border/60 py-2 text-sm last:border-b-0',
                      readOnly && 'opacity-70',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={readOnly}
                      onChange={() => props.onSetGrant(group.id, w.id, !on)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border transition',
                        on ? 'border-[var(--brand-teal)] bg-[var(--brand-teal)] text-white' : 'border-border bg-background',
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{w.name}</span>
                    {on && reach > 0 && (
                      <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                        {reach === 1 ? '1 person reaches it through this group' : `${reach} people reach it through this group`}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              A group opens a workspace or it does not. What a person can do once
              inside is their account role. A personal workspace can never be
              opened by a group: it holds that person's own mail.
            </p>
          </section>

          <section className="border-t border-rule px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {`Members · ${group.members.length} of ${props.people.length}`}
              </h3>
            </div>
            <label className="relative mt-3 block">
              <span className="sr-only">Find a person</span>
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70" aria-hidden />
              <input
                type="search"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Find a person…"
                className="h-8 w-full rounded-md bg-surface-soft pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/30"
              />
            </label>
            <div className="mt-2 flex flex-col">
              {roster.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Nobody matches that.</p>
              )}
              {roster.map((p) => {
                const inGroup = members.has(p.userId);
                return (
                  <label
                    key={p.userId}
                    className={cn(
                      'flex items-center gap-2.5 border-b border-border/60 py-2 text-sm last:border-b-0',
                      readOnly && 'opacity-70',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={inGroup}
                      disabled={readOnly}
                      onChange={() => props.onSetMember(group.id, p.userId, !inGroup)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border transition',
                        inGroup ? 'border-[var(--brand-teal)] bg-[var(--brand-teal)] text-white' : 'border-border bg-background',
                      )}
                    >
                      {inGroup && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{p.name ?? p.email}</span>
                    <span className="hidden shrink-0 truncate text-[12px] text-muted-foreground sm:inline">{p.email}</span>
                    {p.accountRole === 'admin' && <Badge variant="secondary" className="shrink-0">admin</Badge>}
                  </label>
                );
              })}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              An admin badge means this person already reaches every shared
              workspace, so adding them to a group changes nothing today.
            </p>
          </section>

          {props.isAdmin && (
            <SheetFooter className="mt-auto flex-row items-center gap-2 border-t border-rule px-5 py-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={props.pending}
                onClick={() => setConfirmDelete(true)}
                className="text-[var(--brand-fail)] hover:bg-[var(--brand-fail-bg)] hover:text-[var(--brand-fail)]"
              >
                Delete group
              </Button>
              <Button variant="outline" size="sm" className="ml-auto" onClick={props.onClose}>Done</Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      {/* Deleting a group takes every grant it carries with it. The old screen
          did that on one click of a Delete beside the group's name. */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Delete ${group.name}?`}</DialogTitle>
            <DialogDescription>
              {group.grants.length === 0
                ? 'This group opens nothing, and nobody loses a workspace.'
                : `${group.members.length === 1 ? '1 person' : `${group.members.length} people`} lose ${group.grants.map(g => g.name).join(', ')}. Nobody loses their place in the Org.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button
              variant="destructive"
              disabled={props.pending}
              onClick={() => {
                setConfirmDelete(false);
                props.onDelete(group.id);
              }}
            >
              Delete group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
