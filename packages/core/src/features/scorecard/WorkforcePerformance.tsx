'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { WorkforceInventoryPanel } from '@/features/adoption/WorkforceInventoryPanel';
import { client } from '@/libs/Orpc';
import { hasRecordedWork, workforceInsights } from './workforceInsights';

type Overview = Awaited<ReturnType<typeof client.scorecard.workforceOverview>>;

export function WorkforcePerformance() {
  const t = useTranslations('WorkforceInventory');
  const d = useTranslations('WorkforceDashboard');
  const [days, setDays] = useState<1 | 7 | 30 | 90>(7);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void client.scorecard.workforceOverview({ days }).then((result) => {
      if (current) {
        setOverview(result);
      }
    }).catch(() => {
      if (current) {
        setFailed(true);
      }
    });
    return () => {
      current = false;
    };
  }, [days]);
  const selected = overview?.workspaces.find(w => w.id === selectedId);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={d('navigation')} className="flex items-center gap-2 text-sm">
          <button type="button" onClick={() => setSelectedId(null)} className={selected ? 'text-primary underline' : 'font-semibold'}>{d('allWorkspaces')}</button>
          {selected && (
            <>
              <span aria-hidden="true">/</span>
              <span>{selected.name}</span>
            </>
          )}
        </nav>
        <label className="flex items-center gap-2 text-sm">
          {t('period')}
          <select
            value={days}
            onChange={(e) => {
              setOverview(null);
              setFailed(false);
              setDays(Number(e.target.value) as 1 | 7 | 30 | 90);
            }}
            className="rounded-lg border border-border bg-background px-3 py-2"
          >
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
            : selected
              ? <WorkforceInventoryPanel key={`${selected.id}-${days}`} report={selected.report} workspaceSlug={selected.slug} />
              : (
                  <section className="space-y-4">
                    <div className="rounded-2xl bg-primary/5 p-6">
                      <p className="text-xs font-semibold tracking-wider text-primary uppercase">{d('overview')}</p>
                      <h2 className="mt-2 text-2xl font-semibold">{d('overviewTitle')}</h2>
                      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{d('overviewNote')}</p>
                      <div className="mt-5 flex flex-wrap gap-8">
                        {[{ label: d('workspaces'), value: overview.workspaces.length }, { label: d('agentsTitle'), value: overview.workspaces.reduce((sum, w) => sum + w.report.agents.length, 0) }, { label: d('working'), value: overview.workspaces.reduce((sum, w) => sum + w.report.agents.filter(hasRecordedWork).length, 0) }].map(item => (
                          <div key={item.label}>
                            <strong className="block text-3xl">{item.value}</strong>
                            <span className="text-xs text-muted-foreground">{item.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {overview.workspaces.map((workspace) => {
                      const { report } = workspace;
                      const active = report.agents.filter(hasRecordedWork).length;
                      const findings = workforceInsights(report).length;
                      return (
                        <button key={workspace.id} type="button" onClick={() => setSelectedId(workspace.id)} className="flex w-full flex-wrap items-center gap-5 rounded-xl border border-border p-5 text-left transition-colors hover:border-primary/50 hover:bg-muted/30">
                          <span className="min-w-40 flex-1">
                            <strong className="block text-lg">{workspace.name}</strong>
                            <span className="text-xs text-muted-foreground">{d('workspaceSize', { teams: report.teams.length, agents: report.agents.length })}</span>
                          </span>
                          <span className="w-40">
                            <span className="block text-sm">{d('teamActivity', { active, total: report.agents.length })}</span>
                            <span className="mt-2 block h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-primary" style={{ width: `${report.agents.length ? active / report.agents.length * 100 : 0}%` }} /></span>
                          </span>
                          <span className="text-sm">
                            <strong className="block">{report.agents.reduce((sum, a) => sum + a.reviewDecisions, 0)}</strong>
                            <span className="text-xs text-muted-foreground">{d('reviewsShort')}</span>
                          </span>
                          <span className="rounded-full bg-muted px-3 py-1 text-xs">{d('findings', { count: findings })}</span>
                          <span aria-hidden="true">→</span>
                        </button>
                      );
                    })}
                    {!overview.workspaces.length && <p>{d('noWorkspaces')}</p>}
                    <p className="text-xs text-muted-foreground">{d('scope')}</p>
                  </section>
                )}
    </div>
  );
}
