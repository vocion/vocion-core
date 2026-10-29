'use client';

import type { WorkforceInventory } from '@/services/adoption/WorkforceService';
import { useTranslations } from 'next-intl';

export function WorkforceInventoryPanel({ report }: { report: WorkforceInventory }) {
  const t = useTranslations('WorkforceInventory');
  const observed = report.agents.filter(a => a.modelCalls > 0 || a.toolCalls > 0 || a.reviewDecisions > 0).length;
  const exportReport = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `workforce-${report.workspaceId}-${report.generatedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t('title')}</h2>
        <button type="button" onClick={exportReport} className="rounded border border-border px-3 py-1 text-sm">{t('export')}</button>
      </div>
      <p className="text-sm">{t('summary', { teams: report.teams.length, agents: report.agents.length, enabled: report.agents.filter(a => a.enabled).length, observed, days: report.window.days })}</p>
      <p className="text-sm text-muted-foreground">{t('caveat')}</p>
      <p className="text-sm">{t('coverage', { events: report.coverage.localEvents, last: report.coverage.lastLocalEventAt ?? t('unknown'), unlinked: report.coverage.unlinkedAgentEvents })}</p>
      <p className="text-sm">{t('amplitude', { configuration: report.coverage.amplitudeConfiguration ?? t('notConfigured') })}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr>{(['agent', 'team', 'state', 'activity', 'reviewed', 'quality', 'cost', 'value', 'last'] as const).map(key => <th key={key} scope="col" className="p-2">{t(key)}</th>)}</tr></thead>
          <tbody>
            {report.agents.map(agent => (
              <tr key={agent.slug} className="border-t border-border">
                <td className="p-2">
                  <strong>{agent.name}</strong>
                  <p className="text-xs text-muted-foreground">{agent.purpose ?? t('missingPurpose')}</p>
                </td>
                <td className="p-2">{report.teams.find(team => team.slug === agent.teamSlug)?.name ?? agent.teamSlug ?? t('unassigned')}</td>
                <td className="p-2">{t(agent.enabled === null ? 'unknown' : agent.enabled ? 'enabled' : 'disabled')}</td>
                <td className="p-2">{t('counts', { models: agent.modelCalls, tools: agent.toolCalls })}</td>
                <td className="p-2">{agent.reviewDecisions}</td>
                <td className="p-2">{agent.acceptedAsIsRate == null ? t('qualityMissing') : `${Math.round(agent.acceptedAsIsRate * 100)}%`}</td>
                <td className="p-2">{agent.modelCostUsd == null ? t('unknown') : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(agent.modelCostUsd)}</td>
                <td className="p-2 text-muted-foreground">{t('notMeasured')}</td>
                <td className="p-2">{[agent.lastModelCallAt, agent.lastHumanActivityAt, agent.lastToolCallAt].filter(Boolean).sort().at(-1) ?? t('notObserved')}</td>
              </tr>
            ))}
            {!report.agents.length && <tr><td colSpan={9} className="p-2">{t('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">{t('valueGap')}</p>
      <details>
        <summary className="cursor-pointer text-sm">{t('teams')}</summary>
        <ul className="mt-2 space-y-2 text-sm">
          {report.teams.map(team => (
            <li key={team.slug}>
              <strong>{team.name}</strong>
              {' — '}
              {team.goal ?? t('missingGoal')}
              {' · '}
              {t('owner')}
              {': '}
              {team.ownerUserId ?? t('unassigned')}
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-muted-foreground">{t('generated', { at: report.generatedAt })}</p>
    </section>
  );
}
