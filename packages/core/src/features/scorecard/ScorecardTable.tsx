'use client';

import type { DateRange, ScorecardPreset } from './periods';
import type { Scorecard, ScorecardRow } from '@/services/scorecard/ScorecardService';
import { CalendarRange, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client } from '@/libs/Orpc';
import { MAX_SCORECARD_RANGE_DAYS } from '@/libs/scorecard/limits';
import { cn } from '@/utils/Helpers';
import { CustomRangeForm } from './CustomRangeForm';
import { formatScore, NOT_ENOUGH_DATA } from './formatScore';
import { DEFAULT_SCORECARD_PRESET, describeRange, rangeForPreset, SCORECARD_PRESETS } from './periods';

/**
 * The agent scorecard — one row per agent: agreement, confidence, usage.
 *
 * Written for a client's business users, so every label is plain language and
 * every column header carries an info tooltip saying what it measures. A rate
 * with nothing behind it reads "Not enough data", never 0% (see
 * `formatScore`). The period is a preset from the dropdown or a custom range;
 * changing it refetches through `router.scorecard.agents` without a reload.
 */

/** The period on screen: a preset, or a custom range someone picked. */
type Period = { kind: 'preset'; preset: ScorecardPreset; range: DateRange } | { kind: 'custom'; range: DateRange };

const CUSTOM_OPTION = 'custom';

/** What came back for one period. A result for a different period than the one on screen means it is still loading. */
type LoadResult = { key: string } & ({ status: 'ready'; scorecard: Scorecard } | { status: 'failed'; message: string });

type LoadState = { status: 'loading' } | LoadResult;

/**
 * A stable identity for a period, so a late response for an old one is ignored.
 * @param range - The period's range.
 */
function periodKey(range: DateRange): string {
  return `${range.from.toISOString()}/${range.to.toISOString()}`;
}

/**
 * Fetch the scorecard for one period and hand the result to `onDone` unless
 * the caller has moved on (`isCurrent` false) — a slow 90-day response must
 * not overwrite the 7-day one the person switched to.
 * @param range - The period to load.
 * @param isCurrent - Whether the request is still the one on screen.
 * @param onDone - Receives the result.
 */
async function loadScorecard(range: DateRange, isCurrent: () => boolean, onDone: (result: LoadResult) => void): Promise<void> {
  const key = periodKey(range);
  try {
    const scorecard = await client.scorecard.agents({ from: range.from.toISOString(), to: range.to.toISOString() });
    if (isCurrent()) {
      onDone({ key, status: 'ready', scorecard });
    }
  } catch (error) {
    console.error('[ScorecardTable] could not load the scorecard', error);
    if (isCurrent()) {
      onDone({ key, status: 'failed', message: 'The scorecard could not be loaded. Try again in a moment.' });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Period picker                                                       */
/* ------------------------------------------------------------------ */

/**
 * The dropdown's choice: a preset becomes its range; "Custom range…" opens the
 * popover and leaves the period alone until a range is applied.
 * @param value - The selected option's value.
 * @param openCustom - Opens the custom-range popover.
 * @param onChange - Receives the new period for a preset.
 */
function choosePeriodOption(value: string, openCustom: (open: boolean) => void, onChange: (period: Period) => void): void {
  if (value === CUSTOM_OPTION) {
    openCustom(true);
    return;
  }
  const preset = value as ScorecardPreset;
  onChange({ kind: 'preset', preset, range: rangeForPreset(preset) });
}

/**
 * Close the popover and switch to the custom range that was applied.
 * @param range - The applied range.
 * @param openCustom - Closes the popover.
 * @param onChange - Receives the custom period.
 */
function applyCustomPeriod(range: DateRange, openCustom: (open: boolean) => void, onChange: (period: Period) => void): void {
  openCustom(false);
  onChange({ kind: 'custom', range });
}

/**
 * Preset dropdown plus a custom-range popover. Choosing "Custom range…" from
 * the dropdown opens the popover; the date button beside it reopens it later.
 * @param props - The period on screen and the setter.
 * @param props.period - What is showing now.
 * @param props.onChange - Receives the new period.
 */
function PeriodPicker(props: { period: Period; onChange: (period: Period) => void }) {
  const [customOpen, setCustomOpen] = useState(false);
  const selected = props.period.kind === 'preset' ? props.period.preset : CUSTOM_OPTION;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="scorecard-period">Period</label>
      <select
        id="scorecard-period"
        value={selected}
        onChange={event => choosePeriodOption(event.target.value, setCustomOpen, props.onChange)}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium"
      >
        {SCORECARD_PRESETS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        <option value={CUSTOM_OPTION}>Custom range…</option>
      </select>
      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50" aria-label="Pick a custom date range">
            <CalendarRange className="size-3.5" aria-hidden />
            <span data-testid="scorecard-period-label">{describeRange(props.period.range)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3">
          <CustomRangeForm
            initial={props.period.range}
            maxDays={MAX_SCORECARD_RANGE_DAYS}
            onApply={range => applyCustomPeriod(range, setCustomOpen, props.onChange)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

/**
 * What each column measures, in words a client can act on. Shown in the
 * header's info tooltip. The Agent column needs none.
 */
const COLUMNS: Array<{ label: string; explanation?: string }> = [
  { label: 'Agent' },
  {
    label: 'Agreement',
    explanation: 'How often a person made the same call the agent recommended — approving when it said approve, turning down when it said turn down. Only decisions where the agent gave a recommendation count. Higher means people trust its judgement.',
  },
  {
    label: 'Average confidence',
    explanation: 'How sure the agent said it was, on average, when it made those same recommendations. Read it next to Agreement: high confidence with low agreement means the agent is sure of itself but often overruled.',
  },
  {
    label: 'People',
    explanation: 'How many different people in this workspace worked with the agent in the period — chatting with it or reviewing its work.',
  },
  {
    label: 'Conversations',
    explanation: 'How many chat conversations people started with the agent in the period.',
  },
  {
    label: 'Reviewed',
    explanation: 'How many pieces of the agent\'s work a person decided on — approved, edited, rewritten or turned down.',
  },
  {
    label: 'Accepted as-is',
    explanation: 'The share of reviewed work approved without any changes. Edits and rewrites count against it, so it can sit below Agreement when people agree with the call but reword the result.',
  },
];

/**
 * A column header with its info tooltip. The icon is a button so keyboard
 * users can reach the explanation too.
 * @param props - The column.
 * @param props.label - The header text.
 * @param props.explanation - What the column measures; no tooltip when absent.
 */
function ColumnHeader(props: { label: string; explanation?: string }) {
  return (
    <th className="px-3 py-2 text-left font-medium">
      <span className="inline-flex items-center gap-1">
        {props.label}
        {props.explanation && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground/70 hover:text-foreground" aria-label={`What ${props.label} means`}>
                <Info className="size-3" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-72 text-left font-normal">{props.explanation}</TooltipContent>
          </Tooltip>
        )}
      </span>
    </th>
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

export function ScorecardTable() {
  const [period, setPeriod] = useState<Period>(() => ({ kind: 'preset', preset: DEFAULT_SCORECARD_PRESET, range: rangeForPreset(DEFAULT_SCORECARD_PRESET) }));
  const [result, setResult] = useState<LoadResult | null>(null);
  const key = periodKey(period.range);
  const state: LoadState = result && result.key === key ? result : { status: 'loading' };

  // A hook callback has no module-level form; it only wires the loader to this
  // render's period and a cancel flag, and all the work lives in loadScorecard.
  useEffect(() => {
    let current = true;
    void loadScorecard(period.range, () => current, setResult);
    return () => {
      current = false;
    };
  }, [period.range]);

  return (
    <div className="space-y-4">
      <PeriodPicker period={period} onChange={setPeriod} />
      {state.status === 'failed' && (
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground" role="alert">{state.message}</div>
      )}
      {state.status !== 'failed' && (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[11px] text-muted-foreground">
              <tr>
                {COLUMNS.map(column => <ColumnHeader key={column.label} label={column.label} explanation={column.explanation} />)}
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
