import type { LucideIcon } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/**
 * ListRow — THE row. Every list in the dashboard renders its records through
 * this one component: an optional icon, a title, a subline of segments,
 * right-aligned columns of fixed width so numbers line up down the list, a
 * status or verdict chip, and actions that appear on hover or focus. At least
 * 44px tall, hairline-divided by `<ListRows>`, hover a soft fill,
 * keyboard-focusable.
 *
 * Chris, 2026-09-15: "it feels like we're getting a lot of different
 * row/table/record treatments… THIS SHOULD FEEL LIKE ONE APPLICATION NOT
 * FIVE." There used to be a second row component in `components/ui/list-row`
 * for catalog pages; it is gone, and its consumers render through this. A new
 * page that wants a different row shape extends this one (manifesto §19) or
 * says why in its PR. See `docs/design/patterns.md` § One list.
 */

/**
 * The rows' container: it draws the hairlines between them and nothing else.
 * @param props
 * @param props.children
 * @param props.className
 */
export function ListRows(props: { children: ReactNode; className?: string }) {
  return (
    <div data-slot="list-rows" data-pattern="list-rows" className={cn('divide-y divide-border/70', props.className)}>
      {props.children}
    </div>
  );
}

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
  /** Money with its currency: "$12,500". */
  amount: 'w-20',
  /** "Aug 24", "Sep 1, 2026". */
  date: 'w-24',
  /** A short status word. */
  status: 'w-28',
  /** A chip. */
  chip: 'w-24',
} as const;

export type ColumnKind = keyof typeof COLUMN;

const SUBLINE = 'mt-0.5 block truncate text-[13px] text-muted-foreground';

const ROW = 'group flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none';

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
    return <span className={cn(SUBLINE, props.className)}>{parts.join(sep)}</span>;
  }
  return (
    <span className={cn(SUBLINE, props.className)}>
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
  /**
   * A row that PREVIEWS rather than navigates. Set it alongside `href` and a
   * plain left-click previews while the row stays a real link: ⌘/Ctrl-click,
   * middle-click, Open-in-new-tab and a copied address all still go to the
   * page. A list declares this once for every row — never per row.
   *
   * Which a list is: see `docs/design/patterns.md` § *A row is a reference, or
   * it is the task*.
   */
  'onSelect'?: () => void;
  /** Marks the row the preview is currently showing. */
  'selected'?: boolean;
  'icon'?: LucideIcon;
  'title': ReactNode;
  /** `<Subline>` or any one-line node under the title. Raw nodes get the subline's type and spacing. */
  'subline'?: ReactNode;
  /** `<Column>`s, right-aligned, in a fixed order per page. Facts only — they sit INSIDE the row link, so the whole row is one click target. */
  'columns'?: ReactNode;
  /**
   * The same `<Column>`s, for a row whose columns carry their own link or
   * control — a chip that opens the document, a toggle. They render BESIDE
   * the row link, exactly where `actions` already do, because an anchor or a
   * button inside an anchor is invalid HTML: the browser closes the outer
   * link at that point and hydration fails (`<a> cannot be a descendant of
   * <a>`, /gtm/proposals, 2026-09-19).
   *
   * Pass a row's WHOLE set of columns here when ANY one of them is
   * interactive, so the columns stay in the one order the list reads down.
   * Same widths, same alignment — `columns` and `columnsAside` are the same
   * shape, and which one a row uses is decided by one question: does a column
   * click through to somewhere of its own?
   */
  'columnsAside'?: ReactNode;
  /** A status pill, a verdict badge — the row's state, always visible. */
  'chip'?: ReactNode;
  /** Appear on hover and focus-within; always visible on touch. */
  'actions'?: ReactNode;
  /** Trailing chevron for navigational rows. Default: on when `href` is set. */
  'chevron'?: boolean;
  'className'?: string;
  'data-testid'?: string;
};

/**
 * A click that means "take me there" rather than "show me": a modifier, or
 * any button but the primary one.
 * @param e
 */
function wantsNavigation(e: MouseEvent<HTMLElement>): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

export function ListRow(props: ListRowProps) {
  const Icon = props.icon;
  const chevron = props.chevron ?? Boolean(props.href);
  const { onSelect } = props;
  // The row stays an anchor so the browser's own "go there" gestures keep
  // working; only the plain click is taken for the preview.
  const intercept = onSelect
    ? (e: MouseEvent<HTMLElement>) => {
        if (wantsNavigation(e)) {
          return;
        }
        e.preventDefault();
        onSelect();
      }
    : undefined;
  const chip = props.chip && <span className="shrink-0">{props.chip}</span>;
  const content = (
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
      {!props.columnsAside && chip}
    </>
  );
  const actions = props.actions && (
    <span
      data-slot="row-actions"
      className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
    >
      {props.actions}
    </span>
  );
  // Columns then chip then actions, whichever side of the link boundary they
  // fall on: a list reads down its columns, and the boundary must not reorder
  // them. So a row with `columnsAside` carries its chip out here too.
  const tail = (
    <>
      {props.columnsAside}
      {props.columnsAside && chip}
      {actions}
      {chevron && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden />}
    </>
  );
  const classes = cn(ROW, props.selected && 'bg-surface-soft', props.className);

  // A row with actions — or with a column that links somewhere of its own —
  // cannot put them inside its link: an anchor or a button nested in an anchor
  // is invalid HTML, the browser closes the outer link there, and React's
  // hydration fails on it. The link covers the record (icon, title, inert
  // columns, chip); everything that clicks through to somewhere else sits
  // beside it.
  if (props.href && (props.actions || props.columnsAside)) {
    return (
      <div data-pattern="list-row" data-testid={props['data-testid']} className={classes}>
        <Link href={props.href} onClick={intercept} aria-current={props.selected ? 'true' : undefined} aria-label={typeof props.title === 'string' ? props.title : undefined} className="flex min-w-0 flex-1 items-center gap-3 outline-none">
          {content}
        </Link>
        {tail}
      </div>
    );
  }
  if (props.href) {
    return (
      <Link href={props.href} onClick={intercept} aria-current={props.selected ? 'true' : undefined} data-pattern="list-row" data-testid={props['data-testid']} className={classes}>
        {content}
        {tail}
      </Link>
    );
  }
  if (props.onClick ?? onSelect) {
    return (
      <button type="button" onClick={props.onClick ?? onSelect} aria-current={props.selected ? 'true' : undefined} data-pattern="list-row" data-testid={props['data-testid']} className={classes}>
        {content}
        {tail}
      </button>
    );
  }
  return (
    <div data-pattern="list-row" data-testid={props['data-testid']} className={classes}>
      {content}
      {tail}
    </div>
  );
}
