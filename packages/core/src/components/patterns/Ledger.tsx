'use client';

import type { ReactNode } from 'react';
import type { Maybe } from './DetailPage';
import { useState } from 'react';
import { cn } from '@/utils/Helpers';
import { formatScore, scorePercent, scoreVerdict } from './scoreChip';

/**
 * The Ledger archetype — somewhere to look. Every entry the system assessed,
 * newest first under day headers, each with what it read, how it scored, how
 * it decided, and what a person did with it. Rows, not cards: a hairline
 * between entries, a mono provenance footer, the summary clamped to two
 * lines. See `docs/design/patterns.md` § Ledger.
 */

/**
 * LedgerGroup — a day of entries under one small header.
 * @param props
 * @param props.label - "Today", "Mon, Sep 14".
 * @param props.count
 * @param props.children
 * @param props.className
 */
export function LedgerGroup(props: { label: ReactNode; count?: number; children: ReactNode; className?: string }) {
  return (
    <section data-pattern="ledger-group" className={cn('pt-6 first:pt-2', props.className)}>
      <h2 className="mb-1 flex items-baseline gap-2 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {props.label}
        {props.count !== undefined && <span className="font-normal tracking-normal normal-case tabular-nums">{props.count}</span>}
      </h2>
      <div className="divide-y divide-rule">{props.children}</div>
    </section>
  );
}

export type ScoreChipProps = {
  label: string;
  value: number;
  /** The cut-off the value was read against. Without it the chip is a plain reading. */
  threshold?: number | null;
  title?: string;
  className?: string;
};

/**
 * ScoreChip — "discovery 0.95" with a tiny meter and, when a threshold is
 * known, a pass/fail colour and a tick on the meter where the threshold
 * sits. The number is the number; colour never replaces it.
 * @param props
 * @param props.label
 * @param props.value
 * @param props.threshold
 * @param props.title
 * @param props.className
 */
export function ScoreChip(props: ScoreChipProps) {
  const verdict = scoreVerdict(props.value, props.threshold);
  const pct = scorePercent(props.value);
  const fill = verdict === 'pass' ? 'bg-brand-pass' : verdict === 'fail' ? 'bg-brand-fail' : 'bg-foreground/60';
  const text = verdict === 'pass' ? 'text-brand-pass' : verdict === 'fail' ? 'text-brand-fail' : 'text-foreground/80';
  const title = props.title ?? (props.threshold != null ? `${props.label} ${formatScore(props.value)} · threshold ${formatScore(props.threshold)} · ${verdict === 'pass' ? 'met' : 'not met'}` : `${props.label} ${formatScore(props.value)}`);
  return (
    <span data-pattern="score-chip" data-verdict={verdict} title={title} className={cn('inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap', props.className)}>
      <span className="text-muted-foreground">{props.label}</span>
      <span className={cn('font-medium tabular-nums', text)}>{formatScore(props.value)}</span>
      <span className="relative h-1 w-8 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn('block h-full rounded-full', fill)} style={{ width: `${pct}%` }} />
        {props.threshold != null && (
          <span className="absolute top-0 h-full w-px bg-foreground/50" style={{ left: `${scorePercent(props.threshold)}%` }} />
        )}
      </span>
    </span>
  );
}

export type Verdict = 'drop' | 'generate' | 'confirm' | 'hold' | (string & {});

const VERDICT: Record<string, { label: string; className: string }> = {
  // Ink: the system decided nothing needs a person.
  drop: { label: 'drop', className: 'bg-surface-soft text-muted-foreground' },
  // Green: the system produced something.
  generate: { label: 'generate', className: 'bg-brand-pass-bg text-brand-pass' },
  // Amber: a person is being asked.
  confirm: { label: 'confirm', className: 'bg-brand-borderline-bg text-brand-borderline' },
  hold: { label: 'hold', className: 'bg-brand-borderline-bg text-brand-borderline' },
  skipped: { label: 'skipped', className: 'bg-surface-soft text-muted-foreground' },
  pending: { label: 'pending', className: 'bg-surface-soft text-muted-foreground' },
};

/**
 * VerdictBadge — the route the system chose, in the ledger's three colours:
 * ink for drop, green for generate, amber for confirm/hold. Unknown verdicts
 * render neutral, as written.
 * @param props
 * @param props.verdict
 * @param props.label
 * @param props.className
 */
export function VerdictBadge(props: { verdict: Verdict; label?: string; className?: string }) {
  const spec = VERDICT[props.verdict] ?? { label: props.verdict, className: 'bg-surface-soft text-muted-foreground' };
  return (
    <span data-pattern="verdict-badge" data-verdict={props.verdict} className={cn('inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium', spec.className, props.className)}>
      {props.label ?? spec.label}
    </span>
  );
}

export type ProvenanceItem = { label?: string; value: string; title?: string; key?: string };

/**
 * ProvenanceLine — the mono footer: model#prompt · agent · run · transcript ·
 * workspace. Muted, one line, each item titled with what it is. Truth kept in
 * reach without competing with the reading.
 * @param props
 * @param props.items
 * @param props.className
 */
export function ProvenanceLine(props: { items: ReadonlyArray<Maybe<ProvenanceItem>>; className?: string }) {
  const items = props.items.filter((i): i is ProvenanceItem => Boolean(i));
  if (items.length === 0) {
    return null;
  }
  return (
    <div data-pattern="provenance" className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground/80', props.className)}>
      {items.map((it, i) => (
        <span key={it.key ?? `${it.label ?? ''}${it.value}`} className="inline-flex items-center gap-x-2" title={it.title}>
          {it.label && <span className="text-muted-foreground/60">{it.label}</span>}
          <span className="truncate">{it.value}</span>
          {i < items.length - 1 && <span aria-hidden className="text-muted-foreground/40">·</span>}
        </span>
      ))}
    </div>
  );
}

/**
 * LedgerEntry — one assessed thing, read top-down in about two seconds:
 * **what meeting was this, what did Vocion decide, why, and what did the human
 * do** (`docs/specs/discovery-ledger-v2.md`).
 *
 * The slots are in that order and the hierarchy is deliberate: the verdict
 * line sits above the reason, the human line below it, and the model's
 * internals — thresholds, prompt version, run id, transcript hash — go in
 * `details`, collapsed. MANIFESTO §12: the simplest useful reading first, the
 * evidence underneath. The decision history is the ledger; the model internals
 * are supporting evidence.
 * @param props
 * @param props.title
 * @param props.when - Already formatted.
 * @param props.verdict - The decision, as a `<VerdictBadge>` or a class chip.
 * @param props.state - The routing state: "routed", "matched", "dropped".
 * @param props.scores - Confidence readings. Never a score without its class.
 * @param props.summary - One sentence of why. Clamped to two lines when long.
 * @param props.detail - The line under the title: who the meeting was with.
 * @param props.provenance - A `<ProvenanceLine>`; lives inside `details` when there is one.
 * @param props.human - What a person did, and what happened as a result.
 * @param props.details - Evidence and decision details, collapsed behind a disclosure.
 * @param props.detailsLabel - The disclosure's label. Default "Evidence & decision details".
 * @param props.className
 */
export function LedgerEntry(props: {
  'title': ReactNode;
  'when'?: ReactNode;
  'verdict'?: ReactNode;
  'state'?: ReactNode;
  'scores'?: ReactNode;
  'summary'?: string | null;
  'detail'?: ReactNode;
  'provenance'?: ReactNode;
  'human'?: ReactNode;
  'details'?: ReactNode;
  'detailsLabel'?: string;
  'className'?: string;
  'data-testid'?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const summary = props.summary?.trim();
  // Roughly two lines at reading width; below that, no toggle to press.
  const clampable = (summary?.length ?? 0) > 180;
  return (
    <article data-pattern="ledger-entry" data-testid={props['data-testid']} className={cn('py-4', props.className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-medium text-foreground">{props.title}</h3>
            {props.when && <span className="text-[12px] text-muted-foreground tabular-nums">{props.when}</span>}
          </div>
          {props.detail && <div className="mt-0.5 text-[12px] text-muted-foreground">{props.detail}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
          {props.state}
          {props.verdict}
        </div>
      </div>

      {props.scores && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">{props.scores}</div>}

      {summary && (
        <div className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-foreground/80">
          <p className={cn(!expanded && 'line-clamp-2')}>{summary}</p>
          {clampable && (
            <button type="button" onClick={() => setExpanded(e => !e)} aria-expanded={expanded} className="mt-0.5 text-[12px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
              {expanded ? 'less' : 'more'}
            </button>
          )}
        </div>
      )}

      {props.human && <div className="mt-2 text-[12px] text-muted-foreground">{props.human}</div>}

      {props.details && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            data-testid="ledger-details-toggle"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline decoration-border underline-offset-2 transition hover:text-foreground"
          >
            <span aria-hidden className={cn('transition-transform', open && 'rotate-90')}>›</span>
            {props.detailsLabel ?? 'Evidence & decision details'}
          </button>
          {open && (
            <div className="mt-2 space-y-2 border-l border-rule pl-3 text-[12px] text-muted-foreground" data-testid="ledger-details">
              {props.details}
              {props.provenance}
            </div>
          )}
        </div>
      )}

      {!props.details && props.provenance && <div className="mt-2 min-w-0">{props.provenance}</div>}
    </article>
  );
}
