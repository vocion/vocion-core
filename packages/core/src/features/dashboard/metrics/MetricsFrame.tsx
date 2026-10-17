'use client';

import type { ReactNode } from 'react';
import type { PeriodUnit } from '@/services/metrics/periods';
import { useState, useTransition } from 'react';
import { useRouter } from '@/libs/I18nNavigation';

const CHOICES: Array<{ value: PeriodUnit; label: string }> = [{ value: 'week', label: 'By week' }, { value: 'month', label: 'By month' }];

/**
 * The week / month toggle and the figures it re-reads. Switching re-reads
 * every figure on the server, so the chosen pill moves at once and the
 * figures dim until the new ones arrive: a click is never met with nothing.
 * @param props - The frame.
 * @param props.slug - The page's slug, for the toggle's links.
 * @param props.unit - The unit the figures were read in.
 * @param props.note - The line saying how current the figures are.
 * @param props.children - The figures.
 */
export function MetricsFrame({ slug, unit, note, children }: { slug: string; unit: PeriodUnit; note: string; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asked, setAsked] = useState<PeriodUnit | null>(null);
  const shown = pending && asked ? asked : unit;

  const choose = (value: PeriodUnit) => {
    if (value === shown) {
      return;
    }
    setAsked(value);
    startTransition(() => {
      // Explicit both ways: a push that only drops the query was observed
      // never leaving `?by=month`.
      router.push(`/dashboard/p/${slug}?by=${value}`, { scroll: false });
    });
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[13px] text-muted-foreground">{pending ? 'Reading the figures…' : note}</p>
        <div className="flex gap-1 rounded-full border border-border p-0.5 text-xs" role="group" aria-label="Group by">
          {CHOICES.map(c => (
            <button
              key={c.value}
              type="button"
              onClick={() => choose(c.value)}
              aria-pressed={c.value === shown}
              className={c.value === shown
                ? 'rounded-full bg-foreground px-3 py-1 font-medium text-background'
                : 'rounded-full px-3 py-1 text-muted-foreground hover:text-foreground'}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div aria-busy={pending} className={pending ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
        {children}
      </div>
    </div>
  );
}
