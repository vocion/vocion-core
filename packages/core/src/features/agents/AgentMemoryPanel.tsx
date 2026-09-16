import type { AgentMemoryStats } from '@/services/MemoryService';
import { Link } from '@/libs/I18nNavigation';

/**
 * The growing-memory panel — one of the scoped-memory plan's two visible
 * surfaces (the other is the adoption page's approval-rate trend). Shows what
 * this agent knows: cumulative memory count stepped up by each adoption,
 * composition badges by namespace with click-through to the rules. Counts are
 * what the agent reads; causality is shown by adjacency, never claimed.
 *
 * Server component — the page already loads everything else server-side.
 * @param props
 * @param props.stats
 */
export function AgentMemoryPanel(props: { stats: AgentMemoryStats }) {
  const { stats } = props;
  if (stats.composition.length === 0) {
    return null;
  }

  // Dependency-free step chart: cumulative adoptions over time.
  const width = 560;
  const height = 96;
  const pad = { top: 8, right: 8, bottom: 18, left: 26 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const points = stats.series;
  const maxY = Math.max(1, ...points.map(p => p.cumulative));
  const x = (i: number) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / maxY) * innerH;
  // Step path: hold the previous level until the adoption day.
  const path = points.length > 0
    ? `M ${x(0)} ${y(points[0]!.cumulative)} ${points.map((p, i) => `H ${x(i)} V ${y(p.cumulative)}`).join(' ')} H ${pad.left + innerW}`
    : '';

  return (
    <section>
      <h2 className="mb-1 font-display text-base font-semibold">Memory</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Approved rules this agent reads on every turn — each adoption steps the count up. Click a badge to see the rules.
      </p>
      <div className="rounded-lg border border-border/60 p-4">
        <div className="flex flex-wrap items-baseline gap-6">
          <div>
            <div className="font-display text-2xl font-semibold tabular-nums">{stats.activeCount}</div>
            <div className="text-[11px] text-muted-foreground">active memories</div>
          </div>
          <div>
            <div className="font-display text-2xl font-semibold tabular-nums">
              {stats.adoptedLast90 > 0 ? `+${stats.adoptedLast90}` : '0'}
            </div>
            <div className="text-[11px] text-muted-foreground">adopted last 90 days</div>
          </div>
          <div>
            <div className="font-display text-2xl font-semibold tabular-nums">{stats.composition.length}</div>
            <div className="text-[11px] text-muted-foreground">namespaces read</div>
          </div>
        </div>

        {points.length > 0 && (
          <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 w-full" role="img" aria-label="Cumulative approved memories over time">
            {[0, 1].map(f => (
              <text key={f} x={pad.left - 6} y={y(f * maxY) + 3} textAnchor="end" fontSize="9" fill="currentColor" fillOpacity="0.45">
                {Math.round(f * maxY)}
              </text>
            ))}
            <line x1={pad.left} y1={pad.top + innerH} x2={width - pad.right} y2={pad.top + innerH} stroke="currentColor" strokeOpacity="0.12" />
            <path d={path} fill="none" style={{ stroke: 'var(--brand-teal, #14b8a6)' }} strokeWidth="1.5" />
            {points.length > 0 && (
              <text x={width - pad.right} y={height - 5} textAnchor="end" fontSize="9" fill="currentColor" fillOpacity="0.45">
                {points[points.length - 1]!.day}
              </text>
            )}
            <text x={pad.left} y={height - 5} fontSize="9" fill="currentColor" fillOpacity="0.45">
              {points[0]!.day}
            </text>
          </svg>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {stats.composition.map(ns => (
            <Link
              key={ns.name}
              href={`/dashboard/learnings/${ns.name}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              title={`${ns.title} — ${ns.scopeKind} scope`}
            >
              <span className="font-medium text-foreground/80">{ns.title}</span>
              <span className="tabular-nums">{ns.count}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
