import type { JevDecisionHealth, JevOutcomes } from '@/services/routing/health';
import { Link } from '@/libs/I18nNavigation';
import { JevCheckButton } from './JevCheckButton';
import { DECISION_LABEL, failuresCell, latencyCell } from './routingStatus';

/**
 * IS JEV LIVE? inside the Routing section (ADR 0006, health): per decision
 * type, whether Jev answered its newest call, how often it answered or failed
 * and why, how fast, and the outcomes already on record. Counts only.
 */

const STATUS: Record<JevDecisionHealth['status'], { label: string; dot: string }> = {
  live: { label: 'Live', dot: 'bg-emerald-500' },
  failing: { label: 'Failing', dot: 'bg-destructive' },
  idle: { label: 'No calls', dot: 'bg-muted-foreground/40' },
};

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export function JevHealth(props: { health: JevDecisionHealth[]; outcomes: JevOutcomes; canCheck: boolean; adminHref?: string }) {
  const rejected = props.health.some(h => h.lastFailure?.outcome === 'auth' && h.status === 'failing');
  const f = props.outcomes.factory;
  const a = props.outcomes.agent;
  const d = props.outcomes.duplicate;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
        <div className="text-sm font-medium">Is Jev live?</div>
        {props.canCheck && <JevCheckButton />}
      </div>
      {rejected && (
        <p className="px-2 text-sm text-destructive">
          Jev rejected the key on its newest call. Replace it in
          {' '}
          <Link href={props.adminHref ?? '/dashboard/admin'} className="underline">System Keys</Link>
          .
        </p>
      )}
      <Table
        head={['Decision', 'Status', 'Jev answered', 'Failed', 'Latency p50 / p95', 'Last answer']}
        rows={props.health.map(h => [
          DECISION_LABEL[h.type] ?? h.type,
          <span key="s" className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${STATUS[h.status].dot}`} />
            {STATUS[h.status].label}
          </span>,
          `${h.answered} of ${h.asked}`,
          failuresCell(h),
          latencyCell(h.latencyMs.p50, h.latencyMs.p95),
          when(h.lastAnsweredAt),
        ])}
      />

      <div className="px-2 text-sm font-medium">Outcomes on record</div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Table
          title="Factory runs"
          head={['Route', 'Runs', 'QA approved', 'Merged', 'Reruns']}
          rows={f.map(r => [r.selector === 'jev' ? 'Jev' : 'Fallback', String(r.runs), `${r.qaApproved} of ${r.qaJudged}`, String(r.merged), String(r.reruns)])}
        />
        <Table
          title="First messages"
          head={['Picked by', 'Messages', 'Another agent later']}
          rows={a.map(r => [r.decidedBy === 'jev' ? 'Jev' : 'Model read', String(r.firstMessages), String(r.anotherAgentLater)])}
        />
        <Table
          title="Duplicate links"
          head={['Judge', 'Linked', 'Undone']}
          rows={d.map(r => [r.judge === 'jev' ? 'Jev' : r.judge === 'exact' ? 'Exact match' : 'Model', String(r.linked), String(r.undone)])}
        />
      </div>
    </div>
  );
}

function Table(props: { title?: string; head: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <div>
      {props.title && <div className="mb-1 px-2 text-xs text-muted-foreground">{props.title}</div>}
      {props.rows.length === 0
        ? <p className="px-2 text-sm text-muted-foreground">None.</p>
        : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  {props.head.map(h => <th key={h} className="px-2 py-1 font-normal">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {props.rows.map((r, ri) => (
                  // eslint-disable-next-line react/no-array-index-key -- rows are fixed per render
                  <tr key={ri}>
                    {r.map((cell, i) => <td key={props.head[i]} className={i === 0 ? 'px-2 py-2' : 'px-2 py-2 tabular-nums'}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
    </div>
  );
}
