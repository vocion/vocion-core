'use client';

import type { ContentEdit } from './contentKinds';
import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';
import type { ReviewCard, ReviewContentEdit } from '@/libs/actions/types';
import { AlarmClock, Check, ChevronsDownUp, ChevronsUpDown, Loader2, RefreshCw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { withMinimumPending } from '@/features/dashboard/inbox/pending';
import { StickyActionBar } from '@/features/dashboard/StickyActionBar';
import { isRegeneratingFresh } from '@/libs/actions/regenerating';
import { client } from '@/libs/Orpc';
import { contentKindRenderer } from './contentKinds';
import { shortcutFor } from './reviewShortcuts';

/**
 * The reusable review card — ONE template every object type renders through,
 * on every surface that decides the run (the review queue and the domain
 * consoles). The presenter supplies WHAT (the `ReviewCard`); this shell owns
 * HOW: zone layout, inline content editing, the ONE feedback field, snooze,
 * regenerate, and the decide path. Confidence, the agent's recommendation and
 * the lane status render from the run itself, never from the presenter, so no
 * object type can omit them. Absent zones collapse.
 */

/**
 * How each recommendation reads on the card.
 *
 * Phrased as advice — "agent suggests approving" — rather than as the verb
 * itself. A badge reading "Reject" beside a pending item looks like the
 * decision has already been taken, which is the one thing this must not imply.
 */
const SUGGESTION_BADGE: Record<SuggestedDecision, { label: string; className: string }> = {
  approve: { label: 'Agent suggests approving', className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
  // Rose, not amber: amber already means "medium confidence" in `tone()` and
  // "this card is mid-regeneration" on the warning banner, and a third meaning
  // on the same card would make the colour say nothing.
  reject: { label: 'Agent suggests turning down', className: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200' },
  snooze: { label: 'Agent suggests revisiting later', className: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200' },
};

export type ReviewCardRun = {
  id: number;
  actionId: string;
  status: string;
  input: Record<string, unknown>;
  invokedBy: string | null;
  proposal: { confidence?: number; rationale?: string; suggestedDecision?: SuggestedDecision; suggestedDecisionReason?: string } | null;
  card: ReviewCard;
  /** Server truth for an in-flight regeneration — Date on the feed, ISO over RPC. */
  regeneratingSince?: Date | string | null;
  /** The reviewer's instruction the regeneration is answering. */
  regenerateNote?: string | null;
  /** What the last execution attempt said, set when `status` is `failed`. */
  error?: string | null;
  /** How often this agent's recommendations of this kind matched the person's decision (server-computed, 30d). */
  alignment?: { agreementRate: number | null; n: number; window: string } | null;
};

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
  /** Fired after a decision, snooze or regenerate lands, so the surface can drop/refresh the item. */
  onDecided?: (outcome: 'approve' | 'reject' | 'snooze' | 'regenerate') => void;
  /** Fired when an in-flight regeneration completes, so the surface can refetch the new content. */
  onRegenerated?: () => void;
  /**
   * `card` (default) — the bordered card every deciding surface embeds (lead
   * console, conversation dock). `page` — the Review page's airy presentation:
   * no outer box, sections divided by hairlines, the header owned by the page
   * (title, subject, status, confidence live in `ReviewHeader`), and the
   * decision in a sticky bar with the feedback field folded into it.
   * Keyboard `a` / `d` / `s` decide in page mode.
   */
  presentation?: 'card' | 'page';
}) {
  const t = useTranslations('Review');
  const { run, onDecided, onRegenerated } = props;
  const page = props.presentation === 'page';
  // "Edit all" expands every send at once; a fresh run starts folded.
  const [editAll, setEditAll] = useState(false);
  const card = run.card;
  const [contentEdits, setContentEdits] = useState<Record<string, ContentEdit>>({});
  const [propertyEdits, setPropertyEdits] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  // The in-flight regeneration, as the SERVER knows it: seeded from the run
  // row (a reload mid-regeneration shows the same disabled card) and kept
  // current by the status poll below. `since` is an ISO string throughout.
  const [regen, setRegen] = useState<{ since: string; note: string | null } | null>(null);
  // The last execution failure: seeded from a `failed` run (the queue keeps
  // failed cards) and set live when an approve's execution comes back failed.
  // The card stays mounted with the error; Approve becomes Retry.
  const [execError, setExecError] = useState<string | null>(
    run.status === 'failed' ? (run.error ?? 'The action failed to execute.') : null,
  );

  // Reset the working copy when the surface moves to another run.
  useEffect(() => {
    setContentEdits({});
    setNote('');
    setSnoozeOpen(false);
    setEditAll(false);
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setExecError(run.status === 'failed' ? (run.error ?? 'The action failed to execute.') : null);
    const properties = (run.input.properties ?? {}) as Record<string, unknown>;
    setPropertyEdits(Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, str(v)])));
  }, [run.id]);

  // Server truth seeds the state whenever the surface hands us a (re)fetched
  // run — including the reload and second-window cases.
  const runStamp = run.regeneratingSince == null
    ? null
    : typeof run.regeneratingSince === 'string' ? run.regeneratingSince : run.regeneratingSince.toISOString();
  useEffect(() => {
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setRegen(runStamp ? { since: runStamp, note: run.regenerateNote ?? null } : null);
  }, [run.id, runStamp]);

  // While a regeneration is in flight, poll the run every 5s (and on window
  // focus): the stamp clearing is the completion edge — the surface refetches
  // and the SAME card re-enables with the new content, feedback box cleared.
  useEffect(() => {
    if (!regen) {
      return;
    }
    let alive = true;
    const check = async () => {
      try {
        const s = await client.review.actionStatus({ id: run.id });
        if (!alive) {
          return;
        }
        if (s.regeneratingSince == null) {
          setRegen(null);
          setNote('');
          onRegenerated?.();
        } else {
          // A fresh object each poll, so staleness re-renders on schedule.
          setRegen({ since: s.regeneratingSince, note: s.regenerateNote ?? null });
        }
      } catch {
        /* transient — the next tick retries */
      }
    };
    const timer = setInterval(() => void check(), 5_000);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [regen !== null, run.id]);

  // Fresh stamp = hold the card; a stale one (a wedged pass) re-enables it
  // with a caution, matching the server guards expiring.
  const regenerating = regen !== null && isRegeneratingFresh(regen.since);
  const regenStale = regen !== null && !regenerating;
  const held = busy || regenerating;

  const pct = run.proposal?.confidence !== undefined ? Math.round(run.proposal.confidence * 100) : null;
  // Looked up rather than trusted: the envelope is jsonb, so a value written
  // by an older release could be any string, and an unknown one shows nothing
  // instead of an empty badge.
  const suggestion = run.proposal?.suggestedDecision ? SUGGESTION_BADGE[run.proposal.suggestedDecision] : undefined;
  const hasProperties = run.input.properties !== undefined && (card.content?.length ?? 0) === 0;

  const buildDecision = () => {
    const edits: ReviewContentEdit[] = Object.entries(contentEdits).map(([id, e]) => ({ id, ...e }));
    const editedInput = hasProperties
      ? { ...run.input, properties: { ...(run.input.properties as Record<string, unknown>), ...propertyEdits } }
      : undefined;
    return { contentEdits: edits.length > 0 ? edits : undefined, editedInput };
  };

  const decideRun = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    const verbLabel = decision === 'approve' ? (card.verbs?.approve ?? 'Approve') : (card.verbs?.reject ?? 'Reject');
    try {
      const { contentEdits: ce, editedInput } = buildDecision();
      // Never less than ~400ms in flight: a decision that lands instantly reads as nothing having happened.
      const outcome = await withMinimumPending(client.review.decideAction({
        id: run.id,
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(decision === 'approve' && ce ? { contentEdits: ce } : {}),
        ...(decision === 'approve' && editedInput ? { editedInput } : {}),
      }));
      // A failed execution is NOT a completed decision: the card stays with
      // the error on it and Approve becomes Retry. Dropping it here is how a
      // failed enrollment once sat invisible for three days.
      if (decision === 'approve' && outcome.execution?.status === 'failed') {
        const message = outcome.execution.error ?? 'The action failed to execute.';
        setExecError(message);
        toast.error(`Approved, but it failed to run · ${card.title}`, { description: `${message} Approve again to retry.` });
        return;
      }
      setExecError(null);
      toast.success(`${verbLabel === 'Approve' ? 'Approved' : verbLabel === 'Reject' ? 'Rejected' : verbLabel} · ${card.title}`, {
        description: decision === 'approve' ? (card.nextAction ?? 'Executing now.') : 'Nothing runs; the agent learns from it.',
      });
      onDecided?.(decision);
    } catch (err) {
      toast.error(`Could not ${verbLabel.toLowerCase()} · ${card.title}`, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const snoozeRun = async (days: number) => {
    setBusy(true);
    const until = new Date(Date.now() + days * 86_400_000);
    try {
      await withMinimumPending(client.review.snoozeAction({
        id: run.id,
        until: until.toISOString(),
        ...(note.trim() ? { note: note.trim() } : {}),
      }));
      toast.info(`Snoozed · ${card.title}`, { description: `Back on Needs you ${until.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}.` });
      onDecided?.('snooze');
    } catch (err) {
      toast.error(`Could not snooze · ${card.title}`, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      setSnoozeOpen(false);
    }
  };

  // Regenerate — re-run the work behind the run with the feedback as the
  // instruction. The card HOLDS ITS PLACE: the server stamps the run, this
  // card disables itself on that truth, and the poll re-enables it in place
  // when the new content lands — same run id, zero duplicates.
  const regenerateRun = async () => {
    setBusy(true);
    try {
      const instruction = note.trim();
      await withMinimumPending(client.review.regenerateAction({ id: run.id, feedback: instruction }));
      setRegen({ since: new Date().toISOString(), note: instruction });
      toast.info(`Regenerating · ${card.title}`, { description: 'The card re-enables here when the new version lands.' });
      onDecided?.('regenerate');
    } catch (err) {
      toast.error(`Could not regenerate · ${card.title}`, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  // Page mode decides from the keyboard too: a / d / s. Never while typing.
  useEffect(() => {
    if (!page) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement | null });
      if (!action || held) {
        return;
      }
      if (action === 'approve') {
        e.preventDefault();
        void decideRun('approve');
      } else if (action === 'decline') {
        e.preventDefault();
        void decideRun('reject');
      } else if (action === 'snooze') {
        e.preventDefault();
        setSnoozeOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, held, run.id, note, contentEdits, propertyEdits]);

  const approveVerb = card.verbs?.approve ?? 'Approve';
  const rejectVerb = card.verbs?.reject ?? 'Reject';
  // The summary repeats the rationale on most cards; show it once.
  const why = run.proposal?.rationale;
  const summaryDiffers = card.summary !== undefined && card.summary !== why;

  // On the page, a field that is also an editable property is shown once — in
  // the editor — so "industry" does not read twice.
  const pageFields = hasProperties ? card.fields.filter(f => !(f.label in propertyEdits)) : card.fields;

  if (page) {
    return (
      <div data-testid="review-action-card" data-presentation="page" className={regenerating ? 'opacity-90' : ''}>
        {regenerating && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-brand-amber-tint/60 px-4 py-3" data-testid="regenerating-banner">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-brand-amber-deep" aria-hidden />
            <div className="min-w-0 text-sm">
              <span className="font-semibold">Regenerating…</span>
              <span className="text-muted-foreground"> re-enables here when the new version lands.</span>
              {regen?.note && (
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground" title={regen.note}>
                  “
                  {regen.note}
                  ”
                </p>
              )}
            </div>
          </div>
        )}
        {regenStale && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-amber-500/10 px-4 py-3" data-testid="regenerating-stale-banner">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <p className="min-w-0 text-sm text-muted-foreground">This regeneration is taking longer than expected. The item is decidable again; the regenerated version updates it if it still arrives.</p>
          </div>
        )}
        {execError && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-red-500/10 px-4 py-3" data-testid="execution-failed-banner">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">The approval did not go through</p>
              <p className="mt-0.5 text-[13px] break-words text-muted-foreground">{execError}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{`Fix the cause if it names one, then ${approveVerb} again to retry.`}</p>
            </div>
          </div>
        )}

        {/* Provenance — one hairline row of facts. */}
        {card.provenance && card.provenance.length > 0 && (
          <dl className="flex flex-wrap gap-x-10 gap-y-3 border-b border-rule py-5">
            {card.provenance.map(p => (
              <div key={p.label}>
                <dt className="text-[11px] font-medium text-muted-foreground">{p.label}</dt>
                <dd className="mt-0.5 text-sm font-medium">{p.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Recommendation — eyebrow, the action, the reason, a ghost link. No tint, no box. */}
        {card.recommendation && (
          <section className="border-b border-rule py-6">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-brand-amber-deep" aria-hidden />
              Recommended action
            </div>
            <p className="mt-2 text-lg leading-snug font-semibold break-words">{card.recommendation.headline}</p>
            {card.recommendation.detail && <p className="mt-2 max-w-3xl text-[15px] leading-relaxed break-words text-foreground/80">{card.recommendation.detail}</p>}
            {card.links && card.links.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-4">
                {card.links.map(l => (
                  <a key={l.href} href={l.href} className="text-sm font-medium text-foreground/80 underline decoration-border underline-offset-4 transition hover:text-foreground hover:decoration-foreground">
                    {l.label}
                    {' ↗'}
                  </a>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Content — the sends as an accordion; "Edit all" opens every row. */}
        {card.content && card.content.length > 0 && (
          <section className="border-b border-rule py-6">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-medium text-muted-foreground">
                {card.contentHeading?.label ?? 'Content'}
                {card.contentHeading?.meta && <span className="ml-2 text-muted-foreground/70">{card.contentHeading.meta}</span>}
              </span>
              {card.content.length > 1 && (
                <button
                  type="button"
                  onClick={() => setEditAll(v => !v)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  {editAll ? <ChevronsDownUp className="size-3.5" aria-hidden /> : <ChevronsUpDown className="size-3.5" aria-hidden />}
                  {editAll ? 'Collapse all' : 'Edit all'}
                </button>
              )}
            </div>
            <div>
              {card.content.map((item, i) => {
                const Renderer = contentKindRenderer(item.kind);
                return (
                  <Renderer
                    key={item.id}
                    item={item}
                    position={i + 1}
                    defaultExpanded={i === 0}
                    expanded={editAll ? true : undefined}
                    inline
                    edit={contentEdits[item.id]}
                    onEdit={item.kind === 'email'
                      ? patch => setContentEdits(e => ({ ...e, [item.id]: { ...e[item.id], ...patch } }))
                      : undefined}
                    disabled={held}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Fields, why, what happens — labelled rows, inline-editable properties. */}
        {(pageFields.length > 0 || summaryDiffers || (!card.recommendation && why) || card.nextAction || hasProperties) && (
          <section className="space-y-3 border-b border-rule py-6">
            <dl className="space-y-2">
              {pageFields.map(f => (
                <div key={f.label} className="flex gap-4 text-sm">
                  <dt className="w-32 shrink-0 text-[11px] font-medium text-muted-foreground">{f.label}</dt>
                  <dd className="min-w-0 break-words">
                    {f.href
                      ? <a href={f.href} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-2 hover:decoration-foreground">{f.value}</a>
                      : f.value}
                  </dd>
                </div>
              ))}
              {!card.recommendation && why && (
                <div className="flex gap-4 text-sm">
                  <dt className="w-32 shrink-0 text-[11px] font-medium text-muted-foreground">Why</dt>
                  <dd className="min-w-0 break-words text-foreground/85">{why}</dd>
                </div>
              )}
              {summaryDiffers && (
                <div className="flex gap-4 text-sm">
                  <dt className="w-32 shrink-0 text-[11px] font-medium text-muted-foreground">Summary</dt>
                  <dd className="min-w-0 break-words text-foreground/85">{card.summary}</dd>
                </div>
              )}
              {card.nextAction && (
                <div className="flex gap-4 text-sm">
                  <dt className="w-32 shrink-0 text-[11px] font-medium text-muted-foreground">{`On ${approveVerb.toLowerCase()}`}</dt>
                  <dd className="min-w-0 break-words">{card.nextAction}</dd>
                </div>
              )}
            </dl>
            {hasProperties && (
              <div className="space-y-1 pt-1">
                {Object.entries(propertyEdits).map(([k, v]) => (
                  <label key={k} className="flex gap-4 text-sm">
                    <span className="w-32 shrink-0 pt-1.5 text-[11px] font-medium text-muted-foreground">{k}</span>
                    {k === 'notes'
                      ? <textarea className="min-h-24 w-full resize-y rounded-md bg-transparent px-2 py-1.5 text-sm leading-relaxed transition outline-none hover:bg-[var(--surface-hover,var(--muted))] focus:bg-[var(--surface-soft,var(--muted))]" value={v} onChange={ev => setPropertyEdits(e => ({ ...e, [k]: ev.target.value }))} disabled={held} />
                      : <input className="w-full rounded-md bg-transparent px-2 py-1.5 text-sm transition outline-none hover:bg-[var(--surface-hover,var(--muted))] focus:bg-[var(--surface-soft,var(--muted))]" value={v} onChange={ev => setPropertyEdits(e => ({ ...e, [k]: ev.target.value }))} disabled={held} />}
                  </label>
                ))}
              </div>
            )}
          </section>
        )}

        {!card.recommendation && card.links && card.links.length > 0 && (
          <div className="flex flex-wrap gap-4 border-b border-rule py-4">
            {card.links.map(l => (
              <a key={l.href} href={l.href} className="text-sm font-medium underline decoration-border underline-offset-4 transition hover:decoration-foreground">{l.label}</a>
            ))}
          </div>
        )}

        <StickyActionBar
          labels={{ addField: t('add_feedback'), hideField: t('hide_feedback') }}
          primary={{
            'label': execError ? `Retry ${approveVerb}` : approveVerb,
            'onClick': () => void decideRun('approve'),
            'disabled': held,
            'busy': busy,
            'icon': Check,
            'shortcut': 'a',
            'data-testid': 'decide-approve',
          }}
          secondary={[
            { 'label': rejectVerb, 'onClick': () => void decideRun('reject'), 'disabled': held, 'icon': X, 'shortcut': 'd', 'tone': 'danger', 'data-testid': 'decide-reject' },
            { 'label': 'Snooze', 'onClick': () => setSnoozeOpen(o => !o), 'disabled': held, 'icon': AlarmClock, 'shortcut': 's', 'data-testid': 'decide-snooze' },
          ]}
          field={{
            label: 'Feedback',
            placeholder: card.canRegenerate
              ? 'What should change? Regenerate uses this as instructions; a decision carries it as a note for the agent.'
              : 'Add feedback with your decision…',
            value: note,
            onChange: setNote,
            disabled: held,
            action: card.canRegenerate && run.status !== 'failed'
              ? { label: regenerating ? 'Regenerating…' : 'Regenerate', onClick: () => void regenerateRun(), disabled: held || !note.trim(), busy: busy || regenerating, icon: RefreshCw }
              : undefined,
            hint: card.canRegenerate && !regenerating && !note.trim() ? 'Type feedback to regenerate' : undefined,
          }}
          aside={snoozeOpen && (
            <div className="flex gap-1" role="group" aria-label="Snooze until">
              {SNOOZES.map(s => (
                <Button key={s.days} size="sm" variant="ghost" onClick={() => void snoozeRun(s.days)} disabled={held}>
                  {s.label}
                </Button>
              ))}
            </div>
          )}
        />
      </div>
    );
  }

  return (
    <div data-testid="review-action-card">
      <div className={`overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition ${regenerating ? 'opacity-90' : ''}`}>
        {/* Regenerating — server truth: the card stays mounted and disabled
            with the instruction visible, on every surface and across reloads.
            Past staleness the hold expires and the banner flips to a caution. */}
        {regenerating && (
          <div className="flex items-start gap-2.5 border-b border-border/60 bg-brand-amber-tint/60 px-5 py-3" data-testid="regenerating-banner">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-brand-amber-deep" aria-hidden />
            <div className="min-w-0 text-sm">
              <span className="font-semibold">Regenerating…</span>
              <span className="text-muted-foreground"> the card re-enables here when the new version lands.</span>
              {regen?.note && (
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground" title={regen.note}>
                  “
                  {regen.note}
                  ”
                </p>
              )}
            </div>
          </div>
        )}
        {regenStale && (
          <div className="flex items-start gap-2.5 border-b border-border/60 bg-amber-500/10 px-5 py-3" data-testid="regenerating-stale-banner">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <p className="min-w-0 text-sm text-muted-foreground">
              This regeneration is taking longer than expected. The card is decidable again; the regenerated version updates it if it still arrives.
            </p>
          </div>
        )}
        {execError && (
          <div className="flex items-start gap-2.5 border-b border-border/60 bg-red-500/10 px-5 py-3" data-testid="execution-failed-banner">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">The approval did not go through</p>
              <p className="mt-0.5 text-[13px] break-words text-muted-foreground">{execError}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {`Fix the cause if it names one, then ${card.verbs?.approve ?? 'Approve'} again to retry.`}
              </p>
            </div>
          </div>
        )}
        {/* A · Header — system, lane status + confidence from the RUN, title, subject. */}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-medium">{card.system ?? run.actionId.split('.')[0]}</span>
              <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <span className={`size-1.5 rounded-full ${run.status === 'failed' ? 'bg-red-500' : 'bg-emerald-500'}`} aria-hidden />
                {STATUS_LABEL[run.status] ?? run.status}
              </span>
              {run.invokedBy && <span className="text-[11px] text-muted-foreground">{run.invokedBy.replace('agent:', 'proposed by ')}</span>}
              {/* What the agent advised, next to who proposed it. Worded as
                  advice rather than as a verdict: the person decides, and a
                  badge reading "Reject" would look like the item already had
                  been. Absent when the agent gave no view. */}
              {suggestion && (
                <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${suggestion.className}`}>
                  {suggestion.label}
                </span>
              )}
              {/* Why it advised that, beside the advice itself. A badge alone
                  asks a person to take the agent's word for it; the sentence
                  is the part they can actually check against the card. Note
                  this is NOT the rationale above — that argues the payload is
                  right, this argues what should happen to it, and on a
                  "turning down" the two say opposite-sounding things. */}
              {suggestion && run.proposal?.suggestedDecisionReason && (
                <span
                  data-testid="suggested-decision-reason"
                  title={run.proposal.suggestedDecisionReason}
                  className="line-clamp-1 text-[12px] text-muted-foreground"
                >
                  {run.proposal.suggestedDecisionReason}
                </span>
              )}
            </div>
            {pct !== null && (
              <div className="shrink-0 rounded-xl bg-muted/60 px-3 py-1.5 text-right">
                <span className="block text-[12px] font-medium text-muted-foreground">Confidence</span>
                <span className={`text-lg leading-tight font-bold ${tone(run.proposal?.confidence).split(' ').slice(1).join(' ')}`}>
                  {pct}
                  %
                </span>
                {/* The alignment score: confidence is how sure the agent is; this
                    is how often people agreed with it. Inline, same box, no
                    new chrome — and nothing at all until there is evidence. */}
                {run.alignment && run.alignment.n > 0 && run.alignment.agreementRate !== null && (
                  <span className="block text-[10px] leading-tight text-muted-foreground tabular-nums" title={`${run.alignment.n} decided recommendation${run.alignment.n === 1 ? '' : 's'} of this kind by this agent in the last 30 days`}>
                    {`agrees with you ${Math.round(run.alignment.agreementRate * 100)}% · n=${run.alignment.n}`}
                  </span>
                )}
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
                <dt className="text-[12px] font-medium text-muted-foreground">{p.label}</dt>
                <dd className="text-sm font-semibold">{p.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* C · Recommendation — with the evidence links as buttons beside the
            claim they support, so View Research sits with the recommendation
            it justifies instead of a small link at the card's bottom. */}
        {card.recommendation && (
          <div className="border-t border-border/60 px-5 py-4">
            <div className="flex items-start gap-3 rounded-xl bg-muted/50 p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-amber-tint text-brand-amber-deep"><Sparkles className="size-4" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-muted-foreground">Recommended action</div>
                <div className="text-base font-bold break-words">{card.recommendation.headline}</div>
                {card.recommendation.detail && <p className="mt-1 text-sm break-words text-foreground/80">{card.recommendation.detail}</p>}
                {card.links && card.links.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {card.links.map(l => (
                      <Button key={l.href} size="sm" variant="outline" asChild>
                        <a href={l.href}>{l.label}</a>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* D · Content — typed payload, renderer per kind, editable where the kind allows. */}
        {card.content && card.content.length > 0 && (
          <div className="border-t border-border/60 px-5 py-4">
            {card.contentHeading && (
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[12px] font-medium text-muted-foreground">{card.contentHeading.label}</span>
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
                    disabled={held}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Labeled rows — the v1 body, editable in place for property updates. */}
        {(card.fields.length > 0 || card.summary || run.proposal?.rationale || card.nextAction) && (
          <div className="space-y-2 border-t border-border/60 px-5 py-4">
            <dl className="space-y-1">
              {card.fields.map(f => (
                <div key={f.label} className="flex gap-2 text-sm">
                  <dt className="w-24 shrink-0 text-[12px] font-medium text-muted-foreground">{f.label}</dt>
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
                <span className="w-24 shrink-0 text-[12px] font-medium text-muted-foreground">Summary</span>
                <p className="min-w-0 break-words text-foreground/85">{card.summary ?? run.proposal?.rationale}</p>
              </div>
            )}
            {card.nextAction && (
              <div className="flex gap-2 text-sm">
                <span className="w-24 shrink-0 text-[12px] font-medium text-muted-foreground">Next</span>
                <p className="min-w-0 font-medium break-words">{card.nextAction}</p>
              </div>
            )}
            {hasProperties && (
              <div className="space-y-2 pt-1">
                {Object.entries(propertyEdits).map(([k, v]) => (
                  k === 'notes'
                    ? (
                        <label key={k} className="block">
                          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">{k}</span>
                          <textarea className={`${fieldClass} min-h-24 resize-y leading-relaxed`} value={v} onChange={ev => setPropertyEdits(e => ({ ...e, [k]: ev.target.value }))} disabled={held} />
                        </label>
                      )
                    : (
                        <label key={k} className="block">
                          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">{k}</span>
                          <input className={fieldClass} value={v} onChange={ev => setPropertyEdits(e => ({ ...e, [k]: ev.target.value }))} disabled={held} />
                        </label>
                      )
                ))}
              </div>
            )}
          </div>
        )}

        {/* E · Evidence links — fallback placement, for cards with no
            recommendation zone to carry them. */}
        {!card.recommendation && card.links && card.links.length > 0 && (
          <div className="flex flex-wrap gap-4 border-t border-border/60 px-5 py-3">
            {card.links.map(l => (
              <a key={l.href} href={l.href} className="text-sm font-semibold underline decoration-border underline-offset-4 transition hover:decoration-foreground">{l.label}</a>
            ))}
          </div>
        )}

        {/* F · Feedback — ONE field doing three jobs with one piece of text:
            the instruction when Regenerate is clicked, the note riding an
            enroll/decline/snooze, and in every case a learning signal.
            Optional on every verb; Regenerate alone requires it, because a
            regeneration without instructions is a coin flip. */}
        <div className="border-t border-border/60 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Feedback
              {' '}
              <span className="font-normal tracking-normal normal-case">(optional)</span>
            </span>
            <textarea
              className={`${fieldClass} min-h-16 resize-y`}
              placeholder={card.canRegenerate
                ? 'What should change? Regenerate uses this as instructions; a decision carries it as a note for the agent.'
                : 'Add feedback with your decision...'}
              value={note}
              onChange={ev => setNote(ev.target.value)}
              disabled={held}
            />
          </label>
          {card.canRegenerate && run.status !== 'failed' && (
            <div className="mt-2 flex items-center justify-end gap-2">
              {!regenerating && !note.trim() && <span className="text-[11px] text-muted-foreground">Type feedback to regenerate</span>}
              <Button size="sm" variant="outline" onClick={() => void regenerateRun()} disabled={held || !note.trim()}>
                {busy || regenerating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* G · Actions — detached below the card. */}
      <div className="relative mt-3 flex items-stretch gap-2">
        <Button variant="outline" className="flex-1" onClick={() => void decideRun('reject')} disabled={held}>
          <X className="size-3.5" />
          {card.verbs?.reject ?? 'Reject'}
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => setSnoozeOpen(o => !o)} disabled={held}>
          <AlarmClock className="size-3.5" />
          Snooze
        </Button>
        <Button className="flex-[1.6]" onClick={() => void decideRun('approve')} disabled={held}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {execError ? `Retry ${card.verbs?.approve ?? 'Approve'}` : card.verbs?.approve ?? 'Approve'}
        </Button>
        {snoozeOpen && (
          <div className="absolute right-0 bottom-full z-10 mb-2 flex gap-1 rounded-lg border border-border bg-card p-1.5 shadow-md">
            {SNOOZES.map(s => (
              <Button key={s.days} size="sm" variant="ghost" onClick={() => void snoozeRun(s.days)} disabled={held}>
                {s.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
