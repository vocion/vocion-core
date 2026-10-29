'use client';

import type { WorkforceInventory } from '@/services/adoption/WorkforceService';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { hasRecordedWork, workforceInsights } from '@/features/scorecard/workforceInsights';

type Agent = WorkforceInventory['agents'][number];

export function WorkforceInventoryPanel({ report, workspaceSlug }: { report: WorkforceInventory; workspaceSlug?: string }) {
  const t = useTranslations('WorkforceInventory');
  const d = useTranslations('WorkforceDashboard');
  const [teamSlug, setTeamSlug] = useState<string | null>(null);
  const [showAllInsights, setShowAllInsights] = useState(false);
  const agents = teamSlug === null ? report.agents : report.agents.filter(a => teamSlug ? a.teamSlug === teamSlug : !a.teamSlug || !report.teams.some(team => team.slug === a.teamSlug));
  const observed = agents.filter(hasRecordedWork).length;
  const insights = workforceInsights({ ...report, agents });
  const groups = [...report.teams.map(team => ({ slug: team.slug, name: team.name, goal: team.goal })), ...(report.agents.some(a => !a.teamSlug || !report.teams.some(team => team.slug === a.teamSlug)) ? [{ slug: '', name: t('unassigned'), goal: null }] : [])];
  const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);
  const path = (suffix: string) => workspaceSlug ? `/w/${encodeURIComponent(workspaceSlug)}/dashboard/${suffix}` : `/dashboard/${suffix}`;
  const exportReport = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `workforce-${report.workspaceId}-${report.generatedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const metrics = [
    { label: d('working'), value: `${observed} / ${agents.length}`, note: d('workingNote') },
    { label: t('reviewed'), value: agents.reduce((sum, a) => sum + a.reviewDecisions, 0), note: d('reviewNote') },
    { label: t('cost'), value: agents.some(a => a.modelCostUsd != null) ? money(agents.reduce((sum, a) => sum + (a.modelCostUsd ?? 0), 0)) : t('unknown'), note: d('costNote', { count: agents.filter(a => a.modelCostUsd != null).length, total: agents.length }) },
    { label: d('outcomes'), value: d('outcomesElsewhere'), note: d('outcomeNote') },
  ];
  const agentRow = (agent: Agent) => (
    <details key={agent.slug} className="group rounded-xl border border-border bg-background">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-4 p-4 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-semibold text-primary" aria-hidden="true">{agent.name.slice(0, 1)}</span>
        <span className="min-w-40 flex-1">
          <strong className="block">{agent.name}</strong>
          <span className="line-clamp-1 text-xs text-muted-foreground">{agent.purpose ?? t('missingPurpose')}</span>
        </span>
        <span className="rounded-full bg-muted px-2 py-1 text-xs">{agent.enabled === null ? t('unknown') : agent.enabled ? t('enabled') : t('disabled')}</span>
        <span className="text-right text-sm">
          <strong className="block">
            {agent.reviewDecisions}
            {' '}
            {d('reviewsShort')}
          </strong>
          <span className="text-xs text-muted-foreground">{agent.acceptedAsIsRate == null ? t('qualityMissing') : d('accepted', { rate: Math.round(agent.acceptedAsIsRate * 100) })}</span>
        </span>
        <span className="text-right text-sm">
          <strong className="block">{agent.modelCostUsd == null ? t('unknown') : money(agent.modelCostUsd)}</strong>
          <span className="text-xs text-muted-foreground">{d('recordedCost')}</span>
        </span>
        <span className="text-muted-foreground group-open:rotate-90" aria-hidden="true">›</span>
      </summary>
      <div className="space-y-3 border-t border-border p-4 text-sm">
        <p>{agent.purpose ?? t('missingPurpose')}</p>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-lg bg-muted px-3 py-2">{t('counts', { models: agent.modelCalls, tools: agent.toolCalls })}</span>
          <span className="rounded-lg bg-muted px-3 py-2">{d('capabilities', { skills: agent.skills.length, playbooks: agent.playbooks.length })}</span>
        </div>
        <p className="text-muted-foreground">
          {t('last')}
          :
          {' '}
          {[agent.lastModelCallAt, agent.lastHumanActivityAt, agent.lastToolCallAt].filter(Boolean).sort().at(-1) ?? t('notObserved')}
        </p>
        <p className="text-muted-foreground">
          {t('owner')}
          :
          {' '}
          {agent.ownerUserId ?? t('unassigned')}
        </p>
        <div className="flex flex-wrap gap-4">
          <a className="font-medium text-primary underline" href={path(`agents/${encodeURIComponent(agent.slug)}`)}>{d('openAgent')}</a>
          <a className="font-medium text-primary underline" href={path(`inbox?agents=${encodeURIComponent(agent.slug)}`)}>{d('openReviews')}</a>
          <a className="font-medium text-primary underline" href={path('playbooks')}>{d('openPlaybooks')}</a>
        </div>
      </div>
    </details>
  );
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{d('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('summary', { teams: report.teams.length, agents: report.agents.length, enabled: report.agents.filter(a => a.enabled).length, observed: report.agents.filter(hasRecordedWork).length, days: report.window.days })}</p>
        </div>
        <button type="button" onClick={exportReport} className="rounded-lg border border-border px-3 py-2 text-sm">{t('export')}</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(metric => (
          <div key={metric.label} className="rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{metric.value}</p>
            <p className="mt-2 text-xs text-muted-foreground">{metric.note}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 rounded-xl border border-border p-4 text-sm">
        <a className="font-medium text-primary underline" href={path('team-report')}>{d('dailyReport')}</a>
        <a className="font-medium text-primary underline" href={path('inbox?agents=org-review')}>{d('weeklyReview')}</a>
        <a className="font-medium text-primary underline" href={path('learnings')}>{d('feedbackRules')}</a>
        <p className="w-full text-xs text-muted-foreground">{d('existingLoop')}</p>
      </div>
      <section className="rounded-xl border border-border bg-muted/20 p-4">
        <h3 className="font-semibold">{d('priorities')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{d('insightNote')}</p>
        <div className="mt-4 space-y-3">
          {insights.slice(0, showAllInsights ? undefined : 5).map(({ agent, kind }) => (
            <details key={agent.slug} className="rounded-lg border border-border bg-background p-4">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                <strong>
                  {agent.name}
                  {' '}
                  ·
                  {' '}
                  {d(`${kind}Title`)}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {d('investigate')}
                  {' '}
                  →
                </span>
              </summary>
              <p className="mt-2 text-sm">{d(`${kind}Action`)}</p>
              <p className="mt-2 text-xs text-muted-foreground">{d('evidence', { models: agent.modelCalls, tools: agent.toolCalls, reviews: agent.reviewDecisions, rate: agent.acceptedAsIsRate == null ? t('unknown') : `${Math.round(agent.acceptedAsIsRate * 100)}%` })}</p>
              <p className="mt-1 text-xs text-muted-foreground">{d(`${kind}Measure`)}</p>
              <a href={path(kind === 'activation' ? `agents/${encodeURIComponent(agent.slug)}` : `inbox?agents=${encodeURIComponent(agent.slug)}${kind === 'corrections' || kind === 'sample' ? '&tab=decided' : ''}`)} className="mt-3 inline-block text-sm font-medium text-primary underline">
                {d(kind === 'activation' ? 'openAgent' : 'openReviews')}
                {' '}
                →
              </a>
            </details>
          ))}
          {insights.length > 5 && !showAllInsights && <button type="button" className="text-sm text-primary underline" onClick={() => setShowAllInsights(true)}>{d('moreInsights', { count: insights.length - 5 })}</button>}
          {!insights.length && <p className="text-sm text-muted-foreground">{d('noInsights')}</p>}
        </div>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">{d('howImprove')}</summary>
          <p className="mt-2 text-muted-foreground">{d('improvementGuide')}</p>
          <p className="mt-2 text-muted-foreground">{d('cadence')}</p>
        </details>
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{d('teamsTitle')}</h3>
          {teamSlug !== null && <button type="button" className="text-sm text-primary underline" onClick={() => setTeamSlug(null)}>{d('allTeams')}</button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((team) => {
            const members = report.agents.filter(a => team.slug ? a.teamSlug === team.slug : !a.teamSlug || !report.teams.some(t => t.slug === a.teamSlug));
            const active = members.filter(hasRecordedWork).length;
            return (
              <button key={team.slug} type="button" aria-pressed={teamSlug === team.slug} onClick={() => setTeamSlug(teamSlug === team.slug ? null : team.slug)} className={`rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 ${teamSlug === team.slug ? 'border-primary bg-primary/5' : 'border-border'}`}>
                <span className="flex justify-between gap-2">
                  <strong>{team.name}</strong>
                  <span aria-hidden="true">↗</span>
                </span>
                <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">{team.goal ?? t('missingGoal')}</span>
                <span className="mt-4 block h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-primary" style={{ width: `${members.length ? active / members.length * 100 : 0}%` }} /></span>
                <span className="mt-2 block text-xs text-muted-foreground">{d('teamActivity', { active, total: members.length })}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{d('barNote')}</p>
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">{d('agentsTitle')}</h3>
        {agents.map(agentRow)}
        {!agents.length && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      </section>
      <details className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium">{d('coverageTitle')}</summary>
        <p className="mt-3">{t('caveat')}</p>
        <p className="mt-2">{t('coverage', { events: report.coverage.localEvents, last: report.coverage.lastLocalEventAt ?? t('unknown'), unlinked: report.coverage.unlinkedAgentEvents })}</p>
        <p className="mt-2">{t('amplitude', { configuration: report.coverage.amplitudeConfiguration ?? t('notConfigured') })}</p>
        <p className="mt-2">{t('valueGap')}</p>
        <p className="mt-2 text-xs">{t('generated', { at: report.generatedAt })}</p>
      </details>
    </section>
  );
}
