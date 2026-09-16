'use client';

import type { AccordionItem } from '@/components/patterns';
import type { BriefingMetric, BriefingV2 } from '@/services/briefings/document';
import type { InboxItem } from '@/services/InboxService';
import { useState } from 'react';
import { Accordion, DetailMeta, DetailPage, ListRow, ListRows, Section } from '@/components/patterns';
import { Link } from '@/libs/I18nNavigation';
import { firstScreen } from '@/services/briefings/budget';
import { hasContent, SECTION_TITLE } from '@/services/briefings/document';
import { formatDelta, formatValue } from '@/services/briefings/format';
import { ON_TRACK_LABEL } from '@/services/briefings/onTrack';
import { DecisionCards } from './DecisionCards';

/**
 * The briefing, rendered from the typed document
 * (`docs/specs/briefing-v2.md`), on the Detail archetype
 * (`docs/design/patterns.md` § Detail): crumbs, the brief as the H1, one meta
 * line, then hairline-divided `Section`s. Every disclosure on the page is the
 * pattern library's `Accordion`, so "there is more underneath" looks the same
 * in all five places it happens, and the history rows and decision rows are
 * `patterns/ListRow` like every other list in the app.
 *
 * The whole of the review's "what I would attack first" is enforced ABOVE
 * this component, not inside it: sections with nothing in them never arrive
 * (`renderedSections`), the metric list is already capped and delta-joined,
 * the decision headline is already a lane split, the on-track verdict already
 * refuses to be green without evidence, and the narrative has already had
 * system vocabulary moved into the footnotes. This file's whole job is the
 * first screen — *title, date, one metrics line, the decisions, what changed,
 * today's clock* — with everything else behind a disclosure.
 *
 * **No control on this page opens the conversation with a prefilled prompt.**
 * Every actionable item routes to the surface that does the thing; asking
 * about the brief is the selection path (`BriefingChatStarter`), which is
 * secondary by construction. A chip that sends "Do this: 4 learning
 * candidates to adopt or reject" as a chat message is a prompt pretending to
 * be an action.
 * @param props
 * @param props.doc - The document.
 * @param props.liveDecisions - The open inbox now, so a card decided since the brief was written says so.
 */
export function BriefingView({ doc, liveDecisions }: { doc: BriefingV2; liveDecisions: InboxItem[] }) {
  const screen = firstScreen(doc);
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (id: string, next: boolean) => setOpen(ids => (next ? [...ids, id] : ids.filter(x => x !== id)));

  const onTrack = doc.today?.onTrack;
  const showOnTrack = onTrack && (onTrack.status !== 'not-enough-evidence' || onTrack.targetSet);
  const readable = screen.metrics.filter(m => m.value !== null);
  const unreadable = screen.metrics.filter(m => m.value === null && m.unavailable);

  // The three things kept underneath: depth, operations, provenance. One
  // Accordion, so the page has one way of saying "there is more".
  const depth: AccordionItem[] = [];
  if (hasContent(doc, 'detail')) {
    const tables = doc.detail!.tables.filter(t => t.rows.length > 0);
    depth.push({
      id: 'detail',
      label: SECTION_TITLE.detail,
      title: 'View full pipeline',
      meta: `${tables.reduce((n, t) => n + t.rows.length, 0)} rows`,
      children: (
        <div className="space-y-4">
          {tables.map(table => (
            <div key={table.title}>
              <h4 className="mb-1.5 text-[13px] font-medium">{table.title}</h4>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-rule text-left text-muted-foreground">
                      {table.columns.map(c => <th key={c} className="py-1.5 pr-3 font-medium">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map(row => (
                      <tr key={row.join('|')} className="border-b border-rule/60">
                        {row.map((cell, j) => <td key={`${table.columns[j] ?? j}-${cell}`} className="py-1.5 pr-3 align-top tabular-nums">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {table.note && <p className="mt-1.5 text-[13px] text-muted-foreground">{table.note}</p>}
            </div>
          ))}
        </div>
      ),
    });
  }
  if (hasContent(doc, 'agentActivity')) {
    depth.push({
      id: 'agent-activity',
      label: SECTION_TITLE.agentActivity,
      title: doc.agentActivity!.summary,
      children: (
        <ul className="space-y-1 text-[13px] text-muted-foreground">
          {doc.agentActivity!.lines.map(line => <li key={line}>{line}</li>)}
        </ul>
      ),
    });
  }
  if (hasContent(doc, 'provenance')) {
    const p = doc.provenance!;
    depth.push({
      id: 'provenance',
      label: SECTION_TITLE.provenance,
      title: `${p.sources.length} ${p.sources.length === 1 ? 'source' : 'sources'}`,
      children: (
        <ul className="space-y-1 text-[13px] text-muted-foreground">
          {p.sources.map(s => (
            <li key={`${s.kind}-${s.label}`}>
              {s.href ? <Link href={s.href} className="hover:text-foreground">{s.label}</Link> : s.label}
              {s.provenance && <span>{` · ${s.provenance}`}</span>}
              {s.detail && <span>{` — ${s.detail}`}</span>}
            </li>
          ))}
          {p.footnotes.map(f => (
            <li key={f.marker}>
              {`[${f.marker}] ${f.kind}: `}
              <code className="rounded bg-muted px-1 py-px">{f.token}</code>
            </li>
          ))}
          {p.runs && <li>{`Runs ${p.runs.runs} · failed ${p.runs.failed} · spend $${(p.runs.spendCents / 100).toFixed(2)}`}</li>}
        </ul>
      ),
    });
  }

  return (
    // `data-briefing-root` is the selection root the rail watches (#329,
    // docs/agent-chat-surface.md §3.3): highlight any passage of the brief and
    // "Ask Vocion" opens the conversation with it quoted.
    <div data-briefing-root>
      <DetailPage
        data-testid="briefing"
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Briefings', href: '/dashboard/briefings' }, { label: doc.title }]}
        title={doc.title}
        subtitle={`${doc.dateLabel} · ${doc.updatedLabel}`}
        meta={readable.length > 0 ? <DetailMeta items={readable.map(m => <Metric key={m.key} metric={m} />)} /> : undefined}
      >
        {/* 1 — Today. The metrics line is the header's meta; what belongs here
            is the sentence, the verdict, and any number the source could not
            produce — rendered as a state, never as a zero. */}
        {(doc.today?.summary || showOnTrack || unreadable.length > 0) && (
          <Section eyebrow={SECTION_TITLE.today} data-testid="briefing-today">
            {doc.today?.summary && <p className="text-muted-foreground">{doc.today.summary}</p>}
            {showOnTrack && (
              <p className="mt-2 text-[13px]">
                <span className="text-muted-foreground">Are we on track: </span>
                <span className={onTrack.status === 'not-enough-evidence' ? 'text-muted-foreground' : 'font-medium'}>{ON_TRACK_LABEL[onTrack.status]}</span>
                {onTrack.note && <span className="text-muted-foreground">{` — ${onTrack.note}`}</span>}
              </p>
            )}
            {unreadable.length > 0 && (
              <Accordion
                className="mt-2"
                open={open}
                onToggle={toggle}
                items={unreadable.map(m => ({
                  id: `why-${m.key}`,
                  label: m.unavailable!.headline,
                  title: 'Why?',
                  children: <p className="max-w-prose text-[13px] text-muted-foreground">{m.unavailable!.detail}</p>,
                }))}
              />
            )}
          </Section>
        )}

        {/* 2 — Needs your decision. Inbox rows, with the brief's why-now. */}
        {hasContent(doc, 'decisions') && (
          <DecisionCards cards={screen.decisions} live={liveDecisions} queued={doc.decisions!.queued} href={doc.decisions!.href} />
        )}

        {/* 3 — Changed since the last brief. Computed, then narrated. */}
        {screen.changes.length > 0 && (
          <Section eyebrow={SECTION_TITLE.changes} data-testid="briefing-changes">
            <ul className="space-y-1.5" data-slot="changes">
              {screen.changes.map(c => (
                <li key={c.key} className="leading-5">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-muted-foreground tabular-nums">{` ${side(c.from, c.unit)} → ${side(c.to, c.unit)}`}</span>
                  {c.narrative && <span>{` — ${c.narrative}`}</span>}
                </li>
              ))}
            </ul>
            {screen.foldedChanges.length > 0 && (
              <Accordion
                className="mt-2"
                open={open}
                onToggle={toggle}
                items={[{
                  id: 'more-changes',
                  label: 'Smaller moves',
                  title: `${screen.foldedChanges.length} more`,
                  children: (
                    <ul className="space-y-1.5 text-[13px]">
                      {screen.foldedChanges.map(c => (
                        <li key={c.key} className="leading-5">
                          <span className="font-medium">{c.label}</span>
                          <span className="text-muted-foreground tabular-nums">{` ${side(c.from, c.unit)} → ${side(c.to, c.unit)}`}</span>
                          {c.narrative && <span>{` — ${c.narrative}`}</span>}
                        </li>
                      ))}
                    </ul>
                  ),
                }]}
              />
            )}
          </Section>
        )}

        {/* 4 — Today's critical path, in time order. */}
        {screen.criticalPath.length > 0 && (
          <Section eyebrow={SECTION_TITLE.criticalPath} data-testid="briefing-critical-path">
            <ul className="space-y-1.5">
              {[...screen.criticalPath].sort((a, b) => a.order - b.order).map(item => (
                <li key={`${item.order}-${item.label}`} className="flex gap-3 leading-5">
                  <span className="w-16 shrink-0 font-medium tabular-nums">{item.at}</span>
                  <span className="min-w-0">
                    {item.label}
                    {item.status && <span className="text-muted-foreground">{` · ${item.status}`}</span>}
                    {item.owner && <span className="text-muted-foreground">{` · ${item.owner}`}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* 5 — Risks & exceptions. Only actual exceptions ever reach here. */}
        {hasContent(doc, 'exceptions') && (
          <Section eyebrow={SECTION_TITLE.exceptions} data-testid="briefing-exceptions">
            <ul className="space-y-1.5">
              {doc.exceptions!.items.map(e => (
                <li key={e.key} className="leading-5">
                  <span className="font-medium">{e.label}</span>
                  <span>{` — ${e.why}`}</span>
                  {e.owner && <span className="text-muted-foreground">{` (${e.owner})`}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* 6, 7, 8 — depth, operations and provenance, all behind one control. */}
        {depth.length > 0 && (
          <Section eyebrow="Detail & provenance" tone="quiet" data-testid="briefing-depth">
            <Accordion items={depth} open={open} onToggle={toggle} />
          </Section>
        )}

        {/* 9 — the last few briefings, then the archive. */}
        {hasContent(doc, 'history') && (
          <Section
            eyebrow={SECTION_TITLE.history}
            data-testid="briefing-history"
            action={(
              <Link href={doc.history!.viewAllHref} className="text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
                {`View all briefings${doc.history!.total > doc.history!.entries.length ? ` (${doc.history!.total})` : ''}`}
              </Link>
            )}
          >
            <ListRows>
              {doc.history!.entries.map(e => (
                <ListRow
                  key={e.id}
                  href={e.href}
                  title={e.title}
                  subline={new Date(e.at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                />
              ))}
            </ListRows>
          </Section>
        )}
      </DetailPage>
    </div>
  );
}

/**
 * One metric on the meta line: *Open pipeline $3.52M ↑ $210K*. A metric with
 * no prior value renders the value alone — there is no branch that prints a
 * zero delta.
 * @param props
 * @param props.metric - The metric.
 */
function Metric({ metric }: { metric: BriefingMetric }) {
  const delta = formatDelta(metric);
  return (
    <span data-slot="metric" data-metric={metric.key}>
      <span>{metric.label}</span>
      <span className="ml-1.5 font-medium text-foreground tabular-nums">{formatValue(metric.value!, metric.unit)}</span>
      {delta && (
        <span className={`ml-1.5 tabular-nums ${metric.direction === 'up' ? 'text-emerald-600 dark:text-emerald-400' : metric.direction === 'down' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
          {delta}
        </span>
      )}
    </span>
  );
}

function side(v: number | string | null, unit?: string): string {
  if (v === null) {
    return 'gone';
  }
  return typeof v === 'number' ? formatValue(v, unit) : v;
}
