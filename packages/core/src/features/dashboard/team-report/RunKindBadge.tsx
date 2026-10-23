import { Badge } from '@/components/ui/badge';
import { JUDGEMENT_KINDS } from '@/services/TeamReportService';

/**
 * Which kinds are judgement OVER the work rather than the work — these get
 * a hairline so a reader can find every board pass and red-team grade on a
 * page of runs at a glance. Neutral, not a hue: violet, rose and sky are the
 * AI spark's colours (design sweep, 2026-10-23). Everything else is a soft chip.
 * @param kind - `worker_run.kind`.
 */
export function kindVariant(kind: string): 'outline' | 'secondary' {
  switch (kind) {
    case 'board':
    case 'red-team':
    case 'lead':
      return 'outline';
    default:
      return 'secondary';
  }
}

/**
 * The short badge text for a kind. Judgement kinds say so — a board review
 * is quality spend, not output, and the label carries that.
 * @param kind - `worker_run.kind`.
 */
export function kindShortLabel(kind: string): string {
  switch (kind) {
    case 'board': return 'Board · judgement';
    case 'red-team': return 'Red team · quality';
    case 'lead': return 'Lead';
    case 'compact': return 'Compaction';
    case 'snapshot': return 'Snapshot';
    default: return 'Work';
  }
}

/**
 * A small uppercase badge naming the run kind.
 * @param props
 * @param props.kind - `worker_run.kind`.
 * @param props.count - Optional count, for kind-mix chips.
 */
export function RunKindBadge({ kind, count }: { kind: string; count?: number }) {
  return (
    <Badge
      variant={kindVariant(kind)}
      className="rounded-sm px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase"
      title={JUDGEMENT_KINDS.includes(kind) ? 'Judgement about the work — counted as quality spend, not output' : undefined}
    >
      {kindShortLabel(kind)}
      {count !== undefined && <span className="font-normal normal-case tabular-nums">{count}</span>}
    </Badge>
  );
}

/**
 * The kinds a member or team ran, as badges with counts — board and red
 * team first so they are never lost at the end of the row.
 * @param props
 * @param props.byKind - Kind → run count.
 */
export function KindMix({ byKind }: { byKind: Record<string, number> }) {
  const order = ['board', 'red-team', 'lead', 'worker', 'compact', 'snapshot'];
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : 99);
  const kinds = Object.keys(byKind).sort((a, b) => rank(a) - rank(b));
  if (kinds.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {kinds.map(k => <RunKindBadge key={k} kind={k} count={byKind[k]} />)}
    </span>
  );
}
