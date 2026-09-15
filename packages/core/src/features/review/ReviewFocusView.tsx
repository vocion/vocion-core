'use client';

import type { ReviewType } from './reviewQueueModel';
import type { ReviewShortcut } from './reviewShortcuts';
import type { UpNextEntry } from './UpNextMenu';
import type { ReviewCard } from '@/libs/actions/types';
import { Bookmark, Check, Loader2, ShieldCheck, SkipForward, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StickyActionBar } from '@/features/dashboard/StickyActionBar';
import { ReviewActionCard } from './ReviewActionCard';
import { ReviewHeader } from './ReviewHeader';
import { itemTitle, queuePosition, typeLabel } from './reviewQueueModel';
import { SHORTCUTS } from './reviewShortcuts';
import { TypeChips } from './TypeChips';
import { UpNextMenu } from './UpNextMenu';

/**
 * The Review page, presentationally. No fetching, no router — every fact and
 * every handler arrives as a prop, so the page renders in a story and the
 * container (`features/dashboard/ReviewFocus.tsx`) stays about data.
 *
 * Shape (Chris, 2026-09-15): breadcrumb + item title, one meta row, type
 * chips, then the item as hairline-divided sections with the decision in a
 * sticky bar. No outer card, no persistent Up-next rail, no dropdown filter.
 */

export type ActionRun = {
  id: number;
  actionId: string;
  status: string;
  input: Record<string, unknown>;
  invokedBy: string | null;
  createdAt: string | Date;
  proposal: { confidence?: number; rationale?: string; suggestedDecision?: 'approve' | 'reject' | 'snooze' } | null;
  regeneratingSince?: Date | string | null;
  regenerateNote?: string | null;
  error?: string | null;
  card?: ReviewCard;
  /** Alignment beside the confidence meter (server-computed, 30d) — earned autonomy (0099). */
  alignment?: { agreementRate: number | null; n: number; window: string } | null;
};

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * The human answer to "what am I approving?" for an item with no presenter —
 * action verb + target system + object, from the action id and its input.
 * @param p
 */
export function describeAction(p: ActionRun): { title: string; system: string; isEmail: boolean } {
  const input = p.input;
  if (p.card) {
    return { title: p.card.title, system: p.card.system ?? p.actionId.split('.')[0] ?? 'system', isEmail: false };
  }
  if (p.actionId === 'gmail.send') {
    const draft = input.draft === true;
    return { title: `${draft ? 'Draft email' : 'Send email'} → ${str(input.to) || 'recipient'}`, system: 'Gmail', isEmail: true };
  }
  if (p.actionId.startsWith('hubspot.')) {
    const objectType = str(input.objectType) || 'record';
    return { title: `Update HubSpot ${objectType === 'companies' ? 'company' : objectType.replace(/s$/, '')} record`, system: 'HubSpot CRM', isEmail: false };
  }
  return { title: p.actionId, system: p.actionId.split('.')[0] ?? 'system', isEmail: false };
}

export type ReviewFocusViewProps = {
  loaded: boolean;
  types: readonly ReviewType[];
  activeTypes: readonly string[];
  onChangeTypes: (next: string[]) => void;
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
  onSave: () => void;
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
  decided: number;
  showHelp: boolean;
  onToggleHelp: () => void;
};

// Inline fields: text until touched, a soft fill on hover/focus. Tokens from
// the airy shell (PR #330) with main's `--muted` as the fallback.
const INLINE_FIELD = 'w-full rounded-md bg-transparent px-2 py-1.5 text-sm transition outline-none hover:bg-[var(--surface-hover,var(--muted))] focus:bg-[var(--surface-soft,var(--muted))]';

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

  const chips = <TypeChips types={p.types} active={p.activeTypes} onChange={p.onChangeTypes} className="mt-4" />;

  if (!p.current) {
    const chosen = p.types.filter(t => p.activeTypes.includes(t.actionId));
    const chosenLabel = chosen.length === 1 ? chosen[0]!.label : null;
    return (
      <div data-testid="review-focus">
        <ReviewHeader crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Review' }]} title="Review" status="pending" />
        {chips}
        <div className="px-2 py-16 text-center">
          <ShieldCheck className="mx-auto size-8 text-brand-amber-deep" aria-hidden />
          <div className="mt-3 text-base font-semibold">
            {chosenLabel ? `No ${chosenLabel} items left` : p.activeTypes.length > 0 ? 'None of these types left' : 'All caught up'}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {p.decided > 0 ? `${p.decided} handled this session. ` : ''}
            {p.activeTypes.length > 0 ? 'Other types are still waiting — clear the filter to see them.' : 'New agent proposals land here for your decision.'}
          </p>
        </div>
      </div>
    );
  }

  const current = p.current;
  const desc = describeAction(current);
  const label = typeLabel(p.types, current.actionId);
  const title = itemTitle({ label, title: desc.title, subject: current.card?.subject });
  const record = current.card?.subject?.name ?? desc.title;
  const longField = desc.isEmail ? 'body' : 'notes';
  const held = p.busy || p.steering;

  return (
    <div data-testid="review-focus" className="relative">
      <ReviewHeader
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Review', href: '/dashboard/review' }, { label }, { label: record }]}
        title={title}
        subject={current.card?.subject}
        system={current.card?.system ?? desc.system}
        status={current.status}
        proposedBy={current.invokedBy}
        confidence={current.proposal?.confidence}
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
      {p.showHelp && (
        <ul className="hidden flex-wrap gap-x-5 gap-y-1 border-b border-rule py-2 text-[12px] text-muted-foreground sm:flex" data-testid="shortcuts-hint">
          {SHORTCUTS.filter(s => s.action !== 'help').map(s => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <kbd className="rounded border border-border px-1 font-mono">{s.key}</kbd>
              {shortcutLabel[s.action as Exclude<ReviewShortcut, 'help'>]}
            </li>
          ))}
        </ul>
      )}
      {chips}

      <div className="mt-2">
        {current.card && (
          <ReviewActionCard run={{ ...current, card: current.card }} presentation="page" onDecided={p.onCardDecided} onRegenerated={p.onCardRegenerated} />
        )}

        {!current.card && (
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
              primary={{
                'label': desc.isEmail ? (current.input.draft === true ? 'Approve → draft' : 'Approve & send') : 'Approve',
                'onClick': () => p.onDecide('approve'),
                'disabled': held,
                'busy': p.busy,
                'icon': Check,
                'shortcut': 'a',
                'data-testid': 'decide-approve',
              }}
              secondary={[
                { 'label': 'Reject', 'onClick': () => p.onDecide('reject'), 'disabled': held, 'icon': X, 'shortcut': 'd', 'tone': 'danger', 'data-testid': 'decide-reject' },
                { label: 'Save for later', onClick: p.onSave, disabled: held, icon: Bookmark },
                { label: 'Skip', onClick: p.onSkip, disabled: held, icon: SkipForward, shortcut: 'j' },
              ]}
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
