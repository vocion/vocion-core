import type { ReactNode } from 'react';
import { Section } from '@/components/patterns';
import { cn } from '@/utils/Helpers';

/**
 * A titled part of a routine or batch surface. On its own page it is the
 * Detail archetype's `Section` (a region chat can be asked about); in the
 * preview pane it is the same shape without the comment region, because a
 * comment there would be filed against the page underneath (`PreviewPane`).
 * @param props
 * @param props.compact - In the pane.
 * @param props.eyebrow - The label.
 * @param props.action - The right slot.
 * @param props.children - The content.
 * @param props.className
 * @param props.testId - `data-testid`.
 */
export function Part(props: { compact?: boolean; eyebrow: ReactNode; action?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  if (!props.compact) {
    return <Section eyebrow={props.eyebrow} action={props.action} className={props.className} data-testid={props.testId}>{props.children}</Section>;
  }
  return (
    <section className={cn('border-b border-rule py-4 last:border-b-0', props.className)} data-testid={props.testId}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{props.eyebrow}</h3>
        {props.action && <div className="shrink-0 text-[13px]">{props.action}</div>}
      </div>
      <div className="text-sm">{props.children}</div>
    </section>
  );
}

/**
 * A small heading inside a part: "Rules · 4".
 * @param props
 * @param props.children - The words.
 * @param props.count - How many.
 */
export function SubHead(props: { children: ReactNode; count?: number }) {
  return (
    <h4 className="mt-5 mb-2 text-[12px] font-semibold text-foreground first:mt-0">
      {props.children}
      {props.count !== undefined && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{props.count}</span>}
    </h4>
  );
}
