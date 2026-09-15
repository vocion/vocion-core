import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { ListRows } from '@/components/ui/list-row';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/**
 * ListRow — the data row of the List archetype. One record per row: a title,
 * a subline of segments, right-aligned columns of fixed width so numbers line
 * up down the list, a status or verdict chip, and actions that appear on
 * hover or focus. 44px tall, hairline-divided by `<ListRows>` (from
 * `components/ui/list-row`), hover a soft fill, keyboard-focusable.
 *
 * `components/ui/list-row`'s `ListRow` stays the catalog row (icon · title ·
 * meta · chevron) for Skills, Tools, Learnings. This one is for records with
 * numbers and a state — leads, runs, entries. They share the container, the
 * tokens and the height, so a page mixing them reads as one list.
 */

export { ListRows };

/**
 * The column widths every list uses, so a score on the personalization list
 * sits exactly where a score on the ledger does. Numbers are `tabular-nums`
 * and right-aligned; text columns left-aligned. Pick by meaning, not by
 * measuring.
 */
export const COLUMN = {
  /** A 0..1 score with its label: "speculative 0.42". */
  score: 'w-32',
  /** A count or a percentage. */
  number: 'w-16',
  /** "Aug 24", "Sep 1, 2026". */
  date: 'w-24',
  /** A short status word. */
  status: 'w-28',
  /** A chip. */
  chip: 'w-24',
} as const;

export type ColumnKind = keyof typeof COLUMN;

/**
 * One right column. Hidden below `sm` unless `always`, because a phone has
 * room for the title and the chip and not much else.
 * @param props
 * @param props.kind - Which width convention this column takes.
 * @param props.align - Numbers right, text left. Default right.
 * @param props.mono
 * @param props.always - Keep the column on phones.
 * @param props.children
 * @param props.className
 */
export function Column(props: {
  kind: ColumnKind;
  align?: 'left' | 'right';
  mono?: boolean;
  always?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-column={props.kind}
      className={cn(
        'shrink-0 truncate text-[13px] text-muted-foreground tabular-nums',
        COLUMN[props.kind],
        props.align === 'left' ? 'text-left' : 'text-right',
        props.mono && 'font-mono text-[12px]',
        !props.always && 'hidden sm:inline-block',
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}

/**
 * The subline: segments joined by a separator, as one text node, truncated.
 * `›` for a hierarchy (workspace › team › agent), `·` for a list of facts
 * (title · company · arrived Aug 24). Empty segments are dropped so a
 * missing fact leaves no dangling separator.
 * @param props
 * @param props.segments
 * @param props.separator
 * @param props.className
 */
export function Subline(props: { segments: ReadonlyArray<ReactNode | null | undefined | false>; separator?: '›' | '·'; className?: string }) {
  const parts = props.segments.filter((s): s is ReactNode => s !== null && s !== undefined && s !== false && s !== '');
  if (parts.length === 0) {
    return null;
  }
  const sep = ` ${props.separator ?? '›'} `;
  // Strings join into one node so a test (or a screen reader) reads one line.
  if (parts.every(p => typeof p === 'string' || typeof p === 'number')) {
    return <span className={cn('block truncate text-[13px] text-muted-foreground', props.className)}>{parts.join(sep)}</span>;
  }
  return (
    <span className={cn('block truncate text-[13px] text-muted-foreground', props.className)}>
      {parts.map((p, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <span key={i}>
          {i > 0 && <span aria-hidden>{sep}</span>}
          {p}
        </span>
      ))}
    </span>
  );
}

export type ListRowProps = {
  /** A row that navigates. */
  'href'?: string;
  /** A row that acts in place. Ignored when `href` is set. */
  'onClick'?: () => void;
  'icon'?: LucideIcon;
  'title': ReactNode;
  /** `<Subline>` or any one-line node under the title. */
  'subline'?: ReactNode;
  /** `<Column>`s, right-aligned, in a fixed order per page. */
  'columns'?: ReactNode;
  /** A status pill, a verdict badge — the row's state, always visible. */
  'chip'?: ReactNode;
  /** Appear on hover and focus-within; always visible on touch. */
  'actions'?: ReactNode;
  /** Trailing chevron for navigational rows. Default: on when `href` is set. */
  'chevron'?: boolean;
  'className'?: string;
  'data-testid'?: string;
};

export function ListRow(props: ListRowProps) {
  const Icon = props.icon;
  const chevron = props.chevron ?? Boolean(props.href);
  const body = (
    <>
      {Icon && (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-soft text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{props.title}</span>
        {props.subline}
      </span>
      {props.columns}
      {props.chip && <span className="shrink-0">{props.chip}</span>}
      {props.actions && (
        <span
          data-slot="row-actions"
          className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
        >
          {props.actions}
        </span>
      )}
      {chevron && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden />}
    </>
  );
  const classes = cn(
    'group flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
    props.className,
  );
  if (props.href) {
    return <Link href={props.href} data-pattern="list-row" data-testid={props['data-testid']} className={classes}>{body}</Link>;
  }
  if (props.onClick) {
    return <button type="button" onClick={props.onClick} data-pattern="list-row" data-testid={props['data-testid']} className={classes}>{body}</button>;
  }
  return <div data-pattern="list-row" data-testid={props['data-testid']} className={classes}>{body}</div>;
}
