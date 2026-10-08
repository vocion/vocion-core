'use client';

import type { InviteDelivery } from '@/services/InviteMail';
import type { PendingInvite } from '@/services/MembersService';
import { Check, Copy, MailCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
 * With mail on, the invite is also emailed to the address
 * (`services/InviteMail.ts`) and the dialog says so; the link is shown either
 * way, so Copy link is always the fallback. With mail off, the link is the
 * invite, to copy and share.
 */

/** A just-made invite, with what happened to its email. */
export type CreatedInvite = PendingInvite & { delivery: InviteDelivery };

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
  const t = useTranslations('Members');
  const [copied, copy] = useCopyInviteLink();
  return (
    <Button variant="outline" size="sm" onClick={() => void copy(token)}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? t('copied') : (label ?? t('copy_link_short'))}
    </Button>
  );
}

/**
 * What became of a fresh invite's email, in one line above its link.
 * @param props - The invite.
 * @param props.invite - The invite just made.
 */
function DeliveryLine({ invite }: { invite: CreatedInvite }) {
  const t = useTranslations('Members');
  if (invite.delivery.status === 'sent') {
    return (
      <p className="flex items-center gap-1.5 text-sm font-medium" role="status">
        <MailCheck className="size-4 text-muted-foreground" aria-hidden />
        {t('invite_emailed', { email: invite.email })}
      </p>
    );
  }
  if (invite.delivery.status === 'failed') {
    return (
      <p className="text-sm" role="status">
        <span className="font-medium">{t('invite_not_emailed', { email: invite.email })}</span>
        {' '}
        <span className="text-muted-foreground">{invite.delivery.reason}</span>
      </p>
    );
  }
  return <p className="text-sm font-medium">{t('invite_link_for', { email: invite.email })}</p>;
}

export function InviteDialog(props: {
  open: boolean;
  pending: boolean;
  error: string | null;
  /** Whether this server emails invites; the words and the button follow it. */
  emails?: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (email: string, role: 'admin' | 'member') => Promise<CreatedInvite | null>;
}) {
  const t = useTranslations('Members');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [fresh, setFresh] = useState<CreatedInvite | null>(null);
  const [creating, setCreating] = useState(false);
  const busy = props.pending || creating;

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
          <DialogTitle>{t('invite_title')}</DialogTitle>
          <DialogDescription>
            {props.emails ? t('invite_description_mail') : t('invite_description_link')}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setCreating(true);
            try {
              const created = await props.onInvite(email.trim(), role);
              if (created) {
                setFresh(created);
                setEmail('');
              }
            } finally {
              setCreating(false);
            }
          }}
        >
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Label htmlFor="invite-email">{t('invite_email')}</Label>
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
            <Label htmlFor="invite-role">{t('invite_role')}</Label>
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
          <Button type="submit" disabled={busy || !email.trim()}>
            {busy
              ? (props.emails ? t('invite_sending') : t('invite_creating'))
              : (props.emails ? t('invite_send') : t('invite_create'))}
          </Button>
        </form>

        {props.error && <p className="text-sm text-destructive">{props.error}</p>}

        {fresh && (
          <div className="flex flex-col gap-2 rounded-md border border-rule bg-surface-soft p-3" data-testid="invite-fresh">
            <DeliveryLine invite={fresh} />
            <div className="flex items-center gap-2">
              <Input readOnly aria-label={t('invite_link_label')} value={inviteUrl(fresh.token)} className="font-mono text-xs" onFocus={e => e.target.select()} />
              <CopyLink token={fresh.token} label={t('copy')} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>{t('done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
