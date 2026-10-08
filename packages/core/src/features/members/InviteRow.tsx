'use client';

import type { InviteRow as InviteRowData } from './access';
import { Check, Copy, Mail, MoreHorizontal, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Column, ListRow, Subline } from '@/components/patterns';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { day } from './day';
import { useCopyInviteLink } from './inviteLink';

/**
 * Somebody invited and not yet in the Org, as a row on the People lane.
 *
 * The same `ListRow`, in the same column order, as the people above it: the
 * role they join with where a person's Org role sits, and the invite's
 * state and expiry where a person's reach sits — somebody invited reaches
 * nothing until they join, and the chip says why. That column is the one a
 * phone keeps, so "Invited" survives the narrowest screen. When and by whom
 * is the subline, where a person's email is.
 *
 * The verbs are the ones the invite dialog's pending list had — copy the link,
 * revoke — and now live only here, with "Resend email" when this server mails
 * invites (`services/InviteMail.ts`). An expired invite's link no longer works,
 * so its row offers Re-invite instead of Copy and Resend: a fresh link for the
 * same address and role, which replaces the old one and, with mail on, is
 * mailed (`createInvite`).
 * @param props - The row.
 * @param props.invite - The invite, from `inviteRows`.
 * @param props.pending - A write is in flight; the menu waits for it.
 * @param props.onRevoke - Revoke it; the caller confirms first.
 * @param props.onReinvite - Make a fresh link for an expired one.
 * @param props.onResend - Mail it again; absent when this server sends no email.
 */
export function InviteRow(props: {
  invite: InviteRowData;
  pending: boolean;
  onRevoke: (invite: InviteRowData) => void;
  onReinvite: (invite: InviteRowData) => void;
  onResend?: (invite: InviteRowData) => void;
}) {
  const t = useTranslations('Members');
  const [copied, copy] = useCopyInviteLink();
  const { invite } = props;
  const invitedOn = day(invite.invitedAt);

  return (
    <ListRow
      data-testid={`invite-row-${invite.inviteId}`}
      title={invite.email}
      subline={(
        <Subline
          segments={[
            invite.invitedBy
              ? t('invited_by', { date: invitedOn, name: invite.invitedBy })
              : t('invited_on', { date: invitedOn }),
          ]}
        />
      )}
      columnsAside={(
        <>
          <Column kind="status" align="left" always>
            <Badge variant={invite.accountRole === 'admin' ? 'default' : 'secondary'}>{invite.accountRole}</Badge>
          </Column>
          <Column kind="chip" align="left" className="max-w-40">{null}</Column>
          <Column kind="score" align="left" grow always>
            <span className="flex min-w-0 items-center gap-2">
              <Badge
                data-testid="invite-state"
                variant={invite.expired ? 'destructive' : 'accent'}
                title={invite.expired ? t('expired_title') : t('invited_title')}
              >
                {invite.expired ? t('state_expired') : t('state_invited')}
              </Badge>
              {/* A phone keeps the chip and drops the date, rather than
                  showing "e…". The subline still says when it was sent. */}
              <span data-testid="invite-expiry" className="hidden truncate sm:inline">
                {invite.expired
                  ? t('expired_on', { date: day(invite.expiresAt) })
                  : t('expires_on', { date: day(invite.expiresAt) })}
              </span>
            </span>
          </Column>
          <Column kind="date">{null}</Column>
        </>
      )}
      actionsAlways
      actions={(
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('invite_actions', { email: invite.email })}
            disabled={props.pending}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {invite.expired
              ? (
                  <DropdownMenuItem onSelect={() => props.onReinvite(invite)}>
                    <RotateCw aria-hidden />
                    {t('reinvite')}
                  </DropdownMenuItem>
                )
              : (
                  <>
                    {props.onResend && (
                      <DropdownMenuItem onSelect={() => props.onResend?.(invite)}>
                        <Mail aria-hidden />
                        {t('resend_email')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={(e) => {
                        // Keep the menu open long enough to show that it worked.
                        e.preventDefault();
                        void copy(invite.token);
                      }}
                    >
                      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                      {copied ? t('copied') : t('copy_link')}
                    </DropdownMenuItem>
                  </>
                )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => props.onRevoke(invite)}>
              {t('revoke')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    />
  );
}
