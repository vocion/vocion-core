'use client';

import type { Scorecard, ScorecardRow, ScorecardWindow } from '@/services/scorecard/ScorecardService';
import { useEffect, useState } from 'react';
import { client } from '@/libs/Orpc';
import { cn } from '@/utils/Helpers';
import { formatScore, NOT_ENOUGH_DATA } from './formatScore';

/**
 * The agent scorecard — one row per agent: agreement, confidence, usage.
 *
 * Written for a client's business users, so every label is plain language and
 * every header explains itself on hover. A rate with nothing behind it reads
 * "Not enough data", never 0% (see `formatScore`). Client component so the
 * period picker refetches through `router.scorecard.agents` without a reload.
 */

const WINDOW_OPTIONS: readonly ScorecardWindow[] = [7, 30];

/** What came back for `days`. A result for a different window than the one picked means that window is still loading. */
type LoadResult = { days: ScorecardWindow } & ({ status: 'ready'; scorecard: Scorecard } | { status: 'failed'; message: string });

type LoadState = { status: 'loading' } | LoadResult;

/**
 * Fetch one window of the scorecard and hand the result to `onDone` unless the
 * caller has moved on (`isCurrent` false) — a slow 30-day response must not
 * overwrite the 7-day one the person switched to.
 * @param days - The window to load.
 * @param isCurrent - Whether the request is still the one on screen.
 * @param onDone - Receives the new load state.
 */
async function loadScorecard(days: ScorecardWindow, isCurrent: () => boolean, onDone: (result: LoadResult) => void): Promise<void> {
  try {
    const scorecard = await client.scorecard.agents({ days });
    if (isCurrent()) {
      onDone({ days, status: 'ready', scorecard });
    }
  } catch (error) {
    console.error('[ScorecardTable] could not load the scorecard', error);
    if (isCurrent()) {
      onDone({ days, status: 'failed', message: 'The scorecard could not be loaded. Try again in a moment.' });
    }
  }
}

function PeriodPicker(props: { value: ScorecardWindow; onChange: (days: ScorecardWindow) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border text-xs" role="group" aria-label="Period">
      {WINDOW_OPTIONS.map(days => (
        <button
          key={days}
          type="button"
          aria-pressed={props.value === days}
          onClick={() => props.onChange(days)}
          className={cn(
            'px-3 py-1.5 font-medium transition-colors',
            props.value === days ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted/50',
          )}
        >
          {`Last ${days} days`}
        </button>
      ))}
    </div>
  );
}

/**
 * One rate cell. An empty rate is muted so it does not compete with real numbers.
 * @param props - The cell's rate and hover text.
 * @param props.rate - Between 0 and 1, or null when there is nothing to score.
 * @param props.detail - Hover text: what the number is made of.
 */
function RateCell(props: { rate: number | null; detail: string }) {
  const empty = props.rate === null;
  return (
    <td className={cn('px-3 py-2 tabular-nums', empty && 'text-muted-foreground')} title={props.detail} data-empty={empty || undefined}>
      {formatScore(props.rate)}
    </td>
  );
}

function agreementDetail(row: ScorecardRow): string {
  if (row.recommendationsDecided === 0) {
    return `${NOT_ENOUGH_DATA}: none of this agent's recommendations were decided in this period.`;
  }
  return `${row.recommendationsAgreed} of ${row.recommendationsDecided} decided the way this agent recommended.`;
}

function confidenceDetail(row: ScorecardRow): string {
  if (row.recommendationsWithConfidence === 0) {
    return `${NOT_ENOUGH_DATA}: none of this agent's decided recommendations stated how sure it was.`;
  }
  return `Averaged over ${row.recommendationsWithConfidence} recommendations that stated a confidence.`;
}

function ScorecardRowView(props: { row: ScorecardRow }) {
  const { row } = props;
  return (
    <tr className="border-t border-border/50 text-xs" data-testid="scorecard-row" data-agent-slug={row.agentSlug}>
      <td className="px-3 py-2 font-medium">{row.agentName}</td>
      <RateCell rate={row.agreementRate} detail={agreementDetail(row)} />
      <RateCell rate={row.averageConfidence} detail={confidenceDetail(row)} />
      <td className="px-3 py-2 tabular-nums">{row.peopleReached}</td>
      <td className="px-3 py-2 tabular-nums">{row.conversations}</td>
      <td className="px-3 py-2 tabular-nums">{row.reviewDecisions}</td>
      <RateCell rate={row.acceptedAsIsRate} detail={row.reviewDecisions > 0 ? 'Share of reviewed work that was approved without changes.' : `${NOT_ENOUGH_DATA}: nothing from this agent was reviewed in this period.`} />
    </tr>
  );
}

const COLUMNS: Array<{ label: string; title?: string }> = [
  { label: 'Agent' },
  { label: 'Agreement', title: 'How often a person went with what the agent recommended.' },
  { label: 'Average confidence', title: 'How sure the agent said it was, on average, across those same recommendations.' },
  { label: 'People', title: 'Different people who worked with this agent in the period.' },
  { label: 'Conversations' },
  { label: 'Reviewed', title: 'Pieces of this agent\'s work a person approved, changed or turned down.' },
  { label: 'Accepted as-is', title: 'Share of reviewed work approved without any changes.' },
];

export function ScorecardTable() {
  const [days, setDays] = useState<ScorecardWindow>(30);
  const [result, setResult] = useState<LoadResult | null>(null);
  const state: LoadState = result && result.days === days ? result : { status: 'loading' };

  // A hook callback has no module-level form; it only wires the loader to this
  // render's `days` and a cancel flag, and all the work lives in loadScorecard.
  useEffect(() => {
    let current = true;
    void loadScorecard(days, () => current, setResult);
    return () => {
      current = false;
    };
  }, [days]);

  return (
    <div className="space-y-4">
      <PeriodPicker value={days} onChange={setDays} />
      {state.status === 'failed' && (
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground" role="alert">{state.message}</div>
      )}
      {state.status !== 'failed' && (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[11px] text-muted-foreground">
              <tr>
                {COLUMNS.map(column => (
                  <th key={column.label} className="px-3 py-2 text-left font-medium" title={column.title}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.status === 'loading' && (
                <tr><td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</td></tr>
              )}
              {state.status === 'ready' && state.scorecard.rows.length === 0 && (
                <tr><td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-xs text-muted-foreground">This workspace has no agents yet.</td></tr>
              )}
              {state.status === 'ready' && state.scorecard.rows.map(row => <ScorecardRowView key={row.agentSlug} row={row} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
