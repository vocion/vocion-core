'use client';

import type { RecommendedAction } from './types';
import { ArrowRight, CalendarClock, Check, Clock3, Loader2, Mail, PencilLine, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cardDedupKey } from '@/libs/actions/cardDedupKey';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { recommendedActionAdvice } from '@/services/chat/recommendedActionAdvice';
import { inboxHref } from '@/services/inbox/inboxRef';
import { useRecordCardDecision } from './cards/CardDecisions';
import { DEFER_DAYS, deferredLine, deferUntil } from './deferral';
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

/** A secondary control on a card: an icon, no border, a tint on hover. */
const QUIET_ICON = 'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60';

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

export function RecommendedActionCard({ rec, canApprove = true, onProposed }: {
  rec: RecommendedAction;
  /** Whether to offer the inline Approve. The server still authorizes the decision. */
  canApprove?: boolean;
  /** Fired once the run exists (tap or server-filed) so a stack can count it. */
  onProposed?: (runId: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>(rec.runId !== undefined ? { status: 'proposed', runId: rec.runId } : { status: 'idle' });
  // The decision goes into the conversation as a typed user turn (backlog
  // 025), so the next turn binds "approve" to THIS card, never to words.
  const recordDecision = useRecordCardDecision();
  const record = (action: 'approve' | 'reject' | 'defer' | 'undo', runId?: number) => {
    if (rec.id) {
      recordDecision({ cardId: rec.id, label: rec.label, action, runId });
    }
  };
  const [deciding, setDeciding] = useState<'approve' | 'reject' | 'defer' | 'undo' | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [deferredUntil, setDeferredUntil] = useState<Date | null>(null);
  const live = useActionRunStatus(phase.runId);

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
        // One card, one run: a remount proposes under the same key and gets
        // the run that already exists back (`cardDedupKey`).
        dedupKey: cardDedupKey({ actionId: rec.actionId, label: rec.label, input: rec.input }),
        ...recommendedActionAdvice(rec),
      }) as { runId: number; status: string };
      setPhase({ status: 'proposed', runId: res.runId });
      onProposed?.(res.runId);
    } catch (err) {
      setPhase({ status: 'error', message: (err as Error).message });
    }
  };

  /**
   * Propose and approve in one gesture.
   *
   * `prepare` sets phase from its own closure, so the run id is not readable
   * here afterwards — the propose call is repeated rather than reused so the
   * id is in hand for the decision. One network round trip more than the
   * two-click path, and one click fewer.
   */
  const prepareAndApprove = async () => {
    if (!rec.actionId) {
      setPhase({ status: 'error', message: 'This recommendation named no action, so there is nothing to approve.' });
      return;
    }
    setPhase({ status: 'working' });
    setDecideError(null);
    try {
      const res = await client.review.propose({
        actionId: rec.actionId,
        input: rec.input,
        agentSlug: rec.agentSlug,
        rationale: rec.rationale,
        confidence: rec.confidence,
        ...recommendedActionAdvice(rec),
      }) as { runId: number; status: string };
      setPhase({ status: 'proposed', runId: res.runId });
      onProposed?.(res.runId);
      setDeciding('approve');
      await client.review.decideAction({ id: res.runId, decision: 'approve' });
      record('approve', res.runId);
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setDeciding(null);
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
      record(decision, phase.runId);
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setDeciding(null);
    }
  };

  /**
   * Defer: "not now" without it reading as "no". The proposal is filed if it
   * is not yet, then snoozed in review until a week out (`deferral.ts`) — the
   * queue's own snooze, so the card and the queue say the same thing.
   */
  const defer = async () => {
    setDeciding('defer');
    setDecideError(null);
    try {
      let runId = phase.runId;
      if (runId === undefined) {
        if (!rec.actionId) {
          setDecideError('This recommendation named no action, so there is nothing to defer.');
          return;
        }
        const res = await client.review.propose({
          actionId: rec.actionId,
          input: rec.input,
          agentSlug: rec.agentSlug,
          rationale: rec.rationale,
          confidence: rec.confidence,
          ...recommendedActionAdvice(rec),
        }) as { runId: number; status: string };
        runId = res.runId;
        setPhase({ status: 'proposed', runId });
        onProposed?.(runId);
      }
      const until = deferUntil();
      await client.review.snoozeAction({ id: runId, until: until.toISOString(), note: 'Deferred from chat' });
      setDeferredUntil(until);
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setDeciding(null);
    }
  };

  // Icon only, no border: one labelled button on a card — the one you came to
  // press — and the rest quiet, named on hover and to a screen reader
  // (Chris, 2026-09-25: "turn the review and defer buttons into icon only").
  const deferButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => void defer()}
          disabled={deciding !== null || phase.status === 'working'}
          data-testid="recommended-defer"
          aria-label={deciding === 'defer' ? 'Deferring…' : 'Defer'}
          className={QUIET_ICON}
        >
          {deciding === 'defer' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CalendarClock className="size-4" aria-hidden />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{`Defer ${DEFER_DAYS} days`}</TooltipContent>
    </Tooltip>
  );

  // Done for you → Undo, from the card that said it was done (principle 10:
  // one move from where the claim is read).
  const undo = async () => {
    if (phase.runId === undefined) {
      return;
    }
    setDeciding('undo');
    setDecideError(null);
    try {
      await client.review.undoAction({ id: phase.runId });
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setDeciding(null);
    }
  };

  // The server files a card under done-for-you and sends its run id after
  // the card (`card_update`); the card adopts it and shows the run. It used to
  // file ITSELF on mount as well, which was a second filing of the same card
  // (walk 20, finding 27: every done-for-you card filed its ask twice).
  useEffect(() => {
    if (rec.runId !== undefined && phase.runId === undefined) {
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setPhase({ status: 'proposed', runId: rec.runId });
    }
  }, [rec.runId, phase.runId]);

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
      {/* A hairline block, not a second card inside the card. */}
      {isEmail && (to || subject || body) && (
        <div className="mt-2 border-t border-rule px-3 pt-2 text-xs">
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
            {/* A spinner promises the thing will change on its own. `pending`
                is waiting for a PERSON, so it spun forever and read as a hung
                request — Chris, 2026-09-17: *"after clicking review i get
                perma-loading 'In review' icon."* Only states the machine is
                actually working get the spinner. */}
            {!terminal && status !== 'snoozed' && status !== 'pending' && <Loader2 className="size-3 animate-spin" aria-hidden />}
            {status === 'pending' && <Clock3 className="size-3" aria-hidden />}
            {terminal && status === 'done' && <Check className="size-3" aria-hidden />}
            {terminal && status === 'undone' && <RotateCcw className="size-3" aria-hidden />}
            {terminal && status !== 'done' && status !== 'undone' && <X className="size-3" aria-hidden />}
            {status === 'done' && live?.approvedByAgent ? 'Done for you' : desc.label}
          </span>
          {live?.decidedBy && !(status === 'done' && live.approvedByAgent) && (
            <span className="text-muted-foreground">
              {status === 'rejected' ? 'by' : status === 'undone' ? 'undone by' : 'approved by'}
              {' '}
              {live.decidedBy}
              {live.decidedAt ? ` · ${fmtTime(live.decidedAt)}` : ''}
            </span>
          )}
          {status === 'done' && live?.approvedByAgent && live.reason && (
            <span className="text-muted-foreground" title={live.reason}>
              ·
              {live.reason}
            </span>
          )}
          {status === 'done' && live?.undoable && (
            <button
              type="button"
              onClick={() => void undo()}
              disabled={deciding !== null}
              data-testid="recommended-undo"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-60"
            >
              {deciding === 'undo' ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RotateCcw className="size-3" aria-hidden />}
              Undo
            </button>
          )}
          {rec.runId !== undefined && phase.runId === rec.runId && (
            <span className="text-muted-foreground/70">· filed by the agent within bounds</span>
          )}
        </div>
      )}

      {/* CTA */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {deferredUntil && (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarClock className="size-4" aria-hidden />
              {deferredLine(deferredUntil)}
            </span>
            {phase.runId !== undefined && (
              <Link href={inboxHref('proposal', phase.runId)} className="inline-flex items-center gap-1 text-sm text-brand-amber-deep hover:opacity-90">
                Open in review
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </>
        )}
        {!deferredUntil && phase.status === 'proposed'
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
                    {deferButton}
                  </>
                )}
                <Link
                  href={phase.runId !== undefined ? inboxHref('proposal', phase.runId) : '/dashboard/inbox?kind=proposal'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-tint px-3 py-1.5 text-sm font-medium text-brand-amber-deep transition hover:opacity-90"
                >
                  {status === 'pending' ? 'Decide in review' : 'Open in review'}
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
          : deferredUntil
            ? null
            : (
                <>
                  {/* One click when the suggestion is already right. Approving
                    used to mean "Prepare for review", then find the card again,
                    then "Approve" — two clicks and a context switch to agree
                    with something you had already read. Chris, 2026-09-17:
                    *"I wanted to approve. I shouldn't have to click twice."*
                    Preparing is still offered, for when you want to look first
                    or edit the draft. */}
                  {canApprove && !isDraft && (
                    <button
                      type="button"
                      onClick={() => void prepareAndApprove()}
                      disabled={busy || deciding !== null}
                      data-testid="recommended-approve-now"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                    >
                      {busy || deciding === 'approve' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
                      {busy || deciding === 'approve' ? 'Approving…' : 'Approve'}
                    </button>
                  )}
                  {canApprove && !isDraft
                    ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" onClick={prepare} disabled={busy} aria-label={busy ? 'Preparing…' : 'Review first'} className={QUIET_ICON}>
                              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PencilLine className="size-4" aria-hidden />}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Review first</TooltipContent>
                        </Tooltip>
                      )
                    : (
                        // The only way forward on this card, so it keeps its words.
                        <button
                          type="button"
                          onClick={prepare}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                        >
                          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PencilLine className="size-4" aria-hidden />}
                          {busy ? 'Preparing…' : isDraft ? 'Prepare draft for review' : 'Review first'}
                        </button>
                      )}
                  {canApprove && deferButton}
                </>
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
