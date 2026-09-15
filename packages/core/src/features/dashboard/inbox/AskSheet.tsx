'use client';

import type { AskOption } from '@/models/Schema';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ExternalLink, Loader2, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FIXED_ROWS, labelFor, OTHER } from './askOptions';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { firstParagraph, isNearDuplicate, sentenceCase, splitBody } from './askText';
import { KIND_LABEL, riskTone } from './inboxMeta';

/** What the sheet needs to know about one open ask — the page hands it over from the server. */
export type SheetAsk = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  options: AskOption[];
  contextUrl: string | null;
  contextMd: string | null;
  agentSlug: string | null;
  teamSlug: string | null;
  risk: string | null;
  /** How often this asker's recommended option was the one chosen (server-computed, 30d). */
  alignment?: { agreementRate: number | null; n: number; window: string } | null;
};

type Answer = { decision: string; note: string };
type Outcome = { ok: true } | { ok: false; error: string };


/**
 * The question screen and, for a group, the stepper around it — one question
 * per screen, options as tall touchable rows, an "Other" row that opens a
 * textarea, Next → advances, and a receipt at the end that lists every
 * Question → Answer with an Edit per row before one "Submit all". A single
 * ask is the same screen with Submit in place of Next. Each submit is one
 * `POST /api/v1/asks/:id/decide`; a sheet that half-fails stays editable.
 *
 * Built to be answered from a phone: one column, big targets, the action
 * pinned to the bottom of the screen.
 * @param props
 * @param props.asks - The OPEN asks to answer, in order.
 * @param props.title - The sheet's title (a group's `groupTitle`).
 * @param props.endpoint
 * @param props.allowOther
 */
export function AskSheet({ asks, title, endpoint = 'ask', allowOther = true }: {
  asks: SheetAsk[];
  title?: string | null;
  /**
   * Where a decision is written. `ask` → `POST /api/v1/asks/:id/decide`;
   * `review` → `POST /api/v1/reviews/decide` for a proposed action (the id is
   * the action run), which enforces the same `approve` capability the review
   * page does — the sheet never bypasses it.
   */
  endpoint?: 'ask' | 'review';
  /** Offer the free-text "Other" row. Off for review items, which are approve/reject. */
  allowOther?: boolean;
}) {
  const router = useRouter();
  const multi = asks.length > 1;
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<'question' | 'receipt'>('question');
  const [answers, setAnswers] = useState<Record<number, Answer>>(() => {
    // Pre-select the recommended option where there is one.
    const initial: Record<number, Answer> = {};
    for (const ask of asks) {
      const rec = ask.options.find(o => o.recommended);
      if (rec) {
        initial[ask.id] = { decision: rec.id, note: '' };
      }
    }
    return initial;
  });
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [submitting, setSubmitting] = useState(false);

  const current = asks[index];
  if (!current) {
    return null;
  }

  const answerFor = (id: number): Answer => answers[id] ?? { decision: '', note: '' };
  const complete = (a: Answer) => a.decision !== '' && (a.decision !== OTHER || a.note.trim() !== '');
  const remaining = asks.filter(a => outcomes[a.id]?.ok !== true);

  function setAnswer(id: number, patch: Partial<Answer>) {
    setAnswers(prev => ({ ...prev, [id]: { ...answerFor(id), ...patch } }));
  }

  async function submitOne(ask: SheetAsk): Promise<Outcome> {
    const a = answerFor(ask.id);
    const note = a.note.trim() || undefined;
    try {
      const res = endpoint === 'review'
        ? await fetch('/api/v1/reviews/decide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'action', id: ask.id, action: a.decision === 'approve' ? 'approve' : 'reject', reason: note }),
          })
        : await fetch(`/api/v1/asks/${ask.id}/decide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: a.decision, note }),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        return { ok: false, error: body?.error?.message ?? `${res.status} ${res.statusText}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function submitAll() {
    setSubmitting(true);
    const next: Record<number, Outcome> = { ...outcomes };
    for (const ask of remaining) {
      next[ask.id] = await submitOne(ask);
      setOutcomes({ ...next });
    }
    setSubmitting(false);
    if (Object.values(next).every(o => o.ok)) {
      router.refresh();
    }
  }

  if (stage === 'receipt') {
    const allDone = asks.every(a => outcomes[a.id]?.ok);
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <header className="mb-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Receipt</p>
          <h1 className="text-xl font-semibold">{title ?? 'Your answers'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Check each answer. Edit any row, then submit them all at once.</p>
        </header>
        <ol className="divide-y divide-border rounded-md border border-border">
          {asks.map((ask, i) => {
            const a = answerFor(ask.id);
            const outcome = outcomes[ask.id];
            return (
              <li key={ask.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{ask.title}</p>
                  <p className="mt-0.5 text-sm">
                    <span className="font-medium text-primary">{labelFor(ask, a.decision)}</span>
                    {a.note.trim() && <span className="text-muted-foreground">{` — ${a.note.trim()}`}</span>}
                  </p>
                  {outcome && !outcome.ok && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{outcome.error}</p>}
                </div>
                {outcome?.ok
                  ? <Check className="mt-1 size-4 shrink-0 text-emerald-600" aria-label="Submitted" />
                  : (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => {
                          setIndex(i);
                          setStage('question');
                        }}
                        className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        Edit
                      </button>
                    )}
              </li>
            );
          })}
        </ol>
        <StickyBar>
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              setIndex(asks.length - 1);
              setStage('question');
            }}
            className="inline-flex min-h-12 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </button>
          {allDone
            ? (
                <span className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-emerald-600/10 px-4 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <Check className="size-4" aria-hidden />
                  All submitted
                </span>
              )
            : (
                <button
                  type="button"
                  disabled={submitting || remaining.some(a => !complete(answerFor(a.id)))}
                  onClick={submitAll}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                  {remaining.length === asks.length ? 'Submit all' : `Submit ${remaining.length} remaining`}
                </button>
              )}
        </StickyBar>
      </div>
    );
  }

  const answer = answerFor(current.id);
  const rows = current.options.length > 0 ? current.options : FIXED_ROWS;
  // Simplest useful explanation first: two sentences of the body; the rest,
  // the long-form markdown and the context link all live in one Details fold.
  const body = splitBody(current.body);
  const paragraph = firstParagraph(current.body);
  const hasDetails = Boolean(body.rest || current.contextMd || current.contextUrl);
  const canAdvance = complete(answer);
  const outcome = outcomes[current.id];

  return (
    <div className="mx-auto w-full max-w-2xl pb-28">
      <header className="mb-4">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {multi && <span className="font-medium tabular-nums">{`Question ${index + 1} of ${asks.length}`}</span>}
          {multi && title && <span className="truncate">{`· ${title}`}</span>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-border px-2 py-0.5 font-medium">{KIND_LABEL[current.kind] ?? current.kind}</span>
          {current.risk && <span className={`rounded-full border px-2 py-0.5 font-medium tracking-wide uppercase ${riskTone(current.risk)}`}>{`${current.risk} risk`}</span>}
          {current.agentSlug && <span className="text-muted-foreground">{`asked by ${current.agentSlug}`}</span>}
        </div>
        <h1 className="mt-2 line-clamp-2 text-xl leading-snug font-semibold" title={current.title}>{sentenceCase(current.title)}</h1>
        <RecommendationLine ask={current} />
        {body.lead && (
          <div className="prose prose-sm mt-2 max-w-none text-muted-foreground dark:prose-invert">
            <Markdown remarkPlugins={[remarkGfm]}>{body.lead}</Markdown>
          </div>
        )}
      </header>

      <div role="radiogroup" aria-label="Your answer" className="space-y-2">
        {rows.map(option => (
          <OptionRow
            key={option.id}
            option={isNearDuplicate(option.description, paragraph) ? { ...option, description: undefined } : option}
            selected={answer.decision === option.id}
            onSelect={() => setAnswer(current.id, { decision: option.id })}
          />
        ))}
        {allowOther && (
          <OptionRow
            option={{ id: OTHER, label: 'Other', description: 'Answer in your own words. The team reads it and may come back with a follow-up.' }}
            selected={answer.decision === OTHER}
            onSelect={() => setAnswer(current.id, { decision: OTHER })}
          />
        )}
        {answer.decision === OTHER && (
          <textarea
            value={answer.note}
            onChange={e => setAnswer(current.id, { note: e.target.value })}
            rows={4}
            placeholder="What should happen instead?"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        )}
      </div>

      {answer.decision !== '' && answer.decision !== OTHER && (
        <details className="mt-3">
          <summary className="inline-flex min-h-10 cursor-pointer items-center text-sm text-muted-foreground hover:text-foreground">Add a note</summary>
          <textarea
            value={answer.note}
            onChange={e => setAnswer(current.id, { note: e.target.value })}
            rows={3}
            placeholder="Optional — travels back with the answer."
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </details>
      )}

      {hasDetails && (
        <details className="mt-4 rounded-md border border-border">
          <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 px-3 text-sm font-medium">
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
            {body.rest ? 'Show details' : 'Details'}
          </summary>
          <div className="space-y-3 border-t border-border px-3 py-3">
            {body.rest && (
              <div className="prose prose-sm max-w-none text-muted-foreground dark:prose-invert">
                <Markdown remarkPlugins={[remarkGfm]}>{body.rest}</Markdown>
              </div>
            )}
            {current.contextMd && (
              <div className={`prose prose-sm max-w-none dark:prose-invert ${body.rest ? 'border-t border-border pt-3' : ''}`}>
                <Markdown remarkPlugins={[remarkGfm]}>{current.contextMd}</Markdown>
              </div>
            )}
            {current.contextUrl && (
              <a href={current.contextUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
                Open the context
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        </details>
      )}

      {outcome && !outcome.ok && (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">{outcome.error}</div>
      )}

      <StickyBar>
        {multi && index > 0 && (
          <button
            type="button"
            onClick={() => setIndex(i => i - 1)}
            className="inline-flex min-h-12 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </button>
        )}
        {multi
          ? (
              <button
                type="button"
                disabled={!canAdvance}
                onClick={() => (index + 1 < asks.length ? setIndex(i => i + 1) : setStage('receipt'))}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {answer.decision ? `${labelFor(current, answer.decision)} · ${index + 1 < asks.length ? 'Next' : 'Review answers'}` : index + 1 < asks.length ? 'Next' : 'Review answers'}
                <ArrowRight className="size-4" aria-hidden />
              </button>
            )
          : (
              <button
                type="button"
                disabled={!canAdvance || submitting}
                onClick={submitAll}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                {answer.decision ? `Submit · ${labelFor(current, answer.decision)}` : 'Submit'}
              </button>
            )}
      </StickyBar>
    </div>
  );
}

/**
 * One quiet line under the question: how sure the asker is of its
 * recommendation, and how often its recommendations were the one chosen. The
 * same shape an action proposal shows beside its confidence meter, so a
 * person reads asks and actions the same way. Nothing at all when there is
 * neither a confidence nor any history.
 * @param props
 * @param props.ask
 */
function RecommendationLine({ ask }: { ask: SheetAsk }) {
  const rec = ask.options.find(o => o.recommended);
  const confidence = typeof rec?.confidence === 'number' ? Math.round(rec.confidence * 100) : null;
  const a = ask.alignment;
  const agrees = a && a.n > 0 && a.agreementRate !== null ? Math.round(a.agreementRate * 100) : null;
  if (confidence === null && agrees === null) {
    return null;
  }
  return (
    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
      {confidence !== null && `Recommended with ${confidence}% confidence`}
      {confidence !== null && agrees !== null && ' · '}
      {agrees !== null && (
        <span title={`${a!.n} answered recommendation${a!.n === 1 ? '' : 's'} of this kind from this asker in the last 30 days`}>
          {`agrees with you ${agrees}% · n=${a!.n}`}
        </span>
      )}
    </p>
  );
}

function OptionRow({ option, selected, onSelect }: { option: AskOption; selected: boolean; onSelect: () => void }) {
  // "Simple beats flexible": the recommended row is the one obvious primary
  // action — drawn heavier and pre-selected — every other row is secondary.
  const primary = option.recommended === true;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex min-h-14 w-full items-start gap-3 rounded-md border px-4 py-3 text-left transition ${
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : primary ? 'border-primary/50 hover:bg-primary/5' : 'border-border hover:bg-muted/40'
      }`}
    >
      <span className={`mt-1 size-4 shrink-0 rounded-full border ${selected ? 'border-primary bg-primary' : 'border-muted-foreground/50'}`} aria-hidden>
        {selected && <Check className="size-4 text-primary-foreground" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {option.label}
          {option.recommended && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Recommended</span>}
        </span>
        {option.description && (
          <span className={`mt-0.5 text-sm text-muted-foreground ${selected ? 'block' : 'line-clamp-2'}`} title={selected ? undefined : option.description}>
            {option.description}
          </span>
        )}
      </span>
    </button>
  );
}

function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:sticky sm:mt-6 sm:rounded-md sm:border">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2">{children}</div>
    </div>
  );
}

