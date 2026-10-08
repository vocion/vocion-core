'use client';

import type { PendingInvitation } from '@/services/auth/joinInvites';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { postJson } from '@/features/auth/postJson';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { client } from '@/libs/Orpc';

/**
 * The invites list itself, for a story or a test to render without the
 * server: one row per Org that asked, each with one Join.
 * @param props - The invites and what Join does.
 * @param props.invitations - Open invites to this person's address.
 * @param props.onJoin - Accept one; resolves to an error sentence, or null when it worked.
 */
export function InvitationsList(props: { invitations: readonly PendingInvitation[]; onJoin: (token: string) => Promise<string | null> }) {
  const t = useTranslations('Invitations');
  const [joining, setJoining] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <ul className="divide-y divide-border/70">
      {props.invitations.map(invite => (
        <li key={invite.token} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="invitation">
          <div className="min-w-0">
            <p className="text-sm font-medium">{invite.orgName}</p>
            <p className="text-xs text-muted-foreground">
              {invite.role === 'admin' ? t('as_admin') : t('as_member')}
              {' · '}
              {t('expires', { date: new Date(invite.expiresAt) })}
            </p>
            {(invite.problem ?? errors[invite.token]) && (
              <p className="mt-1 text-xs text-destructive" role="alert">{invite.problem ?? errors[invite.token]}</p>
            )}
          </div>
          {!invite.problem && (
            <Button
              size="sm"
              disabled={joining !== null}
              onClick={async () => {
                setJoining(invite.token);
                const error = await props.onJoin(invite.token);
                setJoining(null);
                if (error) {
                  setErrors(e => ({ ...e, [invite.token]: error }));
                }
              }}
            >
              {joining === invite.token ? t('joining') : t('join', { org: invite.orgName })}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The profile's "Invitations": invites another Org sent to this person's
 * address after they signed in, each joined in one click on the login they
 * already have (`/api/invites/accept`). Hidden when there are none. The
 * `org-invited` notification opens here; their next sign-in would join them
 * anyway (`services/auth/joinInvites.ts`).
 */
export function InvitationsSection() {
  const t = useTranslations('Invitations');
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);

  const refresh = useCallback(async () => {
    try {
      setInvitations(await client.profile.invitations());
    } catch {
      setInvitations([]);
    }
  }, []);

  useEffect(() => {
    // False positive: every setState in refresh() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  if (invitations.length === 0) {
    return null;
  }

  return (
    <div id="invitations">
      <DashboardSection title={t('title')} description={t('description')}>
        <InvitationsList
          invitations={invitations}
          onJoin={async (token) => {
            const result = await postJson<{ ok: true; openPath: string | null }>('/api/invites/accept', { inviteToken: token });
            if (!result.ok) {
              return result.error ?? t('failed');
            }
            window.location.href = result.data.openPath ?? '/dashboard';
            return null;
          }}
        />
      </DashboardSection>
    </div>
  );
}
