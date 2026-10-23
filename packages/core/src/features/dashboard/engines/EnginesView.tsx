import type { EnginesQuery } from './engineBoard';
import type { EngineRunRow, EngineScore } from '@/services/factory/engineRun';
import { StatusPill } from '@/components/ui/status-pill';
import { Link } from '@/libs/I18nNavigation';
import { BOARD_LINES, boardColumns, duration, emptyColumn, emptyLine, enginesHref, money, OUTCOMES, runLinks, WINDOWS } from './engineBoard';
import { EnginesControls } from './EnginesControls';

function Board({ columns, factory }: { columns: EngineScore[]; factory: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-2 pr-4 text-xs font-medium text-muted-foreground">Engine</th>
            {columns.map(c => (
              <th key={c.engine} className="px-3 py-2 text-right font-mono text-xs font-semibold">
                {c.engine}
                {c.models.length > 0 && <div className="font-sans text-[11px] font-normal text-muted-foreground">{c.models.join(', ')}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BOARD_LINES.map(line => (
            <tr key={line.key} className="border-b border-border/50">
              <td className="py-1.5 pr-4 whitespace-nowrap" title={line.hint}>{line.label}</td>
              {columns.map(c => <td key={c.engine} className="px-3 py-1.5 text-right font-mono tabular-nums">{line.value(c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {columns.some(c => emptyColumn(c)) && (
        <p className="mt-2 text-[13px] text-muted-foreground">
          {columns.map(emptyColumn).filter(Boolean).join(' ')}
          {factory && (
            <>
              {' '}
              A workspace picks its engine with
              {' '}
              <code className="font-mono text-xs">harness.engine</code>
              {' '}
              on its task-engineer seat.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Runs({ rows, empty, timezone }: { rows: EngineRunRow[]; empty: string | null; timezone: string }) {
  const stamp = (d: Date) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone, timeZoneName: 'short' }).format(d);
  if (empty) {
    return <p className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground" data-testid="engines-empty">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Engine</th>
            <th className="px-3 py-2 font-medium">Seat</th>
            <th className="px-3 py-2 font-medium">Repo</th>
            <th className="px-3 py-2 font-medium">Outcome</th>
            <th className="px-3 py-2 text-right font-medium">Duration</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
            <th className="px-3 py-2 font-medium">Why this engine</th>
            <th className="px-3 py-2 font-medium">Links</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const links = runLinks(r);
            const outcome = OUTCOMES[r.outcome] ?? { label: r.outcome, pill: 'inactive' as const };
            const when = r.startedAt ?? r.createdAt;
            return (
              <tr key={r.id} className="border-b border-border/50 align-top">
                <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">{stamp(when)}</td>
                <td className="px-3 py-1.5 font-mono text-xs">
                  {r.engine}
                  {r.model && <div className="text-[11px] text-muted-foreground">{r.model}</div>}
                </td>
                <td className="px-3 py-1.5">{r.seat ?? '—'}</td>
                <td className="px-3 py-1.5 font-mono text-xs">
                  {r.repo ?? '—'}
                  {r.baseBranch && <span className="text-muted-foreground">{` → ${r.baseBranch}`}</span>}
                </td>
                <td className="px-3 py-1.5"><StatusPill status={outcome.pill} label={outcome.label} size="sm" /></td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{duration(r.durationS)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(r.cents)}</td>
                <td className="max-w-xs px-3 py-1.5 text-[13px] text-muted-foreground">{r.routeReason ?? (r.routePolicy ? r.routePolicy : 'not recorded')}</td>
                <td className="px-3 py-1.5 text-[13px] whitespace-nowrap">
                  <span className="flex gap-3">
                    {links.pr && <a href={links.pr} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">PR</a>}
                    {links.task && <Link href={links.task} className="underline-offset-2 hover:underline">Task</Link>}
                    {links.feature && <Link href={links.feature} className="underline-offset-2 hover:underline">Feature</Link>}
                    {links.run && <Link href={links.run} className="underline-offset-2 hover:underline">Run</Link>}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The Engines page (ADR 0005): every engine side by side on the same figures,
 * then the runs behind them, newest first, each with why its engine was
 * picked and where its work went.
 * @param props - The page.
 * @param props.slug - The page's slug, for its links.
 * @param props.query - The window, source and engine filter in force.
 * @param props.engines - The board's lines (`loadEngineScoreboard`).
 * @param props.rows - The runs (`listEngineRuns`), newest first.
 * @param props.since - Where the window starts.
 * @param props.timezone - The workspace's zone, for the run times.
 */
export function EnginesView({ slug, query, engines, rows, since, timezone }: { slug: string; query: EnginesQuery; engines: EngineScore[]; rows: EngineRunRow[]; since: Date; timezone: string }) {
  const columns = boardColumns(engines, query.source);
  const groups = [
    { label: 'Window', choices: WINDOWS.map(d => ({ key: String(d), label: `${d} days`, href: enginesHref(slug, query, { days: d }), chosen: query.days === d })) },
    { label: 'Source', choices: [
      { key: 'factory', label: 'Real work', href: enginesHref(slug, query, { source: 'factory', engine: null }), chosen: query.source === 'factory' },
      { key: 'eval', label: 'Eval', href: enginesHref(slug, query, { source: 'eval', engine: null }), chosen: query.source === 'eval' },
    ] },
  ];
  const note = `${query.source === 'eval' ? 'Eval runs' : 'Engineering runs'} since ${since.toISOString().slice(0, 10)}, brought up to date as this page was read.`;
  const filters = [{ key: 'all', label: 'All engines', engine: null as string | null }, ...columns.map(c => ({ key: c.engine, label: c.engine, engine: c.engine }))];
  return (
    <EnginesControls groups={groups} note={note}>
      <h2 className="mb-2 text-base font-semibold">Side by side</h2>
      <Board columns={columns} factory={query.source === 'factory'} />
      <div className="mt-10 mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Runs</h2>
        <nav className="flex flex-wrap gap-1 text-xs" aria-label="Engine">
          {filters.map(f => (
            <Link
              key={f.key}
              href={enginesHref(slug, query, { engine: f.engine })}
              scroll={false}
              aria-current={query.engine === f.engine ? 'page' : undefined}
              className={query.engine === f.engine
                ? 'rounded-full border border-foreground px-2 py-0.5 font-medium'
                : 'rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground'}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>
      <Runs rows={rows} empty={emptyLine(query, rows.length)} timezone={timezone} />
    </EnginesControls>
  );
}
