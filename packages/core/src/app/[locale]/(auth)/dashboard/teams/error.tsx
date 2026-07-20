'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Teams route error boundary — "couldn't load teams" + Retry, per
 * design §2a. Scoped to the route segment so the sidebar stays alive.
 * @param root0
 * @param root0.error
 * @param root0.reset - Next.js segment retry.
 */
export default function TeamsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('Teams');

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-background/60 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-[var(--brand-amber-tint)] text-[var(--brand-amber-deep)]">
        <TriangleAlert className="size-5" aria-hidden />
      </div>
      <div className="font-display text-base font-semibold text-foreground">{t('error_title')}</div>
      <p className="max-w-sm text-sm text-muted-foreground">{t('error_body')}</p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-1 inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
      >
        {t('error_retry')}
      </button>
    </div>
  );
}
