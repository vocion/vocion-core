'use client';

import type { BriefRow } from './PersonalizationQueue';
import type { BulkFilter } from './queueFilter';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useRouter } from '@/libs/I18nNavigation';
import { LANE_PILL, shortDateTime } from './leadFormat';
import { BRIEFED_WINDOWS, BULK_NONE, distinctValues, ERROR_CHIP, filterBulkRows, QUEUE_LANES } from './queueFilter';

const REVIEW = 'ready_for_review';

/**
 * The bulk actions view (Metacto tickets 071 and 076): filter the leads, tick
 * the ones to act on, give one instruction, start one job.
 *
 * Selection follows the filter. The page opens with every lead the queue was
 * showing selected; any filter change selects everything it shows and drops
 * what it hides, so what is ticked on screen is exactly what runs. Then any
 * lead can be unticked or ticked on its own, or all at once.
 *
 * Regenerate brief acts only on leads waiting in Review: a brief regenerate on
 * a lead in Hand off or Sent resets it to queued and files a new card for a
 * contact who is already receiving emails. Those leads still show, greyed,
 * with the reason, and cannot be ticked.
 * @param props
 * @param props.rows - Every lead the queue loaded.
 * @param props.initial - The filter the queue link carried.
 * @param props.now - The server's clock, to bucket the briefed windows the same way on both sides.
 */
export const BulkActionsView = (props: { rows: BriefRow[]; initial: BulkFilter; now: number }) => {
  const router = useRouter();
  const [action, setAction] = useState<'regenerate_brief'>('regenerate_brief');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilterState] = useState<BulkFilter>(props.initial);

  const shown = useMemo(() => filterBulkRows(props.rows, filter, props.now), [props.rows, filter, props.now]);
  const selectableIds = (rows: readonly BriefRow[]) => rows.filter(r => r.status === REVIEW).map(r => r.id);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(selectableIds(filterBulkRows(props.rows, props.initial, props.now))));

  const rungs = useMemo(() => distinctValues(props.rows, r => r.recommendedSequence), [props.rows]);
  const magnets = useMemo(() => distinctValues(props.rows, r => r.utmContent), [props.rows]);

  const shownSelectable = shown.filter(r => r.status === REVIEW);
  const notInReview = shown.length - shownSelectable.length;
  const chosen = shownSelectable.filter(r => selected.has(r.id));
  const allTicked = shownSelectable.length > 0 && chosen.length === shownSelectable.length;
  const armed = chosen.length > 0 && note.trim().length > 0 && !submitting;

  const master = useRef<HTMLInputElement>(null);
  if (master.current) {
    master.current.indeterminate = chosen.length > 0 && !allTicked;
  }

  const setFilter = (patch: Partial<BulkFilter>) => {
    const next = { ...filter, ...patch };
    setFilterState(next);
    setSelected(new Set(selectableIds(filterBulkRows(props.rows, next, props.now))));
  };
  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const tickAll = (on: boolean) => setSelected(on ? new Set(shownSelectable.map(r => r.id)) : new Set());
  const toggleChip = (key: string) => setFilter({ chips: filter.chips.includes(key) ? filter.chips.filter(c => c !== key) : [...filter.chips, key] });
  const clear = () => setFilter({ lane: REVIEW, q: '', chips: [], rung: '', magnet: '', before: '' });

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/personalization/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: action, leadIds: chosen.map(r => r.id), note: note.trim() }),
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

  const label = 'text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase';
  const control = 'mt-1.5 h-9 w-full rounded-md border border-border bg-background px-2 text-sm';

  return (
    <div className="flex flex-col gap-6 pt-4" data-testid="bulk-actions-view">
      <section className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={label}>Action</span>
            <select value={action} onChange={e => setAction(e.target.value as 'regenerate_brief')} data-testid="bulk-action" className={control}>
              <option value="regenerate_brief">Regenerate brief</option>
            </select>
          </label>
          <p className="text-[13px] text-muted-foreground">
            Writes each selected lead's brief again from research, picks the sequence again under the current rules, and redrafts the sends. Every card stays in Review and waits for a person; nothing is sent or enrolled. Any send already approved is unapproved where its copy changes.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={label}>Instruction, carried to every lead</span>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={4}
              data-testid="bulk-note"
              aria-label="Instruction for every lead"
              placeholder="e.g. Use a Personalized Nurture rung, replace every dash with a comma, and end each send on its last sentence."
              className="mt-1.5 w-full resize-y rounded-lg bg-surface-soft px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/30"
            />
          </label>
          {error && <p className="text-[13px] text-brand-fail" data-testid="bulk-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="button" onClick={() => void submit()} disabled={!armed} data-testid="bulk-submit">
              {submitting ? 'Starting…' : `Regenerate ${chosen.length} ${chosen.length === 1 ? 'brief' : 'briefs'}`}
            </Button>
            <span className="text-[13px] text-muted-foreground">Runs two at a time on the work queue; the next page shows each one land.</span>
          </div>
        </div>
      </section>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="bulk-filters">
          <label className="block">
            <span className={label}>Lane</span>
            <select value={filter.lane} onChange={e => setFilter({ lane: e.target.value })} data-testid="bulk-filter-lane" className={control}>
              {QUEUE_LANES.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={label}>Search</span>
            <input
              type="search"
              value={filter.q}
              onChange={e => setFilter({ q: e.target.value })}
              data-testid="bulk-filter-q"
              aria-label="Search leads by name or company"
              placeholder="Name or company"
              className={control}
            />
          </label>
          <label className="block">
            <span className={label}>Recommended sequence</span>
            <select value={filter.rung} onChange={e => setFilter({ rung: e.target.value })} data-testid="bulk-filter-rung" className={control}>
              <option value="">Any</option>
              {rungs.map(r => <option key={r} value={r}>{r}</option>)}
              <option value={BULK_NONE}>No recommendation</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>Lead magnet</span>
            <select value={filter.magnet} onChange={e => setFilter({ magnet: e.target.value })} data-testid="bulk-filter-magnet" className={control}>
              <option value="">Any</option>
              {magnets.map(m => <option key={m} value={m}>{m}</option>)}
              <option value={BULK_NONE}>None recorded</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>Briefed before</span>
            <input
              type="datetime-local"
              value={filter.before ? toLocalInput(filter.before) : ''}
              onChange={e => setFilter({ before: e.target.value ? new Date(e.target.value).toISOString() : '' })}
              data-testid="bulk-filter-before"
              className={control}
            />
          </label>
          <div className="flex flex-col lg:col-span-3">
            <span className={label}>Narrow to</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[...BRIEFED_WINDOWS, ERROR_CHIP].map((w) => {
                const on = filter.chips.includes(w.key);
                return (
                  <button
                    key={w.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleChip(w.key)}
                    data-testid={`bulk-filter-window-${w.key}`}
                    className={`h-9 rounded-full border px-3 text-[13px] ${on ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground'}`}
                  >
                    {w.label.replace('Briefed ', '')}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              ref={master}
              type="checkbox"
              checked={allTicked}
              disabled={shownSelectable.length === 0}
              onChange={e => tickAll(e.target.checked)}
              data-testid="bulk-select-all"
              aria-label="Select every lead shown"
            />
            <span data-testid="bulk-count">{`${chosen.length} of ${shownSelectable.length} selected`}</span>
          </label>
          <span className="flex items-center gap-3 text-[13px]">
            <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => tickAll(false)} data-testid="bulk-select-none">Select none</button>
            <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={clear} data-testid="bulk-filter-clear">Clear filters</button>
          </span>
        </div>
        {notInReview > 0 && (
          <p className="text-[13px] text-muted-foreground" data-testid="bulk-blocked">
            {`${notInReview} ${notInReview === 1 ? 'lead is' : 'leads are'} not waiting in Review and cannot be selected. A brief regenerate on a lead already handed off would file a new card for a contact who is receiving emails, and approving it would replace their live enrollment.`}
          </p>
        )}

        <div className="rounded-lg border border-rule">
          <Table data-testid="bulk-rows">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"><span className="sr-only">Selected</span></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Lead magnet</TableHead>
                <TableHead>Recommended sequence</TableHead>
                <TableHead>Briefed</TableHead>
                <TableHead>Lane</TableHead>
                <TableHead>Last error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">No leads match these filters.</TableCell>
                </TableRow>
              )}
              {shown.map((r) => {
                const pill = LANE_PILL[r.status] ?? { status: 'pending' as const, label: r.status };
                const selectable = r.status === REVIEW;
                return (
                  <TableRow key={r.id} className={selectable ? '' : 'opacity-50'} data-testid={`bulk-tr-${r.id}`}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectable && selected.has(r.id)}
                        disabled={!selectable}
                        onChange={() => toggle(r.id)}
                        data-testid={`bulk-row-${r.id}`}
                        aria-label={`Select ${r.contactName}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{r.contactName}</TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">{r.companyName ?? ''}</TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">{r.utmContent ?? ''}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">{r.recommendedSequence ?? ''}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{r.briefedAt ? shortDateTime(r.briefedAt) : ''}</TableCell>
                    <TableCell><StatusPill status={pill.status} label={pill.label} size="sm" /></TableCell>
                    <TableCell className="max-w-72 truncate text-brand-fail" title={r.lastError ?? undefined}>{r.lastError ?? ''}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
};

/**
 * An ISO timestamp as a `datetime-local` value, in the browser's own zone.
 * @param iso - The stored moment.
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
