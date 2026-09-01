'use client';

import { Check, Loader2, ThumbsDown, X } from 'lucide-react';
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
  createdAt: string;
};

type Props = {
  candidates: PendingCandidate[];
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
 */
export function PendingCandidates({ candidates }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  if (candidates.length === 0) {
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
        body: JSON.stringify({ decision, reason: rejectReason }),
      });
      if (!res.ok) {
        throw new Error(await messageFor(res));
      }
      setRejectingId(null);
      setReason('');
      router.refresh();
    } catch (err) {
      console.error('[PendingCandidates] could not decide candidate', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mb-8 rounded-xl border border-primary/30 bg-primary/5 p-5">
      <h2 className="text-base font-semibold">
        Suggested rules (
        {candidates.length}
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
        {candidates.map((candidate) => {
          const current = candidate.editedRuleText ?? candidate.ruleText;
          const draft = drafts[candidate.id] ?? current;
          const busy = busyId === candidate.id;
          return (
            <li key={candidate.id} className="rounded-lg border border-border bg-background p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <code className="font-mono">{candidate.stepName}</code>
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
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              />

              {rejectingId === candidate.id
                ? (
                    <div className="mt-3">
                      <input
                        value={reason}
                        onChange={e => setReason(e.target.value)}
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
    </section>
  );
}
