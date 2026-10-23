'use client';

import type { ReactNode } from 'react';
import { useState, useTransition } from 'react';
import { useRouter } from '@/libs/I18nNavigation';

/** One group of pills: the choices and the link each one opens. */
export type ControlGroup = { label: string; choices: Array<{ key: string; label: string; href: string; chosen: boolean }> };

/**
 * The window and source pills, and the figures they re-read. Choosing one
 * re-reads the board on the server, so the pill moves at once and the figures
 * dim until the new ones arrive (the Metrics page's frame, with two groups).
 * @param props - The frame.
 * @param props.groups - The pill groups.
 * @param props.note - The line saying what the figures cover.
 * @param props.children - The board and the runs.
 */
export function EnginesControls({ groups, note, children }: { groups: ControlGroup[]; note: string; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asked, setAsked] = useState<string | null>(null);

  const go = (id: string, href: string) => {
    setAsked(id);
    startTransition(() => {
      router.push(href, { scroll: false });
    });
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[13px] text-muted-foreground">{pending ? 'Reading the board…' : note}</p>
        <div className="flex flex-wrap gap-2">
          {groups.map(g => (
            <div key={g.label} className="flex gap-1 rounded-full border border-border p-0.5 text-xs" role="group" aria-label={g.label}>
              {g.choices.map((c) => {
                const id = `${g.label}:${c.key}`;
                const shown = pending && asked ? asked === id || (!asked.startsWith(`${g.label}:`) && c.chosen) : c.chosen;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => !c.chosen && go(id, c.href)}
                    aria-pressed={shown}
                    className={shown
                      ? 'rounded-full bg-foreground px-3 py-1 font-medium text-background'
                      : 'rounded-full px-3 py-1 text-muted-foreground hover:text-foreground'}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div aria-busy={pending} className={pending ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
        {children}
      </div>
    </div>
  );
}
