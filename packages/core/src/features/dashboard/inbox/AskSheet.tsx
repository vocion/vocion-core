'use client';

import type { AskOption } from '@/models/Schema';
import type { InboxKind } from '@/services/InboxService';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ExternalLink, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StickyActionBar } from '@/features/dashboard/StickyActionBar';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { kindForAsk } from '@/services/inbox/kinds';
import { FIXED_ROWS, labelFor, OTHER } from './askOptions';
import { firstParagraph, isNearDuplicate, sentenceCase, splitBody } from './askText';
import { DECISION_VERBS } from './decisionVerbs';
import { decisionCrumbs, KIND_LABEL, riskTone } from './inboxMeta';

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
 * Wears the same chrome as every other decision on "Needs you": the
 * `ReviewHeader` (breadcrumb › kind › record, one meta row with the asker,
 * the recommendation's confidence and how often you agreed with this asker)
 * and the `StickyActionBar` for Submit / Next. The option rows ARE the verbs
 * for an ask — `DECISION_VERBS` says so — so the bar carries one primary.
 *
 * Built to be answered from a phone: one column, big targets, the action
 * pinned to the bottom of the screen.
 * @param props
 * @param props.asks - The OPEN asks to answer, in order.
 * @param props.title - The sheet's title (a group's `groupTitle`).
 * @param props.endpoint
 * @param props.allowOther
 * @param props.kind - The inbox kind the crumbs name; defaults to the current ask's.
 * @param props.crumbs - Breadcrumb override.
 */
export function AskSheet({ asks, title, endpoint = 'ask', allowOther = true, kind, crumbs }: {
  asks: SheetAsk[];
  title?: string | null;
  kind?: InboxKind;
  crumbs?: Array<{ label: string; href?: string }>;
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

  const sheetKind = kind ?? kindForAsk(current.kind);
  const sheetCrumbs = crumbs ?? decisionCrumbs(sheetKind, multi ? title ?? null : null);

  if (stage === 'receipt') {
    const allDone = asks.every(a => outcomes[a.id]?.ok);
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ReviewHeader crumbs={sheetCrumbs} title={title ?? 'Your answers'} system="Receipt" status={allDone ? 'done' : 'open'} position={`${asks.length} ${asks.length === 1 ? 'answer' : 'answers'}`} />
        <p className="mt-3 text-sm text-muted-foreground">Check each answer. Edit any row, then submit them all at once.</p>
        <ol className="mt-4 divide-y divide-border border-y border-border">
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
        <StickyActionBar
          primary={allDone
            ? { 'label': 'All submitted', 'onClick': () => router.push('/dashboard/inbox'), 'icon': Check, 'data-testid': 'ask-submit' }
            : {
                'label': remaining.length === asks.length ? 'Submit all' : `Submit ${remaining.length} remaining`,
                'onClick': () => void submitAll(),
                'disabled': submitting || remaining.some(a => !complete(answerFor(a.id))),
                'busy': submitting,
                'icon': Check,
                'data-testid': 'ask-submit',
              }}
          secondary={allDone
            ? []
            : [{
                label: 'Back',
                icon: ArrowLeft,
                disabled: submitting,
                onClick: () => {
                  setIndex(asks.length - 1);
                  setStage('question');
                },
              }]}
        />
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

  const recommended = current.options.find(o => o.recommended);
  const verbs = DECISION_VERBS[sheetKind];
  const primaryLabel = multi
    ? (answer.decision ? `${labelFor(current, answer.decision)} · ${index + 1 < asks.length ? 'Next' : 'Review answers'}` : index + 1 < asks.length ? 'Next' : 'Review answers')
    : (answer.decision ? `${verbs.primary.label} · ${labelFor(current, answer.decision)}` : verbs.primary.label);

  return (
    <div className="mx-auto w-full max-w-3xl" data-testid="ask-sheet">
      <ReviewHeader
        crumbs={sheetCrumbs}
        title={sentenceCase(current.title)}
        system={KIND_LABEL[current.kind] ?? current.kind}
        status="open"
        proposedBy={current.agentSlug ? `asked by ${current.agentSlug}` : null}
        confidence={typeof recommended?.confidence === 'number' ? recommended.confidence : undefined}
        alignment={current.alignment}
        position={multi ? `Question ${index + 1} of ${asks.length}` : undefined}
        extra={current.risk
          ? <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase ${riskTone(current.risk)}`}>{`${current.risk} risk`}</span>
          : undefined}
      />
      {body.lead && (
        <div className="prose prose-sm mt-4 mb-4 max-w-none text-muted-foreground dark:prose-invert">
          <Markdown remarkPlugins={[remarkGfm]}>{body.lead}</Markdown>
        </div>
      )}

      <div role="radiogroup" aria-label="Your answer" className="mt-4 space-y-2">
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

      <StickyActionBar
        primary={multi
          ? { 'label': primaryLabel, 'onClick': () => (index + 1 < asks.length ? setIndex(i => i + 1) : setStage('receipt')), 'disabled': !canAdvance, 'icon': ArrowRight, 'data-testid': 'ask-submit' }
          : { 'label': primaryLabel, 'onClick': () => void submitAll(), 'disabled': !canAdvance || submitting, 'busy': submitting, 'icon': Check, 'data-testid': 'ask-submit' }}
        secondary={multi && index > 0 ? [{ label: 'Back', icon: ArrowLeft, onClick: () => setIndex(i => i - 1) }] : []}
      />
    </div>
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
