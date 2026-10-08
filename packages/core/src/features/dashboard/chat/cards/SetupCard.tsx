'use client';

import type { RecommendedAction } from '../types';
import { Check, Loader2, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { alreadySettled, useSingleFlight } from '@/features/review/decideOnce';
import { cardDedupKey } from '@/libs/actions/cardDedupKey';
import { SETUP_CARD_KIND } from '@/libs/cards/card';
import { redactInternalIds } from '@/libs/chat/redact';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { useActionRunStatus } from '../useActionRunStatus';
import { useRecordCardDecision } from './CardDecisions';

/**
 * ONE STEP OF A WORKSPACE'S SETUP, PRESSED ONCE.
 *
 * The workspace lead's plan (`propose_setup`) arrives as one of these per
 * step: add an app, turn a plugin on, hire a role, invite people. The card is
 * its title, one line of why in the team's words, and one button. Pressing it
 * is the person's decision: the step is proposed as them through the action
 * registry (`review.actAsPerson` — the same path a person's own word takes in
 * chat, never a bypass), runs within their authority, and the card then says
 * Done with Undo beside it and a link to where the result lives. Nothing runs until the press; the stream never files a
 * setup card on its own.
 *
 * Nothing is said for the person: the card records the run it became
 * (`conversations.recordCardDecision` with `turn: false`), so a reload draws
 * Done and Undo where the button was, and the lead's next turn reads what
 * became of the step — done, undone, failed — from the run itself.
 *
 * Every change it makes is announced on the window (`SETUP_CHANGED_EVENT`)
 * so the sidebar's Getting started checklist counts it at once, and the shell
 * re-reads (`AppSidebar`), so an app just added is in the rail.
 */

/** Fired when a setup card ran or was undone; the checklist re-reads on it. */
export const SETUP_CHANGED_EVENT = 'vocion:workspace-setup-changed';

/**
 * Whether this card is a step of a setup plan.
 * @param rec - The card as the chat holds it.
 */
export function isSetupCard(rec: RecommendedAction): boolean {
  return rec.kind === SETUP_CARD_KIND && Boolean(rec.actionId);
}

/** Tell the page a setup step changed (the checklist listens). */
function announce(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SETUP_CHANGED_EVENT));
  }
}

type Props = {
  rec: RecommendedAction;
};

/**
 * One setup step: title, why, one button — then Done, Undo and where it lives.
 * @param props - The card.
 * @param props.rec - The card as the chat holds it.
 */
export function SetupCard({ rec }: Props) {
  const t = useTranslations('Onboarding');
  const [runId, setRunId] = useState<number | undefined>(rec.runId);
  const [busy, setBusy] = useState<'run' | 'undo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const live = useActionRunStatus(runId, nonce);
  const once = useSingleFlight();
  const recordDecision = useRecordCardDecision();

  // A card reloaded with its run, or filed after it was drawn, follows that run.
  useEffect(() => {
    if (rec.runId !== undefined && runId === undefined) {
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect -- adopting a run id the server sent after the card
      setRunId(rec.runId);
    }
  }, [rec.runId, runId]);

  // The checklist counts a step the moment it lands, and again when it is
  // undone; the shell re-reads too, so an app just added is in the rail.
  const status = live?.status;
  const done = status === 'done';
  const undone = status === 'undone';
  const failed = status === 'failed' || status === 'rejected';
  useEffect(() => {
    if (status === 'done' || status === 'undone') {
      announce();
    }
  }, [status]);

  const run = () => once(async () => {
    setBusy('run');
    setError(null);
    try {
      // A step that failed is tried again as a fresh run, not re-approved.
      let id = failed ? undefined : runId;
      let state = failed ? undefined : status;
      if (id === undefined) {
        // The press is the person's decision: proposed as them, it runs within
        // their authority, with Undo, and the run records them as the one who
        // did it (`review.actAsPerson`).
        const res = await client.review.actAsPerson({
          actionId: rec.actionId,
          input: rec.input,
          agentSlug: rec.agentSlug,
          rationale: rec.body,
          // One card, one run: a second press, or a remount, finds the run the first one made.
          dedupKey: cardDedupKey({ actionId: rec.actionId, label: rec.label, input: rec.input }),
        }) as { runId: number; status: string };
        id = res.runId;
        state = res.status;
        setRunId(id);
      }
      // An action that waits for a person whatever happens is approved in the same press.
      if (state === 'pending') {
        await client.review.decideAction({ id, decision: 'approve' });
      }
      // The card keeps the run it became — typed, on the card, with no words
      // written for the person — so a reload shows Done and the lead's next
      // turn reads what became of the step from the run itself.
      if (rec.id) {
        recordDecision({ cardId: rec.id, label: rec.label, action: 'approve', runId: id, turn: false });
      }
    } catch (err) {
      const message = (err as Error)?.message ?? '';
      if (!alreadySettled(message, 'approve')) {
        setError(redactInternalIds(message) || t('step_failed'));
      }
    } finally {
      setBusy(null);
      setNonce(n => n + 1);
    }
  });

  const undo = () => once(async () => {
    if (runId === undefined) {
      return;
    }
    setBusy('undo');
    setError(null);
    try {
      await client.review.undoAction({ id: runId });
    } catch (err) {
      setError(redactInternalIds((err as Error)?.message ?? '') || t('step_failed'));
    } finally {
      setBusy(null);
      setNonce(n => n + 1);
    }
  });

  const working = busy === 'run' || status === 'pending' || status === 'executing';
  const meta = (rec.fields ?? []).map(f => `${f.label} ${f.value}`).join(' · ');

  return (
    <div
      data-testid="setup-card"
      data-step-state={done ? 'done' : undone ? 'undone' : failed ? 'failed' : runId !== undefined ? 'running' : 'proposed'}
      className={`flex min-w-0 items-start gap-3 rounded-xl border px-3 py-2.5 ${done ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-card'}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold break-words">
          {done && <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />}
          <span className={undone ? 'text-muted-foreground line-through decoration-muted-foreground/40' : undefined}>{rec.label}</span>
        </div>
        {rec.body && <p className="mt-0.5 text-xs break-words text-muted-foreground">{rec.body}</p>}
        {meta && !done && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{meta}</p>}
        {done && rec.href && (
          <Link href={rec.href} className="mt-1 inline-flex text-xs font-medium text-brand-amber-deep hover:underline" data-testid="setup-card-open">
            {rec.hrefLabel ?? t('open')}
          </Link>
        )}
        {(error || failed) && (
          <p className="mt-1 text-xs break-words text-brand-fail" role="alert">{error ?? t('step_failed')}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 self-center">
        {done
          ? (
              <>
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{t('step_done')}</span>
                {live?.undoable && (
                  <button
                    type="button"
                    onClick={() => void undo()}
                    disabled={busy !== null}
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-60"
                    data-testid="setup-card-undo"
                  >
                    {busy === 'undo' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
                    {t('undo')}
                  </button>
                )}
              </>
            )
          : undone
            ? <span className="text-xs text-muted-foreground">{t('step_undone')}</span>
            : (
                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={working}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-action px-3 text-[13px] font-medium text-action-foreground transition-colors hover:bg-action/90 disabled:opacity-60"
                  data-testid="setup-card-run"
                >
                  {working && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  {failed ? t('try_again') : (rec.actionLabel ?? t('accept'))}
                </button>
              )}
      </div>
    </div>
  );
}
