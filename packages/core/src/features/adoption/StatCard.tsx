import { cn } from '@/utils/Helpers';
import { formatDelta } from './format';

/**
 * Headline metric card with an optional vs-previous-period delta and a
 * definition tooltip (metric credibility: every number says what it means).
 */
export function StatCard(props: {
  label: string;
  value: string | number;
  hint?: string;
  /** Current + previous raw values — renders a signed delta chip. */
  delta?: { current: number; previous: number };
  /** Plain-language metric definition, shown as a native tooltip. */
  definition?: string;
}) {
  const delta = props.delta ? formatDelta(props.delta.current, props.delta.previous) : null;
  return (
    <div className="rounded-lg border border-border p-4" title={props.definition}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-2xl font-bold tabular-nums">{props.value}</div>
        {delta && (
          <span className={cn(
            'text-[11px] font-medium tabular-nums',
            delta.direction === 'up' && 'text-[var(--brand-pass)]',
            delta.direction === 'down' && 'text-[var(--brand-fail)]',
            delta.direction === 'flat' && 'text-muted-foreground',
          )}
          >
            {delta.text}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {props.label}
        {props.hint && (
          <span className="text-muted-foreground/60">
            {' · '}
            {props.hint}
          </span>
        )}
      </div>
    </div>
  );
}
