'use client';

import type { RecommendedAction } from '../types';
import type { CardAnswerInput } from './CardDecisions';
import { HelpCircle, Send } from 'lucide-react';
import { useId, useState } from 'react';
import { choiceAllowsOther } from '@/libs/cards/card';

/**
 * A choice card: one question, lettered options, your own words, or Skip
 * (#1028). The agent asked it with `ask_choice`; the answer goes back as the
 * person's chat turn, and the card collapses to what was said.
 *
 * Three looks, read off the card and never guessed:
 * - proposed: the question, the options, the text field, Skip;
 * - answered (`answer` set): the question and `✓ <answer>`, no controls;
 * - skipped (`state: 'deferred'`): the question and `Skipped`, no controls.
 *
 * An option's bound actions are not shown here: the pick runs them on the
 * server as the person, and a later change may summarize them.
 *
 * The text field is a plain text input. Nobody should paste a secret into a
 * chat card, so it asks for no credential-style autofill.
 */

const OPTION_BUTTON = 'flex w-full items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50';

type ChoiceCardProps = {
  rec: RecommendedAction;
  onAnswer: (answer: CardAnswerInput) => void;
  /** Resolves false when the skip could not be recorded; the card then reopens. */
  onDismiss: (dismissal: { cardId: string; label: string }) => Promise<boolean> | void;
  /** True while the session is busy with a reply or an upload. */
  busy?: boolean;
  /** No conversation around the card (an artifact view, a preview): show the question and options as text, with nothing to press. */
  readOnly?: boolean;
};

/**
 * The answer the person gave, or null while the card is open.
 * @param rec
 */
function answeredText(rec: RecommendedAction): string | null {
  return rec.answer?.text ?? null;
}

/**
 * True once the card was skipped, here or on an earlier visit.
 * @param rec
 * @param skippedHere
 */
function isSkipped(rec: RecommendedAction, skippedHere: boolean): boolean {
  return skippedHere || (rec.state === 'deferred' && !rec.answer);
}

function CollapsedCard({ rec, line }: { rec: RecommendedAction; line: string }) {
  return (
    <div data-testid="choice-card" data-choice-state="closed" className="mt-2.5 flex flex-col gap-0.5 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="text-sm font-semibold break-words">{rec.label}</div>
      <p className="text-sm text-muted-foreground">{line}</p>
    </div>
  );
}

type SendState = {
  refusal: RecommendedAction['answerRefused'];
  setSentWith: (sent: { refusal: RecommendedAction['answerRefused'] }) => void;
  onAnswer: (answer: CardAnswerInput) => void;
};

/**
 * Mark this send as in flight, then hand the answer up.
 * @param state
 * @param answer
 */
function sendAnswer(state: SendState, answer: CardAnswerInput): void {
  state.setSentWith({ refusal: state.refusal });
  state.onAnswer(answer);
}

const SKIP_FAILED = 'Could not skip this question. Try again.';

type SkipState = {
  setSkippedHere: (skipped: boolean) => void;
  setSkipError: (error: string | null) => void;
  onDismiss: ChoiceCardProps['onDismiss'];
};

/**
 * Skip: show Skipped now, then record the dismissal. If it was not recorded
 * (the answer is `false`, or the call threw) the card reopens with a sentence,
 * so nobody is left looking at a Skipped the server never heard.
 * @param state - The card's setters and the dismissal recorder.
 * @param dismissal - Which card, and its question.
 * @param dismissal.cardId - The card.
 * @param dismissal.label - The question, as the log words it.
 */
async function skipCard(state: SkipState, dismissal: { cardId: string; label: string }): Promise<void> {
  state.setSkippedHere(true);
  state.setSkipError(null);
  const recorded = await Promise.resolve(state.onDismiss(dismissal)).catch(() => false);
  if (recorded === false) {
    state.setSkippedHere(false);
    state.setSkipError(SKIP_FAILED);
  }
}

/**
 * Enter in the text field sends, the same as the button, and only with words in it.
 * @param event
 * @param event.preventDefault
 * @param text
 * @param disabled
 * @param onSend
 */
function submitOther(event: { preventDefault: () => void }, text: string, disabled: boolean, onSend: (text: string) => void): void {
  event.preventDefault();
  if (text && !disabled) {
    onSend(text);
  }
}

function ReadOnlyCard({ rec }: { rec: RecommendedAction }) {
  return (
    <div data-testid="choice-card" data-choice-state="read-only" className="mt-2.5 flex flex-col gap-1 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="text-sm font-semibold break-words">{rec.label}</div>
      {rec.body && <p className="text-xs break-words text-muted-foreground">{rec.body}</p>}
      <ul className="text-sm text-muted-foreground">
        {(rec.options ?? []).map(o => <li key={o.id}>{`${o.id}. ${o.label}`}</li>)}
      </ul>
    </div>
  );
}

function OptionButton({ letter, label, description, disabled, onPick }: { letter: string; label: string; description?: string; disabled: boolean; onPick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onPick} aria-label={`${letter} ${label}`} className={OPTION_BUTTON}>
      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-brand-amber-tint font-mono text-xs font-semibold text-brand-amber-deep" aria-hidden>{letter}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium break-words">{label}</span>
        {description && <span className="mt-0.5 block text-xs break-words text-muted-foreground">{description}</span>}
      </span>
    </button>
  );
}

function OtherField({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [typed, setTyped] = useState('');
  const fieldId = useId();
  const text = typed.trim();
  return (
    <form className="flex items-center gap-2" onSubmit={e => submitOther(e, text, disabled, onSend)}>
      <label htmlFor={fieldId} className="sr-only">Type your own answer</label>
      <input
        id={fieldId}
        type="text"
        autoComplete="off"
        value={typed}
        disabled={disabled}
        placeholder="Type your own answer"
        onChange={e => setTyped(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
      />
      <button type="submit" disabled={disabled || !text} aria-label="Send answer" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50">
        <Send className="size-4" aria-hidden />
      </button>
    </form>
  );
}

export function ChoiceCard({ rec, onAnswer, onDismiss, busy = false, readOnly = false }: ChoiceCardProps) {
  // The refusal the card showed when the person last sent. While it is still
  // the card's current refusal, that send has not come back; a new refusal
  // (or the card changing state) turns the options on again.
  const [sentWith, setSentWith] = useState<{ refusal: RecommendedAction['answerRefused'] } | null>(null);
  const [skippedHere, setSkippedHere] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const cardId = rec.id ?? '';

  const answered = answeredText(rec);
  if (answered !== null) {
    return <CollapsedCard rec={rec} line={`✓ ${answered}`} />;
  }
  if (isSkipped(rec, skippedHere)) {
    return <CollapsedCard rec={rec} line="Skipped" />;
  }

  const sending = (sentWith !== null && sentWith.refusal === rec.answerRefused) || busy;
  if (readOnly) {
    return <ReadOnlyCard rec={rec} />;
  }
  const sendState: SendState = { refusal: rec.answerRefused, setSentWith, onAnswer };

  return (
    <div data-testid="choice-card" data-choice-state="open" className="mt-2.5 flex flex-col gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-amber-tint text-brand-amber-deep">
          <HelpCircle className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold break-words">{rec.label}</div>
          {rec.body && <p className="mt-0.5 text-xs break-words text-muted-foreground">{rec.body}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {(rec.options ?? []).map(o => (
          <OptionButton key={o.id} letter={o.id} label={o.label} description={o.description} disabled={sending} onPick={() => sendAnswer(sendState, { cardId, optionId: o.id, text: o.label })} />
        ))}
      </div>
      {choiceAllowsOther(rec) && <OtherField disabled={sending} onSend={text => sendAnswer(sendState, { cardId, optionId: 'other', text })} />}
      {busy && <p className="text-xs text-muted-foreground">Wait for the reply to finish.</p>}
      {skipError && <p role="alert" className="text-xs text-destructive">{skipError}</p>}
      {rec.answerRefused && !sending && <p role="alert" className="text-xs text-destructive">{rec.answerRefused.error}</p>}
      <div>
        <button type="button" onClick={() => void skipCard({ setSkippedHere, setSkipError, onDismiss }, { cardId, label: rec.label })} disabled={sending} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50">Skip</button>
      </div>
    </div>
  );
}
