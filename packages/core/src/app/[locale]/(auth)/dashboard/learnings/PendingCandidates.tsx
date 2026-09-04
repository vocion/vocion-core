'use client';

import { Check, ChevronDown, Loader2, ThumbsDown, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';

/** A candidate row as the learnings page hands it over from the server. */
export type PendingCandidate = {
  id: number;
  stepName: string;
  ruleText: string;
  editedRuleText: string | null;
  sourceFeedbackJobId: number | null;
  /** 'correct' = change this behaviour, 'reinforce' = keep doing it. */
  polarity: string;
  /** How many separate pieces of feedback asked for this same rule. */
  occurrenceCount: number;
  createdAt: string;
};

type Props = {
  /** The first page, rendered on the server. */
  candidates: PendingCandidate[];
  /** How many pending candidates exist in total, across every page. */
  total: number;
  /** Rows per page, used for the "load more" fetches. */
  pageSize: number;
};

/**
 * Rules the feedback worker proposed, waiting on a person.
 *
 * Talks to the same endpoints an external admin panel uses:
 *   PATCH /api/v1/learning-candidates/<id>          — reword before deciding
 *   POST  /api/v1/learning-candidates/<id>/decide   — approve or reject
 *
 * A rejection needs a reason, so the reject button opens a small form rather
 * than firing straight away — the reason is the record of why the classifier
 * was wrong, and is worth more than the rejection itself.
 * @param root0
 * @param root0.candidates
 * @param root0.total
 * @param root0.pageSize
 */
export function PendingCandidates({ candidates, total, pageSize }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [extraRows, setExtraRows] = useState<PendingCandidate[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // The server re-renders the first page after every decision, so a row it now
  // sends is dropped from the locally fetched tail to avoid showing it twice.
  const serverIds = new Set(candidates.map(candidate => candidate.id));
  const rows = [...candidates, ...extraRows.filter(row => !serverIds.has(row.id))];

  if (rows.length === 0) {
    return null;
  }

  /**
   * Read the message out of an error response, falling back to the status line
   * when the body is not the shape we expect.
   * @param res
   */
  async function messageFor(res: Response): Promise<string> {
    const body = await res.json().catch(() => null);
    return body?.error?.message ?? `${res.status} ${res.statusText}`;
  }

  /**
   * Save a reworded rule, then decide it in the same click.
   * @param candidate
   * @param decision
   * @param rejectReason
   */
  async function decide(
    candidate: PendingCandidate,
    decision: 'approve' | 'reject',
    rejectReason?: string,
  ): Promise<void> {
    setBusyId(candidate.id);
    setError(null);
    try {
      const draft = drafts[candidate.id];
      const current = candidate.editedRuleText ?? candidate.ruleText;
      if (draft !== undefined && draft.trim() && draft !== current) {
        const patched = await fetch(`/api/v1/learning-candidates/${candidate.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ editedRuleText: draft }),
        });
        if (!patched.ok) {
          throw new Error(await messageFor(patched));
        }
      }

      const res = await fetch(`/api/v1/learning-candidates/${candidate.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: decision, reason: rejectReason }),
      });
      if (!res.ok) {
        throw new Error(await messageFor(res));
      }
      setRejectingId(null);
      setReason('');
      setExtraRows(current => current.filter(row => row.id !== candidate.id));
      router.refresh();
    } catch (err) {
      console.error('[PendingCandidates] could not decide candidate', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Fetch the next page from the same endpoint an external panel would call,
   * and append it. Keeps the whole queue reachable instead of stopping at the
   * server-rendered first page.
   */
  async function loadMore(): Promise<void> {
    setLoadingMore(true);
    setError(null);
    try {
      const query = new URLSearchParams({ status: 'pending', limit: String(pageSize), offset: String(rows.length) });
      const res = await fetch(`/api/v1/learning-candidates?${query}`);
      if (!res.ok) {
        throw new Error(await messageFor(res));
      }
      const body = await res.json();
      setExtraRows(current => [...current, ...(body.items as PendingCandidate[])]);
    } catch (err) {
      console.error('[PendingCandidates] could not load more candidates', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="mb-8 rounded-xl border border-primary/30 bg-primary/5 p-5">
      <h2 className="text-base font-semibold">
        Suggested rules (
        {rows.length < total ? `${rows.length} of ${total}` : total}
        )
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Proposed from reviewer feedback. Nothing here changes how an agent behaves until you approve it.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {rows.map((candidate) => {
          const current = candidate.editedRuleText ?? candidate.ruleText;
          const draft = drafts[candidate.id] ?? current;
          const busy = busyId === candidate.id;
          return (
            <li key={candidate.id} className="rounded-lg border border-border bg-background p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <code className="font-mono">{candidate.stepName}</code>
                <span aria-hidden>·</span>
                <span
                  className={candidate.polarity === 'reinforce' ? 'text-emerald-700' : 'text-amber-700'}
                  title={candidate.polarity === 'reinforce'
                    ? 'Someone praised this and said why — adopting it tells the agent to keep doing it'
                    : 'Someone disagreed and said why — adopting it tells the agent to do this differently'}
                >
                  {candidate.polarity === 'reinforce' ? 'keep doing' : 'change'}
                </span>
                {candidate.occurrenceCount > 1 && (
                  <>
                    <span aria-hidden>·</span>
                    <span
                      className="font-medium text-foreground"
                      title="How many separate pieces of feedback asked for this same rule"
                    >
                      asked
                      {' '}
                      {candidate.occurrenceCount}
                      {' '}
                      times
                    </span>
                  </>
                )}
                {candidate.sourceFeedbackJobId !== null && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      from feedback #
                      {candidate.sourceFeedbackJobId}
                    </span>
                  </>
                )}
              </div>

              <textarea
                value={draft}
                onChange={e => setDrafts(d => ({ ...d, [candidate.id]: e.target.value }))}
                rows={3}
                // Locked while the decision is in flight: the row disappears on
                // success, and an edit typed meanwhile would vanish with it.
                disabled={busy}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              />

              {rejectingId === candidate.id
                ? (
                    <div className="mt-3">
                      <input
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        disabled={busy}
                        placeholder="Why is this not a rule worth keeping?"
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                      />
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy || reason.trim().length === 0}
                          onClick={() => decide(candidate, 'reject', reason)}
                          className={buttonVariants({ size: 'sm', variant: 'destructive' })}
                        >
                          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ThumbsDown className="mr-2 size-4" />}
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className={buttonVariants({ size: 'sm', variant: 'outline' })}
                          onClick={() => {
                            setRejectingId(null);
                            setReason('');
                          }}
                        >
                          <X className="mr-2 size-4" />
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                : (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || draft.trim().length === 0}
                        onClick={() => decide(candidate, 'approve')}
                        className={buttonVariants({ size: 'sm' })}
                      >
                        {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
                        Approve as rule
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={buttonVariants({ size: 'sm', variant: 'outline' })}
                        onClick={() => {
                          setRejectingId(candidate.id);
                          setReason('');
                          setError(null);
                        }}
                      >
                        <ThumbsDown className="mr-2 size-4" />
                        Reject
                      </button>
                    </div>
                  )}
            </li>
          );
        })}
      </ul>

      {rows.length < total && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={loadMore}
          className={`mt-4 ${buttonVariants({ size: 'sm', variant: 'outline' })}`}
        >
          {loadingMore ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ChevronDown className="mr-2 size-4" />}
          Load
          {' '}
          {Math.min(pageSize, total - rows.length)}
          {' '}
          more
        </button>
      )}
    </section>
  );
}
