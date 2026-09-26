import { cn } from '@/utils/Helpers';
import { fitToLine } from './access';

/**
 * A row's facts as chips, on one line, with the overflow folded into a count.
 *
 * Not `ChipRow`: these are inert labels inside a list row, not the toolbar's
 * filter controls, so there is nothing that has to stay visible and nothing to
 * measure. The rule they DO share is the one that matters — a cell is one
 * line, however many workspaces the account grows to.
 * @param props - The chips and how many fit.
 * @param props.items - The labels, in display order.
 * @param props.max - How many to show before the count. Default 4.
 * @param props.empty - What to say when there are none.
 * @param props.className - Extra classes for the row.
 */
export function Chips(props: { items: readonly string[]; max?: number; empty?: string; className?: string }) {
  const { shown, more } = fitToLine(props.items, props.max ?? 4);
  if (shown.length === 0) {
    return <span className="text-[13px] text-muted-foreground/70">{props.empty ?? 'none'}</span>;
  }
  return (
    <span className={cn('flex min-w-0 items-center gap-1 overflow-hidden', props.className)}>
      {shown.map(label => (
        <span
          key={label}
          title={label}
          className="inline-flex h-6 max-w-[15ch] shrink-0 items-center truncate rounded border border-border/70 bg-surface-soft px-2 text-[12px] text-foreground/80"
        >
          {label}
        </span>
      ))}
      {more > 0 && (
        <span
          title={props.items.slice(shown.length).join(', ')}
          className="inline-flex h-6 shrink-0 items-center rounded border border-dashed border-border px-2 text-[12px] text-muted-foreground tabular-nums"
        >
          {`+${more}`}
        </span>
      )}
    </span>
  );
}
