import type { JevDecisionHealth, JevOutcomes } from '@/services/routing/health';
import type { RoutingSummary } from '@/services/spend/routing';
import { dollars } from '@/features/spend/SpendView';
import { Link } from '@/libs/I18nNavigation';
import { JevHealth } from './JevHealth';
import { share } from './routingStatus';

/**
 * ROUTING on the Observability page (ADR 0006): how dynamic routing chose over
 * the spend period. Whether it is on and on whose key; agent turns Jev routed
 * against turns that ran the configured model (fallbacks, with why); first
 * messages Jev assigned an agent; and spend by model split by how the model
 * was chosen. The factory's engines have their own page.
 */

export function RoutingSection(props: { summary: RoutingSummary; status: string; periodLabel: string; health?: { decisions: JevDecisionHealth[]; outcomes: JevOutcomes; canCheck: boolean } | null }) {
  const { summary } = props;
  const total = summary.turns.jev + summary.turns.configured;
  return (
    <section id="routing" aria-labelledby="routing-title" className="space-y-4">
      <div className="px-2">
        <div id="routing-title" className="text-[15px] font-semibold">Routing</div>
        <p className="text-sm text-muted-foreground">
          {props.status}
          {' '}
          Factory engines are on the
          {' '}
          <Link href="/dashboard/p/engines" className="text-primary hover:underline">Engines</Link>
          {' '}
          page.
        </p>
      </div>

      {props.health && <JevHealth health={props.health.decisions} outcomes={props.health.outcomes} canCheck={props.health.canCheck} />}

      <div className="grid gap-6 border-y border-border/70 px-2 py-4 sm:grid-cols-4">
        <Figure label={`Turns Jev routed (${props.periodLabel})`} value={String(summary.turns.jev)} hint={`${share(summary.turns.jev, total)} of routed turns`} />
        <Figure label="Ran the configured model" value={String(summary.turns.configured)} hint="Jev unsure, unreachable or skipped" />
        <Figure label="First messages Jev assigned" value={String(summary.agentPicks.jev)} hint={`${summary.agentPicks.modelRead} left to the model read`} />
        <Figure label="Routed turns" value={String(total)} hint="each turn counted once" />
      </div>

      {total === 0 && summary.agentPicks.jev + summary.agentPicks.modelRead === 0
        ? <p className="px-2 text-sm text-muted-foreground">Nothing routed in this period.</p>
        : (
            <div className="grid gap-6 md:grid-cols-2">
              <Table
                title="By kind of run"
                head={['Run', 'Jev', 'Configured']}
                rows={summary.byKind.map(k => [k.kind, String(k.jev), String(k.configured)])}
              />
              <Table
                title="Why the configured model ran"
                head={['Reason', 'Turns']}
                rows={summary.fallbacks.map(f => [f.reason, String(f.turns)])}
              />
            </div>
          )}

      <Table
        title="Spend by model"
        head={['Model', 'Chosen by', 'Calls', 'Spend']}
        rows={summary.spendByModel.map(r => [r.model, r.selector === 'jev' ? 'Jev' : r.selector === 'configured' ? 'configured (Jev fell back)' : 'not routed', String(r.calls), dollars(r.microCents)])}
      />
    </section>
  );
}

function Figure(props: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="text-2xl font-semibold tabular-nums">{props.value}</div>
      <div className="text-xs text-muted-foreground">{props.hint}</div>
    </div>
  );
}

function Table(props: { title: string; head: string[]; rows: string[][] }) {
  return (
    <div>
      <div className="mb-1 px-2 text-sm font-medium">{props.title}</div>
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
                {props.rows.map(r => (
                  <tr key={r.join('|')}>
                    {r.map((cell, i) => <td key={`${props.head[i]}`} className={i === 0 ? 'px-2 py-2 font-mono text-xs' : 'px-2 py-2 tabular-nums'}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
    </div>
  );
}
