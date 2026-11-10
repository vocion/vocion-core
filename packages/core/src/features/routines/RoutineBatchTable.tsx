'use client';

/**
 * AN AUTOMATION BATCH, LIVE, UNDER THE ANSWER THAT NAMED IT — one line per
 * row: what the row is (its label and the inputs that tell it apart), where
 * its run stands (queued, working on a step, waiting on you, escalated, done
 * and verified, failed, already done), and once done what it read back. It
 * stands in for the batch's follow chip (one shape per thing): its header
 * opens the batch in the pane, and each line opens that row's run.
 *
 * The same read as the batch's own page (`useRoutineBatch`): re-read while the
 * batch runs and the tab is shown, at once on a live notice, and no longer by
 * timer once the batch has ended, when the table stays as the record. Columns
 * come from the automation's spec (`libs/routines/batchTable`).
 */

import type { DotTone } from '@/components/patterns';
import type { RoutineTone } from '@/libs/routines/display';
import { LayoutGrid } from 'lucide-react';
import { StatusDot } from '@/components/patterns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { openPreview } from '@/features/preview/previewState';
import { batchTable, columnLabel } from '@/libs/routines/batchTable';
import { batchProgress } from '@/libs/routines/display';
import { batchLabel } from '@/libs/routines/types';
import { cn } from '@/utils/Helpers';
import { useRoutineBatch } from './useRoutineBatch';

const DOT: Record<RoutineTone, DotTone> = { pass: 'pass', amber: 'amber', fail: 'fail', neutral: 'neutral', teal: 'neutral' };

/** How often the table re-reads while its batch runs: a step a few seconds old is still news. */
const CHAT_FAST_MS = 3000;

export function RoutineBatchTable({ batchId }: { batchId: number }) {
  const [batch] = useRoutineBatch(batchId, null, { fastMs: CHAT_FAST_MS, settledMs: null });
  const running = batch?.status === 'running';
  const table = batch ? batchTable(batch) : null;
  const openBatch = (el: HTMLElement) => openPreview({ type: 'routine_batch', id: String(batchId) }, el);
  const openRun = (browserRunId: number | null, el: HTMLElement) => (browserRunId
    ? openPreview({ type: 'browser_run', id: String(browserRunId) }, el)
    : openBatch(el));

  return (
    <section className="mt-3 min-w-0 rounded-lg border border-border/70 bg-background/60 p-3 text-xs" data-routine-batch-table={batchId} data-batch-status={batch?.status}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={ev => openBatch(ev.currentTarget)} className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-foreground hover:underline">
          <LayoutGrid className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{batch ? `${batchLabel(batchId)} · ${batch.routine.name}` : batchLabel(batchId)}</span>
        </button>
        {batch && (
          <StatusDot
            tone={running ? 'amber' : (batch.counts.failed ?? 0) > 0 ? 'fail' : 'pass'}
            pulse={running}
            label={<span className="text-[11px] text-muted-foreground tabular-nums" data-batch-progress>{batchProgress(batch.counts, batch.total)}</span>}
            className="ml-auto shrink-0"
          />
        )}
      </div>
      {table && table.rows.length > 0 && (
        <div className="mt-2 max-h-[26rem] overflow-auto rounded-md border border-border">
          <Table className="text-xs">
            <TableHeader className="bg-muted/60 whitespace-nowrap">
              <TableRow>
                <TableHead className="h-8 px-2 text-[11px]">Row</TableHead>
                {table.inputs.map(c => <TableHead key={`in:${c}`} className="h-8 px-2 text-[11px]">{columnLabel(c)}</TableHead>)}
                <TableHead className="h-8 px-2 text-[11px]">Status</TableHead>
                {table.outputs.map(c => <TableHead key={`out:${c}`} className="h-8 px-2 text-[11px]">{columnLabel(c)}</TableHead>)}
                {table.summary && <TableHead className="h-8 px-2 text-[11px]">Result</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map(({ run, inputs, status, results, result }) => (
                <TableRow
                  key={run.id}
                  className={cn('align-top hover:bg-muted/40', status.tone === 'amber' && run.status !== 'running' && 'bg-waiting-soft')}
                  data-batch-row={run.n}
                  data-row-status={run.status}
                >
                  <TableCell className="max-w-[14rem] px-2 py-1.5">
                    <button type="button" onClick={ev => openRun(run.browserRunId, ev.currentTarget)} className="block max-w-full truncate text-left font-medium text-foreground hover:underline" title={run.label}>
                      {run.label}
                    </button>
                  </TableCell>
                  {inputs.map((v, i) => (
                    <TableCell key={table.inputs[i]} className="max-w-[12rem] truncate px-2 py-1.5 text-muted-foreground" title={v}>{v || '—'}</TableCell>
                  ))}
                  <TableCell className="max-w-[18rem] px-2 py-1.5">
                    <StatusDot tone={DOT[status.tone]} pulse={status.pulse} label={<span className="text-foreground">{status.word}</span>} />
                    {status.detail && (
                      <p className={cn('mt-0.5 truncate text-[11px]', status.tone === 'fail' ? 'text-brand-fail' : 'text-muted-foreground')} title={status.detail} data-row-detail>{status.detail}</p>
                    )}
                  </TableCell>
                  {results.map((c, i) => (
                    <TableCell key={table.outputs[i]} className={cn('max-w-[12rem] truncate px-2 py-1.5', c.off ? 'text-brand-fail' : 'text-foreground')} title={c.text}>{c.text}</TableCell>
                  ))}
                  {table.summary && <TableCell className="max-w-[16rem] truncate px-2 py-1.5 text-muted-foreground" title={result ?? undefined}>{result ?? ''}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
