'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { ConfidenceBars } from '@/components/ui/confidence-indicator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/**
 * The Detail archetype — one record on its own URL. A breadcrumb with
 * context, the record as the H1, ONE meta row of facts, then hairline-divided
 * sections with an optional right column that drops under the content on a
 * phone, and the decision in a `StickyActionBar` that never scrolls away.
 * No outer card. See `docs/design/patterns.md` § Detail.
 */

export type Crumb = { label: string; href?: string };

/**
 * DetailPage — the frame. Sets `document.title` to the record so the tab and
 * the shell breadcrumb say what this page is.
 * @param props
 * @param props.crumbs - Workspace › section › record. The last crumb is plain.
 * @param props.title - The record's name, as the H1.
 * @param props.subtitle - Role · company, or the one line under the name.
 * @param props.meta - A `<DetailMeta>`.
 * @param props.actions - The right cluster on the title row: Back, Up next, a shortcuts hint. Not the decision — that is `bar`.
 * @param props.aside - The right column (`<RightColumn>`). Drops under the content below `@3xl`.
 * @param props.children - The sections.
 * @param props.bar - The `<StickyActionBar>`, rendered after the columns so it spans the page.
 * @param props.className
 */
export function DetailPage(props: {
  'crumbs': readonly Crumb[];
  'title': string;
  'subtitle'?: ReactNode;
  'meta'?: ReactNode;
  'actions'?: ReactNode;
  'aside'?: ReactNode;
  'children': ReactNode;
  'bar'?: ReactNode;
  'className'?: string;
  'data-testid'?: string;
}) {
  const { title, crumbs } = props;
  const section = crumbs.length >= 2 ? crumbs[crumbs.length - 2]!.label : undefined;
  useEffect(() => {
    const prev = document.title;
    document.title = section ? `${title} · ${section}` : title;
    return () => {
      document.title = prev;
    };
  }, [title, section]);

  return (
    // Its own `@container`: the column breakpoint reads the width this page
    // actually has — beside an open conversation rail, not the whole shell.
    <div data-pattern="detail-page" data-testid={props['data-testid']} className={cn('@container relative flex flex-col', props.className)}>
      <header className="border-b border-rule pb-5" data-pattern="detail-header">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={`${c.href ?? ''}|${c.label}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />}
              {c.href
                ? <Link href={c.href} className="truncate transition hover:text-foreground">{c.label}</Link>
                : <span className={cn('truncate', i === crumbs.length - 1 && 'text-foreground/80')}>{c.label}</span>}
            </span>
          ))}
        </nav>
        {/*
          The title and the controls share one wrapping flex line, and the
          title's BASIS is what makes the wrap real.

          `flex-1` alone means `flex-basis: 0`: an item with a zero basis has a
          hypothetical main size of zero, never contributes to the line's
          overflow, and so the line never wraps — while a `shrink-0` cluster
          beside it takes every pixel it wants out of the title, down to its
          `min-w-0` floor. That is how a 22px heading ends up 215px wide and
          broken one phrase per line on a page with 800px spare. Neither a
          `min-width` on the H1 nor a `max-width` on the cluster fixes it; they
          only move where the squeeze lands.

          So: the title gets a real basis (20rem), which is the width below
          which the line is genuinely too tight and the controls should drop to
          their own row; and the cluster may shrink, so its own truncating
          labels truncate instead of pushing.
        */}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 basis-80">
            <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em] text-balance">{title}</h1>
            {props.subtitle && <p className="mt-1 text-sm text-muted-foreground">{props.subtitle}</p>}
          </div>
          {props.actions && <div className="flex min-w-0 shrink flex-wrap items-center gap-2 text-[13px] text-muted-foreground sm:flex-nowrap">{props.actions}</div>}
        </div>
        {props.meta}
      </header>

      <DetailColumns aside={props.aside}>{props.children}</DetailColumns>

      {props.bar}
    </div>
  );
}

/**
 * DetailColumns — content beside a right column at `@3xl` and above, the
 * column under the content below that. The grid the order test reads
 * (`.grid` → two children, content first).
 * @param props
 * @param props.aside
 * @param props.children
 * @param props.className
 */
export function DetailColumns(props: { aside?: ReactNode; children: ReactNode; className?: string }) {
  // `grow`: on a page that sets a min-height, the columns fill what is left of
  // it, so the sticky bar lands at the bottom of the SCREEN instead of under
  // whichever section happens to be open. On a page that sets none there is no
  // free space to take, so it changes nothing.
  if (!props.aside) {
    return <div data-pattern="detail-columns" className={cn('min-w-0 grow', props.className)}>{props.children}</div>;
  }
  return (
    <div data-pattern="detail-columns" className={cn('@container grid grow gap-x-10 gap-y-2 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]', props.className)}>
      <div className="min-w-0">{props.children}</div>
      {props.aside}
    </div>
  );
}

/**
 * RightColumn — the evidence column: Confidence, Timeline, CRM context, the
 * structured facts beside the argument. `<Section>`s inside, stacked.
 * @param props
 * @param props.children
 * @param props.label - Accessible name.
 * @param props.className
 */
export function RightColumn(props: { children: ReactNode; label?: string; className?: string }) {
  return (
    <aside aria-label={props.label ?? 'Context'} data-pattern="right-column" className={cn('min-w-0 @3xl:border-l @3xl:border-rule @3xl:pl-8', props.className)}>
      {props.children}
    </aside>
  );
}

/**
 * DetailMeta — the one meta row under the H1: facts separated by middots.
 * Absent facts leave no gap. Pass `<MetaChip>`, `<StatusDot>`,
 * `<ConfidenceMeter>`, plain text — anything short.
 * @param props
 * @param props.items - In reading order. Null and false are skipped.
 * @param props.className
 */
export function DetailMeta(props: { items: ReadonlyArray<ReactNode | null | undefined | false>; className?: string }) {
  const items = props.items.filter((n): n is ReactNode => n !== null && n !== undefined && n !== false);
  if (items.length === 0) {
    return null;
  }
  return (
    <div data-pattern="detail-meta" className={cn('mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted-foreground', props.className)}>
      {items.map((node, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <span key={i} className="inline-flex items-center gap-x-2">
          {typeof node === 'string' || typeof node === 'number' ? <span>{node}</span> : node}
          {i < items.length - 1 && <span aria-hidden className="text-muted-foreground/50">·</span>}
        </span>
      ))}
    </div>
  );
}

/**
 * MetaChip — the eyebrow: the system ("PERSONALIZATION"), or a small link
 * out ("Open in HubSpot ↗"). Uppercase tracking for a system, sentence case
 * with an underline for a link.
 * @param props
 * @param props.children
 * @param props.href - External href; renders an anchor that opens in a new tab.
 * @param props.className
 */
export function MetaChip(props: { children: ReactNode; href?: string; className?: string }) {
  if (props.href) {
    return (
      <a href={props.href} target="_blank" rel="noopener noreferrer" className={cn('underline decoration-border underline-offset-2 transition hover:text-foreground hover:decoration-foreground', props.className)}>
        {props.children}
      </a>
    );
  }
  return <span className={cn('text-[12px] font-medium tracking-wide text-foreground/70 uppercase', props.className)}>{props.children}</span>;
}

export type DotTone = 'pass' | 'amber' | 'fail' | 'neutral' | 'ink';

const DOT: Record<DotTone, string> = {
  pass: 'bg-brand-pass',
  amber: 'bg-brand-borderline',
  fail: 'bg-brand-fail',
  neutral: 'bg-muted-foreground/50',
  ink: 'bg-foreground',
};

/**
 * StatusDot — a 6px dot and a word: "● Ready for review".
 * @param props
 * @param props.tone
 * @param props.label
 * @param props.className
 */
export function StatusDot(props: { tone: DotTone; label: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', props.className)} data-pattern="status-dot">
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT[props.tone])} aria-hidden />
      {props.label}
    </span>
  );
}

/**
 * ConfidenceMeter — the meta row's confidence, drawn by the one component that
 * draws every confidence (`components/ui/ConfidenceBars`). This is the
 * Detail-archetype wrapper: it adds the rationale tooltip and the optional
 * second reading (alignment), and nothing else — the bars, the colours and the
 * ladder all come from the shared component, so a change there changes every
 * surface at once.
 * @param props
 * @param props.value - 0..1.
 * @param props.label - What the confidence is IN — the class, the verdict. Shown before the reading.
 * @param props.format - `score` renders "0.60", `percent` renders "60%". Default percent.
 * @param props.rationale - The model's reason, shown in the tooltip.
 * @param props.readingHidden
 * @param props.alignment - A second 0..1 reading ("alignment 0.91"), when measured.
 * @param props.className
 */
export function ConfidenceMeter(props: {
  value: number;
  label?: string;
  format?: 'percent' | 'score';
  rationale?: string | null;
  /** Bars only, the reading in the tooltip — for a dense meta row. */
  readingHidden?: boolean;
  alignment?: { value: number; label?: string } | null;
  className?: string;
}) {
  const body = (
    <>
      <ConfidenceBars value={props.value} subject={props.label} format={props.format} size="md" readingHidden={props.readingHidden} />
      {props.alignment && (
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {`· ${props.alignment.label ?? 'alignment'} ${Math.round(props.alignment.value * 100)}%`}
        </span>
      )}
    </>
  );
  const classes = cn('inline-flex items-center gap-1.5', props.className);
  if (!props.rationale) {
    return <span className={classes} data-pattern="confidence-meter" data-testid="confidence-meter">{body}</span>;
  }
  // The rationale opens on hover and on focus; a button so the keyboard reaches it.
  const meter = (
    <button type="button" className={cn(classes, 'cursor-help rounded-sm focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none')} data-pattern="confidence-meter" data-testid="confidence-meter">
      {body}
    </button>
  );
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{meter}</TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-left leading-relaxed">{props.rationale}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Section — an eyebrow label, a hairline, the content. Sections stack with
 * hairlines between them; none has a border of its own. `action` sits at the
 * eyebrow's right — a ghost verb ("View research", "Edit all"), never the
 * page's primary.
 *
 * **A section is a commentable region.** It carries `data-comment-field`,
 * named by its eyebrow, which is the whole opt-in for select-to-talk
 * (`docs/design/patterns.md` § Select → talk): wrap a Detail page in a
 * `CommentLayerProvider` and every section in it becomes selectable, with no
 * per-section wiring and no page inventing a control of its own. The
 * attribute is inert without a provider above — it is an id, not behaviour —
 * so it costs nothing on the pages that have not opted in.
 *
 * Pass `commentField` to name the region something other than the eyebrow
 * (an eyebrow that is a `ReactNode`, or two sections that would collide), or
 * `null` to opt a section out.
 * @param props
 * @param props.eyebrow - The label, sentence case.
 * @param props.action
 * @param props.children
 * @param props.tone - `quiet` for the right column: tighter padding.
 * @param props.className
 * @param props.id
 * @param props.commentField - Region name for select-to-talk; `null` opts out.
 */
export function Section(props: {
  'eyebrow': ReactNode;
  'action'?: ReactNode;
  'children': ReactNode;
  'tone'?: 'default' | 'quiet';
  'className'?: string;
  'aria-label'?: string;
  'id'?: string;
  'data-testid'?: string;
  'commentField'?: string | null;
}) {
  const quiet = props.tone === 'quiet';
  // The eyebrow IS the region's name when it is a plain string; a composed
  // eyebrow has to be named explicitly rather than stringified into
  // something an anchor cannot be resolved against later.
  const commentField = props.commentField === null
    ? undefined
    : props.commentField ?? (typeof props.eyebrow === 'string' ? props.eyebrow : undefined);
  return (
    <section
      id={props.id}
      aria-label={props['aria-label']}
      data-pattern="section"
      data-testid={props['data-testid']}
      data-comment-field={commentField}
      className={cn('border-b border-rule last:border-b-0', quiet ? 'py-4' : 'py-6', props.className)}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{props.eyebrow}</h3>
        {props.action && <div className="shrink-0 text-[13px]">{props.action}</div>}
      </div>
      <div className={cn('text-sm', quiet && 'text-[13px]')}>{props.children}</div>
    </section>
  );
}

export type Fact = { label: ReactNode; value: ReactNode; href?: string; key?: string };

/**
 * FactList — label/value pairs. `rows`: label left in a fixed column, value
 * right, hairlines between (the content column). `column`: label over value,
 * stacked (the right column, where there is no width for two columns).
 * @param props
 * @param props.facts
 * @param props.layout
 * @param props.className
 */
/** Anything falsy is skipped, so `cond && { label, value }` reads naturally. */
export type Maybe<T> = T | null | undefined | false | '' | 0;

export function FactList(props: { facts: ReadonlyArray<Maybe<Fact>>; layout?: 'rows' | 'column'; className?: string }) {
  const facts = props.facts.filter((f): f is Fact => Boolean(f));
  if (facts.length === 0) {
    return null;
  }
  const value = (f: Fact) => f.href
    ? <a href={f.href} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground">{f.value}</a>
    : f.value;
  if (props.layout === 'column') {
    return (
      <dl data-pattern="fact-list" className={cn('flex flex-col gap-2.5', props.className)}>
        {facts.map((f, i) => (
          <div key={f.key ?? (typeof f.label === 'string' ? f.label : i)}>
            <dt className="text-[12px] text-muted-foreground">{f.label}</dt>
            <dd className="text-sm break-words text-foreground">{value(f)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl data-pattern="fact-list" className={cn('divide-y divide-rule', props.className)}>
      {facts.map((f, i) => (
        <div key={f.key ?? (typeof f.label === 'string' ? f.label : i)} className="flex gap-4 py-2 text-sm">
          <dt className="w-32 shrink-0 text-[12px] leading-5 text-muted-foreground">{f.label}</dt>
          <dd className="min-w-0 flex-1 break-words text-foreground">{value(f)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Accordion — rows for sub-items (the sends of a sequence): a header line
 * that opens the body underneath. Controlled by `open`, or self-managed with
 * `defaultOpen`. "Edit all" on the Section opens every row at once via
 * `open`.
 */
export type AccordionItem = {
  id: string;
  /** The row's leading label — "Day 0", "Send 2". */
  label: ReactNode;
  /** The title — a subject line. */
  title: ReactNode;
  /** A short trailing fact — "edited", "3 paragraphs". */
  meta?: ReactNode;
  children: ReactNode;
};

export function Accordion(props: {
  items: readonly AccordionItem[];
  /** Controlled: the ids currently open. */
  open?: readonly string[];
  onToggle?: (id: string, open: boolean) => void;
  className?: string;
}) {
  return (
    <div data-pattern="accordion" className={cn('divide-y divide-rule', props.className)}>
      {props.items.map(item => (
        <AccordionRow key={item.id} item={item} open={props.open?.includes(item.id) ?? false} onToggle={props.onToggle} />
      ))}
    </div>
  );
}

function AccordionRow(props: { item: AccordionItem; open: boolean; onToggle?: (id: string, open: boolean) => void }) {
  const { item, open } = props;
  return (
    <div data-pattern="accordion-row" data-state={open ? 'open' : 'closed'}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => props.onToggle?.(item.id, !open)}
        className="flex min-h-11 w-full items-center gap-3 rounded-md px-1 py-2 text-left transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground/60 transition-transform', open && 'rotate-90')} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="text-muted-foreground">{item.label}</span>
          <span className="text-muted-foreground/60"> · </span>
          <span className="font-medium text-foreground">{item.title}</span>
        </span>
        {item.meta && <span className="shrink-0 text-[12px] text-muted-foreground">{item.meta}</span>}
      </button>
      {open && <div className="pb-4 pl-7">{item.children}</div>}
    </div>
  );
}
