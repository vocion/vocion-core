'use client';

import { UserPlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/libs/I18nNavigation';

/**
 * Small, dismissible "Invite team members" card at the bottom of the sidebar
 * (ElevenLabs pattern). Links to the Members page, which issues link-based
 * invites today (MembersService). Dismissal is remembered per user via nav
 * prefs; the card is hidden in the icon rail.
 * @param props
 * @param props.onDismiss
 */
export function InviteTeamCard({ onDismiss }: { onDismiss: () => void }) {
  const t = useTranslations('DashboardLayout');
  return (
    <div className="relative mx-2 mb-2 rounded-xl border border-border/70 bg-background p-3 group-data-[collapsible=icon]:hidden">
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('dismiss')}
        className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <X className="size-3.5" aria-hidden />
      </button>
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-soft text-muted-foreground">
          <UserPlus className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 pr-5">
          <div className="text-[13px] font-medium text-foreground">{t('invite_title')}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{t('invite_body')}</p>
          <Link href="/dashboard/members" className="mt-2 inline-flex h-7 items-center rounded-lg bg-action px-2.5 text-[12px] font-medium text-action-foreground transition-colors hover:bg-action/90">
            {t('invite_cta')}
          </Link>
        </div>
      </div>
    </div>
  );
}
