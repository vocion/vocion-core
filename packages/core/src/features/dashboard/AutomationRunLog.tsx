import type { AutomationRunRow } from '@/services/AutomationService';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';
import { formatDuration, invokedByLabel, summarizeResult, targetRunHref } from './automationResult';

/**
 * The run log — every fire, one table, newest first.
 *
 * Separate from the automation cards on purpose: a card is the DEFINITION
 * (what it does, when it fires, who owns it) and this is the HISTORY. The
 * screen used to do both jobs in one list and neither well, so "has this been
 * running" was answerable only from `psql`.
 */

const CELL = 'px-3 py-2 align-top';

/**
 * One page of fires.
 * @param props
 * @param props.runs - The rows to render.
 * @param props.showAutomation - Include the automation column (off on a per-automation page).
 */
export function AutomationRunLog({ runs, showAutomation = true }: { runs: AutomationRunRow[]; showAutomation?: boolean }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
        No fires recorded for these filters.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[52rem] text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-[10px] tracking-wide text-muted-foreground uppercase">
            <th className={CELL}>Started</th>
            {showAutomation && <th className={CELL}>Automation</th>}
            <th className={CELL}>Kind</th>
            <th className={CELL}>Duration</th>
            <th className={CELL}>Invoked by</th>
            <th className={CELL}>Status</th>
            <th className={CELL}>Result</th>
            <th className={CELL}>Run</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const summary = summarizeResult(run.result);
            const href = targetRunHref(run.kind, run.targetRunId);
            const duration = run.finishedAt
              ? formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())
              : null;
            return (
              <tr key={run.id} className="border-b border-border/60 last:border-0">
                <td className={`${CELL} font-mono whitespace-nowrap`}>
                  {run.startedAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </td>
                {showAutomation && (
                  <td className={CELL}>
                    <Link href={`/dashboard/automation/${run.slug}`} className="font-medium hover:underline">{run.slug}</Link>
                  </td>
                )}
                <td className={`${CELL} text-muted-foreground`}>{run.kind}</td>
                <td className={`${CELL} font-mono whitespace-nowrap`}>{duration ?? (run.status === 'running' ? 'in flight' : '—')}</td>
                <td className={`${CELL} whitespace-nowrap text-muted-foreground`} title={run.invokedBy ?? undefined}>
                  {invokedByLabel(run.invokedBy)}
                  {run.dryRun && ' (dry)'}
                </td>
                <td className={CELL}><RunStatus status={run.status} /></td>
                <td className={`${CELL} min-w-64`}>
                  {run.error
                    ? <span className="text-red-600" title={run.error}>{run.error.slice(0, 160)}</span>
                    : (summary ?? <span className="text-muted-foreground/60">—</span>)}
                </td>
                <td className={CELL}>
                  {href
                    ? (
                        <Link href={href} className="font-mono hover:underline">
                          #
                          {run.targetRunId}
                        </Link>
                      )
                    : <span className="text-muted-foreground/60">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunStatus({ status }: { status: string }) {
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-red-600">
        <AlertTriangle className="size-3" />
        error
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        running
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-emerald-600">
      <CheckCircle2 className="size-3" />
      ok
    </span>
  );
}
