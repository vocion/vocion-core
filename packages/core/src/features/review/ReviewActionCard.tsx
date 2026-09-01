'use client';

import type { ContentEdit } from './contentKinds';
import type { ReviewCard, ReviewContentEdit } from '@/libs/actions/types';
import { AlarmClock, Check, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';
import { contentKindRenderer } from './contentKinds';

/**
 * The reusable review card — ONE template every object type renders through,
 * on every surface that decides the run (the review queue and the domain
 * consoles). The presenter supplies WHAT (the `ReviewCard`); this shell owns
 * HOW: zone layout, inline content editing, the note, snooze, and the decide
 * path. Confidence and the lane status render from the run itself, never from
 * the presenter, so no object type can omit them. Absent zones collapse.
 */

export type ReviewCardRun = {
  id: number;
  actionId: string;
  status: string;
  input: Record<string, unknown>;
  invokedBy: string | null;
  proposal: { confidence?: number; rationale?: string } | null;
  card: ReviewCard;
};

/** Actions whose Decline requires a reason (the note doubles as it). */
const REJECT_NEEDS_NOTE = new Set(['personalization.enroll']);

/** The run status, as the lane label a reviewer reads. */
const STATUS_LABEL: Record<string, string> = {
  pending: 'Ready for review',
  approved: 'Approved',
  executing: 'Executing',
  done: 'Done',
  failed: 'Failed',
  rejected: 'Declined',
};

function tone(c?: number): string {
  if (c === undefined) {
    return 'bg-muted text-muted-foreground';
  }
  if (c >= 0.85) {
    return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  }
  if (c >= 0.7) {
    return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  }
  return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
}

const SNOOZES = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const fieldClass = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-brand-amber';

export function ReviewActionCard(props: {
  run: ReviewCardRun;
  /** Fired after a decision or snooze lands, so the surface can drop/refresh the item. */
  onDecided?: (outcome: 'approve' | 'reject' | 'snooze') => void;
}) {
  const { run, onDecided } = props;
  const card = run.card;
  const [contentEdits, setContentEdits] = useState<Record<string, ContentEdit>>({});
  const [propertyEdits, setPropertyEdits] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [steer, setSteer] = useState('');
  const [steering, setSteering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  // Reset the working copy when the surface moves to another run.
  useEffect(() => {
    setContentEdits({});
    setNote('');
    setSteer('');
    setSnoozeOpen(false);
    const properties = (run.input.properties ?? {}) as Record<string, unknown>;
    setPropertyEdits(Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, str(v)])));
  }, [run.id]);

  const pct = run.proposal?.confidence !== undefined ? Math.round(run.proposal.confidence * 100) : null;
  const hasProperties = run.input.properties !== undefined && (card.content?.length ?? 0) === 0;
  const rejectNeedsNote = REJECT_NEEDS_NOTE.has(run.actionId);
  const firstEmailId = card.content?.find(c => c.kind === 'email')?.id;

  const buildDecision = () => {
    const edits: ReviewContentEdit[] = Object.entries(contentEdits).map(([id, e]) => ({ id, ...e }));
    const editedInput = hasProperties
      ? { ...run.input, properties: { ...(run.input.properties as Record<string, unknown>), ...propertyEdits } }
      : undefined;
    return { contentEdits: edits.length > 0 ? edits : undefined, editedInput };
  };

  const decideRun = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    try {
      const { contentEdits: ce, editedInput } = buildDecision();
      await client.review.decideAction({
        id: run.id,
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(decision === 'approve' && ce ? { contentEdits: ce } : {}),
        ...(decision === 'approve' && editedInput ? { editedInput } : {}),
      });
      onDecided?.(decision);
    } finally {
      setBusy(false);
    }
  };

  const snoozeRun = async (days: number) => {
    setBusy(true);
    try {
      await client.review.snoozeAction({
        id: run.id,
        until: new Date(Date.now() + days * 86_400_000).toISOString(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDecided?.('snooze');
    } finally {
      setBusy(false);
      setSnoozeOpen(false);
    }
  };

  // Steer — AI rewrite of the draft's long text; lands in the first email
  // item's body (or the notes property) for the reviewer to re-review.
  const canSteer = firstEmailId !== undefined && typeof run.input.body === 'string';
  const onSteer = async () => {
    setSteering(true);
    try {
      const res = await client.review.rewriteDraft({ runId: run.id, hint: steer.trim() || undefined });
      if (firstEmailId) {
        setContentEdits(e => ({ ...e, [firstEmailId]: { ...e[firstEmailId], body: res.body } }));
      }
      setSteer('');
    } catch {
      /* keep current text */
    } finally {
      setSteering(false);
    }
  };

  return (
    <div data-testid="review-action-card">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {/* A · Header — system, lane status + confidence from the RUN, title, subject. */}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">{card.system ?? run.actionId.split('.')[0]}</span>
              <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                {STATUS_LABEL[run.status] ?? run.status}
              </span>
              {run.invokedBy && <span className="text-[11px] text-muted-foreground">{run.invokedBy.replace('agent:', 'proposed by ')}</span>}
            </div>
            {pct !== null && (
              <div className="shrink-0 rounded-xl bg-muted/60 px-3 py-1.5 text-right">
                <span className="block text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">Confidence</span>
                <span className={`text-lg leading-tight font-bold ${tone(run.proposal?.confidence).split(' ').slice(1).join(' ')}`}>
                  {pct}
                  %
                </span>
              </div>
            )}
          </div>
          <h2 className="mt-2 text-xl leading-snug font-bold break-words">{card.title}</h2>
          {card.subject && (
            <p className="mt-1 text-sm text-muted-foreground">
              {card.subject.href
                ? <a href={card.subject.href} target="_blank" rel="noreferrer" className="font-semibold text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">{card.subject.name}</a>
                : <span className="font-semibold text-foreground">{card.subject.name}</span>}
              {card.subject.role && (
                <span>
                  <span className="px-2 text-border">/</span>
                  {card.subject.role}
                </span>
              )}
              {card.subject.company && (
                <span>
                  <span className="px-2 text-border">/</span>
                  {card.subject.company}
                </span>
              )}
            </p>
          )}
        </div>

        {/* B · Provenance */}
        {card.provenance && card.provenance.length > 0 && (
          <dl className="flex flex-wrap gap-x-10 gap-y-2 border-t border-border/60 px-5 py-4">
            {card.provenance.map(p => (
              <div key={p.label}>
                <dt className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{p.label}</dt>
                <dd className="text-sm font-semibold">{p.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* C · Recommendation */}
        {card.recommendation && (
          <div className="border-t border-border/60 px-5 py-4">
            <div className="flex items-start gap-3 rounded-xl bg-muted/50 p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-amber-tint text-brand-amber-deep"><Sparkles className="size-4" aria-hidden /></span>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">Recommended action</div>
                <div className="text-base font-bold break-words">{card.recommendation.headline}</div>
                {card.recommendation.detail && <p className="mt-1 text-sm break-words text-foreground/80">{card.recommendation.detail}</p>}
              </div>
            </div>
          </div>
        )}

        {/* D · Content — typed payload, renderer per kind, editable where the kind allows. */}
        {card.content && card.content.length > 0 && (
          <div className="border-t border-border/60 px-5 py-4">
            {card.contentHeading && (
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">{card.contentHeading.label}</span>
                {card.contentHeading.meta && <span className="text-[13px] text-muted-foreground">{card.contentHeading.meta}</span>}
              </div>
            )}
            <div>
              {card.content.map((item, i) => {
                const Renderer = contentKindRenderer(item.kind);
                return (
                  <Renderer
                    key={item.id}
                    item={item}
                    position={i + 1}
                    defaultExpanded={i === 0}
                    edit={contentEdits[item.id]}
                    onEdit={item.kind === 'email'
                      ? patch => setContentEdits(e => ({ ...e, [item.id]: { ...e[item.id], ...patch } }))
                      : undefined}
                    disabled={busy || steering}
                  />
                );
              })}
            </div>
            {canSteer && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-brand-amber"
                  placeholder="Steer the agent — e.g. shorter, firmer ask"
                  value={steer}
                  onChange={ev => setSteer(ev.target.value)}
                  disabled={busy || steering}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') {
                      ev.preventDefault();
                      void onSteer();
                    }
                  }}
                />
                <Button size="sm" variant="outline" onClick={() => void onSteer()} disabled={busy || steering}>
                  {steering ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  Rewrite
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Labeled rows — the v1 body, editable in place for property updates. */}
        {(card.fields.length > 0 || card.summary || run.proposal?.rationale || card.nextAction) && (
          <div className="space-y-2 border-t border-border/60 px-5 py-4">
            <dl className="space-y-1">
              {card.fields.map(f => (
                <div key={f.label} className="flex gap-2 text-sm">
                  <dt className="w-24 shrink-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{f.label}</dt>
                  <dd className="min-w-0 break-words">
                    {f.href
                      ? <a href={f.href} target="_blank" rel="noreferrer" className="text-brand-amber-deep underline decoration-brand-amber/40 underline-offset-2 hover:decoration-brand-amber">{f.value}</a>
                      : f.value}
                  </dd>
                </div>
              ))}
            </dl>
            {(card.summary ?? run.proposal?.rationale) && (
              <div className="flex gap-2 text-sm">
                <span className="w-24 shrink-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Summary</span>
                <p className="min-w-0 break-words text-foreground/85">{card.summary ?? run.proposal?.rationale}</p>
              </div>
            )}
            {card.nextAction && (
              <div className="flex gap-2 text-sm">
                <span className="w-24 shrink-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Next</span>
                <p className="min-w-0 font-medium break-words">{card.nextAction}</p>
              </div>
            )}
            {hasProperties && (
              <div className="space-y-2 pt-1">
                {Object.entries(propertyEdits).map(([k, v]) => (
                  k === 'notes'
                    ? (
                        <label key={k} className="block">
                          <span className="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{k}</span>
                          <textarea className={`${fieldClass} min-h-24 resize-y leading-relaxed`} value={v} onChange={ev => setPropertyEdits(e => ({ ...e, [k]: ev.target.value }))} disabled={busy} />
                        </label>
                      )
                    : (
                        <label key={k} className="block">
                          <span className="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{k}</span>
                          <input className={fieldClass} value={v} onChange={ev => setPropertyEdits(e => ({ ...e, [k]: ev.target.value }))} disabled={busy} />
                        </label>
                      )
                ))}
              </div>
            )}
          </div>
        )}

        {/* E · Evidence links */}
        {card.links && card.links.length > 0 && (
          <div className="flex flex-wrap gap-4 border-t border-border/60 px-5 py-3">
            {card.links.map(l => (
              <a key={l.href} href={l.href} className="text-sm font-semibold underline decoration-border underline-offset-4 transition hover:decoration-foreground">{l.label}</a>
            ))}
          </div>
        )}

        {/* F · Note for the agent — rides every verb. */}
        <div className="border-t border-border/60 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
              Note for the agent
              {' '}
              <span className="font-normal tracking-normal normal-case">{rejectNeedsNote ? '(required to decline)' : '(optional)'}</span>
            </span>
            <textarea
              className={`${fieldClass} min-h-16 resize-y`}
              placeholder="Add feedback with your decision..."
              value={note}
              onChange={ev => setNote(ev.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        {/* Raw payload demoted to a drill — never the surface. */}
        <details className="border-t border-border/60 px-5 py-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground transition hover:text-foreground">raw payload</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px] break-words whitespace-pre-wrap">{JSON.stringify(run.input, null, 2)}</pre>
        </details>
      </div>

      {/* G · Actions — detached below the card. */}
      <div className="relative mt-3 flex items-stretch gap-2">
        <Button variant="outline" className="flex-1" onClick={() => void decideRun('reject')} disabled={busy || (rejectNeedsNote && !note.trim())}>
          <X className="size-3.5" />
          {card.verbs?.reject ?? 'Reject'}
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => setSnoozeOpen(o => !o)} disabled={busy}>
          <AlarmClock className="size-3.5" />
          Snooze
        </Button>
        <Button className="flex-[1.6]" onClick={() => void decideRun('approve')} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {card.verbs?.approve ?? 'Approve'}
        </Button>
        {snoozeOpen && (
          <div className="absolute right-0 bottom-full z-10 mb-2 flex gap-1 rounded-lg border border-border bg-card p-1.5 shadow-md">
            {SNOOZES.map(s => (
              <Button key={s.days} size="sm" variant="ghost" onClick={() => void snoozeRun(s.days)} disabled={busy}>
                {s.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
