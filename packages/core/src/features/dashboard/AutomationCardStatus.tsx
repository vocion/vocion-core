import type { AutomationRunRow, ScheduleHealth } from '@/services/AutomationService';
import type { MirrorFreshness } from '@/services/CrmRecordsService';
import { AlertTriangle, Database } from 'lucide-react';
import { humanizeAge } from '@/libs/cron/schedule';
import { Link } from '@/libs/I18nNavigation';
import { checkResultOf, formatDuration, summarizeResult, targetRunHref } from './automationResult';

/**
 * The card's status block: last outcome, how long it took, whether the
 * schedule is overdue, how fresh the data it reads is, and a link to the run
 * that carries the full report.
 *
 * The card used to render one timestamp whether the schedule was twelve days
 * healthy or nineteen hours dead, and the mission run holding the counts had
 * nothing anywhere pointing at it.
 * @param props
 * @param props.run - The most recent fire, or null when there has never been one.
 * @param props.health - The verdict on the schedule's silence.
 * @param props.freshness - The mirror this automation's work reads.
 * @param props.slug - The automation, for the fire-history link.
 */
export function AutomationCardStatus({
  run,
  health,
  freshness,
  slug,
}: {
  run: AutomationRunRow | null;
  health: ScheduleHealth;
  freshness: MirrorFreshness | null;
  slug: string;
}) {
  const check = checkResultOf(run?.result);
  const summary = summarizeResult(run?.result);
  const href = run ? targetRunHref(run.kind, run.targetRunId) : null;
  const duration = run?.finishedAt
    ? formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())
    : null;

  return (
    <div className="mt-1 space-y-0.5">
      {health.overdue && (
        <div className="inline-flex items-center gap-1 font-medium text-amber-600" title={health.expectedAt ? `expected at ${health.expectedAt.toISOString()}` : undefined}>
          <AlertTriangle className="size-3" />
          overdue —
          {' '}
          {health.reason}
        </div>
      )}

      {run
        ? (
            <>
              <div className={run.status === 'error' ? 'text-red-600' : undefined}>
                {run.status === 'error' ? 'last run failed' : run.status === 'running' ? 'running since' : 'last run'}
                {' '}
                {run.startedAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {run.dryRun && ' (dry)'}
                {duration && ` · ${duration}`}
              </div>
              {summary && <div className="text-muted-foreground/70">{summary}</div>}
              {run.error && <div className="max-w-56 truncate text-red-600" title={run.error}>{run.error}</div>}
              {check?.mirror?.stale && (
                <div className="max-w-56 text-amber-600" title={check.mirror.note ?? undefined}>
                  read stale data
                </div>
              )}
              {href && (
                <div>
                  <Link href={href} className="hover:underline">report →</Link>
                </div>
              )}
            </>
          )
        : <div className="text-muted-foreground/70">no runs recorded yet</div>}

      {freshness && <SourceFreshness freshness={freshness} />}

      <div>
        <Link href={`/dashboard/automation/${slug}`} className="hover:underline">fire history →</Link>
      </div>
    </div>
  );
}

/**
 * The freshness of the connector mirror this automation's work reads.
 *
 * A fire over seven-day-old data is not a healthy fire however green it looks,
 * and this is where the sync cadence and the fire cadence sit next to each
 * other — which is what makes the end-to-end delay readable.
 * @param props
 * @param props.freshness
 */
function SourceFreshness({ freshness }: { freshness: MirrorFreshness }) {
  const label = freshness.sources.map(s => s.slug).join(', ');
  const cadence = freshness.expectedEveryMs === null ? null : `every ${humanizeAge(freshness.expectedEveryMs)}`;
  const age = freshness.ageMs === null ? 'never synced' : `${humanizeAge(freshness.ageMs)} ago`;
  return (
    <div
      className={`inline-flex max-w-56 items-start gap-1 ${freshness.stale ? 'text-amber-600' : 'text-muted-foreground/70'}`}
      title={freshness.reason ?? undefined}
    >
      <Database className="mt-0.5 size-3 shrink-0" />
      <span>
        reads
        {' '}
        <Link href="/dashboard/connectors" className="hover:underline">{label}</Link>
        {cadence ? `, synced ${cadence}` : ''}
        {' — last '}
        {age}
      </span>
    </div>
  );
}
