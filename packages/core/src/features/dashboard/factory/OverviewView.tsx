import type { FactoryOverview, OverviewFigure, OverviewPanelView } from '@/services/factory/overview';
import { Link } from '@/libs/I18nNavigation';

/**
 * The `overview` archetype's renderer - the briefing.
 *
 * A server component and a pure function of the assembled page: every string
 * on screen was decided in `services/factory/overview.ts`, so what a person
 * reads here can be asserted in a unit test without a browser.
 *
 * Three rendering rules carry the page's argument:
 *
 *  1. **Content decides visual weight.** A section with nothing to say is one
 *     line, not a heading with an empty box under it. Today every section got
 *     the same ceremony whether or not it had anything to report, which is
 *     how a quiet factory ends up looking as busy as a stuck one.
 *  2. **Method is one click away, never beside the number.** Every panel's
 *     `method` prose lives inside a closed "How this is measured" affordance.
 *     A page a person steers by states conclusions.
 *  3. **Nothing is drawn as NOT MEASURABLE.** An instrumentation gap is
 *     tracked where instrumentation is fixed, not printed on a management
 *     surface in the place a number should be.
 */

function Method({ method }: { method?: string }) {
  if (!method) {
    return null;
  }
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">How this is measured</summary>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{method}</p>
    </details>
  );
}

function Figures({ figures }: { figures: OverviewFigure[] }) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
      {figures.map(f => (
        <div key={f.label} className="bg-background p-4">
          <div className="font-mono text-2xl font-semibold tabular-nums">{f.value}</div>
          <div className="mt-1 text-xs font-medium">{f.label}</div>
          {f.note && <div className="mt-1 text-xs text-muted-foreground">{f.note}</div>}
        </div>
      ))}
    </div>
  );
}

function PanelShell({ title, note, method, children }: { title: string; note?: string; method?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{note}</p>}
      <div className="mt-3">{children}</div>
      <Method method={method} />
    </section>
  );
}

/**
 * A section with nothing to report: one line, no box, no ceremony.
 * @param root0
 * @param root0.title
 * @param root0.line
 * @param root0.method
 */
function Collapsed({ title, line, method }: { title: string; line: string; method?: string }) {
  return (
    <section className="mb-6">
      <p className="text-sm">
        <span className="font-semibold">{title}</span>
        {' · '}
        <span className="text-muted-foreground">{line}</span>
      </p>
      <Method method={method} />
    </section>
  );
}

function MaybeLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? <Link href={href} className="underline underline-offset-2">{children}</Link> : <>{children}</>;
}

function Panel({ panel }: { panel: OverviewPanelView }) {
  if (panel.kind === 'judgment') {
    return (
      <section className="mb-8">
        <p className="max-w-3xl text-base font-medium">{panel.line}</p>
      </section>
    );
  }

  if (panel.kind === 'needsYou') {
    if (panel.collapsed) {
      return <Collapsed title={panel.title} line={panel.collapsed} method={panel.method} />;
    }
    return (
      <PanelShell title={`${panel.title} · ${panel.count}`} note={panel.note} method={panel.method}>
        <ul className="divide-y divide-border rounded-md border border-border">
          {panel.rows.map(row => (
            <li key={row.id} className="px-3 py-2 text-sm">
              <div className="font-medium">
                <MaybeLink href={row.href}>{row.title}</MaybeLink>
                {row.blocksWork && <span className="ml-2 text-xs font-normal text-muted-foreground">blocking work</span>}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {row.recommendation ? `Recommended: ${row.recommendation}` : 'No recommendation was filed with this decision'}
                {row.restated > 0 && ` · asked again ${row.restated} more times`}
              </div>
            </li>
          ))}
        </ul>
        {panel.more > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {panel.more}
            {' more on '}
            <Link href={panel.href} className="underline underline-offset-2">Review</Link>
            .
          </p>
        )}
        {panel.accounting && <p className="mt-2 text-xs text-muted-foreground">{panel.accounting}</p>}
      </PanelShell>
    );
  }

  if (panel.kind === 'active') {
    if (panel.empty) {
      return <Collapsed title={panel.title} line={panel.empty} method={panel.method} />;
    }
    return (
      <PanelShell title={panel.title} note={panel.note} method={panel.method}>
        <ul className="divide-y divide-border rounded-md border border-border">
          {panel.rows.map(row => (
            <li key={row.id} className="px-3 py-2 text-sm">
              <div className="font-medium"><MaybeLink href={row.href}>{row.title}</MaybeLink></div>
              <div className="mt-0.5 text-xs text-muted-foreground">{row.progress}</div>
            </li>
          ))}
        </ul>
        {panel.more > 0 && <p className="mt-2 text-xs text-muted-foreground">{`${panel.more} more in progress, on Work.`}</p>}
      </PanelShell>
    );
  }

  if (panel.kind === 'next') {
    return (
      <PanelShell title={panel.title} note={panel.note} method={panel.method}>
        {panel.empty
          ? <p className="text-sm text-muted-foreground">{panel.empty}</p>
          : (
              <ol className="divide-y divide-border rounded-md border border-border">
                {panel.rows.map(row => (
                  <li key={row.id} className="px-3 py-2 text-sm">
                    <div className="font-medium"><MaybeLink href={row.href}>{row.title}</MaybeLink></div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{row.why}</div>
                  </li>
                ))}
              </ol>
            )}
        {panel.unreasoned && <p className="mt-2 text-xs text-muted-foreground">{panel.unreasoned}</p>}
      </PanelShell>
    );
  }

  if (panel.kind === 'digest') {
    if (panel.collapsed) {
      return <Collapsed title={panel.title} line={panel.collapsed} method={panel.method} />;
    }
    return (
      <PanelShell title={`${panel.title} · ${panel.heading}`} note={panel.note} method={panel.method}>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {panel.lines.map(line => <li key={line}>{line}</li>)}
        </ul>
      </PanelShell>
    );
  }

  if (panel.kind === 'status') {
    return (
      <PanelShell title={panel.title} note={panel.note} method={panel.method}>
        {panel.empty
          ? <p className="text-sm text-muted-foreground">{panel.empty}</p>
          : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {panel.rows.map(row => (
                  <li key={row.id} className="px-3 py-2 text-sm">
                    <span className="font-medium"><MaybeLink href={row.href}>{row.headline}</MaybeLink></span>
                    <span className="ml-2 text-xs text-muted-foreground">{row.summary}</span>
                  </li>
                ))}
              </ul>
            )}
      </PanelShell>
    );
  }

  if (panel.kind === 'economics') {
    return (
      <PanelShell title={panel.title} note={panel.note} method={panel.method}>
        <Figures figures={panel.figures} />
      </PanelShell>
    );
  }

  return (
    <PanelShell title={panel.title} note={panel.note} method={panel.method}>
      <Figures figures={panel.figures} />
      {panel.sentence && <p className="mt-2 text-sm">{panel.sentence}</p>}
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
