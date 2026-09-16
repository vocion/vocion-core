import type { TeamReport } from '@/services/TeamReportService';
import { ArrowUpRight } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';
import { age, durationMs, pct, usd } from './format';

/**
 * The headline row (spec, "What I would make the page look like"): Teams on
 * target · Goal progress (only when computable) · AI operating cost · Human
 * review time · Auto-completed work · Needs attention. Orange only when
 * something is actually waiting.
 * @param props
 * @param props.report
 * @param props.now
 */
export function HeadlineRow({ report, now = new Date() }: { report: TeamReport; now?: Date }) {
  const h = report.headline;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-border pb-6 sm:grid-cols-3 lg:grid-cols-6">
      <Stat
        label="Teams on target"
        value={h.teamsOnTarget.measured === 0 ? '—' : `${h.teamsOnTarget.onTarget} / ${h.teamsOnTarget.measured}`}
        note={h.teamsOnTarget.measured === 0 ? 'No team has a readable measure' : `of ${h.teamsOnTarget.measured} measured`}
      />
      {h.goalProgress && (
        <Stat
          label="Goal progress"
          value={pct(h.goalProgress.progress)}
          note={`weighted over ${h.goalProgress.measures} contributing measure${h.goalProgress.measures === 1 ? '' : 's'}`}
        />
      )}
      <Stat label="AI operating cost" value={usd(h.cents)} note={report.totals.judgementCents > 0 ? `${pct(report.totals.judgementCents / Math.max(1, h.cents))} on judgement` : 'model and tool spend'} />
      <Stat label="Human review time" value={h.humanReviewMs === 0 ? '0' : durationMs(h.humanReviewMs)} note="decision latency, summed" />
      <Stat label="Auto-completed work" value={h.autoCompletedRate === null ? '—' : pct(h.autoCompletedRate)} note={h.autoCompletedRate === null ? 'No work items yet' : 'needed nobody'} />
      <div className="min-w-0">
        <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Needs attention</dt>
        <dd className={`text-2xl leading-tight font-semibold tabular-nums ${h.needsAttention > 0 ? 'text-amber-700 dark:text-amber-400' : ''}`}>
          {h.needsAttention > 0 ? h.needsAttention : <span className="text-base font-medium text-muted-foreground">No pending escalations</span>}
        </dd>
        <dd className="mt-0.5 text-xs text-muted-foreground">
          {h.needsAttention > 0 && h.needsAttentionOldestAt ? `oldest ${age(h.needsAttentionOldestAt, now)} · ` : ''}
          <Link href="/dashboard/inbox" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
            Inbox
            <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        </dd>
      </div>
    </dl>
  );
}

/**
 * A stat tile: label over value, optional note.
 * @param root0
 * @param root0.label
 * @param root0.value
 * @param root0.note
 */
export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="text-2xl leading-tight font-semibold tabular-nums">{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}
