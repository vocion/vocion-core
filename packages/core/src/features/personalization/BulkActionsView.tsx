'use client';

import type { BriefRow } from './PersonalizationQueue';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { useRouter } from '@/libs/I18nNavigation';
import { LANE_PILL, shortDateTime } from './leadFormat';

/**
 * The bulk actions view (Metacto ticket 071): the leads the queue was
 * showing, one action, one note, one confirmation that states the count.
 *
 * Regenerate brief is the first action. It is offered only when every lead
 * in the view waits in Review: a brief regenerate on a lead in Hand off or
 * Sent resets it to queued and files a new card for a contact who is already
 * receiving emails, so those views say why and offer nothing.
 * @param props
 * @param props.rows - The leads the view covers, as the queue showed them.
 * @param props.viewLabel - The view in words ("Review · briefed earlier").
 * @param props.max - The most leads one job may take.
 */
export const BulkActionsView = (props: { rows: BriefRow[]; viewLabel: string; max: number }) => {
  const router = useRouter();
  const [action, setAction] = useState<'regenerate_brief'>('regenerate_brief');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notInReview = useMemo(() => props.rows.filter(r => r.status !== 'ready_for_review'), [props.rows]);
  const tooMany = props.rows.length > props.max;
  const blocked = props.rows.length === 0 || notInReview.length > 0 || tooMany;
  const armed = !blocked && note.trim().length > 0 && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/personalization/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: action, leadIds: props.rows.map(r => r.id), note: note.trim() }),
      });
      const body = await res.json().catch(() => null) as { jobId?: number; error?: { message?: string } } | null;
      if (!res.ok || !body?.jobId) {
        setError(body?.error?.message ?? `The job could not start (${res.status}).`);
        return;
      }
      router.push(`/gtm/personalization/bulk/${body.jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The job could not start.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pt-4" data-testid="bulk-actions-view">
      <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Action</span>
            <select
              value={action}
              onChange={e => setAction(e.target.value as 'regenerate_brief')}
              data-testid="bulk-action"
              className="mt-1.5 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="regenerate_brief">Regenerate brief</option>
            </select>
          </label>
          <p className="text-[13px] text-muted-foreground">
            Writes each lead's brief again from research, picks the sequence again under the current rules, and redrafts the sends. Every card stays in Review and waits for a person; nothing is sent or enrolled. Any send already approved is unapproved where its copy changes.
          </p>
          <label className="block">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Instruction, carried to every lead</span>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={4}
              data-testid="bulk-note"
              aria-label="Instruction for every lead"
              placeholder="e.g. Use a Personalized Nurture rung, replace every dash with a comma, and end each send on its last sentence with no sign-off."
              className="mt-1.5 w-full resize-y rounded-lg bg-surface-soft px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/30"
            />
          </label>
          {notInReview.length > 0 && (
            <p className="text-[13px] text-brand-fail" data-testid="bulk-blocked">
              {`${notInReview.length} of these leads ${notInReview.length === 1 ? 'is' : 'are'} not waiting in Review (${[...new Set(notInReview.map(r => LANE_PILL[r.status]?.label ?? r.status))].join(', ')}). A brief regenerate on a lead already handed off would file a new card for a contact who is receiving emails, and approving it would replace their live enrollment. Narrow the queue to the Review lane first.`}
            </p>
          )}
          {tooMany && (
            <p className="text-[13px] text-brand-fail" data-testid="bulk-too-many">{`At most ${props.max} leads in one job; this view has ${props.rows.length}. Narrow it with the briefed-window chips or the search.`}</p>
          )}
          {error && <p className="text-[13px] text-brand-fail" data-testid="bulk-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="button" onClick={() => void submit()} disabled={!armed} data-testid="bulk-submit">
              {submitting ? 'Starting…' : `Regenerate ${props.rows.length} ${props.rows.length === 1 ? 'brief' : 'briefs'}`}
            </Button>
            <span className="text-[13px] text-muted-foreground">Runs two at a time on the work queue; the next page shows each one land.</span>
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{`${props.rows.length} ${props.rows.length === 1 ? 'lead' : 'leads'} in this view · ${props.viewLabel}`}</h2>
          <ol className="mt-2 divide-y divide-rule rounded-lg border border-rule" data-testid="bulk-rows">
            {props.rows.map((r) => {
              const pill = LANE_PILL[r.status] ?? { status: 'pending' as const, label: r.status };
              return (
                <li key={r.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{r.contactName}</span>
                    {r.companyName && <span className="text-muted-foreground">{` · ${r.companyName}`}</span>}
                    {r.briefedAt && <span className="text-muted-foreground">{` · briefed ${shortDateTime(r.briefedAt)}`}</span>}
                  </span>
                  <StatusPill status={pill.status} label={pill.label} size="sm" />
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </div>
  );
};
