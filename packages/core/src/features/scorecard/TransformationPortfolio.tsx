'use client';

import type { PortfolioCommand, PortfolioData } from '@/services/workforce/portfolioContract';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { workspaceUrl } from '@/libs/links';
import { client } from '@/libs/Orpc';
import { improvementStates, rolloutStages } from '@/services/workforce/portfolioContract';
import { operatingPath, operatingTotals } from './operatingModel';
import { portfolioNextStep } from './portfolioModel';

type Overview = Awaited<ReturnType<typeof client.scorecard.workforceOverview>>;
type Workspace = Overview['workspaces'][number];
type Workflow = Workspace['portfolio']['workflows'][number];
const blank: PortfolioData = { name: '', objective: '', owner: '', teamSlug: null, stage: 'discovery', successMeasure: '', baseline: '', expectedBenefit: '', improvements: [] };
const inputClass = 'mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm';

export function TransformationPortfolio({ workspaces, selected, activeId, team, days, refresh }: { workspaces: Workspace[]; selected?: Workspace; activeId: string; team: string | null; days: number; refresh: () => void }) {
  const t = useTranslations('TransformationPortfolio');
  const [editing, setEditing] = useState<{ record: Workflow | null; id: string; data: PortfolioData; itemIds: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ payload: string; command: PortfolioCommand } | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<{ name: string; rows: Awaited<ReturnType<typeof client.scorecard.portfolioHistory>> } | null>(null);
  const editable = selected && selected.id === activeId;
  const rows = workspaces.flatMap(w => (w.portfolio?.workflows ?? []).filter(f => team === null || (f.data.teamSlug ?? '') === team).map(f => ({ ...f, workspace: w })));
  const today = new Date().toISOString().slice(0, 10);
  const linked = new Set(rows.flatMap(f => f.itemIds.map(id => `${f.workspace.id}:${id}`)));
  const unlinked = workspaces.flatMap(w => w.outcomes.items.filter((item) => {
    const agentTeam = w.report.agents.find(a => a.slug === item.agentSlug)?.teamSlug ?? '';
    return (team === null || agentTeam === team) && !linked.has(`${w.id}:${item.id}`);
  }));
  const stageCounts = rolloutStages.map(stage => ({ stage, count: rows.filter(r => r.data.stage === stage).length }));
  const patch = (key: keyof PortfolioData, value: unknown) => setEditing(current => current && ({ ...current, data: { ...current.data, [key]: value } }));
  async function save() {
    if (!editing || !editable) {
      return;
    }
    setBusy(true);
    setError('');
    const payload = JSON.stringify(editing);
    const command: PortfolioCommand = pending.current?.payload === payload ? pending.current.command : { id: editing.id, version: editing.record?.version ?? -1, eventKey: crypto.randomUUID(), data: editing.data, itemIds: editing.itemIds };
    pending.current = { payload, command };
    try {
      await client.scorecard.savePortfolio(command);
      pending.current = null;
      setEditing(null);
      setHistory(null);
      setSaved(true);
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="transformation-portfolio" className="scroll-mt-20 space-y-5" aria-labelledby="transformation-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wider text-primary uppercase">{t('eyebrow')}</p>
          <h2 id="transformation-title" className="mt-1 text-xl font-semibold">{t('title')}</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {editable && !editing && (
          <button
            type="button"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => {
              setEditing({ record: null, id: crypto.randomUUID(), data: { ...blank, teamSlug: team || null }, itemIds: [] });
              setSaved(false);
              setError('');
            }}
          >
            {t('add')}
          </button>
        )}
      </div>
      {saved && <p role="status" className="text-sm text-primary">{t('saved')}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {workspaces.some(w => w.portfolio && !w.portfolio.complete) && <p role="alert">{t('partial')}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label={t('stages')}>
        {stageCounts.map(({ stage, count }) => (
          <a key={stage} href={`#rollout-${stage}`} className="rounded-xl border border-border bg-muted/30 p-4 hover:border-primary">
            <span className="text-xs text-muted-foreground">{t(`stage.${stage}`)}</span>
            <strong className="mt-1 block text-2xl">{count}</strong>
            <div className="mt-3 h-1 overflow-hidden rounded bg-muted" aria-hidden="true"><div className="h-full bg-primary" style={{ width: `${rows.length ? 100 * count / rows.length : 0}%` }} /></div>
          </a>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('scope', { count: unlinked.length })}</p>
      {!selected && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{t('choose')}</p>}
      {selected && !editable && <Link href={operatingPath(workspaceUrl(selected.slug, '/dashboard/scorecard'), days, selected.id, team)} className="text-sm text-primary underline">{t('openWorkspace')}</Link>}
      {editing && editable && (
        <form
          className="space-y-5 rounded-2xl border border-primary/40 bg-muted/20 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="space-y-5">
            <legend className="font-semibold">{editing.record ? t('edit') : t('add')}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {(['name', 'owner', 'objective', 'successMeasure', 'baseline', 'expectedBenefit'] as const).map(key => (
                <label key={key} className="text-sm">
                  {t(key)}
                  <textarea required={key === 'name'} maxLength={key === 'name' || key === 'owner' ? 200 : 2000} rows={key === 'name' || key === 'owner' ? 1 : 2} className={inputClass} value={editing.data[key]} onChange={e => patch(key, e.target.value)} />
                </label>
              ))}
              <label className="text-sm">
                {t('stageLabel')}
                <select className={inputClass} value={editing.data.stage} onChange={e => patch('stage', e.target.value)}>{rolloutStages.map(stage => <option key={stage} value={stage}>{t(`stage.${stage}`)}</option>)}</select>
              </label>
              <label className="text-sm">
                {t('team')}
                <select className={inputClass} value={editing.data.teamSlug ?? ''} onChange={e => patch('teamSlug', e.target.value || null)}>
                  <option value="">{t('unassigned')}</option>
                  {selected.report.teams.map(team => <option key={team.slug} value={team.slug}>{team.name}</option>)}
                </select>
              </label>
            </div>
            <fieldset className="space-y-2 rounded-xl border border-border p-4">
              <legend className="text-sm font-semibold">{t('linkWork')}</legend>
              <p className="text-xs text-muted-foreground">{t('linkNote')}</p>
              {selected.outcomes.items.filter(item => !(selected.portfolio?.workflows ?? []).some(f => f.id !== editing.record?.id && f.itemIds.includes(item.id))).map(item => (
                <label key={item.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={editing.itemIds.includes(item.id)} onChange={e => setEditing({ ...editing, itemIds: e.target.checked ? [...editing.itemIds, item.id] : editing.itemIds.filter(id => id !== item.id) })} />
                  {item.title}
                </label>
              ))}
              {editing.itemIds.filter(id => !selected.outcomes.items.some(item => item.id === id)).map(id => (
                <label key={id} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked onChange={() => setEditing({ ...editing, itemIds: editing.itemIds.filter(itemId => itemId !== id) })} />
                  {t('outsideWindow', { id })}
                </label>
              ))}
            </fieldset>
            <div className="space-y-4">
              <h3 className="font-semibold">{t('improvements')}</h3>
              <p className="text-xs text-muted-foreground">{t('improvementNote')}</p>
              {editing.data.improvements.map((improvement, index) => {
                const update = (key: keyof typeof improvement, value: string) => patch('improvements', editing.data.improvements.map((i, n) => n === index ? { ...i, [key]: value } : i));
                return (
                  <fieldset key={improvement.id} className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
                    <legend className="text-sm font-medium">{t('improvementNumber', { count: index + 1 })}</legend>
                    {(['title', 'owner', 'hypothesis', 'baseline', 'successMeasure', 'result'] as const).map(key => (
                      <label key={key} className="text-sm">
                        {t(`change.${key}`)}
                        <textarea rows={2} required={key !== 'result' || improvement.status === 'closed'} maxLength={key === 'title' || key === 'owner' ? 200 : 2000} className={inputClass} value={improvement[key]} onChange={e => update(key, e.target.value)} />
                      </label>
                    ))}
                    <label className="text-sm">
                      {t('followUp')}
                      <input required type="date" className={inputClass} value={improvement.followUp} onChange={e => update('followUp', e.target.value)} />
                    </label>
                    <label className="text-sm">
                      {t('status')}
                      <select className={inputClass} value={improvement.status} onChange={e => update('status', e.target.value)}>{improvementStates.map(status => <option key={status} value={status}>{t(`statusValue.${status}`)}</option>)}</select>
                    </label>
                    <label className="text-sm">
                      {t('decision')}
                      <select className={inputClass} value={improvement.decision} onChange={e => update('decision', e.target.value)}>{(['unproven', 'keep', 'revise', 'revert'] as const).map(decision => <option key={decision} value={decision}>{t(`decisionValue.${decision}`)}</option>)}</select>
                    </label>
                  </fieldset>
                );
              })}
              <button type="button" disabled={editing.data.improvements.length >= 100} className="text-sm text-primary underline" onClick={() => patch('improvements', [...editing.data.improvements, { id: crypto.randomUUID(), title: '', owner: editing.data.owner, hypothesis: '', baseline: editing.data.baseline, successMeasure: editing.data.successMeasure, followUp: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), status: 'planned', result: '', decision: 'unproven' }])}>{t('addImprovement')}</button>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">{busy ? t('saving') : t('save')}</button>
              <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setEditing(null)}>{t('cancel')}</button>
            </div>
          </fieldset>
        </form>
      )}
      {!rows.length && (
        <div className="rounded-2xl border border-dashed p-6">
          <h3 className="font-semibold">{t('emptyTitle')}</h3>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('empty')}</p>
        </div>
      )}
      {stageCounts.map(({ stage }) => (
        <div key={stage} id={`rollout-${stage}`} className="scroll-mt-20 space-y-3">
          {rows.some(row => row.data.stage === stage) && <h3 className="text-sm font-semibold">{t(`stage.${stage}`)}</h3>}
          {rows.filter(row => row.data.stage === stage).map((row) => {
            const items = row.workspace.outcomes.items.filter(item => row.itemIds.includes(item.id));
            const totals = operatingTotals(items);
            const next = portfolioNextStep(row.data, items, today);
            return (
              <article key={row.id} className="rounded-2xl border border-border p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {row.workspace.name}
                      {' '}
                      ·
                      {' '}
                      {row.data.owner || t('noOwner')}
                    </p>
                    <h4 className="mt-1 text-lg font-semibold">{row.data.name}</h4>
                    <p className="mt-2 text-sm">{row.data.objective || t('noObjective')}</p>
                  </div>
                  {editable && (
                    <div className="flex gap-4 text-sm">
                      <button
                        type="button"
                        disabled={busy}
                        className="text-primary underline"
                        onClick={() => {
                          setEditing({ record: row, id: row.id, data: structuredClone(row.data), itemIds: [...row.itemIds] });
                          setSaved(false);
                          setError('');
                        }}
                      >
                        {t('edit')}
                      </button>
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={async () => {
                          try {
                            setHistory({ name: row.data.name, rows: await client.scorecard.portfolioHistory({ id: row.id }) });
                          } catch {
                            setError(t('failed'));
                          }
                        }}
                      >
                        {t('history')}
                      </button>
                    </div>
                  )}
                  {!editable && <Link className="text-sm text-primary underline" href={operatingPath(workspaceUrl(row.workspace.slug, '/dashboard/scorecard'), days, row.workspace.id, row.data.teamSlug)}>{t('openWorkspace')}</Link>}
                </div>
                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('accepted')}</dt>
                    <dd className="mt-1 text-xl font-semibold">
                      {totals.accepted}
                      <span className="text-xs font-normal text-muted-foreground">
                        {' '}
                        /
                        {totals.items}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('firstPass')}</dt>
                    <dd className="mt-1 text-xl font-semibold">
                      {totals.reviewed ? `${Math.round(100 * totals.firstPass / totals.reviewed)}%` : '—'}
                      <span className="text-xs font-normal text-muted-foreground">
                        {' '}
                        ·
                        {t('reviewed', { count: totals.reviewed })}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('effort')}</dt>
                    <dd className="mt-1 text-xl font-semibold">
                      {totals.effort === null ? '—' : t('minutes', { count: totals.effort })}
                      <span className="text-xs font-normal text-muted-foreground">
                        {' '}
                        ·
                        {totals.effortReported}
                        /
                        {totals.items}
                      </span>
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 rounded-xl bg-primary/5 p-4">
                  <strong className="text-sm">{t(`next.${next}`)}</strong>
                  <p className="mt-1 text-xs text-muted-foreground">{t(`why.${next}`)}</p>
                </div>
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-primary">{t('evidence')}</summary>
                  <div className="mt-3 space-y-3">
                    <p>
                      <strong>
                        {t('successMeasure')}
                        :
                        {' '}
                      </strong>
                      {row.data.successMeasure || t('unknown')}
                    </p>
                    <p>
                      <strong>
                        {t('baseline')}
                        :
                        {' '}
                      </strong>
                      {row.data.baseline || t('unknown')}
                    </p>
                    <p>
                      <strong>
                        {t('expectedBenefit')}
                        :
                        {' '}
                      </strong>
                      {row.data.expectedBenefit || t('unknown')}
                    </p>
                    <p className="text-xs text-muted-foreground">{t('evidenceNote')}</p>
                    {items.map(item => <Link key={item.id} className="block text-primary underline" href={operatingPath(workspaceUrl(row.workspace.slug, '/dashboard/scorecard'), days, row.workspace.id, null, item.id)}>{item.title}</Link>)}
                    <h5 className="font-semibold">{t('improvements')}</h5>
                    {!row.data.improvements.length && <p className="text-muted-foreground">{t('noImprovements')}</p>}
                    {row.data.improvements.map(i => (
                      <div key={i.id} className="rounded-lg border border-border p-3">
                        <strong>{i.title}</strong>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {i.owner}
                          {' '}
                          ·
                          {' '}
                          {t(`statusValue.${i.status}`)}
                          {' '}
                          ·
                          {' '}
                          {i.followUp}
                        </p>
                        <p className="mt-2">{i.hypothesis}</p>
                        <p className="mt-2">
                          <strong>
                            {t('change.baseline')}
                            :
                            {' '}
                          </strong>
                          {i.baseline}
                        </p>
                        <p>
                          <strong>
                            {t('change.successMeasure')}
                            :
                            {' '}
                          </strong>
                          {i.successMeasure}
                        </p>
                        <p className="mt-2">{i.result || t('noResult')}</p>
                        <p className="mt-2 text-xs">
                          {t('decision')}
                          :
                          {' '}
                          {t(`decisionValue.${i.decision}`)}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      ))}
      {history && (
        <section className="rounded-xl border border-border p-5">
          <h3 className="font-semibold">
            {t('history')}
            {' '}
            ·
            {' '}
            {history.name}
          </h3>
          <p className="mt-2 text-xs text-muted-foreground">{t('historyNote')}</p>
          {history.rows.map(row => (
            <details key={row.version} className="mt-3">
              <summary className="cursor-pointer text-sm">
                {t('revision', { count: row.version + 1 })}
                {' '}
                ·
                {' '}
                {new Date(row.createdAt).toLocaleString()}
                {' '}
                ·
                {' '}
                {row.actorId}
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap">{JSON.stringify({ workflow: row.data.data, linkedItems: row.data.itemIds }, null, 2)}</pre>
            </details>
          ))}
          <button type="button" className="mt-3 text-sm underline" onClick={() => setHistory(null)}>{t('closeHistory')}</button>
        </section>
      )}
    </section>
  );
}
