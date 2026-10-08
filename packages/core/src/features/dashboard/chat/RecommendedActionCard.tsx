'use client';

import type { RecommendedAction } from './types';
import { ArrowRight, CalendarClock, Check, Clock3, FilePen, Loader2, Mail, PencilLine, RotateCcw, ShieldCheck, Sparkles, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { alreadySettled, useSingleFlight } from '@/features/review/decideOnce';
import { ResultLinks } from '@/features/review/ResultLinks';
import { cardDedupKey } from '@/libs/actions/cardDedupKey';
import { shortTitle } from '@/libs/cards/title';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { recommendedActionAdvice } from '@/services/chat/recommendedActionAdvice';
import { inboxHref } from '@/services/inbox/inboxRef';
import { ConnectSystemsCard, isConnectSystemsCard } from '../connect-systems/ConnectSystemsCard';
import { openAgentSurface } from './agentSurface';
import { BrandPreviewCard, isBrandCard } from './cards/BrandPreviewCard';
import { useRecordCardDecision } from './cards/CardDecisions';
import { isSetupCard, SetupCard } from './cards/SetupCard';
import { ConnectLinkCard, isConnectLinkCard } from './ConnectLinkCard';
import { DEFER_DAYS, deferredLine, deferUntil } from './deferral';
import { describeActionEffect, describeCardState, subtitleFor } from './recommendedAction';
import { answerInput, rulingChoices } from './rulingChoices';
import { TERMINAL_STATUSES, useActionRunStatus } from './useActionRunStatus';

/**
 * A2UI recommended-action card — turns a suggested next action into ONE tap,
 * and then keeps telling the truth about it (R4).
 *
 * Shows a real preview of what will be prepared (to / subject / body for an
 * email send) so the decision is informed, then "Prepare for review" JIT-
 * creates the gated review item (review.propose, reusing the agent's
 * authority) — nothing sends without approval. From that moment the card
 * follows the run in one state line (`describeCardState`): Waiting on you →
 * Approved by <name> / Done for you → Undone / Rejected / Failed, polled from
 * `review.actionStatus`. Above it, one line says what approving DOES, from
 * the action id (`describeActionEffect`), never from the agent's title. A
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

type CardProps = {
  rec: RecommendedAction;
  /** Whether to offer the inline Approve. The server still authorizes the decision. */
  canApprove?: boolean;
  /** Fired once the run exists (tap or server-filed) so a stack can count it. */
  onProposed?: (runId: number) => void;
  /** True while the reply holding the card is still streaming; the connect card's login waits for it. */
  replyInProgress?: boolean;
};

/**
 * One card in the answer. The connect card (`offer_connection`, #1080), a
 * setup step (`propose_setup`, `cards/SetupCard.tsx`) and a drafted brand
 * (`propose_brand`, `cards/BrandPreviewCard.tsx`) have their own components;
 * every other card is the action card below. The split is here, above every
 * hook, so no card ever calls a different set of hooks.
 * @param props - The card and how it behaves.
 */
export function RecommendedActionCard(props: CardProps) {
  if (isSetupCard(props.rec)) {
    return <SetupCard rec={props.rec} />;
  }
  if (isConnectSystemsCard(props.rec)) {
    return <ConnectSystemsCard rec={props.rec} />;
  }
  if (isBrandCard(props.rec)) {
    return <BrandPreviewCard rec={props.rec} />;
  }
  return isConnectLinkCard(props.rec) ? <ConnectLinkCard rec={props.rec} replyInProgress={props.replyInProgress} /> : <ActionCard {...props} />;
}

function ActionCard({ rec, canApprove = true, onProposed }: CardProps) {
  const [phase, setPhase] = useState<Phase>(rec.runId !== undefined ? { status: 'proposed', runId: rec.runId } : { status: 'idle' });
  const [drafting, setDrafting] = useState(false);
  // The decision is recorded ON THE CARD (backlog 025) — which option too,
  // on a ruling — never as a turn the person did not type; the next turn
  // binds "approve" to THIS card by its proposal, never to words.
  const recordDecision = useRecordCardDecision();
  const record = (action: 'approve' | 'reject' | 'defer' | 'undo', runId?: number, optionId?: string) => {
    if (rec.id) {
      recordDecision({ cardId: rec.id, label: rec.label, action, runId, ...(optionId ? { optionId } : {}) });
    }
  };
  const [deciding, setDeciding] = useState<'approve' | 'reject' | 'defer' | 'undo' | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [deferredUntil, setDeferredUntil] = useState<Date | null>(null);
  // What this person already decided here, until the poll says so too: the
  // buttons do not come back in the gap between the decision returning and
  // the status catching up (Chris, 2026-09-29: pressed Approve twice).
  const [asked, setAsked] = useState<'approve' | 'reject' | null>(null);
  // Which option is being chosen, so only its button spins.
  const [choosing, setChoosing] = useState<string | null>(null);
  // Bumped after a decision so the status is read now, not on the backoff.
  const [pollNonce, setPollNonce] = useState(0);
  const live = useActionRunStatus(phase.runId, pollNonce);
  // One gesture at a time, closed synchronously on the first press.
  const once = useSingleFlight();
  /**
   * A decision landed — or was refused because it already had. Either way the
   * card settles; only a refusal that is NOT the asked-for state is an error.
   * @param decision - What was pressed.
   * @param err - What the call threw, when it threw.
   */
  const settle = (decision: 'approve' | 'reject', err?: unknown) => {
    if (err !== undefined && !alreadySettled((err as Error)?.message, decision)) {
      setDecideError((err as Error)?.message ?? String(err));
      return;
    }
    setAsked(decision);
    setPollNonce(n => n + 1);
  };

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
  const prepareAndApprove = () => once(async () => {
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
      settle('approve');
    } catch (err) {
      settle('approve', err);
    } finally {
      setDeciding(null);
    }
  });

  /**
   * A RULING'S BUTTONS ARE ITS OPTIONS (Chris, 2026-09-29). Choosing one files
   * the question and answers it in one press — the choice rides the approval
   * as the reviewer's edit (`answer`), and an option that carries an action
   * runs it as the person (`ask.file` → `decideAsk`).
   * @param optionId - The chosen option.
   */
  const answerWith = (optionId: string) => once(async () => {
    if (!rec.actionId) {
      return;
    }
    setChoosing(optionId);
    setDeciding('approve');
    setDecideError(null);
    try {
      let runId = phase.runId;
      if (runId === undefined) {
        const res = await client.review.propose({
          actionId: rec.actionId,
          input: rec.input,
          agentSlug: rec.agentSlug,
          rationale: rec.rationale,
          confidence: rec.confidence,
          dedupKey: cardDedupKey({ actionId: rec.actionId, label: rec.label, input: rec.input }),
          ...recommendedActionAdvice(rec),
        }) as { runId: number; status: string };
        runId = res.runId;
        setPhase({ status: 'proposed', runId });
        onProposed?.(runId);
      }
      await client.review.decideAction({ id: runId, decision: 'approve', editedInput: answerInput(rec.input, optionId) });
      record('approve', runId, optionId);
      settle('approve');
    } catch (err) {
      settle('approve', err);
    } finally {
      setDeciding(null);
    }
  });

  const decide = (decision: 'approve' | 'reject') => once(async () => {
    if (phase.runId === undefined) {
      return;
    }
    setDeciding(decision);
    setDecideError(null);
    try {
      await client.review.decideAction({ id: phase.runId, decision });
      record(decision, phase.runId);
      settle(decision);
    } catch (err) {
      settle(decision, err);
    } finally {
      setDeciding(null);
    }
  });

  /**
   * Defer: "not now" without it reading as "no". The proposal is filed if it
   * is not yet, then snoozed in review until a week out (`deferral.ts`) — the
   * queue's own snooze, so the card and the queue say the same thing.
   */
  const defer = () => once(async () => {
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
  });

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
  const undo = () => once(async () => {
    if (phase.runId === undefined) {
      return;
    }
    setDeciding('undo');
    setDecideError(null);
    try {
      await client.review.undoAction({ id: phase.runId });
      setAsked(null);
      setPollNonce(n => n + 1);
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setDeciding(null);
    }
  });

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

  const isEmail = rec.actionId === 'gmail.send';
  const to = str(rec.input.to);
  const subject = str(rec.input.subject);
  const body = str(rec.input.body);
  const isDraft = rec.input.draft === true;
  const busy = phase.status === 'working';

  const polled = live?.status ?? (phase.status === 'proposed' ? 'pending' : null);
  // A decision that returned outranks a poll that has not caught up with it.
  const status = polled === 'pending' && asked ? (asked === 'approve' ? 'executing' : 'rejected') : polled;
  const unfiled = rec.state === 'unfiled' && phase.runId === undefined;
  const terminal = status ? TERMINAL_STATUSES.has(status) : false;
  const effect = describeActionEffect(rec.actionId);
  // A settled run's error is stale: the state line now says what happened.
  useEffect(() => {
    if (terminal) {
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setDecideError(null);
    }
  }, [terminal]);
  // The record this card is about opens from the card; once the card's action
  // has made a record (a filed request), the link is to THAT record (Chris,
  // 2026-09-28: "I want to click through to the feature detail page").
  const recordLink = live?.recordHref
    ? { href: live.recordHref, label: live.recordHrefLabel ?? 'Open record' }
    // An href with no actionId is a link card, drawn by its own button below: only recommend_action sets href, and only with an action_id.
    : rec.href && rec.actionId ? { href: rec.href, label: rec.hrefLabel ?? 'Open record' } : null;
  const draft = rec.draft && phase.runId === undefined ? rec.draft : null;
  // What the run made, each one move away — the record link above already
  // names one of them when it is the same page.
  const madeLinks = status === 'done' ? (live?.links ?? []).filter(l => l.href !== recordLink?.href) : [];
  const state = describeCardState({ status, decidedBy: live?.decidedBy, decidedAt: live?.decidedAt, approvedByAgent: live?.approvedByAgent, unfiled, summary: live?.summary, draft: Boolean(draft), choice: live?.choice }, fmtTime);
  // Done reads as done at a glance: a green edge, not the card that waits on you.
  const done = status === 'done';
  // Draft needed → one tap asks the agent for the whole record, here.
  const askForDraft = () => {
    if (!draft) {
      return;
    }
    setDrafting(true);
    // The dock or the full-page chat claims it and sends it in THIS
    // conversation; with neither mounted, the chat page picks it up.
    openAgentSurface({ prompt: draft.prompt, send: true }, (href) => {
      window.location.assign(href);
    });
  };
  const toneClass = state.tone === 'green'
    ? 'text-emerald-600 dark:text-emerald-400'
    : state.tone === 'red'
      ? 'text-destructive'
      : state.tone === 'amber'
        ? 'text-brand-amber-deep'
        : 'text-muted-foreground';
  // A spinner promises the thing will change on its own. Waiting on a PERSON
  // spun forever and read as a hung request (Chris, 2026-09-17), so only the
  // states the machine is actually working get one.
  const stateIcon = unfiled && status === null
    ? <X className="size-3 shrink-0" aria-hidden />
    : draft
      ? <FilePen className="size-3 shrink-0" aria-hidden />
      : status === null || status === 'pending'
        ? <Clock3 className="size-3 shrink-0" aria-hidden />
        : status === 'snoozed'
          ? <CalendarClock className="size-3 shrink-0" aria-hidden />
          : !terminal
              ? <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
              : status === 'done'
                ? <Check className="size-3 shrink-0" aria-hidden />
                : status === 'undone'
                  ? <RotateCcw className="size-3 shrink-0" aria-hidden />
                  : <X className="size-3 shrink-0" aria-hidden />;
  const stateText = (
    <span className={`inline-flex min-w-0 items-center gap-1 font-medium ${toneClass}`} data-testid="recommended-action-state">
      {stateIcon}
      <span className="truncate">{state.label}</span>
    </span>
  );
  // Why it ran on its own is one hover away from the words that say it did.
  const whyNot = unfiled && status === null ? rec.unfiledReason : draft ? draft.missing : undefined;
  const stateLabel = whyNot
    ? (
        <Tooltip>
          <TooltipTrigger asChild>{stateText}</TooltipTrigger>
          <TooltipContent>{draft ? `Missing: ${whyNot}` : `Not filed: ${whyNot}`}</TooltipContent>
        </Tooltip>
      )
    : live?.approvedByAgent && live.reason
      ? (
          <Tooltip>
            <TooltipTrigger asChild>{stateText}</TooltipTrigger>
            <TooltipContent>{live.reason}</TooltipContent>
          </Tooltip>
        )
      : stateText;

  const choices = rulingChoices(rec);
  // A RULING WAITING ON YOU IS ITS QUESTION AND ITS ANSWERS (Chris,
  // 2026-09-29, proposal 5210: "overall that card is complex?"): the question,
  // one line of why, the options, and review one quiet icon away. The effect
  // and "Waiting on you" rows go — the buttons say both. Once chosen, the
  // state line comes back: "You chose X · Undo".
  const pendingRuling = Boolean(choices) && canApprove && !draft && !deferredUntil && (status === null || status === 'pending');
  // A short action, and a line under it only when that line says something
  // the title does not. Confidence is the review detail's, not the card's.
  const title = shortTitle(choices ? str(rec.input.title).trim() || rec.label : rec.label);
  const why = subtitleFor(title, rec.rationale);
  const reviewHref = phase.runId !== undefined ? inboxHref('proposal', phase.runId) : '/dashboard/inbox?kind=proposal';
  const decideInReviewIcon = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={reviewHref} aria-label="Decide in review" data-testid="ruling-review-link" className={QUIET_ICON}>
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </TooltipTrigger>
      <TooltipContent>Decide in review</TooltipContent>
    </Tooltip>
  );
  const choiceButtons = choices && canApprove
    ? choices.map(c => (
        <button
          key={c.id}
          type="button"
          onClick={() => void answerWith(c.id)}
          disabled={busy || deciding !== null}
          data-testid="ruling-choice"
          className={c.recommended
            ? 'inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60'
            : 'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-60'}
        >
          {deciding === 'approve' && choosing === c.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {c.label}
        </button>
      ))
    : null;

  return (
    <div data-testid="recommended-action-card" data-run-status={status ?? undefined} data-draft={draft ? 'needed' : undefined} className={`mt-2.5 flex flex-col overflow-hidden rounded-xl border bg-card ${done ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border'}`}>
      {/* Header — compact: a short title, its why clamped */}
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-brand-amber-tint text-brand-amber-deep'}`}>
          {done ? <Check className="size-3.5" aria-hidden /> : isEmail ? <Mail className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold break-words">
            {rec.href
              ? <Link href={rec.href} className="hover:underline" data-testid="recommended-action-title-link">{title}</Link>
              : title}
          </div>
          {why && <p className={`mt-0.5 ${pendingRuling ? 'line-clamp-1' : 'line-clamp-2'} text-xs break-words text-muted-foreground`} data-testid="recommended-action-why">{why}</p>}
        </div>
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

      {/* What approving does, then where it stands — two lines, every card,
          in every state, so no card has to be read twice (Chris, 2026-09-28:
          "I don't understand what the first card did. Is it an auto approve
          recommendation? Make that clear."). The effect comes from the action
          id, never the agent's title. */}
      {!pendingRuling && (
        <div className="mx-3 mt-2 flex min-w-0 items-center gap-1.5 text-xs text-foreground/80">
          <span className="flex min-w-0 items-center gap-1.5" data-testid="recommended-action-effect">
            <Zap className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{draft ? 'Nothing is filed until the draft meets the bar' : effect}</span>
          </span>
          {recordLink && (
            <Link href={recordLink.href} data-testid="recommended-action-record-link" className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-brand-amber-deep hover:opacity-90">
              {recordLink.label}
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          )}
        </div>
      )}
      {!pendingRuling && (
        <div className="mx-3 mt-1 flex min-w-0 items-center gap-2 text-xs" data-testid="recommended-action-status">
          {/* Nothing waits on anyone for a card with nothing to press. */}
          {(rec.actionId || phase.runId !== undefined) && stateLabel}
          {status === 'done' && live?.undoable && (
            <button
              type="button"
              onClick={() => void undo()}
              disabled={deciding !== null}
              data-testid="recommended-undo"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-60"
            >
              {deciding === 'undo' ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RotateCcw className="size-3" aria-hidden />}
              Undo
            </button>
          )}
        </div>
      )}
      {madeLinks.length > 0 && <ResultLinks links={madeLinks} className="mx-3 mt-1 text-xs" />}
      {/* CTA — pinned to the bottom, so cards stretched to one height in a
          strip keep their buttons on one line. */}
      <div className="mt-auto flex flex-wrap items-center gap-2 px-3 py-2.5">
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
        {draft && !deferredUntil
          ? (
              <button
                type="button"
                onClick={askForDraft}
                disabled={drafting}
                data-testid="recommended-draft"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {drafting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FilePen className="size-4" aria-hidden />}
                {drafting ? 'Asked for the draft' : `Draft the full ${String(rec.input.objectType ?? 'record').replace(/[_-]+/g, ' ')}`}
              </button>
            )
          : !deferredUntil && phase.status === 'proposed'
              ? (
                  <>
                    {status === 'pending' && canApprove && choiceButtons && (
                      <>
                        {choiceButtons}
                        {decideInReviewIcon}
                      </>
                    )}
                    {status === 'pending' && canApprove && !choiceButtons && (
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
                    {!(pendingRuling && choiceButtons) && (
                      <Link
                        href={reviewHref}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-tint px-3 py-1.5 text-sm font-medium text-brand-amber-deep transition hover:opacity-90"
                      >
                        {status === 'pending' ? 'Decide in review' : 'Open in review'}
                        <ArrowRight className="size-3.5" aria-hidden />
                      </Link>
                    )}
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
                : !rec.actionId
                  // A card that names no action has nothing to approve (red team,
                  // 2026-09-26: "Approve build" whose Approve answered "This
                  // recommendation named no action"). It reads as a note; no button
                  // that can only fail. The connect link card (offer_connection,
                  // #1080) never reaches here: ConnectLinkCard draws it.
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
                          {canApprove && !isDraft && choiceButtons}
                          {canApprove && !isDraft && !choiceButtons && (
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
                          {canApprove && !isDraft && choiceButtons
                            ? (
                          // A ruling's review is one quiet icon: it files the
                          // question into review without answering it.
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button type="button" onClick={prepare} disabled={busy} aria-label="Decide in review" data-testid="ruling-review-link" className={QUIET_ICON}>
                                      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>Decide in review</TooltipContent>
                                </Tooltip>
                              )
                            : canApprove && !isDraft
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
                          {canApprove && !choiceButtons && deferButton}
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
