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
import { inviteUrl, useCopyInviteLink } from './inviteLink';

/**
 * Inviting somebody, behind the People lane's primary action. It makes the
 * link and hands it over, and that is all it does.
 *
 * It used to list the pending invites too, with their Copy and Revoke. Those
 * are rows on the People lane now (`InviteRow`), the one place an invite is
 * shown: a list inside a dialog beside the same list on the page would be two
 * surfaces doing one job, and the dialog's copy was the only one there was —
 * you had to open "Invite member" to find out who had been invited.
 *
 * No email is sent: the invite is a link to copy and share.
 */

/**
 * The link an invite is shared as. Re-exported here, beside `CopyLink`, so
 * every place that shows an invite shares the same link — an extension's page
 * among them, which imports both from this module.
 */
export { inviteUrl };

/**
 * Copies an invite's link, and says so for two seconds.
 * @param props - The invite.
 * @param props.token - The invite's token.
 * @param props.label - The button's words (default "Copy link").
 */
export function CopyLink({ token, label }: { token: string; label?: string }) {
  const [copied, copy] = useCopyInviteLink();
  return (
    <Button variant="outline" size="sm" onClick={() => void copy(token)}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : (label ?? 'Copy link')}
    </Button>
  );
}

export function InviteDialog(props: {
  open: boolean;
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onInvite: (email: string, role: 'admin' | 'member') => Promise<PendingInvite | null>;
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
            only for the address you name. It waits on the People list until
            they join.
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

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
