'use client';

import { Check, Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { hireAgent } from './actions';

/**
 * The one action on a catalog entry's profile.
 *
 * It sits below the description and above the system prompt on purpose —
 * far enough down that somebody has had to scroll past what the agent is
 * before they can hire it.
 *
 * An already-hired entry renders as a state, not a disabled button with a
 * tooltip: the answer to "can I hire this" is "you already did", and that
 * should be readable without hovering.
 * @param root0
 * @param root0.slug - Catalog entry slug.
 * @param root0.name - Display name, for the confirmed state.
 * @param root0.hired - Whether the workspace already has this agent.
 */
export function HireButton({ slug, name, hired }: { slug: string; name: string; hired: boolean }) {
  const t = useTranslations('Marketplace');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(hired);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--brand-teal-deep)]">
        <Check className="size-3.5" aria-hidden />
        {t('hired', { name })}
      </div>
    );
  }

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await hireAgent(slug);
      if (!result.ok) {
        setError(t('hire_failed'));
        return;
      }
      setDone(true);
      router.refresh();
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-action px-3.5 py-1.5 text-[13px] font-medium text-action-foreground transition-colors hover:bg-action/90 disabled:opacity-60 sm:min-h-0"
      >
        {pending
          ? <Loader2 className="size-3.5 animate-spin" aria-hidden />
          : <Plus className="size-3.5" aria-hidden />}
        {t('hire')}
      </button>
      {error && <p className="mt-1.5 text-xs text-[var(--brand-amber-deep)]">{error}</p>}
    </div>
  );
}
