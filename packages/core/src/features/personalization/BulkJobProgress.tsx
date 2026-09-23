'use client';

import type { BulkLeadOutcome } from '@/models/Schema';
import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from '@/libs/I18nNavigation';

export type BulkJobView = {
  id: number;
  kind: string;
  note: string;
  total: number;
  done: number;
  failed: number;
  status: string;
  outcomes: BulkLeadOutcome[];
  createdAt: string;
};

/**
 * One bulk job as it runs and as it remains (Metacto ticket 071): the counts,
 * then every lead with where it got to. Polls while the job is open and stops
 * when it is done, so the page is also the record afterwards.
 * @param props
 * @param props.initial - The job as the server rendered it.
 */
export const BulkJobProgress = (props: { initial: BulkJobView }) => {
  const [job, setJob] = useState(props.initial);
  const open = job.status !== 'done';

  useEffect(() => {
    if (!open) {
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/v1/personalization/bulk/${job.id}`);
        if (!res.ok) {
          return;
        }
        const next = await res.json() as BulkJobView;
        if (alive) {
          setJob(next);
        }
      } catch {
        /* transient; the next tick retries */
      }
    };
    const timer = setInterval(() => void tick(), 4_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open, job.id]);

  const pending = job.total - job.done - job.failed;
  return (
    <div className="flex flex-col gap-5 pt-4" data-testid="bulk-job">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span data-testid="bulk-job-counts" className="tabular-nums">
          <span className="font-medium">{job.done}</span>
          {` of ${job.total} landed`}
          {job.failed > 0 && <span className="text-brand-fail">{` · ${job.failed} did not land`}</span>}
          {pending > 0 && <span className="text-muted-foreground">{` · ${pending} to go`}</span>}
        </span>
        <span className="text-muted-foreground">
          {open ? <Loader2 className="mr-1 inline size-3.5 animate-spin align-[-2px]" aria-hidden /> : null}
          {open ? 'Running, two at a time.' : 'Finished.'}
        </span>
        <Link href="/gtm/personalization" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Back to the queue</Link>
      </div>
      <p className="text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground/85">Instruction: </span>
        <span className="whitespace-pre-line">{job.note}</span>
      </p>
      <ol className="divide-y divide-rule rounded-lg border border-rule" data-testid="bulk-job-rows">
        {job.outcomes.map(o => (
          <li key={o.leadId} className="flex items-start gap-3 px-3 py-2 text-sm" data-state={o.state}>
            {o.state === 'landed' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-pass" aria-label="landed" />}
            {o.state === 'failed' && <XCircle className="mt-0.5 size-4 shrink-0 text-brand-fail" aria-label="did not land" />}
            {o.state === 'queued' && <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="waiting" />}
            <span className="min-w-0">
              <span className="font-medium">{o.contactName ?? `Lead ${o.leadId}`}</span>
              {o.state === 'failed' && o.error && <span className="block text-[13px] break-words text-muted-foreground">{o.error}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};
