import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/**
 * StatRow and Stat: the one row of headline numbers (design patterns,
 * 2026-10-23). Numbers in a row between hairlines, no fills and no cards
 * (the airy pass, B-034b §4); columns auto-fit, so a figure that is not there
 * leaves no gap (a missing capability makes the interface smaller, never a
 * blank tile). It replaced nine hand-rolled stat blocks (`StatCard`,
 * `HeadlineRow`'s `Stat`, the observability and metrics rows…).
 *
 * A stat prefers a trend to an explanation: `delta` ("18%", down, good) says
 * how it moved; `note` is one quiet line for what the number covers. Colour
 * is the trend's meaning only (`pass` when the move is good, `fail` when it is
 * bad), never the number itself.
 * @param props
 * @param props.children
 * @param props.className
 */
export function StatRow(props: { 'children': ReactNode; 'className'?: string; 'aria-label'?: string; 'data-testid'?: string }) {
  return (
    <dl
      data-pattern="stat-row"
      data-testid={props['data-testid']}
      aria-label={props['aria-label']}
      className={cn('grid gap-x-8 gap-y-5 border-y border-border py-5 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]', props.className)}
    >
      {props.children}
    </dl>
  );
}

export type StatDelta = {
  /** The move as people say it: "18%", "3", "$1.2k". */
  value: string;
  direction: 'up' | 'down';
  /** Whether the move is good news: pass, bad news: fail, or neither. */
  tone?: 'pass' | 'fail' | 'neutral';
  /** What the move is against: "vs last week". */
  against?: string;
};

export function Stat(props: {
  'label': ReactNode;
  'value': ReactNode;
  'delta'?: StatDelta | null;
  'note'?: ReactNode;
  /** The record or page behind the number, one move away (principle 10). */
  'href'?: string;
  'className'?: string;
  'data-testid'?: string;
  /** A stable name for the figure, for a test or a link to find it by. */
  'id'?: string;
}) {
  const d = props.delta;
  const Arrow = d?.direction === 'down' ? ArrowDownRight : ArrowUpRight;
  const value = <span className="text-[26px] leading-none font-semibold tracking-tight text-foreground tabular-nums">{props.value}</span>;
  return (
    <div data-pattern="stat" data-stat={props.id} data-testid={props['data-testid']} className={cn('min-w-0', props.className)}>
      <dt className="text-[12px] text-muted-foreground">{props.label}</dt>
      <dd className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {props.href ? <Link href={props.href} className="rounded-sm hover:underline hover:decoration-border hover:underline-offset-4">{value}</Link> : value}
        {d && (
          <span className={cn('inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums', d.tone === 'pass' ? 'text-pass' : d.tone === 'fail' ? 'text-fail' : 'text-muted-foreground')}>
            <Arrow className="size-3.5" strokeWidth={2} aria-hidden />
            {d.value}
            {d.against && <span className="font-normal text-muted-foreground">{` ${d.against}`}</span>}
          </span>
        )}
      </dd>
      {props.note && <dd className="mt-1 text-[12px] leading-snug text-muted-foreground">{props.note}</dd>}
    </div>
  );
}
