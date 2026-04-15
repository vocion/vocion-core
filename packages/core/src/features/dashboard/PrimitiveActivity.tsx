import { Activity, Clock, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';

type Props = {
  kind: 'skill' | 'workflow';
  slug: string;
  total: number;
  approved: number;
  up: number;
  down: number;
  lastRunAt: Date | null;
};

/**
 * Compact strip showing recent-activity signal for a skill or workflow:
 * total runs, approval rate, ratings, last-run timestamp, and a link to
 * the audit timeline filtered to this slug.
 * @param props
 */
export function PrimitiveActivity(props: Props) {
  const approvalRate = props.total > 0 ? Math.round((props.approved / props.total) * 100) : null;

  return (
    <div className="mb-6 rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Activity className="size-4 text-muted-foreground" />
          Recent activity
        </div>
        <Link
          href={`/dashboard/audit?kind=${props.kind}`}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          View all →
        </Link>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-5">
        <Cell label="Total runs" value={props.total} />
        <Cell label="Approved" value={approvalRate === null ? '—' : `${approvalRate}%`} />
        <Cell
          label={<><ThumbsUp className="inline size-3 text-primary" /></>}
          value={props.up}
        />
        <Cell
          label={<><ThumbsDown className="inline size-3 text-destructive" /></>}
          value={props.down}
        />
        <Cell
          label={<><Clock className="inline size-3" /></>}
          value={props.lastRunAt ? relativeTime(props.lastRunAt) : 'never'}
        />
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: React.ReactNode; value: number | string }) {
  return (
    <div className="px-4 py-3 text-center">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
    </div>
  );
}

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);
  if (day < 30) {
    return `${day}d ago`;
  }
  return d.toLocaleDateString();
}
