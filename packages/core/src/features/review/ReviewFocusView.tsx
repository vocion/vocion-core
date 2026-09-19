'use client';

import type { ReviewType } from './reviewQueueModel';
import type { ReviewShortcut } from './reviewShortcuts';
import type { UpNextEntry } from './UpNextMenu';
import type { ReviewCard } from '@/libs/actions/types';
import { AlarmClock, Check, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { DECISION_VERBS } from '@/features/dashboard/inbox/decisionVerbs';
import { decisionCrumbs } from '@/features/dashboard/inbox/inboxMeta';
import { StickyActionBar } from '@/features/dashboard/StickyActionBar';
import { EvidenceRefs } from '@/features/preview/EvidenceRefs';
import { humaniseActionId } from '@/services/inbox/describeActionRun';
import { describeAction } from './describeAction';
import { ReviewHeader } from './ReviewHeader';
import { itemTitle, queuePosition, typeLabel } from './reviewQueueModel';
import { SHORTCUTS } from './reviewShortcuts';
import { ReviewSurface } from './ReviewSurface';
import { TypeChips } from './TypeChips';
import { UpNextMenu } from './UpNextMenu';

/**
 * The proposal decision screen, presentationally. No fetching, no router —
 * every fact and every handler arrives as a prop, so the page renders in a
 * story and the container (`features/dashboard/ReviewFocus.tsx`) stays about
 * data.
 *
 * A proposal that carries a card IS `ReviewSurface` — crumbs, name, role and
 * company, position, then the content as tabs with the decision in a sticky
 * bar. This file is what sits around it: the queue's own controls (Back, Up
 * next, the shortcut hint), the empty state, and the fallback for a run with
 * no presenter behind it. The kind chips are the list's job (pass `types` only
 * where a standalone queue wants them).
 */

export type ActionRun = {
  id: number;
  actionId: string;
  status: string;
  input: Record<string, unknown>;
  invokedBy: string | null;
  createdAt: string | Date;
  proposal: { confidence?: number; rationale?: string; evidence?: string[]; suggestedDecision?: 'approve' | 'reject' | 'snooze'; suggestedDecisionReason?: string } | null;
  regeneratingSince?: Date | string | null;
  regenerateNote?: string | null;
  error?: string | null;
  card?: ReviewCard;
  /** Alignment beside the confidence meter (server-computed, 30d) — earned autonomy (0099). */
  alignment?: { agreementRate: number | null; n: number; window: string } | null;
  /** The action's registered display name ("Enroll MQL in sequence"), when the loader knew it. */
  typeLabel?: string;
};

// Re-exported so existing client importers are untouched; the definition is
// in a server-safe module because server components need it too.
export { describeAction };

export type ReviewFocusViewProps = {
  loaded: boolean;
  /** The kind chips. Omit them on the inbox detail — the list owns filtering there. */
  types?: readonly ReviewType[];
  activeTypes?: readonly string[];
  onChangeTypes?: (next: string[]) => void;
  /** Breadcrumb override; defaults to Workspace › Review queue › Proposals › record. */
  crumbs?: Array<{ label: string; href?: string }>;
  current: ActionRun | null;
  /** Index of `current` in the working queue, 0-based; -1 when unknown. */
  index: number;
  /** Real queue size from the server. */
  total: number;
  upNext: readonly UpNextEntry[];
  onSkipTo: (id: number) => void;
  onLoadMore?: () => void;
  canBack: boolean;
  onBack: () => void;
  onSkip: () => void;
  onCardDecided: (outcome: 'approve' | 'reject' | 'snooze' | 'regenerate') => void;
  onCardRegenerated: () => void;
  /** Generic (presenter-less) items: the editable working copy and the steer field. */
  edited: Record<string, string>;
  onEditField: (key: string, value: string) => void;
  steer: string;
  onSteerChange: (value: string) => void;
  onSteer: () => void;
  steering: boolean;
  busy: boolean;
  onDecide: (decision: 'approve' | 'reject') => void;
  /**
   * Snooze, on the generic (card-less) proposal. The card owns its own
   * snooze; this is the same verb for everything else. The bar dropped it
   * when the sticky bar replaced the action row (2026-09-15), so `s` did
   * nothing and the E2E spec that snoozes from here timed out.
   */
  snoozeOpen: boolean;
  onToggleSnooze: () => void;
  onSnooze: (days: number) => void;
  decided: number;
  showHelp: boolean;
  onToggleHelp: () => void;
};

// Inline fields: text until touched, a soft fill on hover/focus. Tokens from
// the airy shell (PR #330) with main's `--muted` as the fallback.
const INLINE_FIELD = 'w-full rounded-md bg-transparent px-2 py-1.5 text-sm transition outline-none hover:bg-[var(--surface-hover,var(--muted))] focus:bg-[var(--surface-soft,var(--muted))]';

const VERBS = DECISION_VERBS.proposal;
const verb = (id: string) => [VERBS.primary, ...VERBS.secondary].find(v => v.id === id)!;

/** The same three revisit horizons the card offers. */
const SNOOZES = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

export function ReviewFocusView(p: ReviewFocusViewProps) {
  const t = useTranslations('Review');
  const shortcutLabel: Record<Exclude<ReviewShortcut, 'help'>, string> = {
    next: t('shortcut_next'),
    prev: t('shortcut_prev'),
    approve: t('shortcut_approve'),
    decline: t('shortcut_decline'),
    snooze: t('shortcut_snooze'),
  };
  if (!p.loaded) {
    return <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  }

  const types = p.types ?? [];
  const activeTypes = p.activeTypes ?? [];
  const chips = p.types && p.onChangeTypes ? <TypeChips types={p.types} active={activeTypes} onChange={p.onChangeTypes} className="mt-4" /> : null;

  if (!p.current) {
    const chosen = types.filter(ty => activeTypes.includes(ty.actionId));
    const chosenLabel = chosen.length === 1 ? chosen[0]!.label : null;
    return (
      <div data-testid="review-focus">
        <ReviewHeader crumbs={p.crumbs ?? decisionCrumbs('proposal')} title="Proposals" status="pending" />
        {chips}
        <div className="px-2 py-16 text-center">
          <ShieldCheck className="mx-auto size-8 text-brand-amber-deep" aria-hidden />
          <div className="mt-3 text-base font-semibold">
            {chosenLabel ? `No ${chosenLabel} items left` : activeTypes.length > 0 ? 'None of these types left' : 'All caught up'}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {p.decided > 0 ? `${p.decided} handled this session. ` : ''}
            {activeTypes.length > 0 ? 'Other types are still waiting — clear the filter to see them.' : 'New agent proposals land on the review queue for your decision.'}
          </p>
        </div>
      </div>
    );
  }

  const current = p.current;
  const desc = describeAction(current);
  const label = current.typeLabel ?? (types.length > 0 ? typeLabel(types, current.actionId) : humaniseActionId(current.actionId));
  // A card that names its own object owns the H1 and the section crumb; every
  // other card keeps the generated "<action> — <subject>" title.
  const object = current.card?.object;
  const title = object?.title ?? itemTitle({ label, title: desc.title, subject: current.card?.subject });
  const record = object?.title ?? current.card?.subject?.name ?? desc.title;
  const longField = desc.isEmail ? 'body' : 'notes';
  const held = p.busy || p.steering;

  const backAndNext = (
    <>
      <button
        type="button"
        onClick={p.onBack}
        disabled={!p.canBack}
        className="rounded-md px-1.5 py-1 transition enabled:hover:bg-surface-hover enabled:hover:text-foreground disabled:opacity-40"
      >
        {`‹ ${t('back')}`}
      </button>
      <UpNextMenu next={p.upNext} remaining={Math.max(p.total - 1, p.upNext.length)} onSkipTo={p.onSkipTo} onLoadMore={p.onLoadMore} />
      <button
        type="button"
        onClick={p.onToggleHelp}
        aria-expanded={p.showHelp}
        className="hidden items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground sm:inline-flex"
        title="Keyboard shortcuts"
      >
        <kbd className="rounded border border-border px-1 font-mono">?</kbd>
        {t('shortcuts')}
      </button>
    </>
  );
  const help = p.showHelp && (
    <ul className="hidden flex-wrap gap-x-5 gap-y-1 border-b border-rule py-2 text-[12px] text-muted-foreground sm:flex" data-testid="shortcuts-hint">
      {SHORTCUTS.filter(s => s.action !== 'help').map(s => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <kbd className="rounded border border-border px-1 font-mono">{s.key}</kbd>
          {shortcutLabel[s.action as Exclude<ReviewShortcut, 'help'>]}
        </li>
      ))}
    </ul>
  );

  // A proposal with a presenter behind it IS the flat template — one shell,
  // whatever the object type, and the same shell the lead page mounts.
  if (current.card) {
    return (
      <div data-testid="review-focus" className="relative">
        {chips}
        <ReviewSurface
          run={{ ...current, card: current.card }}
          crumbs={p.crumbs ?? decisionCrumbs('proposal', record, object?.section)}
          title={title}
          subtitle={object?.subtitle}
          position={queuePosition(p.index, p.total)}
          actions={backAndNext}
          beforeTabs={help}
          onDecided={p.onCardDecided}
          onRegenerated={p.onCardRegenerated}
        />
      </div>
    );
  }

  return (
    <div data-testid="review-focus" className="relative">
      <ReviewHeader
        crumbs={p.crumbs ?? decisionCrumbs('proposal', record, object?.section)}
        title={title}
        subtitle={object?.subtitle}
        system={desc.system}
        status={current.status}
        proposedBy={current.invokedBy}
        confidence={current.proposal?.confidence}
        confidenceSubject="Recommendation"
        alignment={current.alignment}
        suggestion={current.proposal?.suggestedDecision}
        position={queuePosition(p.index, p.total)}
        upNext={<UpNextMenu next={p.upNext} remaining={Math.max(p.total - 1, p.upNext.length)} onSkipTo={p.onSkipTo} onLoadMore={p.onLoadMore} />}
        canBack={p.canBack}
        onBack={p.onBack}
        extra={(
          <button
            type="button"
            onClick={p.onToggleHelp}
            aria-expanded={p.showHelp}
            className="hidden items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition hover:bg-[var(--surface-hover,var(--muted))] hover:text-foreground sm:inline-flex"
            title="Keyboard shortcuts"
          >
            <kbd className="rounded border border-border px-1 font-mono">?</kbd>
            {t('shortcuts')}
          </button>
        )}
      />
      {help}
      {chips}

      <div className="mt-2">
        {(
          <div data-testid="review-generic">
            {current.proposal?.rationale && (
              <section className="border-b border-rule py-6">
                <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                  <Sparkles className="size-3.5 text-brand-amber-deep" aria-hidden />
                  Why
                </div>
                <p className="mt-2 max-w-3xl text-[15px] leading-relaxed break-words text-foreground/80">{current.proposal.rationale}</p>
              </section>
            )}
            {/* Kept in its own section rather than folded into "Why" above.
                That one is the case for the payload; this is the case for the
                recommendation, and on a card the agent wants turned down they
                are different arguments — merging them would read as the agent
                contradicting itself. */}
            {current.proposal?.suggestedDecisionReason && (
              <section data-testid="review-generic-suggestion-reason" className="border-b border-rule py-6">
                <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                  <Sparkles className="size-3.5 text-brand-amber-deep" aria-hidden />
                  Why it suggests that
                </div>
                <p className="mt-2 max-w-3xl text-[15px] leading-relaxed break-words text-foreground/80">{current.proposal.suggestedDecisionReason}</p>
              </section>
            )}
            {/* What the recommendation rests on. Each citation opens in the
                preview panel, so the evidence can be checked without leaving
                the decision — and `a` still approves while it is open. */}
            {(current.proposal?.evidence?.length ?? 0) > 0 && (
              <section className="border-b border-rule py-6" aria-label="Evidence">
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">Evidence</div>
                <EvidenceRefs sources={current.proposal!.evidence!} />
              </section>
            )}
            {/* The alignment score: confidence is how sure the agent is; this is
                how often you agreed with this kind of recommendation (0099). */}
            {current.alignment && current.alignment.n > 0 && current.alignment.agreementRate !== null && (
              <p data-testid="alignment-score" className="border-b border-rule py-3 text-[13px] text-muted-foreground tabular-nums" title={`${current.alignment.n} decided recommendations of this kind in the last 30 days`}>
                {`Agrees with you ${Math.round(current.alignment.agreementRate * 100)}% · n=${current.alignment.n}`}
              </p>
            )}
            {current.input.draft === true && (
              <p className="border-b border-rule py-3 text-[13px] text-muted-foreground">Dry run — approving writes a draft, nothing is sent.</p>
            )}
            <section className="space-y-1 border-b border-rule py-6">
              <div className="mb-2 text-[11px] font-medium text-muted-foreground">The changes — edit in place; your version is what runs</div>
              {Object.entries(p.edited).map(([k, v]) => (
                <label key={k} className="flex gap-4 text-sm">
                  <span className="w-32 shrink-0 pt-1.5 text-[11px] font-medium text-muted-foreground">{k}</span>
                  {k === longField
                    ? <textarea className={`${INLINE_FIELD} min-h-32 resize-y leading-relaxed`} value={v} onChange={ev => p.onEditField(k, ev.target.value)} disabled={held} />
                    : <input className={INLINE_FIELD} value={v} onChange={ev => p.onEditField(k, ev.target.value)} disabled={held} />}
                </label>
              ))}
            </section>
            <StickyActionBar
              labels={{ addField: t('add_feedback'), hideField: t('hide_feedback') }}
              primary={{
                'label': desc.isEmail ? (current.input.draft === true ? `${verb('approve').label} → draft` : `${verb('approve').label} & send`) : verb('approve').label,
                'onClick': () => p.onDecide('approve'),
                'disabled': held,
                'busy': p.busy,
                'icon': Check,
                'shortcut': verb('approve').shortcut,
                'data-testid': 'decide-approve',
              }}
              secondary={[
                { 'label': verb('reject').label, 'onClick': () => p.onDecide('reject'), 'disabled': held, 'icon': X, 'shortcut': verb('reject').shortcut, 'tone': 'danger', 'data-testid': 'decide-reject' },
                { 'label': verb('snooze').label, 'onClick': p.onToggleSnooze, 'disabled': held, 'icon': AlarmClock, 'shortcut': verb('snooze').shortcut, 'data-testid': 'decide-snooze' },
              ]}
              aside={p.snoozeOpen && (
                <div className="flex gap-1" role="group" aria-label="Snooze until">
                  {SNOOZES.map(sn => (
                    <Button key={sn.days} size="sm" variant="ghost" onClick={() => p.onSnooze(sn.days)} disabled={held}>
                      {sn.label}
                    </Button>
                  ))}
                </div>
              )}
              field={{
                label: 'Steer the agent',
                placeholder: 'Steer the agent — e.g. shorter, mention the July 20 call, firmer ask',
                value: p.steer,
                onChange: p.onSteerChange,
                disabled: held,
                action: { label: 'Rewrite', onClick: p.onSteer, disabled: held, busy: p.steering, icon: Sparkles },
              }}
            />
          </div>
        )}
      </div>

    </div>
  );
}
