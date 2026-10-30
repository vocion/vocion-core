'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WorkforceInventoryPanel } from '@/features/adoption/WorkforceInventoryPanel';
import { Link, useRouter } from '@/libs/I18nNavigation';
import { workspaceUrl } from '@/libs/links';
import { client } from '@/libs/Orpc';
import { useWorkspaceSlug } from '@/libs/workspaceSlug';
import { operatingPath, operatingPeriod, operatingTotals } from './operatingModel';
import { TransformationPortfolio } from './TransformationPortfolio';
import { WorkforceOutcomes } from './WorkforceOutcomes';

type Overview = Awaited<ReturnType<typeof client.scorecard.workforceOverview>>;

export function WorkforcePerformance() {
  const t = useTranslations('WorkforceOperating');
  const d = useTranslations('WorkforceDashboard');
  const params = useSearchParams();
  const router = useRouter();
  const days = operatingPeriod(params.get('days'));
  const scope = params.get('scope');
  const team = params.get('team');
  const work = params.get('work');
  const workspaceSlug = useWorkspaceSlug();
  const [revision, setRevision] = useState(0);
  const requestKey = `${workspaceSlug ?? ''}:${days}:${scope ?? ''}:${revision}`;
  const [snapshot, setSnapshot] = useState<{ key: string; data: Overview | null; failed: boolean } | null>(null);
  const overview = snapshot?.key === requestKey ? snapshot.data : null;
  const failed = snapshot?.key === requestKey && snapshot.failed;
  useEffect(() => {
    let current = true;
    void client.scorecard.workforceOverview({ days }).then((result) => {
      if (current) {
        setSnapshot({ key: requestKey, data: result, failed: false });
      }
    }).catch(() => current && setSnapshot({ key: requestKey, data: null, failed: true }));
    return () => {
      current = false;
    };
  }, [days, requestKey]);
  const selected = overview?.workspaces.find(w => w.id === scope);
  const base = selected ? workspaceUrl(selected.slug, '/dashboard/scorecard') : '/dashboard/scorecard';
  const href = (nextScope: string | null, nextTeam: string | null = null, nextWork: string | null = null) => operatingPath(base, days, nextScope, nextTeam, nextWork);
  const teamOf = (workspace: NonNullable<Overview>['workspaces'][number], agentSlug: string) => {
    const agentTeam = workspace.report.agents.find(a => a.slug === agentSlug)?.teamSlug;
    return workspace.report.teams.some(t => t.slug === agentTeam) ? agentTeam : '';
  };
  const workspaces = selected ? [selected] : overview?.workspaces ?? [];
  const items = workspaces.flatMap(w => w.outcomes.items.filter(item => team === null || teamOf(w, item.agentSlug) === team).map(item => ({ ...item, workspace: w })));
  const totals = operatingTotals(items);
  const agents = workspaces.flatMap(w => w.report.agents.filter(a => team === null || teamOf(w, a.slug) === team));
  const costKnown = agents.filter(a => a.modelCostUsd !== null);
  const cost = costKnown.length ? costKnown.reduce((sum, a) => sum + a.modelCostUsd!, 0) : null;
  const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  const teamName = selected ? (team === '' ? t('unassigned') : selected.report.teams.find(t => t.slug === team)?.name) : undefined;
  const selectedWork = work === null ? null : items.find(item => item.id === work);
  const invalid = overview && ((scope !== null && !selected) || (team !== null && (!selected || teamName === undefined)) || (work !== null && (!selected || !selectedWork)));
  const priorities = workspaces.flatMap(w => w.outcomes.priorities.filter(p => items.some(item => item.workspace.id === w.id && item.id === p.itemId)).map(p => ({ ...p, workspace: w }))).sort((a, b) => a.priority - b.priority).slice(0, 5);
  const metricCards = [
    { title: t('accepted'), value: totals.accepted, note: t('acceptedNote', { total: totals.items }), link: '#work-portfolio' },
    { title: t('firstPass'), value: totals.reviewed ? `${Math.round(100 * totals.firstPass / totals.reviewed)}%` : t('unknown'), note: t('firstPassNote', { count: totals.firstPass, total: totals.reviewed }), link: '#work-portfolio' },
    { title: t('effort'), value: totals.effort === null ? t('unknown') : t('minutes', { count: totals.effort }), note: t('effortNote', { count: totals.effortReported, total: totals.items }), link: '#measurement-coverage' },
    { title: t('cost'), value: cost === null ? t('unknown') : money(cost), note: t('costNote', { count: costKnown.length, total: agents.length }), link: '#agent-evidence' },
  ];
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={d('navigation')} className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={href(null)} className="text-primary underline">{d('allWorkspaces')}</Link>
          {selected && (
            <>
              <span aria-hidden="true">/</span>
              <Link href={href(selected.id)} className="text-primary underline">{selected.name}</Link>
            </>
          )}
          {team !== null && teamName && (
            <>
              <span aria-hidden="true">/</span>
              <Link href={href(selected!.id, team)} className="text-primary underline">{teamName}</Link>
            </>
          )}
          {selectedWork && (
            <>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{selectedWork.title}</span>
            </>
          )}
        </nav>
        <label className="flex items-center gap-2 text-sm">
          {t('period')}
          <select value={days} onChange={e => router.push(operatingPath(base, operatingPeriod(e.target.value), scope, team, work))} className="rounded-lg border border-border bg-background px-3 py-2">
            <option value={1}>{d('daily')}</option>
            <option value={7}>{d('weekly')}</option>
            <option value={30}>30d</option>
            <option value={90}>90d</option>
          </select>
        </label>
      </div>
      {failed
        ? <p role="alert">{t('failed')}</p>
        : !overview
            ? <p role="status">{t('loading')}</p>
            : invalid
              ? <p role="alert">{t('missing')}</p>
              : (
                  <>
                    <header className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 to-background p-6">
                      <p className="text-xs font-semibold tracking-wider text-primary uppercase">{t('eyebrow')}</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight">{t('title')}</h2>
                      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('intro')}</p>
                      <p className="mt-3 text-xs text-muted-foreground">{t('cohort')}</p>
                    </header>
                    {selectedWork && selected && selected.id === overview.activeId ? <WorkforceOutcomes key={`${selected.id}-${days}-${work}`} days={days} agents={selected.report.agents} itemId={selectedWork.id} /> : null}
                    {!selectedWork && (
                      <>
                        {workspaces.some(w => !w.outcomes.complete) && <p role="alert" className="rounded-xl border border-amber-500 p-4 text-sm">{t('partial')}</p>}
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          {metricCards.map(metric => (
                            <a key={metric.title} href={metric.link} className="rounded-xl border border-border p-5 transition-colors hover:bg-muted/40">
                              <p className="text-xs text-muted-foreground">{metric.title}</p>
                              <strong className="mt-3 block text-3xl tracking-tight">{metric.value}</strong>
                              <p className="mt-3 text-xs text-muted-foreground">{metric.note}</p>
                            </a>
                          ))}
                        </div>
                        <TransformationPortfolio key={`${workspaceSlug}:${scope}:${team}`} workspaces={workspaces} selected={selected} activeId={overview.activeId} team={team} days={days} refresh={() => setRevision(r => r + 1)} />
                        <section className="space-y-3" aria-labelledby="operating-priorities">
                          <h3 id="operating-priorities" className="text-lg font-semibold">{t('priorities')}</h3>
                          <p className="text-sm text-muted-foreground">{t('prioritiesNote')}</p>
                          {priorities.map(p => (
                            <Link key={`${p.workspace.id}:${p.itemId}`} href={operatingPath(workspaceUrl(p.workspace.slug, '/dashboard/scorecard'), days, p.workspace.id, team, p.itemId)} className="block rounded-xl border border-l-4 border-border border-l-primary p-4 hover:bg-muted/30">
                              <span className="text-xs text-muted-foreground">{p.workspace.name}</span>
                              <strong className="mt-1 block text-sm">{p.text}</strong>
                              <p className="mt-2 text-xs text-muted-foreground">{p.evidence}</p>
                              <p className="mt-2 text-xs">{p.measure}</p>
                              <span className="mt-3 block text-xs font-medium text-primary">
                                {t('inspect')}
                                {' '}
                                →
                              </span>
                            </Link>
                          ))}
                          {!priorities.length && <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">{t('noPriorities')}</p>}
                        </section>
                        {!selected && (
                          <section className="space-y-3">
                            <h3 className="text-lg font-semibold">{t('workspaces')}</h3>
                            {overview.workspaces.map((w) => {
                              const s = operatingTotals(w.outcomes.items);
                              return (
                                <Link key={w.id} href={operatingPath(workspaceUrl(w.slug, '/dashboard/scorecard'), days, w.id)} className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-5 hover:bg-muted/30">
                                  <span className="min-w-40 flex-1">
                                    <strong className="block text-lg">{w.name}</strong>
                                    <span className="text-xs text-muted-foreground">{d('workspaceSize', { teams: w.report.teams.length, agents: w.report.agents.length })}</span>
                                  </span>
                                  <span className="text-sm">{t('rowAccepted', { count: s.accepted })}</span>
                                  <span className="text-sm">{t('rowPending', { count: s.pending })}</span>
                                  <span className="text-xs text-muted-foreground">{t('rowEvidence', { count: s.items })}</span>
                                  <span aria-hidden="true">→</span>
                                </Link>
                              );
                            })}
                          </section>
                        )}
                        <section id="work-portfolio" className="scroll-mt-20 space-y-3">
                          <h3 className="text-lg font-semibold">{t('portfolio')}</h3>
                          <p className="text-sm text-muted-foreground">{t('portfolioNote')}</p>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>{t('pending', { count: totals.pending })}</span>
                            <span>{t('completedPending', { count: totals.completedUnreviewed })}</span>
                            <span>{t('blocked', { count: totals.blocked })}</span>
                            <span>{t('stale', { count: totals.stale })}</span>
                          </div>
                          {items.map(item => (
                            <Link key={`${item.workspace.id}:${item.id}`} href={operatingPath(workspaceUrl(item.workspace.slug, '/dashboard/scorecard'), days, item.workspace.id, team, item.id)} className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-4 hover:bg-muted/30">
                              <span className="min-w-40 flex-1">
                                <strong className="block">{item.title}</strong>
                                <span className="text-xs text-muted-foreground">
                                  {item.workspace.name}
                                  {' '}
                                  ·
                                  {' '}
                                  {item.agentSlug}
                                  {' '}
                                  ·
                                  {' '}
                                  {item.workflow}
                                </span>
                              </span>
                              <span className="rounded-full bg-muted px-3 py-1 text-xs">{item.evidenceChanged ? t('changed') : item.status}</span>
                              <span className="text-xs text-primary">
                                {t('inspect')}
                                {' '}
                                →
                              </span>
                            </Link>
                          ))}
                          {!items.length && <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">{t('empty')}</p>}
                        </section>
                        <section id="measurement-coverage" className="scroll-mt-20 rounded-xl border border-border p-5 text-sm">
                          <h3 className="font-semibold">{t('coverage')}</h3>
                          <p className="mt-2 text-muted-foreground">{t('coverageNote', { reviewed: totals.reviewed, linked: totals.linked, total: totals.items })}</p>
                          <p className="mt-2 text-muted-foreground">{t('alignment')}</p>
                          <p className="mt-2 text-muted-foreground">{t('improvement')}</p>
                        </section>
                        {selected && <section id="agent-evidence" className="scroll-mt-20"><WorkforceInventoryPanel key={`${selected.id}-${days}`} report={selected.report} workspaceSlug={selected.slug} selectedTeam={team} teamHref={next => href(selected.id, next)} operating /></section>}
                        {!selected && <p id="agent-evidence" className="text-sm text-muted-foreground">{t('agentHint')}</p>}
                        {selected && selected.id === overview.activeId && (
                          <details className="rounded-xl border border-border p-5">
                            <summary className="cursor-pointer font-medium">{t('manage')}</summary>
                            <div className="mt-4"><WorkforceOutcomes days={days} agents={selected.report.agents} /></div>
                          </details>
                        )}
                      </>
                    )}
                    {selected && selected.id !== overview.activeId && <Link className="text-primary underline" href={href(selected.id, team, work)}>{d('openOutcomes')}</Link>}
                  </>
                )}
    </div>
  );
}
