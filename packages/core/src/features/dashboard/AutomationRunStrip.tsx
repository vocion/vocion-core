import type { AutomationRunRow } from '@/services/AutomationService';

/**
 * The hourly strip — one cell per hour, so twelve days of healthy hourly runs
 * are one glance and a nineteen-hour gap is one glance too.
 *
 * This is the picture that had to be assembled by hand from `psql` to find the
 * 3 September outage a week after it happened. Filled means the hour held a run
 * that closed `ok`; the shade is how long it took; hollow means the hour passed
 * with no run. Hours before the first recorded run are blank rather than drawn
 * as gaps, because nothing was expected of them.
 */

const HOURS = 24;
const HOUR_MS = 3_600_000;

type Cell = { runs: number; maxMs: number; errored: boolean };

/**
 * Bucket runs into hours, keyed `YYYY-MM-DDTHH`.
 * @param runs - Runs, any order.
 */
function bucket(runs: AutomationRunRow[]): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const run of runs) {
    const key = run.startedAt.toISOString().slice(0, 13);
    const ms = run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : 0;
    const prev = cells.get(key);
    cells.set(key, {
      runs: (prev?.runs ?? 0) + 1,
      maxMs: Math.max(prev?.maxMs ?? 0, ms),
      errored: (prev?.errored ?? false) || run.status === 'error',
    });
  }
  return cells;
}

function shade(cell: Cell): string {
  if (cell.errored) {
    return 'bg-red-500';
  }
  if (cell.maxMs < 5 * 60_000) {
    return 'bg-emerald-400';
  }
  if (cell.maxMs < 15 * 60_000) {
    return 'bg-emerald-600';
  }
  return 'bg-amber-500';
}

/**
 * @param props
 * @param props.runs - Runs to draw, any order.
 * @param props.days - How many days back to draw.
 * @param props.expected - True when a schedule made every hour in range expect a run, so empties draw as gaps.
 * @param props.now - Right edge of the strip.
 */
export function AutomationRunStrip({
  runs,
  days = 13,
  expected = true,
  now = new Date(),
}: {
  runs: AutomationRunRow[];
  days?: number;
  expected?: boolean;
  now?: Date;
}) {
  if (runs.length === 0) {
    return <p className="text-xs text-muted-foreground">No runs recorded yet, so there is no history to draw.</p>;
  }
  const cells = bucket(runs);
  const firstRun = runs.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b)).startedAt;
  const lastRun = runs.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b)).startedAt;

  // Rows are UTC days, oldest first, ending on the day of `now`.
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rows = Array.from({ length: days }, (_, i) => new Date(dayStart - (days - 1 - i) * 24 * HOUR_MS));

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-[9px] text-muted-foreground">
          <thead>
            <tr>
              <th className="w-14" />
              {Array.from({ length: HOURS }, (_, h) => (
                <th key={h} className="font-mono font-normal">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((day) => {
              const label = day.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
              return (
                <tr key={day.toISOString()}>
                  <th className="pr-2 text-right font-mono text-[10px] font-normal whitespace-nowrap">{label}</th>
                  {Array.from({ length: HOURS }, (_, h) => {
                    const at = new Date(day.getTime() + h * HOUR_MS);
                    const key = at.toISOString().slice(0, 13);
                    const cell = cells.get(key);
                    // Outside the recorded range is genuinely nothing, not a
                    // state: an hour before the first run never expected one.
                    const outOfRange = at.getTime() < firstRun.getTime() - HOUR_MS
                      || at.getTime() > Math.max(lastRun.getTime(), now.getTime());
                    const title = `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC — ${
                      cell
                        ? `${cell.runs > 1 ? `${cell.runs} runs, longest ` : 'ran, '}${(cell.maxMs / 60_000).toFixed(1)} min${cell.errored ? ', with an error' : ''}`
                        : outOfRange ? 'outside the recorded range' : 'did not run'
                    }`;
                    return (
                      <td key={h}>
                        <span
                          title={title}
                          className={`block size-[13px] rounded-[2px] ${
                            cell
                              ? shade(cell)
                              : outOfRange
                                ? 'bg-transparent'
                                : expected
                                  ? 'border border-dashed border-amber-500/60'
                                  : 'bg-muted'
                          }`}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-muted-foreground">
        <Key className="bg-emerald-400" label="under 5 min" />
        <Key className="bg-emerald-600" label="5 to 15 min" />
        <Key className="bg-amber-500" label="over 15 min" />
        <Key className="bg-red-500" label="errored" />
        {expected && <Key className="border border-dashed border-amber-500/60" label="did not run" />}
      </div>
      <p className="text-[11px] text-muted-foreground">
        One cell per UTC hour. Hover any cell for its runs and the longest of them.
      </p>
    </div>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-3 rounded-[2px] ${className}`} />
      {label}
    </span>
  );
}
