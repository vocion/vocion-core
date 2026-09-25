'use client';

import type { AccessOverview, WorkspaceRoleName } from '@/services/GroupService';
import { Plus, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { client } from '@/libs/Orpc';

const ROLES: WorkspaceRoleName[] = ['owner', 'pm', 'specialist', 'client_reviewer'];

/** What each role may do, in the words the grant model actually uses. */
const ROLE_HINT: Record<WorkspaceRoleName, string> = {
  owner: 'everything, including managing the workspace',
  pm: 'everything',
  specialist: 'draft and comment',
  client_reviewer: 'approve and comment',
};

/** Why someone reaches a workspace. The distinction matters when fixing access. */
const VIA_LABEL: Record<string, string> = {
  'owner': 'owns it',
  'direct': 'direct grant',
  'group': 'group',
  'account-admin': 'account admin',
};

export function AccessPanel({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<AccessOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [showNew, setShowNew] = useState(false);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');

  const refresh = useCallback(async () => {
    try {
      setData(await client.groups.overview());
      setError(null);
    } catch {
      setError('Could not load access.');
    }
  }, []);

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
        setError(err instanceof Error ? err.message : 'That did not work.');
      }
    });
  };

  if (error && !data) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const shared = data.workspaces.filter(w => w.kind === 'shared');

  return (
    <div className="flex flex-col gap-8">
      {/*
        The screen must say whether what it shows is in force. Without this it
        reads as a description of who reaches what, when in fact every member
        still reaches everything.
      */}
      {!data.enforced && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium">These grants are not in force yet.</p>
          <p className="mt-1 text-muted-foreground">
            Everyone on the account still reaches every workspace. What you set here is
            recorded and takes effect when
            {' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">VOCION_ENFORCE_WORKSPACE_ACCESS=1</code>
            {' '}
            is set on the deployment.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* ---------------- who reaches what ---------------- */}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium">Who reaches what</h3>
          <p className="text-sm text-muted-foreground">
            Every person on the account, and the workspaces they can open.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Groups</TableHead>
              <TableHead>Reaches</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.people.map(p => (
              <TableRow key={p.userId}>
                <TableCell className="align-top">
                  <div className="font-medium">{p.name ?? p.email}</div>
                  <div className="text-xs text-muted-foreground">{p.email}</div>
                  {p.accountRole === 'admin' && <Badge variant="secondary" className="mt-1">account admin</Badge>}
                </TableCell>
                <TableCell className="align-top">
                  {p.groups.length === 0
                    ? <span className="text-xs text-muted-foreground">none</span>
                    : (
                        <div className="flex flex-wrap gap-1">
                          {p.groups.map(g => <Badge key={g} variant="outline">{g}</Badge>)}
                        </div>
                      )}
                </TableCell>
                <TableCell className="align-top">
                  {p.reaches.length === 0
                    ? <span className="text-xs text-muted-foreground">nothing</span>
                    : (
                        <div className="flex flex-col gap-1">
                          {p.reaches.map(r => (
                            <div key={r.projectId} className="flex flex-wrap items-center gap-2 text-sm">
                              <span>{r.name}</span>
                              <Badge variant="secondary">{r.role}</Badge>
                              <span className="text-xs text-muted-foreground">{VIA_LABEL[r.via] ?? r.via}</span>
                              {/*
                                A direct grant is what migration 0145 left behind, and
                                the usual reason someone still reaches a workspace no
                                group of theirs opens. Offer the fix here, or the only
                                way to correct it is SQL.
                              */}
                              {isAdmin && r.via === 'direct' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={pending}
                                  onClick={() => run(() => client.groups.removeDirect({ projectId: r.projectId, userId: p.userId }))}
                                >
                                  Remove
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {/* ---------------- groups ---------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Groups</h3>
            <p className="text-sm text-muted-foreground">
              A group opens a set of workspaces at a role. Changes here outrank the
              seed: a deploy never undoes them.
            </p>
          </div>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setShowNew(v => !v)}>
              <Plus className="size-3.5" />
              New group
            </Button>
          )}
        </div>

        {showNew && isAdmin && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border p-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="group-slug">Slug</Label>
              <Input id="group-slug" value={slug} placeholder="delivery" onChange={e => setSlug(e.target.value)} className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="group-name">Name</Label>
              <Input id="group-name" value={name} placeholder="Delivery" onChange={e => setName(e.target.value)} className="w-56" />
            </div>
            <Button
              disabled={pending || !slug.trim() || !name.trim()}
              onClick={() => run(async () => {
                await client.groups.create({ slug: slug.trim(), name: name.trim() });
                setSlug('');
                setName('');
                setShowNew(false);
              })}
            >
              Create
            </Button>
          </div>
        )}

        {data.groups.length === 0 && (
          <p className="text-sm text-muted-foreground">No groups yet.</p>
        )}

        {data.groups.map(g => (
          <div key={g.id} className="flex flex-col gap-4 rounded-md border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" />
                  <span className="font-medium">{g.name}</span>
                  <Badge variant="outline">{g.slug}</Badge>
                  {g.managedFrom === 'yaml' && <Badge variant="secondary">seeded</Badge>}
                </div>
                {g.description && <p className="mt-1 text-sm text-muted-foreground">{g.description}</p>}
              </div>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => client.groups.remove({ groupId: g.id }))}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Opens</p>
                {shared.map((w) => {
                  const grant = g.grants.find(x => x.projectId === w.id);
                  return (
                    <div key={w.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm">{w.name}</span>
                      <select
                        className="rounded-md border border-input bg-transparent px-2 py-1 text-sm disabled:opacity-60"
                        value={grant?.role ?? ''}
                        disabled={!isAdmin || pending}
                        onChange={e => run(() => client.groups.setGrant({
                          groupId: g.id,
                          projectId: w.id,
                          role: (e.target.value || null) as WorkspaceRoleName | null,
                        }))}
                      >
                        <option value="">no access</option>
                        {ROLES.map(r => <option key={r} value={r}>{`${r} — ${ROLE_HINT[r]}`}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Members</p>
                {data.people.map((p) => {
                  const inGroup = g.members.some(m => m.userId === p.userId);
                  return (
                    <label key={p.userId} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={inGroup}
                        disabled={!isAdmin || pending}
                        onChange={() => run(() => client.groups.setMember({
                          groupId: g.id,
                          userId: p.userId,
                          member: !inGroup,
                        }))}
                      />
                      <span>{p.name ?? p.email}</span>
                      <span className="text-xs text-muted-foreground">{p.email}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
