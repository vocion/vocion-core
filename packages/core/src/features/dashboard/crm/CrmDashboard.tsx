'use client';

import type { crmDashboard } from '@/services/crm/dashboard';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { CampaignPlanner } from './CampaignPlanner';

type Dashboard = Awaited<ReturnType<typeof crmDashboard>>;

export function CrmDashboard({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('CrmDashboard');
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  async function refresh() {
    const response = await fetch(`/api/v1/crm?workspace=${encodeURIComponent(workspaceId)}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(t('loadError'));
    }
    setData(await response.json());
  }
  useEffect(() => {
    void refresh().catch(e => setError(String(e.message)));
    const timer = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [workspaceId]);
  async function sync() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/crm?workspace=${encodeURIComponent(workspaceId)}`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message ?? t('queueError'));
      }
      setProgress(t('queued'));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('resume'));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mb-8 space-y-4 rounded-xl border p-5" aria-label="CRM funnel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t('funnel')}</h2>
        {data?.canSync && <button type="button" className="rounded-md border px-3 py-2 text-sm disabled:opacity-50" onClick={() => void sync()} disabled={busy}>{busy ? t('syncing') : t('sync')}</button>}
      </div>
      <p className="text-sm text-muted-foreground">
        {!data ? t('loadingPolicy') : data.dryRun ? t('dryRun') : t('workspace')}
        {' '}
        {' · '}
        {t('source')}
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {progress && <p role="status" className="text-sm">{progress}</p>}
      {!data && !error && <p role="status">{t('loading')}</p>}
      {data && (
        <>
          <p className="text-xs text-muted-foreground">
            {data.sync?.lastCompletedAt ? t('lastSync', { date: new Date(data.sync.lastCompletedAt).toLocaleString() }) : t('incomplete')}
            {data.sync && ` · ${data.sync.status}`}
            {data.sync?.error && ` · ${data.sync.error}`}
          </p>
          <div className="flex flex-wrap gap-3">{data.lists.map(list => <Link className="text-sm underline" key={list.id} href={`/dashboard/lists/${list.id}`}>{list.title}</Link>)}</div>
          <h3 className="font-medium">{t('lifecycle')}</h3>
          {data.leads.length === 0
            ? <p className="text-sm text-muted-foreground">{t('empty')}</p>
            : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {data.leads.map(row => (
                    <div className="rounded-lg bg-muted p-3" key={row.stage}>
                      <div className="text-2xl font-semibold">{row.count}</div>
                      <div className="text-sm">{row.stage}</div>
                    </div>
                  ))}
                </div>
              )}
          <h3 className="font-medium">{t('deals')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">{t('pipeline')}</th>
                  <th className="p-2">{t('stage')}</th>
                  <th className="p-2">{t('dealCount')}</th>
                  <th className="p-2">{t('amount')}</th>
                </tr>
              </thead>
              <tbody>
                {data.deals.map(row => (
                  <tr className="border-t" key={`${row.pipelineId}-${row.stageId}-${row.pipeline}-${row.stage}-${row.currency}`}>
                    <td className="p-2">{row.pipeline}</td>
                    <td className="p-2">{row.stage}</td>
                    <td className="p-2">{row.count}</td>
                    <td className="p-2">
                      {row.amount === null ? t('notRecorded') : Number(row.amount).toLocaleString()}
                      {' '}
                      {row.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t('note')}</p>
          <CampaignPlanner key={workspaceId} workspaceId={workspaceId} />
        </>
      )}
    </section>
  );
}
