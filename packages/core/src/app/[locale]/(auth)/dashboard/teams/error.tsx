'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/buttonVariants';

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
      <TriangleAlert className="size-5 text-muted-foreground" aria-hidden />
      <div className="font-display text-base font-semibold text-foreground">{t('error_title')}</div>
      <p className="max-w-sm text-sm text-muted-foreground">{t('error_body')}</p>
      <button
        type="button"
        onClick={() => reset()}
        className={buttonVariants({ size: 'sm', className: 'mt-1' })}
      >
        {t('error_retry')}
      </button>
    </div>
  );
}
