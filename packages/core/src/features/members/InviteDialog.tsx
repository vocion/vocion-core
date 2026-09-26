'use client';

import type { PendingInvite } from '@/services/MembersService';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
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

/**
 * Inviting somebody, and the pending invites, behind the People lane's primary
 * action. They were a form and a second table stacked under the members table,
 * which is a second page's worth of controls on a screen whose job is to
 * answer who reaches what.
 *
 * No email is sent: the invite is a link to copy and share.
 */

function inviteUrl(token: string): string {
  return `${window.location.origin}/sign-up?invite=${token}`;
}

function CopyLink({ token, label }: { token: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(inviteUrl(token));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : (label ?? 'Copy link')}
    </Button>
  );
}

export function InviteDialog(props: {
  open: boolean;
  invites: readonly PendingInvite[];
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onInvite: (email: string, role: 'admin' | 'member') => Promise<PendingInvite | null>;
  onRevoke: (inviteId: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [fresh, setFresh] = useState<PendingInvite | null>(null);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setFresh(null);
        }
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="invite-dialog">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            No email is sent. You get a link to share directly, good once, and
            only for the address you name.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const created = await props.onInvite(email.trim(), role);
            if (created) {
              setFresh(created);
              setEmail('');
            }
          }}
        >
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              placeholder="teammate@company.example"
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              value={role}
              onChange={e => setRole(e.target.value as 'admin' | 'member')}
              className="h-9 rounded-md bg-surface-soft px-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <Button type="submit" disabled={props.pending || !email.trim()}>
            {props.pending ? 'Creating…' : 'Create link'}
          </Button>
        </form>

        {props.error && <p className="text-sm text-destructive">{props.error}</p>}

        {fresh && (
          <div className="flex flex-col gap-2 rounded-md border border-rule bg-surface-soft p-3">
            <p className="text-sm font-medium">{`Link for ${fresh.email}`}</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={inviteUrl(fresh.token)} className="font-mono text-xs" onFocus={e => e.target.select()} />
              <CopyLink token={fresh.token} label="Copy" />
            </div>
          </div>
        )}

        {props.invites.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Pending</p>
            {props.invites.map(inv => (
              <div key={inv.id} className="flex items-center gap-2 border-b border-border/60 py-2 text-sm last:border-b-0">
                <span className="min-w-0 flex-1 truncate">{inv.email}</span>
                <span className={inv.expired ? 'text-[12px] text-destructive' : 'text-[12px] text-muted-foreground'}>
                  {inv.expired ? 'Expired' : `expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                </span>
                {!inv.expired && <CopyLink token={inv.token} />}
                <Button variant="ghost" size="sm" onClick={() => props.onRevoke(inv.id)}>Revoke</Button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
