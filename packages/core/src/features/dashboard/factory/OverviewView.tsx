import type { FactoryOverview, OverviewFigure, OverviewGap, OverviewPanelView } from '@/services/factory/overview';
import { Link } from '@/libs/I18nNavigation';

/**
 * The `overview` archetype's renderer - the 60-second control plane.
 *
 * A server component and a pure function of the assembled page: every string
 * on screen was decided in `services/factory/overview.ts`, so what a person
 * reads here can be asserted in a unit test without a browser.
 *
 * Two rendering rules carry the page's argument:
 *
 *  1. A GAP is drawn where its figure would have been, in the same grid, with
 *     the reason it is not measurable. It is not hidden and it is not styled
 *     as an error: an honest hole is a finding about the factory, and burying
 *     it would make the page comfortable and useless.
 *  2. The autonomy panel draws work autonomy and human interruption in two
 *     separate blocks under two separate headings. They are never adjacent
 *     figures in one strip, because side by side in one strip is exactly how
 *     "94% auto-completed" gets read as "and therefore nothing needs you".
 */

function Figures({ figures, gaps }: { figures: OverviewFigure[]; gaps: OverviewGap[] }) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
      {figures.map(f => (
        <div key={f.label} className="bg-background p-4">
          <div className="font-mono text-2xl font-semibold tabular-nums">{f.value}</div>
          <div className="mt-1 text-xs font-medium">{f.label}</div>
          {f.note && <div className="mt-1 text-xs text-muted-foreground">{f.note}</div>}
        </div>
      ))}
      {gaps.map(g => (
        <div key={g.label} className="bg-background p-4">
          <div className="font-mono text-2xl font-semibold text-muted-foreground tabular-nums">not measurable</div>
          <div className="mt-1 text-xs font-medium">{g.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{g.why}</div>
        </div>
      ))}
    </div>
  );
}

function PanelShell({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="mt-1 mb-3 max-w-3xl text-xs text-muted-foreground">{note}</p>}
      <div className={note ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function MaybeLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? <Link href={href} className="underline underline-offset-2">{children}</Link> : <>{children}</>;
}

function Panel({ panel }: { panel: OverviewPanelView }) {
  if (panel.kind === 'status') {
    return (
      <PanelShell title={panel.title} note={panel.note}>
        {panel.empty
          ? <Empty>{panel.empty}</Empty>
          : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {panel.rows.map(row => (
                  <li key={row.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2 text-sm">
                    <span className="font-medium"><MaybeLink href={row.href}>{row.headline}</MaybeLink></span>
                    {row.facts.map(f => (
                      <span key={f.label} className="text-xs text-muted-foreground">
                        {'· '}
                        {f.value}
                        {' '}
                        {f.label}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
      </PanelShell>
    );
  }

  if (panel.kind === 'digest') {
    return (
      <PanelShell title={panel.title} note={panel.note}>
        <p className={`mb-2 text-xs ${panel.sinceKnown ? 'text-muted-foreground' : 'font-medium'}`}>{panel.heading}</p>
        {panel.empty
          ? <Empty>{panel.empty}</Empty>
          : (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {panel.lines.map(line => <li key={line}>{line}</li>)}
              </ul>
            )}
      </PanelShell>
    );
  }

  if (panel.kind === 'active') {
    return (
      <PanelShell title={panel.title} note={panel.note}>
        {panel.empty
          ? <Empty>{panel.empty}</Empty>
          : (
              <>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {panel.rows.map(row => (
                    <li key={row.id} className="px-3 py-2 text-sm">
                      <div className="font-medium"><MaybeLink href={row.href}>{row.title}</MaybeLink></div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {row.progress}
                        {' · waiting on '}
                        {row.waitingOn}
                      </div>
                    </li>
                  ))}
                </ul>
                {panel.more > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {panel.more}
                    {' more in flight than this panel shows. The unit here is the outcome, not the worker run.'}
                  </p>
                )}
              </>
            )}
      </PanelShell>
    );
  }

  if (panel.kind === 'next') {
    return (
      <PanelShell title={panel.title} note={panel.note}>
        {panel.empty
          ? <Empty>{panel.empty}</Empty>
          : (
              <ol className="divide-y divide-border rounded-md border border-border">
                {panel.rows.map(row => (
                  <li key={row.id} className="px-3 py-2 text-sm">
                    <div className="font-medium"><MaybeLink href={row.href}>{row.title}</MaybeLink></div>
                    <div className={`mt-0.5 text-xs ${row.reasonRecorded ? 'text-muted-foreground' : 'text-muted-foreground italic'}`}>
                      {'Why: '}
                      {row.why}
                    </div>
                  </li>
                ))}
              </ol>
            )}
      </PanelShell>
    );
  }

  if (panel.kind === 'needsYou') {
    return (
      <PanelShell title={panel.title} note={panel.note}>
        <Figures figures={panel.figures} gaps={panel.gaps} />
        <p className="mt-2 text-xs">
          <Link href={panel.href} className="underline underline-offset-2">Open Review</Link>
        </p>
      </PanelShell>
    );
  }

  if (panel.kind === 'economics') {
    return (
      <PanelShell title={panel.title} note={panel.note}>
        <Figures figures={panel.figures} gaps={panel.gaps} />
      </PanelShell>
    );
  }

  return (
    <PanelShell title={panel.title} note={panel.note}>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Work autonomy</h3>
      <Figures figures={panel.work} gaps={[]} />
      <h3 className="mt-4 mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">What it cost a person</h3>
      <p className="mb-2 max-w-3xl text-xs text-muted-foreground">
        A different measure, kept separate on purpose. How much work finished on its own says nothing about
        how much of a person&apos;s day it took, or how much of that was worth taking.
      </p>
      <Figures figures={panel.attention} gaps={panel.gaps} />
    </PanelShell>
  );
}

/**
 * Draw an assembled overview.
 * @param props
 * @param props.overview - The output of `assembleOverview`.
 */
export function OverviewView({ overview }: { overview: FactoryOverview }) {
  return (
    <div>
      {overview.panels.map((panel, i) => <Panel key={`${panel.kind}-${i}`} panel={panel} />)}
    </div>
  );
}
