'use client';

import type { BriefingMetric, BriefingV2 } from '@/services/briefings/document';
import type { InboxItem } from '@/services/InboxService';
import { ListRow, ListRows } from '@/components/ui/list-row';
import { Link } from '@/libs/I18nNavigation';
import { firstScreen } from '@/services/briefings/budget';
import { hasContent, SECTION_TITLE } from '@/services/briefings/document';
import { formatDelta, formatValue } from '@/services/briefings/format';
import { ON_TRACK_LABEL } from '@/services/briefings/onTrack';
import { DecisionCards } from './DecisionCards';
import { Disclosure } from './Disclosure';

/**
 * The briefing, rendered from the typed document
 * (`docs/specs/briefing-v2.md`).
 *
 * The whole of the review's "what I would attack first" is enforced above
 * this component, not inside it: sections with nothing in them never arrive
 * (`renderedSections`), the metric list is already capped and delta-joined,
 * the decision headline is already a lane split, the on-track verdict already
 * refuses to be green without evidence, and the narrative has already had
 * system vocabulary moved into the footnotes. This file's whole job is the
 * first screen — *title, date, one metrics line, the decisions, what changed,
 * today's clock* — with everything else behind a disclosure.
 * @param props
 * @param props.doc - The document.
 * @param props.liveDecisions - The open inbox now, so a card decided since the brief was written says so.
 */
export function BriefingView({ doc, liveDecisions }: { doc: BriefingV2; liveDecisions: InboxItem[] }) {
  const screen = firstScreen(doc);
  const onTrack = doc.today?.onTrack;
  const showOnTrack = onTrack && (onTrack.status !== 'not-enough-evidence' || onTrack.targetSet);

  return (
    <div data-briefing-root className="space-y-6">
      {/* 1 — Today. The metrics line IS the section; it needs no heading. */}
      {screen.metrics.length > 0 && (
        <section data-briefing-section="today">
          {/* A div, not a <p>: an unavailable metric carries a disclosure,
              and a disclosure is block content. */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[15px] leading-6">
            {screen.metrics.map((m, i) => (
              <span key={m.key} className="flex items-baseline gap-2">
                {i > 0 && <span aria-hidden className="text-muted-foreground/50">·</span>}
                <Metric metric={m} />
              </span>
            ))}
          </div>
          {doc.today?.summary && <p className="mt-2 text-[13px] text-muted-foreground">{doc.today.summary}</p>}
          {showOnTrack && (
            <p className="mt-2 text-[13px]">
              <span className="text-muted-foreground">Are we on track: </span>
              <span className={onTrack.status === 'not-enough-evidence' ? 'text-muted-foreground' : 'font-medium'}>{ON_TRACK_LABEL[onTrack.status]}</span>
              {onTrack.note && <span className="text-muted-foreground">{` — ${onTrack.note}`}</span>}
            </p>
          )}
        </section>
      )}

      {/* 2 — Needs your decision. Inbox rows, with the brief's why-now. */}
      {hasContent(doc, 'decisions') && (
        <DecisionCards cards={screen.decisions} live={liveDecisions} queued={doc.decisions!.queued} href={doc.decisions!.href} />
      )}

      {/* 3 — Changed since the last brief. Computed, then narrated. */}
      {screen.changes.length > 0 && (
        <section data-briefing-section="changes">
          <SectionHeading>{SECTION_TITLE.changes}</SectionHeading>
          <ul className="space-y-1.5 text-[13px]">
            {screen.changes.map(c => (
              <li key={c.key} className="leading-5">
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground">{` ${side(c.from, c.unit)} → ${side(c.to, c.unit)}`}</span>
                {c.narrative && <span>{` — ${c.narrative}`}</span>}
              </li>
            ))}
          </ul>
          {screen.foldedChanges.length > 0 && (
            <Disclosure className="mt-2" tone="quiet" label={`${screen.foldedChanges.length} more ${screen.foldedChanges.length === 1 ? 'change' : 'changes'}`}>
              <ul className="space-y-1.5 text-[13px]">
                {screen.foldedChanges.map(c => (
                  <li key={c.key} className="leading-5">
                    <span className="font-medium">{c.label}</span>
                    <span className="text-muted-foreground">{` ${side(c.from, c.unit)} → ${side(c.to, c.unit)}`}</span>
                    {c.narrative && <span>{` — ${c.narrative}`}</span>}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </section>
      )}

      {/* 4 — Today's critical path, in time order. */}
      {screen.criticalPath.length > 0 && (
        <section data-briefing-section="critical-path">
          <SectionHeading>{SECTION_TITLE.criticalPath}</SectionHeading>
          <ul className="space-y-1.5 text-[13px]">
            {[...screen.criticalPath].sort((a, b) => a.order - b.order).map(item => (
              <li key={`${item.order}-${item.label}`} className="flex gap-3 leading-5">
                <span className="w-14 shrink-0 font-medium tabular-nums">{item.at}</span>
                <span className="min-w-0">
                  {item.label}
                  {item.status && <span className="text-muted-foreground">{` · ${item.status}`}</span>}
                  {item.owner && <span className="text-muted-foreground">{` · ${item.owner}`}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 5 — Risks & exceptions. Only actual exceptions ever reach here. */}
      {hasContent(doc, 'exceptions') && (
        <section data-briefing-section="exceptions">
          <SectionHeading>{SECTION_TITLE.exceptions}</SectionHeading>
          <ul className="space-y-1.5 text-[13px]">
            {doc.exceptions!.items.map(e => (
              <li key={e.key} className="leading-5">
                <span className="font-medium">{e.label}</span>
                <span>{` — ${e.why}`}</span>
                {e.owner && <span className="text-muted-foreground">{` (${e.owner})`}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 6 — the depth, behind one disclosure. */}
      {hasContent(doc, 'detail') && (
        <section data-briefing-section="detail">
          <Disclosure label="View full pipeline">
            <div className="space-y-4">
              {doc.detail!.tables.filter(t => t.rows.length > 0).map(table => (
                <div key={table.title}>
                  <h3 className="mb-1.5 text-[13px] font-medium">{table.title}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[32rem] border-collapse text-[12px]">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          {table.columns.map(c => <th key={c} className="py-1.5 pr-3 font-medium">{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map(row => (
                          <tr key={row.join('|')} className="border-b border-border/60">
                            {row.map((cell, j) => <td key={`${table.columns[j] ?? j}-${cell}`} className="py-1.5 pr-3 align-top">{cell}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {table.note && <p className="mt-1.5 text-[12px] text-muted-foreground">{table.note}</p>}
                </div>
              ))}
            </div>
          </Disclosure>
        </section>
      )}

      {/* 7 — agent activity, only when something mattered. */}
      {hasContent(doc, 'agentActivity') && (
        <section data-briefing-section="agent-activity">
          <Disclosure tone="quiet" label={doc.agentActivity!.summary}>
            <ul className="space-y-1 text-[12px] text-muted-foreground">
              {doc.agentActivity!.lines.map(line => <li key={line}>{line}</li>)}
            </ul>
          </Disclosure>
        </section>
      )}

      {/* 8 — Sources & run details. Never "Evidence". */}
      {hasContent(doc, 'provenance') && (
        <section data-briefing-section="provenance">
          <Disclosure tone="quiet" label={SECTION_TITLE.provenance}>
            <ul className="space-y-1 text-[12px] text-muted-foreground">
              {doc.provenance!.sources.map(s => (
                <li key={`${s.kind}-${s.label}`}>
                  {s.href ? <Link href={s.href} className="hover:text-foreground">{s.label}</Link> : s.label}
                  {s.provenance && <span>{` · ${s.provenance}`}</span>}
                  {s.detail && <span>{` — ${s.detail}`}</span>}
                </li>
              ))}
              {doc.provenance!.footnotes.map(f => (
                <li key={f.marker}>
                  {`[${f.marker}] ${f.kind}: `}
                  <code className="rounded bg-muted px-1 py-px">{f.token}</code>
                </li>
              ))}
              {doc.provenance!.runs && (
                <li>
                  {`Runs ${doc.provenance!.runs.runs} · failed ${doc.provenance!.runs.failed} · spend $${(doc.provenance!.runs.spendCents / 100).toFixed(2)}`}
                </li>
              )}
            </ul>
          </Disclosure>
        </section>
      )}

      {/* 9 — the last few briefings, then the archive. */}
      {hasContent(doc, 'history') && (
        <section data-briefing-section="history">
          <SectionHeading>{SECTION_TITLE.history}</SectionHeading>
          <ListRows>
            {doc.history!.entries.map(e => (
              <ListRow key={e.id} href={e.href} title={e.title} meta={new Date(e.at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} />
            ))}
          </ListRows>
          <p className="mt-2 text-[13px]">
            <Link href={doc.history!.viewAllHref} className="text-brand-amber-deep hover:opacity-80">View all briefings</Link>
            {doc.history!.total > doc.history!.entries.length && (
              <span className="text-muted-foreground">{` — ${doc.history!.total} in all`}</span>
            )}
          </p>
        </section>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-base font-semibold tracking-tight">{children}</h2>;
}

/**
 * One metric. A number the source could not produce renders as a state with
 * the technical reason behind "Why?" — never as a zero, and never with the
 * connector's field name on the page (spec §7).
 * @param props
 * @param props.metric
 */
function Metric({ metric }: { metric: BriefingMetric }) {
  if (metric.value === null) {
    return (
      <span className="inline-flex items-baseline gap-1.5 text-muted-foreground">
        {metric.unavailable?.headline ?? `${metric.label} unavailable`}
        {metric.unavailable && (
          <Disclosure label="Why?" tone="quiet" className="inline-block align-baseline">
            <span className="block max-w-prose text-[12px] text-muted-foreground">{metric.unavailable.detail}</span>
          </Disclosure>
        )}
      </span>
    );
  }
  const delta = formatDelta(metric);
  return (
    <span>
      <span className="text-muted-foreground">{metric.label}</span>
      <span className="ml-1.5 font-medium tabular-nums">{formatValue(metric.value, metric.unit)}</span>
      {delta && <span className={`ml-1.5 text-[13px] tabular-nums ${metric.direction === 'up' ? 'text-emerald-600 dark:text-emerald-400' : metric.direction === 'down' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>{delta}</span>}
    </span>
  );
}

function side(v: number | string | null, unit?: string): string {
  if (v === null) {
    return 'gone';
  }
  return typeof v === 'number' ? formatValue(v, unit) : v;
}
