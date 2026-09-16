'use client';

import type { RecommendedAction } from './types';
import { ArrowRight, Check, Loader2, Mail, PencilLine, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { inboxHref } from '@/services/inbox/inboxRef';
import { describeActionStatus, TERMINAL_STATUSES, useActionRunStatus } from './useActionRunStatus';

/**
 * A2UI recommended-action card — turns a suggested next action into ONE tap,
 * and then keeps telling the truth about it (R4).
 *
 * Shows a real preview of what will be prepared (to / subject / body for an
 * email send) so the decision is informed, then "Prepare for review" JIT-
 * creates the gated review item (review.propose, reusing the agent's
 * authority) — nothing sends without approval. From that moment the card
 * follows the run: Proposed → In review → Approved · running → Done / Failed /
 * Rejected, polled from `review.actionStatus`, with who decided and when. A
 * reviewer can approve inline (same `review.decideAction` path as the review
 * page — never a bypass). A card that arrives with `runId` already set was
 * filed by the server under the conversation's `act-within-bounds` autonomy
 * and starts in the status view.
 */

type Phase = { status: 'idle' | 'working' | 'proposed' | 'error'; runId?: number; message?: string };

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function fmtTime(iso: string | null): string {
  if (!iso) {
    return '';
  }
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function RecommendedActionCard({ rec, canApprove = true, onProposed, autoPropose = false }: {
  rec: RecommendedAction;
  /** Whether to offer the inline Approve. The server still authorizes the decision. */
  canApprove?: boolean;
  /** Fired once the run exists (tap or server-filed) so a stack can count it. */
  onProposed?: (runId: number) => void;
  /**
   * The thread runs at `act-within-bounds` (0094): propose into the review
   * queue as soon as the card appears, and say so. Still nothing executes —
   * the queue and trust rules gate every outward step. A card that already
   * arrived with a server-filed `runId` (R4) has nothing left to propose.
   */
  autoPropose?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(rec.runId !== undefined ? { status: 'proposed', runId: rec.runId } : { status: 'idle' });
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const live = useActionRunStatus(phase.runId);
  const autoFiredRef = useRef(rec.runId !== undefined);

  const prepare = async () => {
    // Belt and braces behind `readRecommendedAction` (the event boundary): a
    // card with no action names nothing to propose, and firing the RPC anyway
    // is how two 400s reached production. Nothing here recovers from it —
    // this is the last place that can refuse to make the call.
    if (!rec.actionId) {
      setPhase({ status: 'error', message: 'This recommendation named no action, so there is nothing to prepare.' });
      return;
    }
    setPhase({ status: 'working' });
    try {
      const res = await client.review.propose({
        actionId: rec.actionId,
        input: rec.input,
        agentSlug: rec.agentSlug,
        rationale: rec.rationale,
        confidence: rec.confidence,
      }) as { runId: number; status: string };
      setPhase({ status: 'proposed', runId: res.runId });
      onProposed?.(res.runId);
    } catch (err) {
      setPhase({ status: 'error', message: (err as Error).message });
    }
  };

  const decide = async (decision: 'approve' | 'reject') => {
    if (phase.runId === undefined) {
      return;
    }
    setDeciding(decision);
    setDecideError(null);
    try {
      await client.review.decideAction({ id: phase.runId, decision });
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setDeciding(null);
    }
  };

  useEffect(() => {
    if (autoPropose && !autoFiredRef.current && rec.actionId) {
      autoFiredRef.current = true;
      // Proposing IS the effect here: the thread runs at act-within-bounds,
      // so the card fires its one network call the moment it appears.

      void prepare();
    }
    // `prepare` closes over `rec`, which is stable for the card's life.
  }, [autoPropose]);

  const pct = rec.confidence !== undefined ? Math.round(rec.confidence * 100) : null;
  const isEmail = rec.actionId === 'gmail.send';
  const to = str(rec.input.to);
  const subject = str(rec.input.subject);
  const body = str(rec.input.body);
  const isDraft = rec.input.draft === true;
  const busy = phase.status === 'working';

  const status = live?.status ?? (phase.status === 'proposed' ? 'pending' : null);
  const desc = status ? describeActionStatus(status) : null;
  const terminal = status ? TERMINAL_STATUSES.has(status) : false;
  const toneClass = desc?.tone === 'green'
    ? 'text-emerald-600 dark:text-emerald-400'
    : desc?.tone === 'red'
      ? 'text-destructive'
      : desc?.tone === 'amber'
        ? 'text-brand-amber-deep'
        : 'text-muted-foreground';

  return (
    <div data-testid="recommended-action-card" data-run-status={status ?? undefined} className="mt-2.5 overflow-hidden rounded-xl border border-border bg-card">
      {/* Header — compact: label + confidence, rationale clamped */}
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-amber-tint text-brand-amber-deep">
          {isEmail ? <Mail className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold break-words">{rec.label}</div>
          {rec.rationale && <p className="mt-0.5 line-clamp-2 text-xs break-words text-muted-foreground">{rec.rationale}</p>}
        </div>
        {pct !== null && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              pct >= 85
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : pct >= 60
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
            }`}
            title="Agent confidence from grounding"
          >
            {pct}
            %
          </span>
        )}
      </div>

      {/* Draft preview — one compact block: to→subject line + 2-line body */}
      {isEmail && (to || subject || body) && (
        <div className="mx-3 mt-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs">
          {(to || subject) && (
            <div className="truncate">
              {to && <span className="text-muted-foreground">{to}</span>}
              {to && subject && <span className="text-muted-foreground/50"> · </span>}
              {subject && <span className="font-medium">{subject}</span>}
            </div>
          )}
          {body && (
            <p className="mt-1 line-clamp-2 leading-relaxed break-words text-foreground/80">
              {body}
            </p>
          )}
        </div>
      )}

      {/* Status line — the run's truth, once it exists */}
      {status && desc && (
        <div className="mx-3 mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" data-testid="recommended-action-status">
          <span className={`inline-flex items-center gap-1 font-medium ${toneClass}`}>
            {!terminal && status !== 'snoozed' && <Loader2 className="size-3 animate-spin" aria-hidden />}
            {terminal && status === 'done' && <Check className="size-3" aria-hidden />}
            {terminal && status !== 'done' && <X className="size-3" aria-hidden />}
            {desc.label}
          </span>
          {live?.decidedBy && (
            <span className="text-muted-foreground">
              {status === 'rejected' ? 'by' : 'approved by'}
              {' '}
              {live.decidedBy}
              {live.decidedAt ? ` · ${fmtTime(live.decidedAt)}` : ''}
            </span>
          )}
          {rec.runId !== undefined && phase.runId === rec.runId && (
            <span className="text-muted-foreground/70">· filed by the agent within bounds</span>
          )}
        </div>
      )}

      {/* CTA */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {phase.status === 'proposed'
          ? (
              <>
                {status === 'pending' && canApprove && (
                  <>
                    <button
                      type="button"
                      onClick={() => void decide('approve')}
                      disabled={deciding !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                    >
                      {deciding === 'approve' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide('reject')}
                      disabled={deciding !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </>
                )}
                <Link
                  href={phase.runId !== undefined ? inboxHref('proposal', phase.runId) : '/dashboard/inbox?kind=proposal'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-tint px-3 py-1.5 text-sm font-medium text-brand-amber-deep transition hover:opacity-90"
                >
                  {status === 'pending' ? 'Decide on Needs you' : 'Open on Needs you'}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
                {decideError && (
                  <span className="text-xs text-destructive">
                    Couldn’t decide it:
                    {' '}
                    {decideError}
                  </span>
                )}
              </>
            )
          : (
              <button
                type="button"
                onClick={prepare}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PencilLine className="size-4" aria-hidden />}
                {busy ? 'Preparing…' : isDraft ? 'Prepare draft for review' : 'Prepare for review'}
              </button>
            )}
        {isDraft && phase.status !== 'proposed' && (
          <span className="text-[11px] text-muted-foreground">saves to Gmail Drafts — nothing sends without you</span>
        )}
        {phase.status === 'error' && (
          <span className="text-xs text-destructive">
            Couldn’t prepare it:
            {' '}
            {phase.message}
          </span>
        )}
      </div>
    </div>
  );
}
