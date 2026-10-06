'use client';

import type { ReactNode } from 'react';
import type { DotTone } from '@/components/patterns';
import type { HistoryCost, HistoryRow, Tone } from '@/services/factory/featureReport';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { RecordCode, StatusDot } from '@/components/patterns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { historyCostLine } from '@/services/factory/featureHistory';
import { money } from '@/services/factory/featureReport';
import { cn } from '@/utils/Helpers';
import { FeatureDrawerLink, PreviewOpen } from './FeatureDrawerLink';

/**
 * TIMELINE — WHAT HAPPENED, NEWEST FIRST (Chris, 2026-10-02, FE-370).
 *
 * One list in place of four: the Activity card, the Implementation rows, the
 * bottom event log and the "Connected work" sheet. The conversations, the
 * plan, each attempt as a group ("Attempt 3 of 3 · passed · $0.75") with its
 * build and QA's reviews under it, the merge, the deploy, the release, the
 * live check, the factory's notes — each titled by what it did and found
 * (`libs/factory/runTitle.ts`), its code small and muted beside the time,
 * its cost on the right, the total and its split at the foot.
 *
 * ONE COMPONENT, TWO DENSITIES. On the page (`compact`) the newest few rows,
 * an attempt as its one line, and "See full timeline"; in the side panel
 * (`full`, `PreviewPane` → `doc.timeline`) every row with each attempt's
 * rows under it. There is no second history list.
 *
 * Newest first because the page's few rows must say where the work has got
 * to, and because that is the order the activity list already kept (#269).
 */

const DOT: Record<Tone, DotTone> = { ok: 'pass', warn: 'amber', bad: 'fail', info: 'ink', muted: 'neutral' };

/** How many rows the page shows before "See full timeline". */
export const COMPACT_ROWS = 5;

/**
 * A moment in the reader's own clock — "2 Oct, 08:22". The server writes it
 * in UTC; the browser rewrites it in the reader's zone after mount.
 * @param props
 * @param props.at - ISO time.
 */
function When({ at }: { at: string }) {
  const fmt = (zone?: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) }).format(new Date(at));
  const [text, setText] = useState(() => fmt('UTC'));
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect */
  useEffect(() => {
    setText(fmt());
  }, [at]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect */
  return <time dateTime={at} className="whitespace-nowrap">{text}</time>;
}

/**
 * What a row opens: a run or record in the preview pane, a link out, or
 * nothing (an attempt's own line, a note).
 * @param props
 * @param props.row - The row.
 * @param props.children - The row's content.
 */
function Opens({ row, children }: { row: HistoryRow; children: ReactNode }) {
  if (row.open) {
    return <PreviewOpen recordRef={row.open} look="row" className="block w-full text-left" testId="timeline-open">{children}</PreviewOpen>;
  }
  if (row.href) {
    return <a href={row.href} target="_blank" rel="noreferrer" className="block rounded-md hover:bg-surface-hover" data-testid="timeline-open">{children}</a>;
  }
  return <div>{children}</div>;
}

/**
 * One row: the dot, the title, its code and time under it, its cost on the right.
 * @param props
 * @param props.row - The row.
 * @param props.nested - An attempt's own row, drawn under it.
 * @param props.notes - Draw the factory's lines folded under it (the side panel).
 */
function Row({ row, nested, notes }: { row: HistoryRow; nested?: boolean; notes?: boolean }) {
  return (
    <li data-testid="timeline-row" data-kind={row.kind} data-live={row.live ? 'true' : undefined} className="flex min-w-0 items-start">
      <div className="min-w-0 flex-1">
        <Opens row={row}>
          <span className={cn('flex min-w-0 items-start gap-2.5 px-2 py-1.5', nested && 'pl-6')}>
            <span className="pt-[5px]">
              <StatusDot tone={row.live ? 'amber' : DOT[row.tone]} label={null} pulse={row.live} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block text-[14px] leading-snug break-words', row.kind === 'note' ? 'text-muted-foreground' : 'text-foreground', row.kind === 'attempt' && 'font-medium')} data-testid="timeline-title">
                {row.title}
              </span>
              {(row.code || row.at) && (
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground tabular-nums">
                  <RecordCode code={row.code} />
                  {row.at && <When at={row.at} />}
                </span>
              )}
              {notes && (row.notes ?? []).map(n => (
                <span key={n} className="mt-1 block text-[12px] leading-relaxed break-words text-muted-foreground" data-testid="timeline-note">{n}</span>
              ))}
            </span>
            <span className="shrink-0 pt-px text-[12px] text-muted-foreground tabular-nums" data-testid="timeline-cost">
              {row.cents === null ? '' : money(row.cents)}
            </span>
            {(row.open || row.href) && <ChevronRight className="mt-[3px] size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />}
          </span>
        </Opens>
      </div>
      {row.external && (
        <Tooltip>
          <TooltipTrigger asChild>
            <a href={row.external.url} target="_blank" rel="noreferrer" aria-label={row.external.label} className="mt-1 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground" data-testid="timeline-external">
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </TooltipTrigger>
          <TooltipContent>{row.external.label}</TooltipContent>
        </Tooltip>
      )}
    </li>
  );
}

/**
 * The Timeline.
 * @param props
 * @param props.rows - Newest first (`featureHistory.ts`).
 * @param props.cost - The foot.
 * @param props.density - `compact` on the page, `full` in the side panel.
 * @param props.requestId - The feature, for "See full timeline" (compact only).
 */
export function FeatureTimeline({ rows, cost, density, requestId }: { rows: readonly HistoryRow[]; cost: HistoryCost; density: 'compact' | 'full'; requestId?: number }) {
  const compact = density === 'compact';
  const shown = compact ? rows.slice(0, COMPACT_ROWS) : rows;
  if (rows.length === 0) {
    return <p className="text-[13px] text-muted-foreground" data-testid="timeline-empty">Nothing has happened on this work yet.</p>;
  }
  return (
    <div data-testid="feature-timeline" data-density={density} className="min-w-0">
      <ol className="-mx-2 min-w-0">
        {shown.map(r => (
          <li key={r.key} className="min-w-0">
            <ul className="min-w-0">
              <Row row={r} notes={!compact} />
              {!compact && (r.children ?? []).map(c => <Row key={c.key} row={c} nested notes />)}
            </ul>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-rule pt-2 text-[12px] text-muted-foreground">
        <span className="min-w-0 tabular-nums" data-testid="timeline-cost-foot">{historyCostLine(cost, money)}</span>
        {compact && requestId !== undefined && (
          <FeatureDrawerLink requestId={requestId} drawer="timeline" look="link" className="shrink-0 text-[12px]" testId="timeline-see-all">
            {rows.length > shown.length ? `See full timeline · ${rows.length}` : 'See full timeline'}
          </FeatureDrawerLink>
        )}
      </div>
    </div>
  );
}
