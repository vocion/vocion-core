'use client';

import type { WorkforceCommand } from '@/services/workforce/contracts';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { client } from '@/libs/Orpc';
import { outcomeInsights } from '@/services/workforce/insights';

type Report = Awaited<ReturnType<typeof client.scorecard.outcomes>>;

export function WorkforceOutcomes({ days, agents }: { days: 1 | 7 | 30 | 90; agents: { slug: string; name: string }[] }) {
  const t = useTranslations('WorkforceOutcomes');
  const [report, setReport] = useState<Report | null>(null);
  const [test, setTest] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => setReport(await client.scorecard.outcomes({ days, test })), [days, test]);
  useEffect(() => {
    let active = true;
    setReport(null);
    void client.scorecard.outcomes({ days, test }).then(r => active && setReport(r)).catch(() => active && setError(t('failed')));
    return () => {
      active = false;
    };
  }, [days, test, t]);
  async function save(command: WorkforceCommand, form: HTMLFormElement) {
    setBusy(true);
    setError('');
    try {
      await client.scorecard.recordOutcome(command);
      form.reset();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }
  const inputClass = 'block w-full rounded-lg border border-border bg-background p-2';
  return (
    <section className="space-y-4 rounded-2xl border border-border p-5" aria-label={t('title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={busy} checked={test} onChange={e => setTest(e.target.checked)} />
          {t('test')}
        </label>
      </div>
      <p className="text-sm text-muted-foreground">{t('note')}</p>
      {error && <p role="alert">{error}</p>}
      {report && report.test === test && (
        <>
          <div className="flex flex-wrap gap-8">
            {(['items', 'accepted', 'blocked'] as const).map(k => (
              <div key={k}>
                <strong className="block text-2xl">{report.summary[k]}</strong>
                <span className="text-sm">{t(k)}</span>
              </div>
            ))}
          </div>
          {!report.complete && <p role="alert">{t('capped')}</p>}
          <button
            type="button"
            className="text-sm underline"
            onClick={() => {
              const href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
              const a = document.createElement('a');
              a.href = href;
              a.download = 'workforce-outcomes.json';
              a.click();
              URL.revokeObjectURL(href);
            }}
          >
            {t('export')}
          </button>
          {report.learning && (
            <section className="space-y-3 rounded-xl border border-border p-4" aria-label={t('learningTitle')}>
              <h3 className="font-semibold">{t('learningTitle')}</h3>
              <p className="text-sm text-muted-foreground">{t('learningNote')}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {([
                  ['evalCases', report.learning.summary.cases],
                  ['referenceCases', report.learning.summary.referenceCases],
                  ['feedbackStock', report.learning.feedback.accumulated],
                  ['feedbackReceived', report.learning.feedback.received],
                  ['learningApproved', report.learning.candidates.approved],
                  ['learningEvaluated', report.learning.candidates.eval_completed],
                ] as const).map(([label, count]) => (
                  <div key={label} className="rounded-lg bg-muted p-3">
                    <strong className="block text-xl">{count}</strong>
                    <span className="text-sm">{t(label)}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm">{t('learningCoverage', { covered: report.learning.summary.agentsWithCases, agents: report.learning.summary.registeredAgents, fresh: report.learning.summary.freshDatasets, datasets: report.learning.summary.datasets })}</p>
              <p className="text-sm">{t('feedbackQueue', { pending: report.learning.feedback.pending, failed: report.learning.feedback.failed, applied: report.learning.feedback.applied })}</p>
              <p className="text-sm text-muted-foreground">{t('learningUnknown')}</p>
              {report.learningRecommendations.map(insight => (
                <div key={insight.evidence} className="rounded-lg bg-primary/5 p-3 text-sm">
                  <strong>{insight.evidence}</strong>
                  <p>{insight.text}</p>
                  <p className="mt-2 text-muted-foreground">{insight.measure}</p>
                </div>
              ))}
              {report.learning.datasets.map(dataset => (
                <details key={dataset.id} className="rounded-xl border border-border p-3">
                  <summary className="cursor-pointer">
                    <strong>{dataset.slug}</strong>
                    <span className="ml-3 text-sm text-muted-foreground">
                      {dataset.agentSlug}
                      {' '}
                      ·
                      {' '}
                      {dataset.teamSlug ?? t('unknown')}
                      {' '}
                      ·
                      {' '}
                      {dataset.cases}
                      {' '}
                      {t('evalCases')}
                    </span>
                  </summary>
                  <p className="mt-3 text-sm">{t('evalDetail', { version: dataset.version, provider: dataset.provider, status: dataset.latestStatus ?? t('unknown'), rate: dataset.passRate === null ? t('unknown') : `${Math.round(dataset.passRate * 100)}%` })}</p>
                  <p className="text-sm text-muted-foreground">{t('evalFreshness')}</p>
                  <p className="text-sm break-all">{dataset.workspaceSha ?? t('unknown')}</p>
                </details>
              ))}
            </section>
          )}
          {outcomeInsights(report).map(insight => (
            <div key={insight.itemId} className="rounded-xl bg-primary/5 p-4 text-sm">
              <strong>{insight.evidence}</strong>
              <p>{insight.text}</p>
              <p className="mt-2 text-muted-foreground">{insight.measure}</p>
            </div>
          ))}
          {report.items.map(item => (
            <details key={item.id} className="rounded-xl border border-border p-4">
              <summary className="cursor-pointer">
                <strong>{item.title}</strong>
                <span className="ml-3 text-sm text-muted-foreground">
                  {item.agentSlug}
                  {' '}
                  ·
                  {' '}
                  {item.status}
                  {' '}
                  ·
                  {' '}
                  {item.links.length}
                  {' '}
                  {t('attempts')}
                </span>
              </summary>
              <div className="mt-4 space-y-3 text-sm">
                {item.evidenceChanged && <p role="alert">{t('stale')}</p>}
                <p>
                  {t('rubric')}
                  :
                  {' '}
                  {item.rubric}
                </p>
                <p>
                  {t('version')}
                  :
                  {' '}
                  {item.configurationVersion}
                  {' '}
                  ·
                  {' '}
                  {item.workflow}
                </p>
                <p>
                  {t('baseline')}
                  :
                  {' '}
                  {item.baselineMinutes ?? t('unknown')}
                  {' · '}
                  {t(item.baselineKind)}
                  {' · '}
                  {t('sampleSize')}
                  {': '}
                  {item.baselineSampleSize ?? t('unknown')}
                  {' '}
                  ·
                  {' '}
                  {item.baselineEvidence}
                </p>
                <p>
                  {t('effort')}
                  :
                  {' '}
                  {item.activeEffortMinutes ?? t('unknown')}
                  {' '}
                  ·
                  {' '}
                  {item.effortCoverage}
                </p>
                <p>
                  {t('cost')}
                  :
                  {' '}
                  {item.linkedWorkerCostCents === null ? t('unknown') : `$${(item.linkedWorkerCostCents / 100).toFixed(2)}`}
                  {' '}
                  ·
                  {' '}
                  {t('partial')}
                </p>
                <ol className="space-y-2">
                  {item.events.map(event => (
                    <li key={event.id} className="rounded-lg bg-muted p-3">
                      <strong>{event.kind}</strong>
                      {' '}
                      ·
                      {' '}
                      {String(event.createdAt)}
                      <p className="whitespace-pre-wrap">{typeof event.data.evidence === 'string' ? event.data.evidence : typeof event.data.sourceId === 'number' ? `${event.data.sourceKind} #${event.data.sourceId}` : t('registered')}</p>
                    </li>
                  ))}
                </ol>
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const f = new FormData(form);
                    void save({ kind: 'link', itemId: item.id, version: item.version, eventKey: crypto.randomUUID(), sourceKind: f.get('sourceKind') as 'action' | 'worker', sourceId: Number(f.get('sourceId')) }, form);
                  }}
                >
                  <label>
                    {t('source')}
                    <select name="sourceKind" className={inputClass}>
                      <option value="action">{t('action')}</option>
                      <option value="worker">{t('worker')}</option>
                    </select>
                  </label>
                  <label>
                    {t('sourceId')}
                    <input name="sourceId" type="number" min="1" required className={inputClass} />
                  </label>
                  <button disabled={busy} className="rounded-lg border p-2">{t('link')}</button>
                </form>
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const f = new FormData(form);
                    void save({ kind: 'review', itemId: item.id, version: item.version, eventKey: crypto.randomUUID(), status: f.get('status') as 'accepted', reason: f.get('reason') as 'meets-rubric', evidence: String(f.get('evidence')), ...(f.get('effort') !== '' ? { effortMinutes: Number(f.get('effort')) } : {}) }, form);
                  }}
                >
                  <label>
                    {t('outcome')}
                    <select name="status" className={inputClass}>{['accepted', 'corrected', 'rejected', 'blocked', 'reopened'].map(s => <option key={s}>{s}</option>)}</select>
                  </label>
                  <label>
                    {t('reason')}
                    <select name="reason" className={inputClass}>{['meets-rubric', 'context', 'data-access', 'playbook', 'approval', 'execution', 'routing', 'other'].map(s => <option key={s}>{s}</option>)}</select>
                  </label>
                  <label>
                    {t('evidence')}
                    <textarea name="evidence" maxLength={2000} required className={inputClass} />
                  </label>
                  <label>
                    {t('effort')}
                    <input name="effort" type="number" min="0" max="1440" className={inputClass} />
                  </label>
                  <button disabled={busy} className="rounded-lg bg-primary p-2 text-primary-foreground">{t('review')}</button>
                </form>
              </div>
            </details>
          ))}
          {!report.items.length && <p>{t('empty')}</p>}
        </>
      )}
      <details className="rounded-xl bg-muted/30 p-4">
        <summary className="cursor-pointer font-medium">{t('register')}</summary>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void save({ kind: 'create', eventKey: crypto.randomUUID(), key: String(f.get('key')), title: String(f.get('title')), agentSlug: String(f.get('agent')), workflow: f.get('workflow') as 'human-assisted', rubric: String(f.get('rubric')), configurationVersion: String(f.get('version')), test, ...(f.get('baseline') ? { baselineMinutes: Number(f.get('baseline')), baselineEvidence: String(f.get('baselineEvidence')), baselineKind: f.get('baselineKind') as 'assumed' | 'measured', baselineSampleSize: Number(f.get('baselineSampleSize')) } : {}) }, form);
          }}
        >
          {(['title', 'key', 'rubric', 'version'] as const).map(name => (
            <label key={name}>
              {t(name)}
              <input name={name} required maxLength={name === 'rubric' ? 2000 : 120} className={inputClass} />
            </label>
          ))}
          <label>
            {t('agent')}
            <select name="agent" required className={inputClass}>{agents.map(a => <option key={a.slug} value={a.slug}>{a.name}</option>)}</select>
          </label>
          <label>
            {t('workflow')}
            <select name="workflow" className={inputClass}>{['human-assisted', 'scheduled', 'multi-agent'].map(s => <option key={s}>{s}</option>)}</select>
          </label>
          <label>
            {t('baseline')}
            <input name="baseline" type="number" min="1" max="10080" className={inputClass} />
          </label>
          <label>
            {t('baselineKind')}
            <select name="baselineKind" defaultValue="assumed" className={inputClass}>
              <option value="assumed">{t('assumed')}</option>
              <option value="measured">{t('measured')}</option>
            </select>
          </label>
          <label>
            {t('sampleSize')}
            <input name="baselineSampleSize" type="number" min="0" max="1000000" defaultValue="0" className={inputClass} />
          </label>
          <p className="text-muted-foreground sm:col-span-2">{t('baselineGuidance')}</p>
          <label>
            {t('baselineEvidence')}
            <textarea name="baselineEvidence" maxLength={2000} className={inputClass} />
          </label>
          <button disabled={busy || !agents.length} className="rounded-lg border p-2">{t('register')}</button>
        </form>
      </details>
    </section>
  );
}
