'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { fitChips } from '@/components/patterns';
import { cn } from '@/utils/Helpers';

/** Matches the `gap-1` the row is laid out with. */
const GAP = 4;

/**
 * A row's facts as chips, on one line, with the overflow folded into a count.
 *
 * Not `ChipRow`: these are inert labels inside a list row, not the toolbar's
 * filter controls, so there is nothing to toggle and nothing that has to stay
 * visible. The rule they DO share is the one that matters, and they share the
 * implementation of it — `fitChips`, the same pure, unit-tested rule
 * `ChipRow` asks. A fixed "show the first four" is not that rule: four
 * workspace names do not fit where two do, and the fourth ends up clipped
 * mid-word by the cell's own overflow.
 *
 * The cell is one line however many workspaces the account grows to.
 * @param props - The labels and what to say when there are none.
 * @param props.items - The labels, in display order.
 * @param props.empty - What to say when there are none.
 * @param props.className - Extra classes for the row.
 */
export function Chips(props: { items: readonly string[]; empty?: string; className?: string }) {
  const rowRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(props.items.length);
  const signature = props.items.join('|');

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) {
      return;
    }
    // Measuring is the point of the effect, not a side effect of rendering:
    // the widths only exist once the browser has laid the clone out.
    const compute = () => {
      const nodes = Array.from(measure.children) as HTMLElement[];
      const more = nodes.pop();
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setVisible(fitChips(nodes.map(n => n.offsetWidth), row.clientWidth, more?.offsetWidth ?? 0, GAP));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(row);
    return () => ro.disconnect();
  }, [signature]);

  if (props.items.length === 0) {
    return <span className="text-[13px] text-muted-foreground/70">{props.empty ?? 'none'}</span>;
  }

  const shown = props.items.slice(0, visible);
  const hidden = props.items.slice(visible);

  return (
    <span ref={rowRef} className={cn('relative flex min-w-0 items-center gap-1 overflow-hidden', props.className)}>
      {shown.map(label => <Chip key={label} label={label} />)}
      {hidden.length > 0 && (
        <span
          title={hidden.join(', ')}
          className="inline-flex h-6 shrink-0 items-center rounded border border-dashed border-border px-2 text-[12px] text-muted-foreground tabular-nums"
        >
          {`+${hidden.length}`}
        </span>
      )}
      {/* Off-screen copy at full width, so the widths measured are the real
          ones rather than the clipped ones. */}
      <span ref={measureRef} aria-hidden className="pointer-events-none invisible absolute flex gap-1" style={{ left: -9999 }}>
        {props.items.map(label => <Chip key={label} label={label} />)}
        <span className="inline-flex h-6 shrink-0 items-center rounded border border-dashed px-2 text-[12px] tabular-nums">
          {`+${props.items.length}`}
        </span>
      </span>
    </span>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span
      title={label}
      className="inline-flex h-6 shrink-0 items-center rounded border border-border/70 bg-surface-soft px-2 text-[12px] whitespace-nowrap text-foreground/80"
    >
      {label}
    </span>
  );
}
