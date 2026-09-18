import type { TeamReport } from '@/services/TeamReportService';
import { Check, Circle, CircleDashed } from 'lucide-react';
import { createElement } from 'react';
import { ownerDisplayName } from '@/features/dashboard/teams/helpers';
import { agentAccent } from '@/libs/agentAccents';
import { agentIcon } from '@/libs/agentIcons';
import { Link } from '@/libs/I18nNavigation';
import { ConfigureWorkforce } from './ConfigureWorkforce';

/**
 * The setup state (spec §10): "N things needed before performance can be
 * measured", a four-line checklist, one primary action, and the teams
 * underneath as a light roster. No zeroes pretending to be a report; no
 * file paths in the primary copy.
 * @param props
 * @param props.report
 * @param props.isAdmin
 */
export function WorkforceSetup({ report, isAdmin }: { report: TeamReport; isAdmin: boolean }) {
  const s = report.setup;
  const teams = report.teams.map(t => ({ slug: t.slug, name: t.name, mission: t.mission, hasMeasure: t.contract.measures.length > 0 }));
  const headline = s.missing > 0
    ? `${s.missing} thing${s.missing === 1 ? '' : 's'} needed before performance can be measured`
    : 'Configured — waiting for the first completed work';
  return (
    <>
      <section className="border-b border-border pb-8">
        <h2 className="text-lg font-semibold tracking-tight">{headline}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The report graduates from this checklist to team performance once the workspace states an outcome, at least one team has a measure, and work has completed.
        </p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {s.items.map(item => (
            <div key={item.key} className="flex items-start gap-2.5">
              {item.status === 'ok'
                ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                : item.status === 'missing'
                  ? <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                  : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" aria-hidden />}
              <div className="min-w-0">
                <dt className="text-sm font-medium">{item.label}</dt>
                <dd className={`text-sm ${item.status === 'missing' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{item.detail}</dd>
              </div>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ConfigureWorkforce goal={report.goal} teams={teams} isAdmin={isAdmin} />
          {s.reasons.includes('no-work') && !s.reasons.includes('no-measures') && (
            <span className="text-xs text-muted-foreground">Measures are set — the report appears once a run completes or an action executes.</span>
          )}
        </div>
      </section>

      <section className="py-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Teams</h3>
          <Link href="/dashboard/teams" className="text-xs font-medium text-primary hover:underline">Org chart</Link>
        </div>
        {report.teams.length === 0 && report.ungrouped.length === 0 && (
          <p className="text-sm text-muted-foreground">No teams or agents yet. Load a starter workspace from the org chart, or add teams to the workspace.</p>
        )}
        <ul className="divide-y divide-border/60">
          {report.teams.map(t => (
            <li key={t.slug} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
              <Link href={`/dashboard/teams/${t.slug}`} className="text-sm font-medium hover:text-primary">{t.name}</Link>
              <span className="text-xs text-muted-foreground">{t.mission ?? 'No mission yet'}</span>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                {t.members.map((m) => {
                  const a = agentAccent(m.accent);
                  return (
                    <span key={m.slug} title={`${m.name}${m.isLead ? ' · AI lead' : ''}`} className="flex size-5 items-center justify-center rounded-sm" style={{ background: a.tint, color: a.ink }}>
                      {createElement(agentIcon(m.icon, { primary: m.isLead }), { 'className': 'size-3', 'aria-hidden': true })}
                    </span>
                  );
                })}
                <span>
                  {t.members.length}
                  {t.members.length === 1 ? ' agent' : ' agents'}
                </span>
                <span className="text-muted-foreground/60">·</span>
                <span>{t.contract.owner ? ownerDisplayName(t.contract.owner) : 'no owner'}</span>
                <span className="text-muted-foreground/60">·</span>
                <span className={t.contract.measures.length > 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}>{t.contract.measures.length > 0 ? 'measured' : 'no measure'}</span>
              </span>
            </li>
          ))}
          {report.ungrouped.length > 0 && (
            <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
              <span className="text-sm font-medium text-muted-foreground">Unassigned agents</span>
              <span className="text-xs text-muted-foreground">{report.ungrouped.map(m => m.name).join(', ')}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {report.ungrouped.length}
                {report.ungrouped.length === 1 ? ' agent' : ' agents'}
              </span>
            </li>
          )}
        </ul>
      </section>
    </>
  );
}
