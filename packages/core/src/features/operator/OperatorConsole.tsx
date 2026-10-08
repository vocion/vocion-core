'use client';

import type { CreatedAccount, OperatorOverview } from '@/services/OperatorConsoleService';
import { Building2, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Column, ListEmpty, ListPage, ListRow, ListRows, ListToolbar, Subline } from '@/components/patterns';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CopyLink, inviteUrl } from '@/features/members/InviteDialog';
import { client } from '@/libs/Orpc';
import { formatMoney } from '@/libs/workspace/pageFields';
import { AccountSheet } from './AccountSheet';
import { capLabel, lastSeen } from './format';

/**
 * The operator console — every client account on the deployment, one row
 * each, and the one thing the page is reached to do: let a new client in.
 *
 * A row reads left to right as the operator's questions: who is this, how
 * big is it (workspaces, people), is anyone using it (last activity), what is
 * it costing (30-day spend), and is it near its cap (this month against the
 * cap). The row opens the account's sheet, where the cap is set and where an
 * admin can be re-invited — nothing is changed from the list itself.
 *
 * `ListPage` / `ListToolbar` / `ListRow` like every other list
 * (`docs/design/patterns.md`); there is no second row shape here.
 */

export function OperatorConsole() {
  const [overview, setOverview] = useState<OperatorOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setOverview(await client.operator.overview());
      setError(null);
    } catch {
      setError('Could not load the accounts.');
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    // Every setState in refresh() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const run = (fn: () => Promise<unknown>) => {
    startTransition(async () => {
      try {
        await fn();
        await refresh();
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : 'That did not work.');
      }
    });
  };

  const accounts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = overview?.accounts ?? [];
    if (!needle) {
      return all;
    }
    return all.filter(a => [a.name, a.slug, ...a.members.map(m => m.email), ...a.workspaces.map(w => w.name)]
      .some(value => value.toLowerCase().includes(needle)));
  }, [overview, q]);

  if (!loaded) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }
  if (!overview) {
    return <p className="p-4 text-sm text-destructive">{error ?? 'Could not load the accounts.'}</p>;
  }

  const open = overview.accounts.find(a => a.id === openId) ?? null;
  // Both are `YYYY-MM-DD`, so they compare as strings.
  const windowStartsLate = overview.ledgerStartedOn !== null && overview.ledgerStartedOn > overview.windowStartsOn;

  return (
    <ListPage
      title="Operator"
      description="Every client account on this deployment: who is in it, whether it is used, and what it costs. Accounts are invite-only — a new client starts here."
      actions={(
        <Button size="sm" disabled={pending} onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New account
        </Button>
      )}
    >
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {windowStartsLate && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          {`Spend is recorded per day from ${overview.ledgerStartedOn}; the ${overview.windowDays}-day totals start there.`}
        </p>
      )}

      <ListToolbar
        className="mt-4"
        search={{ value: q, onChange: setQ, placeholder: 'Find an account, a person or a workspace…' }}
        trailing={(
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {`${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}`}
          </span>
        )}
      />

      {accounts.length === 0
        ? (overview.accounts.length === 0
            ? <ListEmpty variant="page" icon={Building2} title="No accounts yet" description="Create the first client account and invite its admin." action={{ label: 'New account', onClick: () => setCreating(true) }} />
            : <ListEmpty variant="inline" title="No account matches that." />)
        : (
            <ListRows>
              {accounts.map(account => (
                <ListRow
                  key={account.id}
                  data-testid="operator-account-row"
                  icon={Building2}
                  title={account.name}
                  onClick={() => setOpenId(account.id)}
                  subline={(
                    <Subline
                      separator="·"
                      segments={[
                        account.slug,
                        `${account.workspaces.length} ${account.workspaces.length === 1 ? 'workspace' : 'workspaces'}`,
                        `${account.members.length} ${account.members.length === 1 ? 'person' : 'people'}`,
                        account.invites.length > 0 && `${account.invites.length} invited`,
                      ]}
                    />
                  )}
                  columns={(
                    <>
                      <Column kind="date">{lastSeen(account.lastActivityAt)}</Column>
                      <Column kind="amount" always>{formatMoney(account.spendCents)}</Column>
                      <Column kind="status" className="w-36">{capLabel(account)}</Column>
                    </>
                  )}
                  chip={account.cap.blocked
                    ? <Badge variant="destructive">At cap</Badge>
                    : (account.members.length === 0 && account.invites.length > 0 ? <Badge variant="outline">Invited</Badge> : undefined)}
                />
              ))}
            </ListRows>
          )}

      <p className="mt-3 px-2 text-[12px] text-muted-foreground">
        {`Columns: last activity · spend over the last ${overview.windowDays} days · this month against the account cap.`}
      </p>

      <AccountSheet
        account={open}
        pending={pending}
        windowDays={overview.windowDays}
        onClose={() => setOpenId(null)}
        onSetCap={(accountId, hardCentsLimit) => run(() => client.operator.setAccountCap({ accountId, hardCentsLimit }))}
        onInvite={(accountId, email, role) => run(() => client.operator.invite({ accountId, email, role }))}
      />

      <NewAccountDialog
        open={creating}
        pending={pending}
        onOpenChange={setCreating}
        onCreate={async (input) => {
          try {
            const created = await client.operator.createAccount(input);
            await refresh();
            return created;
          } catch (err) {
            setError(err instanceof Error && err.message ? err.message : 'Could not create the account.');
            return null;
          }
        }}
      />
    </ListPage>
  );
}

/**
 * The whole of onboarding: the client's name, its first workspace, and who
 * its admin is. What comes back is the admin's invite link — no email is sent,
 * the same as an invite from the members page.
 * @param props - Open state and the create call.
 * @param props.open - Whether the dialog shows.
 * @param props.pending - A write is in flight.
 * @param props.onOpenChange - Open or close it.
 * @param props.onCreate - Create the account; resolves to null on failure.
 */
function NewAccountDialog(props: {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; workspaceName?: string; adminEmail: string }) => Promise<CreatedAccount | null>;
}) {
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedAccount | null>(null);

  const close = (open: boolean) => {
    if (!open) {
      setCreated(null);
      setName('');
      setWorkspaceName('');
      setAdminEmail('');
    }
    props.onOpenChange(open);
  };

  return (
    <Dialog open={props.open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg" data-testid="new-account-dialog">
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>
            Creates the client&apos;s account and its first workspace, and an admin invite
            to share with them. No email is sent.
          </DialogDescription>
        </DialogHeader>

        {created
          ? (
              <div className="flex flex-col gap-2 rounded-md border border-rule bg-surface-soft p-3">
                <p className="text-sm font-medium">
                  {`${created.account.name} is ready. Admin link for ${created.invite.email}:`}
                </p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={inviteUrl(created.invite.token)} className="font-mono text-xs" onFocus={e => e.target.select()} />
                  <CopyLink token={created.invite.token} label="Copy" />
                </div>
                <p className="text-[12px] text-muted-foreground">
                  {`Good once, for that address only, until ${new Date(created.invite.expiresAt).toLocaleDateString()}. Workspace: ${created.workspace.name}.`}
                </p>
              </div>
            )
          : (
              <form
                id="new-account-form"
                className="flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  const result = await props.onCreate({
                    name: name.trim(),
                    workspaceName: workspaceName.trim() || undefined,
                    adminEmail: adminEmail.trim(),
                  });
                  setBusy(false);
                  if (result) {
                    setCreated(result);
                  }
                }}
              >
                <div className="flex flex-col gap-1">
                  <Label htmlFor="account-name">Client name</Label>
                  <Input id="account-name" required value={name} placeholder="Northwind" onChange={e => setName(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="account-workspace">First workspace</Label>
                  <Input id="account-workspace" value={workspaceName} placeholder={name.trim() || 'Same as the client name'} onChange={e => setWorkspaceName(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="account-admin">Admin email</Label>
                  <Input id="account-admin" type="email" required value={adminEmail} placeholder="admin@client.example" onChange={e => setAdminEmail(e.target.value)} />
                </div>
              </form>
            )}

        <DialogFooter>
          {created
            ? <Button variant="outline" onClick={() => close(false)}>Done</Button>
            : (
                <>
                  <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
                  <Button type="submit" form="new-account-form" disabled={busy || props.pending || !name.trim() || !adminEmail.trim()}>
                    {busy ? 'Creating…' : 'Create account'}
                  </Button>
                </>
              )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
