'use client';

import type { campaignPlans } from '@/services/crm/campaigns';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

type Plans = Awaited<ReturnType<typeof campaignPlans>>;
type Row = Plans['rows'][number];

function localDateTime(value: unknown) {
  const date = new Date(String(value ?? ''));
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
}

export function CampaignPlanner({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('CampaignPlanner');
  const [kind, setKind] = useState<'weekly' | 'outreach'>('weekly');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Plans | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ id: string; values: Row['values']; listVersion: number } | null>(null);
  const endpoint = `/api/v1/crm/campaigns?workspace=${encodeURIComponent(workspaceId)}&kind=${kind}&offset=${offset}`;
  async function load(signal?: AbortSignal) {
    const response = await fetch(endpoint, { cache: 'no-store', signal });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error?.message ?? t('error'));
    }
    setData(result);
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted) {
        setError(e.message);
      }
    });
    return () => controller.abort();
  }, [endpoint]);
  async function command(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message ?? t('error'));
      }
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mb-8 space-y-4 rounded-xl border p-5" aria-label={t('title')}>
      <h2 className="text-xl font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted-foreground">{t('hold')}</p>
      <label className="block">
        {t('kind')}
        <select
          className="ml-3 rounded border bg-background p-2"
          value={kind}
          disabled={busy || !!draft}
          onChange={(e) => {
            setData(null);
            setError('');
            setOffset(0);
            setKind(e.target.value as typeof kind);
          }}
        >
          <option value="weekly">{t('weekly')}</option>
          <option value="outreach">{t('outreach')}</option>
        </select>
      </label>
      {!data && !error && <p role="status">{t('loading')}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {data && !draft && <button className="rounded border px-3 py-2" type="button" disabled={busy} onClick={() => setDraft({ id: crypto.randomUUID(), values: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, listVersion: data.list.version })}>{t('new')}</button>}
      {data && draft && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void command({ action: 'save', id: data.list.id, expectedVersion: draft.listVersion, records: [{ id: draft.id, values: draft.values }] });
          }}
        >
          <p className="text-sm">{t('scheduleHelp', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
          {data.list.fields.filter(f => !['status', 'reviewer', 'review_notes'].includes(f.key)).map(field => (
            <label key={field.key} className="block text-sm">
              {field.label}
              {field.key === 'proposed_at'
                ? (
                    <input
                      type="datetime-local"
                      className="mt-1 block rounded border bg-background p-2"
                      value={localDateTime(draft.values.proposed_at)}
                      disabled={busy}
                      onChange={(e) => {
                        const date = new Date(e.target.value);
                        setDraft({ ...draft, values: { ...draft.values, proposed_at: Number.isFinite(date.getTime()) ? date.toISOString() : '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
                      }}
                    />
                  )
                : field.key === 'timezone'
                  ? <p>{String(draft.values.timezone ?? '')}</p>
                  : <textarea className="mt-1 block w-full rounded border bg-background p-2" rows={field.key === 'body' ? 8 : 2} maxLength={10000} value={String(draft.values[field.key] ?? '')} disabled={busy} onChange={e => setDraft({ ...draft, values: { ...draft.values, [field.key]: e.target.value } })} />}
            </label>
          ))}
          <div className="flex gap-3">
            <button type="submit" className="rounded border px-3 py-2" disabled={busy}>{t('save')}</button>
            <button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={() => setDraft(null)}>{t('close')}</button>
          </div>
        </form>
      )}
      {data && !draft && data.rows.length === 0 && <p>{t('empty')}</p>}
      {data && !draft && data.rows.map(row => (
        <CampaignCard key={`${row.id}:${data.list.version}`} row={row} data={data} busy={busy} edit={() => setDraft({ id: row.id, values: row.values, listVersion: data.list.version })} review={(decision, notes) => void command({ action: 'review', id: data.list.id, expectedVersion: data.list.version, recordId: row.id, recordVersion: row.version, decision, notes })} />
      ))}
      {data && !draft && (
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy || offset === 0}
            onClick={() => {
              setData(null);
              setOffset(Math.max(0, offset - 20));
            }}
          >
            {t('previous')}
          </button>
          <button
            type="button"
            disabled={busy || data.nextOffset === null}
            onClick={() => {
              setData(null);
              setOffset(data.nextOffset!);
            }}
          >
            {t('next')}
          </button>
          <button type="button" disabled={busy} onClick={() => void load().catch(e => setError(e.message))}>{t('refresh')}</button>
        </div>
      )}
    </section>
  );
}

function CampaignCard({ row, data, busy, edit, review }: { row: Row; data: Plans; busy: boolean; edit: () => void; review: (decision: 'approve' | 'changes' | 'cancel', notes: string) => void }) {
  const t = useTranslations('CampaignPlanner');
  const [notes, setNotes] = useState('');
  return (
    <article className="space-y-3 rounded border p-4">
      <h3 className="font-semibold">{String(row.values.name ?? t('untitled'))}</h3>
      <p>{t(row.state as 'due' | 'draft' | 'stale' | 'cancelled' | 'changes' | 'scheduled')}</p>
      <details>
        <summary className="cursor-pointer">{t('inspect', { version: row.version })}</summary>
        <dl className="space-y-3 py-3">
          {data.list.fields.filter(f => !['status', 'reviewer', 'review_notes'].includes(f.key)).map(field => (
            <div key={field.key}>
              <dt className="text-sm font-semibold">{field.label}</dt>
              <dd className="break-words whitespace-pre-wrap">{String(row.values[field.key] ?? '—')}</dd>
            </div>
          ))}
        </dl>
        {row.review && (
          <p className="text-sm">
            {t('receipt', { reviewer: row.review.actorId, version: row.review.recordVersion, at: new Date(row.review.reviewedAt).toLocaleString() })}
            {' '}
            {row.review.notes}
          </p>
        )}
        {data.canReview && (
          <div className="space-y-2">
            <label className="block">
              {t('notes')}
              <textarea className="block w-full rounded border bg-background p-2" value={notes} maxLength={2000} disabled={busy} onChange={e => setNotes(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={() => review('approve', notes)}>{t('approve')}</button>
              <button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={() => review('changes', notes)}>{t('requestChanges')}</button>
              <button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={() => review('cancel', notes)}>{t('cancel')}</button>
            </div>
          </div>
        )}
      </details>
      <button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={edit}>{t('edit')}</button>
    </article>
  );
}
