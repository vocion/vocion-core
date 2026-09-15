import { JUDGEMENT_KINDS } from '@/services/TeamReportService';

/**
 * Which kinds are judgement OVER the work rather than the work — these get
 * their own hue so a reader can find every board pass and red-team grade
 * on a page of runs at a glance. Everything else stays neutral.
 * @param kind - `worker_run.kind`.
 */
export function kindTone(kind: string): string {
  switch (kind) {
    case 'board':
      return 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300';
    case 'red-team':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300';
    case 'lead':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300';
    case 'compact':
    case 'snapshot':
      return 'border-border bg-muted text-muted-foreground';
    default:
      return 'border-border bg-background text-foreground/70';
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
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase ${kindTone(kind)}`}
      title={JUDGEMENT_KINDS.includes(kind) ? 'Judgement about the work — counted as quality spend, not output' : undefined}
    >
      {kindShortLabel(kind)}
      {count !== undefined && <span className="font-normal normal-case tabular-nums">{count}</span>}
    </span>
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
