import { cn } from '@/utils/Helpers';

/**
 * A goal's progress as a thin bar and its words: the words always (a bar is
 * never the only way the number is said), the bar only when there is
 * something to measure against.
 * @param props - The bar.
 * @param props.ratio - 0..1, or null when unmeasured.
 * @param props.label - "12 of 40 contacted".
 * @param props.size - `row` in a list, `page` on the goal's page.
 * @param props.className - Extra classes.
 */
export function GoalProgressBar(props: { ratio: number | null; label: string; size?: 'row' | 'page'; className?: string }) {
  const pct = props.ratio === null ? null : Math.round(Math.min(Math.max(props.ratio, 0), 1) * 100);
  const page = props.size === 'page';
  return (
    <span data-testid="goal-progress" className={cn('flex min-w-0 flex-col', page ? 'gap-2' : 'gap-1', props.className)}>
      <span className={cn('tabular-nums', page ? 'text-[15px] font-medium text-foreground' : 'truncate text-[12px] text-muted-foreground')}>{props.label}</span>
      {pct !== null && (
        <span
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={props.label}
          className={cn('block w-full overflow-hidden rounded-full bg-muted', page ? 'h-2' : 'h-1')}
        >
          <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}
