'use client';

import type { ReactNode } from 'react';
import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { ConfidenceMeter } from '@/components/patterns';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/**
 * The decision-screen header every kind on "Review queue" shares: a breadcrumb
 * with context (Workspace › Review queue › kind › record), the item as the H1
 * ("Enroll MQL in sequence — Dev Okonkwo · Vantage Automation"), and ONE meta row —
 * system · status · who proposed or asked · confidence as an inline meter ·
 * how often people agreed with this agent on this kind · what the agent
 * suggests · where you are in the queue — with Back and "Next: …" on the
 * right. A proposal, an ask, a stopped run and a suggested rule all read the
 * same way; only what sits under the header differs.
 *
 * Sets `document.title` to the H1 so the browser tab (and a shell breadcrumb
 * that reads the title) say what this page is. Chris, 2026-09-15: "better page
 * titles and breadcrumbs with context."
 */

const STATUS_LABEL: Record<string, string> = {
  pending: 'Ready for review',
  open: 'Waiting on you',
  approved: 'Approved',
  executing: 'Executing',
  done: 'Done',
  failed: 'Failed',
  rejected: 'Declined',
  paused: 'Paused',
  awaiting_review: 'Awaiting review',
  lost: 'Lost',
  cancelled: 'Cancelled',
  completed: 'Completed',
  superseded: 'Superseded',
};

const RED_STATUSES = new Set(['failed', 'lost', 'rejected', 'cancelled']);

const SUGGESTION: Record<SuggestedDecision, { label: string; className: string }> = {
  approve: { label: 'Agent suggests approving', className: 'text-emerald-700 dark:text-emerald-300' },
  reject: { label: 'Agent suggests turning down', className: 'text-rose-700 dark:text-rose-300' },
  snooze: { label: 'Agent suggests waiting', className: 'text-muted-foreground' },
};

export function ReviewHeader(props: {
  crumbs: Array<{ label: string; href?: string }>;
  title: string;
  /** The record the item is about; the H1 already names it, so this line carries role, company and the deep link. */
  subject?: { name: string; role?: string; company?: string; href?: string };
  /**
   * One line under the H1 naming what this record IS — "Discovery assessment ·
   * Sep 14, 11:30 AM". Set it when the H1 is the object's own name rather than
   * a description of the decision; `subject` still renders its deep link.
   */
  subtitle?: string;
  system?: string;
  status: string;
  proposedBy?: string | null;
  confidence?: number;
  /**
   * What the confidence is IN — the class or the recommendation it scores.
   * A number beside a verdict it does not belong to is the defect
   * `docs/specs/discovery-ledger-v2.md` is about, so the meter takes it.
   */
  confidenceSubject?: string;
  /**
   * How often this agent's recommendations of this kind matched what the
   * person decided (30d). Confidence says how sure the agent is; this says how
   * often people agreed with it. Rendered right after the meter, and not at
   * all until there is at least one decided recommendation.
   */
  alignment?: { agreementRate: number | null; n: number; window: string } | null;
  suggestion?: SuggestedDecision;
  /** "3 of 213" */
  position?: string;
  /** The Up-next control. */
  upNext?: ReactNode;
  /** Anything else for the right cluster — the shortcuts hint. */
  extra?: ReactNode;
  onBack?: () => void;
  canBack?: boolean;
}) {
  const t = useTranslations('Review');
  const tInbox = useTranslations('Inbox');
  const surface = tInbox('title');
  const { crumbs, title, subject } = props;
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · ${surface}`;
    return () => {
      document.title = prev;
    };
  }, [title, surface]);
  const suggestion = props.suggestion ? SUGGESTION[props.suggestion] : undefined;

  const subline = subject ? [subject.role, subject.company].filter(Boolean).join(' · ') : '';

  // The meta row, as a list of facts separated by middots. Absent facts leave
  // no gap.
  //
  // Chris, 2026-09-17: *"make this bar more concise or visual or… less text?,
  // but with discoverable hover/tooltip if helpful"*. So the grammar goes and
  // the facts stay: "recommended by revenue-lead" is one fact wearing three words,
  // "Recommendation 65%" names the thing the whole page already is, and
  // "(n=9, 30d)" is the working behind the number. Each keeps its full sentence
  // in a tooltip — which is the reduction pass exactly: show the reading, put
  // the workings one hover behind it.
  const meta: ReactNode[] = [];
  if (props.system) {
    meta.push(<span key="system" className="text-[12px] font-medium tracking-wide text-foreground/70 uppercase">{props.system}</span>);
  }
  meta.push(
    <span key="status" className="inline-flex items-center gap-1.5">
      <span className={cn('size-1.5 rounded-full', RED_STATUSES.has(props.status) ? 'bg-red-500' : props.status === 'paused' || props.status === 'awaiting_review' ? 'bg-amber-500' : 'bg-emerald-500')} aria-hidden />
      {STATUS_LABEL[props.status] ?? props.status}
    </span>,
  );
  if (props.proposedBy) {
    const agent = props.proposedBy.replace('agent:', '');
    meta.push(<span key="by" title={`Recommended by ${agent}`}>{agent}</span>);
  }
  if (props.confidence !== undefined) {
    // Never a bare score: the meter carries what the confidence is IN.
    meta.push(<ConfidenceMeter key="confidence" value={props.confidence} label={props.confidenceSubject} readingHidden />);
  }
  const alignmentRate = props.alignment && props.alignment.n > 0 ? props.alignment.agreementRate : null;
  if (props.alignment && alignmentRate !== null) {
    const a = props.alignment;
    meta.push(
      <span
        key="alignment"
        className="tabular-nums"
        data-testid="alignment-score"
        title={`You have agreed with this agent ${Math.round(alignmentRate * 100)}% of the time — ${a.n} decided recommendation${a.n === 1 ? '' : 's'} of this kind in the last ${a.window === 'all' ? 'all time' : a.window}`}
      >
        {`${Math.round(alignmentRate * 100)}% aligned`}
      </span>,
    );
  }
  if (suggestion) {
    meta.push(<span key="suggestion" className={cn('font-medium', suggestion.className)}>{suggestion.label}</span>);
  }
  if (props.position) {
    meta.push(<span key="position" className="tabular-nums" data-testid="queue-position">{props.position}</span>);
  }

  return (
    <header className="mb-2 border-b border-rule pb-5" data-testid="review-header">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
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
        The title and the queue controls share one wrapping flex line, and the
        title's basis is what makes the wrap real.

        The bug this replaces: the title block was `flex-1`, i.e.
        `flex-basis: 0`. A flex item with a zero basis has a hypothetical main
        size of zero, so it never contributes to the line's overflow and the
        line NEVER wraps — while the control cluster beside it was
        `sm:shrink-0`. Every pixel the Up-next label wanted therefore came out
        of the title, down to its `min-w-0` floor: the H1 collapsed to about
        150px and broke one word per line on a page with room to spare. Neither
        a `min-width` on the H1 nor a `max-width` on the cluster fixes that —
        they just move where the squeeze lands.

        So: the title gets a real basis (20rem), which is the width below which
        the line is genuinely too tight and the controls should drop to their
        own row; and the cluster is allowed to shrink, so its already-`truncate`d
        Up-next label truncates instead of pushing.
      */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em] text-balance">{title}</h1>
          {props.subtitle && <p className="mt-1 text-sm text-muted-foreground">{props.subtitle}</p>}
          {subject && (subline || subject.href) && (
            <p className="mt-1 text-sm text-muted-foreground">
              {subline}
              {subject.href && (
                <a href={subject.href} target="_blank" rel="noreferrer" className={cn('underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground', subline && 'ml-2')}>
                  {`Open ${subject.name} ↗`}
                </a>
              )}
            </p>
          )}
        </div>
        <div className="flex min-w-0 shrink flex-wrap items-center gap-2 text-[13px] text-muted-foreground sm:flex-nowrap">
          {props.canBack !== undefined && (
            <button
              type="button"
              onClick={props.onBack}
              disabled={!props.canBack}
              className="rounded-md px-1.5 py-1 transition enabled:hover:bg-[var(--surface-hover,var(--muted))] enabled:hover:text-foreground disabled:opacity-40"
            >
              {`‹ ${t('back')}`}
            </button>
          )}
          {props.upNext}
          {props.extra}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted-foreground" data-testid="review-meta">
        {meta.map((node, i) => (
          <span key={(node as { key: string }).key} className="inline-flex items-center gap-x-2">
            {node}
            {i < meta.length - 1 && <span aria-hidden className="text-muted-foreground/50">·</span>}
          </span>
        ))}
      </div>
    </header>
  );
}
