/**
 * THE ENGINES PAGE'S ARITHMETIC (ADR 0005), kept apart from the markup so it
 * is tested on its own: which window and source the URL asks for, which
 * engines get a column, each line of the side-by-side table, and where a run
 * row links. The figures themselves are `services/factory/engineRun.ts`'s;
 * nothing here recomputes them.
 */

import type { EngineRunRow, EngineScore } from '@/services/factory/engineRun';

export const WINDOWS = [7, 30, 90] as const;
export type EnginesWindow = (typeof WINDOWS)[number];
export type EnginesSource = 'factory' | 'eval';

/** What the page shows, from its URL. */
export type EnginesQuery = { days: EnginesWindow; source: EnginesSource; engine: string | null };

/**
 * The window, source and engine filter a URL asks for; anything else is the default (30 days, real work, every engine).
 * @param params - The page's search params.
 */
export function readEnginesQuery(params: Record<string, string | string[] | undefined>): EnginesQuery {
  const one = (k: string) => (typeof params[k] === 'string' ? params[k] as string : undefined);
  const days = Number(one('days'));
  const engine = one('engine');
  return {
    days: (WINDOWS as readonly number[]).includes(days) ? days as EnginesWindow : 30,
    source: one('source') === 'eval' ? 'eval' : 'factory',
    engine: engine && /^[a-z][a-z0-9-]{0,31}$/.test(engine) ? engine : null,
  };
}

/**
 * The page's link with one part of the query changed. Defaults are left out, so the plain path is the default view.
 * @param slug - The page's slug.
 * @param q - The query in force.
 * @param change - What to change.
 */
export function enginesHref(slug: string, q: EnginesQuery, change: Partial<EnginesQuery>): string {
  const next = { ...q, ...change };
  const sp = new URLSearchParams();
  if (next.days !== 30) {
    sp.set('days', String(next.days));
  }
  if (next.source !== 'factory') {
    sp.set('source', next.source);
  }
  if (next.engine) {
    sp.set('engine', next.engine);
  }
  const s = sp.toString();
  return `/dashboard/p/${slug}${s ? `?${s}` : ''}`;
}

/** The engines a runner knows, in the order the table shows them; codex joins when it has runs. */
const ALWAYS = ['claude-cli', 'openhands'] as const;
const ORDER = ['claude-cli', 'openhands', 'codex'];

/**
 * An engine with no runs in the window: a column that says so, never a missing one.
 * @param engine
 * @param source
 */
function emptyScore(engine: string, source: string): EngineScore {
  return { engine, source, runs: 0, running: 0, prs: 0, qaPassed: 0, qaFailed: 0, accepted: 0, merged: 0, reverted: 0, failed: 0, prRate: null, qaPassRate: null, acceptRate: null, medianDurationS: null, totalCents: 0, centsPerLanded: null, guardViolations: 0, retries: 0, models: [], byComplexity: {} };
}

/**
 * One column per engine for the source shown: claude-cli and openhands always
 * (an empty one says it has no runs), any other engine with runs after them.
 * @param engines - The board's lines.
 * @param source - The source shown.
 */
export function boardColumns(engines: readonly EngineScore[], source: EnginesSource): EngineScore[] {
  const mine = engines.filter(e => e.source === source);
  const names = [...new Set([...ALWAYS, ...mine.map(e => e.engine)])];
  const rank = (n: string) => (ORDER.includes(n) ? ORDER.indexOf(n) : ORDER.length);
  return names
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(n => mine.find(e => e.engine === n) ?? emptyScore(n, source));
}

/**
 * A share as a percentage, or a dash.
 * @param v - 0 to 1, or null.
 */
export function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

/**
 * Cents as dollars.
 * @param cents - Cents, or null.
 */
export function money(cents: number | null): string {
  if (cents === null) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

/**
 * Seconds as `4m 05s` (or `1h 02m`).
 * @param s - Seconds, or null.
 */
export function duration(s: number | null): string {
  if (s === null) {
    return '—';
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

/** The sizes, in the order the table lists them. */
const SIZES = ['small', 'medium', 'large', 'unknown'] as const;

/**
 * Runs by size, as `small 3 · medium 1`.
 * @param byComplexity - The engine's split.
 */
export function sizeSplit(byComplexity: Record<string, number>): string {
  const parts = SIZES.filter(k => (byComplexity[k] ?? 0) > 0).map(k => `${k} ${byComplexity[k]}`);
  return parts.length ? parts.join(' · ') : '—';
}

/** One line of the side-by-side table. */
export type BoardLine = { key: string; label: string; hint: string; value: (e: EngineScore) => string };

export const BOARD_LINES: readonly BoardLine[] = [
  { key: 'runs', label: 'Runs', hint: 'Engineering runs in the window; running ones are counted here and left out of the rates.', value: e => (e.running ? `${e.runs} (${e.running} running)` : String(e.runs)) },
  { key: 'prRate', label: 'PR rate', hint: 'Finished runs that opened a pull request.', value: e => pct(e.prRate) },
  { key: 'qaPassRate', label: 'QA pass rate', hint: 'Of the runs QA judged, the share it passed.', value: e => pct(e.qaPassRate) },
  { key: 'acceptRate', label: 'Acceptance rate', hint: 'Of the runs with a settled outcome, the share accepted or merged and not reverted.', value: e => pct(e.acceptRate) },
  { key: 'medianDurationS', label: 'Median time', hint: 'From claim to the end of the run.', value: e => duration(e.medianDurationS) },
  { key: 'totalCents', label: 'Spend', hint: 'Model spend, the runs\' own final account.', value: e => money(e.runs ? e.totalCents : null) },
  { key: 'centsPerLanded', label: 'Cost per landed change', hint: 'Spend over the runs accepted or merged.', value: e => money(e.centsPerLanded) },
  { key: 'guardViolations', label: 'Guard violations', hint: 'Tool calls the guard hooks refused.', value: e => (e.runs ? String(e.guardViolations) : '—') },
  { key: 'retries', label: 'Retries', hint: 'Runs that were a second or later attempt at their task.', value: e => (e.runs ? String(e.retries) : '—') },
  { key: 'size', label: 'By size', hint: 'Runs by the size of the change: small up to 3 files and 150 lines, large from 10 files or 600 lines.', value: e => sizeSplit(e.byComplexity) },
];

/** Where a run row links. */
export type RunLinks = { run: string | null; task: string | null; feature: string | null; pr: string | null };

/**
 * A run row's links: its run page, its task, its feature and its pull request.
 * @param r - The row.
 */
export function runLinks(r: Pick<EngineRunRow, 'workerRunId' | 'taskId' | 'requestId' | 'prUrl'>): RunLinks {
  return {
    run: r.workerRunId ? `/dashboard/p/runs/${r.workerRunId}` : null,
    task: r.taskId ? `/dashboard/objects/${r.taskId}` : null,
    feature: r.requestId ? `/dashboard/p/feature/${r.requestId}` : null,
    pr: r.prUrl && /^https:\/\//.test(r.prUrl) ? r.prUrl : null,
  };
}

/** The outcome words, as a person reads them, and the status pill that carries them. */
export const OUTCOMES: Record<string, { label: string; pill: 'completed' | 'failed' | 'pending' | 'running' | 'inactive' }> = {
  running: { label: 'Running', pill: 'running' },
  failed: { label: 'Failed', pill: 'failed' },
  cancelled: { label: 'Cancelled', pill: 'inactive' },
  no_pr: { label: 'No PR', pill: 'pending' },
  pr_opened: { label: 'PR opened', pill: 'running' },
  qa_failed: { label: 'QA failed', pill: 'failed' },
  qa_passed: { label: 'QA passed', pill: 'completed' },
  accepted: { label: 'Accepted', pill: 'completed' },
  rejected: { label: 'Rejected', pill: 'failed' },
  merged: { label: 'Merged', pill: 'completed' },
  reverted: { label: 'Reverted', pill: 'failed' },
  superseded: { label: 'Superseded', pill: 'inactive' },
};

/**
 * What the page says when there is nothing to show: no runs at all in the
 * window, or none for the engine filtered on. Null when there are rows.
 * @param q - The query in force.
 * @param rows - How many runs the list has.
 */
export function emptyLine(q: EnginesQuery, rows: number): string | null {
  if (rows > 0) {
    return null;
  }
  const window = `the last ${q.days} days`;
  if (q.source === 'eval') {
    return `No eval runs on the board for ${window}. Eval results are imported with src/scripts/import-eval-runs.ts.`;
  }
  if (q.engine) {
    return `No ${q.engine} runs in ${window}. A workspace picks an engine with harness.engine on its task-engineer seat; its next build lands here.`;
  }
  return `No engineering runs in ${window}. Every build the factory starts lands here when it ends, whichever engine ran it.`;
}

/**
 * The line under an engine's empty column.
 * @param e - The column.
 */
export function emptyColumn(e: EngineScore): string | null {
  return e.runs === 0 ? `No ${e.engine} runs yet in this window.` : null;
}
