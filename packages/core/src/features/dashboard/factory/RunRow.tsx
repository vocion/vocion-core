import type { DotTone } from '@/components/patterns';
import type { ReportAttempt, Tone } from '@/services/factory/featureReport';
import { StatusDot } from '@/components/patterns';
import { money } from '@/services/factory/featureReport';
import { PreviewOpen } from './FeatureDrawerLink';

const DOT: Record<Tone, DotTone> = { ok: 'pass', warn: 'amber', bad: 'fail', info: 'ink', muted: 'neutral' };

/**
 * ONE RUN, AS A ROW — the status dot and word, "Run #419", which attempt it
 * was, when it started and what it cost; the row opens the run in the preview
 * pane. The same row wherever a feature names a run: under its current state
 * and in its Implementation (Chris, 2026-09-29: "the summary should indicate
 * active runs as rows").
 * @param props
 * @param props.attempt - The run, as the report reads it.
 * @param props.of - How many attempts there are, for "attempt 2 of 3".
 * @param props.testId - A test hook.
 */
export function RunRow({ attempt: a, of, testId }: { attempt: ReportAttempt; of: number; testId?: string }) {
  const tone: DotTone = a.live ? 'amber' : DOT[a.tone];
  return (
    <PreviewOpen recordRef={{ type: 'worker_run', id: String(a.runId) }} look="row" testId={testId}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1.5 text-[13px]" data-run-row={a.runId} data-live={a.live ? 'true' : undefined}>
        <StatusDot tone={tone} label={<span className="font-medium text-foreground">{a.outcome}</span>} />
        <span className="text-foreground/85 tabular-nums">{`Run #${a.runId}`}</span>
        <span className="text-muted-foreground tabular-nums">
          {[`attempt ${a.n} of ${Math.max(of, a.n)}`, `started ${a.ago}`, a.cents !== null && a.cents > 0 ? money(a.cents) : null].filter(Boolean).join(' · ')}
        </span>
      </span>
    </PreviewOpen>
  );
}
