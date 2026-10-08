'use client';

import type { OperatorAccount } from '@/services/OperatorConsoleService';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CopyLink } from '@/features/members/InviteDialog';
import { formatMoney } from '@/libs/workspace/pageFields';
import { centsFromDollars, lastSeen } from './format';

/**
 * One account, as its operator needs it: the month against the cap (and the
 * one control on this page that changes money), the workspaces with what each
 * spent, the people with when each was last seen, and the open invites.
 *
 * The cap is in dollars because that is how an operator agrees it with a
 * client; it is stored in cents like every other cap. Clearing the field and
 * saving removes the cap.
 */

const SECTION = 'border-t border-rule px-5 py-4';
const HEADING = 'text-[11px] font-semibold tracking-wide text-muted-foreground uppercase';
const LINE = 'flex items-center gap-2 border-b border-border/60 py-2 text-sm last:border-b-0';

export function AccountSheet(props: {
  account: OperatorAccount | null;
  pending: boolean;
  windowDays: number;
  onClose: () => void;
  onSetCap: (accountId: string, hardCentsLimit: number | null) => void;
  onInvite: (accountId: string, email: string, role: 'admin' | 'member') => void;
}) {
  const account = props.account;
  if (!account) {
    return null;
  }
  // Keyed on the account so the form fields start from that account's values.
  return <AccountSheetBody key={account.id} {...props} account={account} />;
}

function AccountSheetBody(props: {
  account: OperatorAccount;
  pending: boolean;
  windowDays: number;
  onClose: () => void;
  onSetCap: (accountId: string, hardCentsLimit: number | null) => void;
  onInvite: (accountId: string, email: string, role: 'admin' | 'member') => void;
}) {
  const { account } = props;
  const [cap, setCap] = useState(account.cap.hardCentsLimit === null ? '' : String(account.cap.hardCentsLimit / 100));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('admin');
  const parsed = centsFromDollars(cap);
  const capChanged = parsed !== undefined && parsed !== account.cap.hardCentsLimit;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg" data-testid="operator-account-sheet">
        <SheetHeader className="p-5 pb-4">
          <SheetTitle className="text-lg">{account.name}</SheetTitle>
          <SheetDescription>
            {`${account.slug} · created ${new Date(account.createdAt).toLocaleDateString()} · last activity ${lastSeen(account.lastActivityAt)}`}
          </SheetDescription>
        </SheetHeader>

        <section className={SECTION}>
          <h3 className={HEADING}>This month</h3>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
            {formatMoney(account.cap.spentCents)}
            {account.cap.hardCentsLimit !== null && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">{`of a ${formatMoney(account.cap.hardCentsLimit)} cap`}</span>
            )}
            {account.cap.blocked && <Badge variant="destructive" className="ml-2 align-middle">At cap</Badge>}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {`Every workspace in the account, resets ${new Date(account.cap.periodResetsAt).toLocaleDateString(undefined, { timeZone: 'UTC' })} (UTC). At the cap, ingest and image generation stop and agent turns are refused; search and small calls carry on.`}
          </p>
          <form
            className="mt-3 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed !== undefined) {
                props.onSetCap(account.id, parsed);
              }
            }}
          >
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="account-cap">Monthly cap (USD)</Label>
              <Input
                id="account-cap"
                inputMode="decimal"
                value={cap}
                placeholder="No cap"
                aria-invalid={parsed === undefined}
                onChange={e => setCap(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={props.pending || !capChanged}>
              {parsed === null && account.cap.hardCentsLimit !== null ? 'Remove cap' : 'Save cap'}
            </Button>
          </form>
        </section>

        <section className={SECTION}>
          <h3 className={HEADING}>{`Workspaces · last ${props.windowDays} days`}</h3>
          <div className="mt-2 flex flex-col">
            {account.workspaces.map(w => (
              <div key={w.id} className={LINE}>
                <span className="min-w-0 flex-1 truncate">
                  {w.name}
                  <span className="ml-2 font-mono text-[12px] text-muted-foreground">{w.slug}</span>
                </span>
                <span className="w-24 shrink-0 text-right text-[13px] text-muted-foreground">{lastSeen(w.lastActivityAt)}</span>
                <span className="w-20 shrink-0 text-right tabular-nums">{formatMoney(w.spendCents)}</span>
              </div>
            ))}
            {account.personal.count > 0 && (
              <div className={LINE}>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {`${account.personal.count} personal ${account.personal.count === 1 ? 'workspace' : 'workspaces'}`}
                </span>
                <span className="w-24 shrink-0 text-right text-[13px] text-muted-foreground">{lastSeen(account.personal.lastActivityAt)}</span>
                <span className="w-20 shrink-0 text-right tabular-nums">{formatMoney(account.personal.spendCents)}</span>
              </div>
            )}
            {account.workspaces.length === 0 && account.personal.count === 0 && (
              <p className="py-2 text-sm text-muted-foreground">No workspaces.</p>
            )}
          </div>
        </section>

        <section className={SECTION}>
          <h3 className={HEADING}>People</h3>
          <div className="mt-2 flex flex-col">
            {account.members.map(m => (
              <div key={m.userId} className={LINE}>
                <span className="min-w-0 flex-1 truncate">{m.email}</span>
                <span className="w-16 shrink-0 text-[12px] text-muted-foreground">{m.role}</span>
                <span className="w-24 shrink-0 text-right text-[13px] text-muted-foreground">{lastSeen(m.lastActiveAt)}</span>
              </div>
            ))}
            {account.members.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nobody has joined yet.</p>}
          </div>
        </section>

        <section className={SECTION}>
          <h3 className={HEADING}>Invites</h3>
          <div className="mt-2 flex flex-col">
            {account.invites.map(inv => (
              <div key={inv.id} className={LINE}>
                <span className="min-w-0 flex-1 truncate">{inv.email}</span>
                <span className="w-16 shrink-0 text-[12px] text-muted-foreground">{inv.role}</span>
                <span className={inv.expired ? 'text-[12px] text-destructive' : 'text-[12px] text-muted-foreground'}>
                  {inv.expired ? 'Expired' : `until ${new Date(inv.expiresAt).toLocaleDateString()}`}
                </span>
                {!inv.expired && <CopyLink token={inv.token} />}
              </div>
            ))}
          </div>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              props.onInvite(account.id, email.trim(), role);
              setEmail('');
            }}
          >
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="operator-invite-email">Invite</Label>
              <Input id="operator-invite-email" type="email" required value={email} placeholder="admin@client.example" onChange={e => setEmail(e.target.value)} />
            </div>
            <select
              aria-label="Role"
              value={role}
              onChange={e => setRole(e.target.value as 'admin' | 'member')}
              className="h-9 rounded-md bg-surface-soft px-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="admin">admin</option>
              <option value="member">member</option>
            </select>
            <Button type="submit" variant="outline" disabled={props.pending || !email.trim()}>Create link</Button>
          </form>
        </section>
      </SheetContent>
    </Sheet>
  );
}
