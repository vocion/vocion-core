'use client';

import type { ReactNode } from 'react';
import type { ReviewOutcome } from './useReviewDecision';
import type { Crumb } from '@/components/patterns';
import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';
import type { ReviewCard, ReviewContent, ReviewContentEdit } from '@/libs/actions/types';
import { AlarmClock, Ban, Check, Loader2, RefreshCw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  ConfidenceMeter,
  DetailPage,
  FactList,
  Section,
  StatusDot,
  StickyActionBar,
} from '@/components/patterns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { useDraftRevision } from '@/features/personalization/draftRevision';
import { EvidenceRefs } from '@/features/preview/EvidenceRefs';
import { cn } from '@/utils/Helpers';
import { contentKindEditable, contentKindRenderer } from './contentKinds';
import { shortcutFor } from './reviewShortcuts';
import { useReviewDecision } from './useReviewDecision';

/**
 * ReviewSurface — the ONE flat decision screen, for every object type and on
 * every surface that decides a run.
 *
 * The split that makes it one screen: a **presenter** (on the action) returns
 * the DATA — title, subject, provenance, recommendation, content items, verb
 * labels — and this shell owns the LAYOUT: what sits where, in what order, and
 * whether a zone appears at all. A presenter can fill text in; it cannot decide
 * where that text goes. That is what stops seven object types becoming seven
 * layouts, and it is why adding the next type costs a presenter and zero shell
 * changes.
 *
 * ```
 * DetailPage
 *   title   card.object?.title ?? card.subject?.name ?? card.title
 *   actions position ("28 of 224"), Back, Up next
 *   meta    provenance · recommendation · confidence — ONE hairline row
 *   bar     Add feedback · Snooze · Decline · Confirm
 *   children
 *     notices                    regenerating / stale / execution failed
 *     Tabs variant="line"
 *       Changes                  editable properties, first when there are any
 *       <one pane per item>      contentKindRenderer(item.kind)
 *       <extraTabs>              a surface's own documents (the lead's Brief)
 *       Why                      composed HERE, from the run
 *       Evidence                 composed HERE, from the run — ALWAYS last
 * ```
 *
 * Why and Evidence are built from the `action_run`, never from the presenter,
 * so no object type can ship without them: the run supplies status, who
 * proposed it, confidence, rationale, citations, the alignment score and any
 * failure; the presenter supplies only text INSIDE those zones. The run is what
 * stops a type dropping its evidence; the shell is what stops it rearranging
 * it.
 *
 * No outer box, and no box inside one: hairlines, spacing and eyebrows carry
 * the structure (`docs/design/patterns.md` § A bordered surface never contains
 * another bordered surface).
 */

/** The run a review surface decides — the `action_run` row with its built card. */
export type ReviewCardRun = {
  id: number;
  actionId: string;
  status: string;
  input: Record<string, unknown>;
  invokedBy: string | null;
  proposal: { confidence?: number; rationale?: string; evidence?: string[]; suggestedDecision?: SuggestedDecision; suggestedDecisionReason?: string } | null;
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

/**
 * A tab a surface owns that the run knows nothing about — the lead page's
 * Brief, for instance. The escape hatch that keeps anything lead-specific out
 * of the core contract.
 */
export type ReviewExtraTab = {
  id: string;
  label: string;
  children: ReactNode;
  /** Render before the run's own content tabs rather than after them. */
  first?: boolean;
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

const RED_STATUSES = new Set(['failed', 'rejected']);

const SUGGESTION_LABEL: Record<SuggestedDecision, string> = {
  approve: 'Agent suggests approving',
  reject: 'Agent suggests turning down',
  snooze: 'Agent suggests revisiting later',
};

const SNOOZES = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Inline fields: text until touched, a soft fill on hover and focus. */
const INLINE_FIELD = 'w-full rounded-md bg-transparent px-2 py-1.5 text-sm transition outline-none hover:bg-surface-hover focus:bg-surface-soft disabled:opacity-60';

/**
 * A quiet, hairline notice — regenerating, stale, failed. Never a banner box.
 * @param props
 * @param props.tone
 * @param props.icon
 * @param props.children
 * @param props.testid
 */
function Notice(props: { tone: 'amber' | 'red'; icon: ReactNode; children: ReactNode; testid: string }) {
  return (
    <div
      data-testid={props.testid}
      className={cn('flex items-start gap-2.5 border-l-2 py-1 pl-3 text-sm', props.tone === 'red' ? 'border-brand-fail' : 'border-brand-borderline')}
    >
      <span className={cn('mt-0.5 shrink-0', props.tone === 'red' ? 'text-brand-fail' : 'text-brand-borderline')}>{props.icon}</span>
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

/**
 * The meta row: label-over-value cells on one hairline row — the provenance
 * the presenter gave, then the recommendation, with the run's confidence
 * trailing it. A card with no recommendation shows its provenance only; a card
 * with neither shows no row at all, rather than an empty rule.
 * @param props - The cells and the recommendation.
 * @param props.cells - Provenance, and any the surface prepends.
 * @param props.recommendation - Label and headline for the last cell.
 * @param props.confidence - 0..1, trailing the recommendation.
 * @param props.confidenceSubject - What the confidence is IN.
 */
function MetaRow(props: {
  cells: ReadonlyArray<{ label: string; value: ReactNode }>;
  recommendation?: { label: string; headline: string } | null;
  confidence?: number;
  confidenceSubject?: string;
}) {
  if (props.cells.length === 0 && !props.recommendation) {
    return null;
  }
  return (
    <dl data-testid="review-meta" data-pattern="detail-meta" className="mt-3 flex flex-wrap gap-x-10 gap-y-3 border-b border-rule pb-4">
      {props.cells.map(c => (
        <div key={c.label} className="min-w-[104px]">
          <dt className="text-[12px] text-muted-foreground">{c.label}</dt>
          <dd className="mt-0.5 text-sm break-words">{c.value}</dd>
        </div>
      ))}
      {props.recommendation && (
        <div className="min-w-[104px]" data-testid="meta-recommendation">
          <dt className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Sparkles className="size-3.5 text-brand-amber-deep" aria-hidden />
            {props.recommendation.label}
          </dt>
          <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-sm">
            <span className="font-medium break-words text-foreground">{props.recommendation.headline}</span>
            {props.confidence !== undefined && (
              <ConfidenceMeter value={props.confidence} label={props.confidenceSubject} readingHidden />
            )}
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * One content item, full pane: the item's own Edit and Regenerate at the top
 * right, then the registered renderer. Regenerate sits HERE rather than on the
 * bar, because one Regenerate on a shared bar silently means whichever item
 * its author had in mind.
 * @param props - The item, its working copy, and the regenerate path.
 * @param props.item - The content item.
 * @param props.label - What the tab calls it, so the controls can name it.
 * @param props.edit - The reviewer's working copy.
 * @param props.edit.subject
 * @param props.edit.body
 * @param props.onEdit - Patch handler, absent when the kind is not editable.
 * @param props.changed - True for a moment after a conversation rewrite landed.
 * @param props.actions
 * @param props.edited
 * @param props.disabled - Held while busy or regenerating.
 * @param props.canRegenerate - Whether the action implements regeneration.
 * @param props.regenerating - True while a pass is in flight.
 * @param props.onRegenerate - Runs the pass with the instruction.
 * @param props.editable - Whether the kind takes the reviewer's edits.
 * @param props.children - The registered renderer, already built.
 */
function ItemPane(props: {
  item: ReviewContent;
  label: string;
  editable: boolean;
  children: ReactNode;
  /** A control the surface adds beside Edit and Regenerate. */
  actions?: ReactNode;
  /** True when the working copy differs from what the agent wrote. */
  edited?: boolean;
  disabled?: boolean;
  canRegenerate: boolean;
  regenerating: boolean;
  onRegenerate: (instruction: string) => void;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');

  const focusBody = () => {
    const field = pane.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea:not([disabled]), input:not([disabled])');
    field?.focus();
    field?.setSelectionRange?.(field.value.length, field.value.length);
  };

  return (
    // `data-comment-field`: the item is a region the selection control can
    // anchor to, so highlighting a sentence in it offers *Ask about this* /
    // *Add change* (`docs/design/patterns.md` § Select → talk).
    <div data-comment-field={props.label} data-testid={`item-pane-${props.item.id}`}>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {props.label}
          {/* Your version, not the agent's — said once, quietly, and it
              survives a tab change where the arrival tint does not. */}
          {props.edited && <span className="ml-2 font-normal normal-case" data-testid={`edited-${props.item.id}`}>edited</span>}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          {props.actions}
          {props.editable && (
            <button
              type="button"
              data-testid={`edit-${props.item.id}`}
              onClick={focusBody}
              disabled={props.disabled}
              className="inline-flex h-8 items-center rounded-lg px-2 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
            >
              Edit
            </button>
          )}
          {props.canRegenerate && (
            <button
              type="button"
              data-testid={`regenerate-${props.item.id}`}
              onClick={() => setOpen(o => !o)}
              disabled={props.disabled}
              aria-expanded={open}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
            >
              {props.regenerating ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
              {props.regenerating ? 'Regenerating…' : `Regenerate ${props.label}`}
            </button>
          )}
        </div>
      </div>

      <div ref={pane}>{props.children}</div>

      {open && props.canRegenerate && (
        <div className="mt-3 border-t border-rule pt-3" data-testid={`regenerate-${props.item.id}-open`}>
          <label className="block">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {`What should ${props.label} do differently?`}
            </span>
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              rows={3}
              aria-label={`Regenerate instruction for ${props.label}`}
              placeholder="e.g. Shorter, and lead with the hiring signal rather than the guide."
              className="mt-1.5 w-full resize-y rounded-lg bg-surface-soft px-3 py-2 text-sm leading-relaxed transition outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/30"
            />
          </label>
          <p className="mt-1 text-[13px] text-muted-foreground">
            This re-runs the work behind the recommendation with your instruction. The item holds its place here and re-enables when the new version lands.
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 rounded-lg px-3 text-sm text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid={`regenerate-${props.item.id}-submit`}
              disabled={props.disabled || instruction.trim().length === 0}
              onClick={() => {
                props.onRegenerate(instruction.trim());
                setOpen(false);
                setInstruction('');
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3 text-sm text-action-foreground transition hover:opacity-90 disabled:opacity-40"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReviewSurface(props: {
  'run': ReviewCardRun;
  'crumbs': readonly Crumb[];
  /** Overrides the title the card would produce. */
  'title'?: string;
  'subtitle'?: string;
  /** "28 of 224" — where you are in the queue, beside the name. */
  'position'?: string;
  /** The rest of the right cluster on the title row: Back, Up next, a shortcuts hint. */
  'actions'?: ReactNode;
  /** Cells the surface adds to the meta row, after the card's provenance. */
  'meta'?: ReadonlyArray<{ label: string; value: ReactNode }>;
  /** A control beside the item's own Edit and Regenerate — a scoped ask. */
  'itemActions'?: (item: ReviewContent, label: string) => ReactNode;
  /** Tabs this surface owns — the lead page's Brief, for instance. */
  'extraTabs'?: readonly ReviewExtraTab[];
  /** What the surface says between the header and the tabs — a shortcuts hint, an outcome. */
  'beforeTabs'?: ReactNode;
  /** Which tab opens. Defaults to the first one. */
  'defaultTab'?: string;
  /** The surface's own evidence, under the shell's — claims, a timeline. */
  'evidenceExtra'?: ReactNode;
  /** Hold the primary: the consequence cannot be determined, and why. */
  'hold'?: { reason: string } | null;
  /** False when there is nothing pending to decide — the screen reads, no bar. */
  'decidable'?: boolean;
  /** True when a conversation beside the page owns the rewrite; items read-only. */
  'guided'?: boolean;
  /** Edits from another surface, merged under this one's own. */
  'extraContentEdits'?: () => ReviewContentEdit[];
  'onDecided'?: (outcome: ReviewOutcome) => void;
  'onRegenerated'?: () => void;
  /**
   * The feedback toggle's wording. English by default, like `StickyActionBar`
   * itself: the lead page and the stories mount no intl provider, and a shell
   * that reads `useTranslations` would throw on both. Translated surfaces pass
   * their own strings.
   */
  'barLabels'?: { addField?: string; hideField?: string };
  'data-testid'?: string;
}) {
  const { run } = props;
  const card = run.card;
  const decidable = props.decidable ?? true;

  // A decision that lands is announced HERE: the hook reports the outcome,
  // this says what happened, and the surface around it moves on.
  const landed = useRef(false);
  const d = useReviewDecision(run, {
    onDecided: (outcome) => {
      landed.current = true;
      props.onDecided?.(outcome);
    },
    onRegenerated: props.onRegenerated,
    extraContentEdits: props.extraContentEdits,
  });

  const approveVerb = card.verbs?.approve ?? 'Approve';
  const rejectVerb = card.verbs?.reject ?? 'Decline';

  const [snoozeOpen, setSnoozeOpen] = useState(false);
  /** Content ids that moved in the last couple of seconds — the tint fades on its own. */
  const [justChanged, setJustChanged] = useState<Record<string, number>>({});

  const content = card.content ?? [];
  // Read the KEYS off the run, not off the hook's working copy: the copy is
  // seeded in an effect, so deriving the tabs from it would open the screen on
  // Why for one paint and leave a fields-only type there.
  const propertyKeys = d.hasProperties ? Object.keys((run.input.properties ?? {}) as Record<string, unknown>) : [];
  const propertyValue = (k: string) => d.propertyEdits[k] ?? str((run.input.properties as Record<string, unknown>)[k]);

  // The tabs, derived. Nothing here enumerates object types, kinds or counts:
  // N items produce N tabs, the surface's own tabs slot in, and Why and
  // Evidence are always built — Evidence last.
  const before = (props.extraTabs ?? []).filter(x => x.first);
  const after = (props.extraTabs ?? []).filter(x => !x.first);
  const itemTabs = content.map(item => ({ id: `item-${item.id}`, label: (item as { tabLabel?: string }).tabLabel ?? item.label }));
  const tabIds = [
    ...(propertyKeys.length > 0 ? ['changes'] : []),
    ...before.map(x => `extra-${x.id}`),
    ...itemTabs.map(x => x.id),
    ...after.map(x => `extra-${x.id}`),
    'why',
    'evidence',
  ];
  const opening = props.defaultTab && tabIds.includes(props.defaultTab) ? props.defaultTab : tabIds[0]!;
  const [tab, setTab] = useState(opening);
  useEffect(() => {
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setTab(opening);
    setSnoozeOpen(false);
  }, [run.id]);
  // A tab that stops existing (the content came back shorter) must not leave
  // the pane blank; fall back to the first one rather than rendering nothing.
  const active = tabIds.includes(tab) ? tab : tabIds[0]!;

  /**
   * A rewrite asked for in the conversation lands HERE, in the copy you are
   * looking at — and the shell moves to the tab it landed in, because a change
   * you did not watch happen needs to say where it went.
   */
  useDraftRevision(run.id, (contentId, body) => {
    d.editContent(contentId, { body });
    setJustChanged(prev => ({ ...prev, [contentId]: Date.now() }));
    if (tabIds.includes(`item-${contentId}`)) {
      setTab(`item-${contentId}`);
    }
  });
  useEffect(() => {
    if (Object.keys(justChanged).length === 0) {
      return;
    }
    const timer = setTimeout(() => setJustChanged({}), 2400);
    return () => clearTimeout(timer);
  }, [justChanged]);

  const decide = async (decision: 'approve' | 'reject') => {
    landed.current = false;
    const verbLabel = decision === 'approve' ? approveVerb : rejectVerb;
    try {
      await d.decide(decision);
      if (!landed.current) {
        // A failed execution is NOT a completed decision: the surface stays
        // with the error on it and the primary becomes Retry.
        toast.error(`${verbLabel}ed, but it failed to run · ${card.title}`, { description: `${approveVerb} again to retry.` });
        return;
      }
      toast.success(`${decision === 'approve' ? `${verbLabel}ed` : `${verbLabel}d`} · ${card.title}`, {
        description: decision === 'approve' ? (card.nextAction ?? 'Executing now.') : 'Nothing runs; the agent learns from it.',
      });
    } catch (err) {
      toast.error(`Could not ${verbLabel.toLowerCase()} · ${card.title}`, { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const snooze = async (days: number) => {
    const until = new Date(Date.now() + days * 86_400_000);
    try {
      await d.snooze(days);
      toast.info(`Snoozed · ${card.title}`, { description: `Back on the review queue ${until.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}.` });
    } catch (err) {
      toast.error(`Could not snooze · ${card.title}`, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSnoozeOpen(false);
    }
  };

  const regenerate = async (instruction: string) => {
    try {
      await d.regenerate(instruction);
      toast.info(`Regenerating · ${card.title}`, { description: 'The item re-enables here when the new version lands.' });
    } catch (err) {
      toast.error(`Could not regenerate · ${card.title}`, { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const heldPrimary = d.held || Boolean(props.hold);

  // The keyboard decides too: a / d / s, never while you are typing.
  useEffect(() => {
    if (!decidable) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement | null });
      if (!action || d.held) {
        return;
      }
      if (action === 'approve' && !heldPrimary) {
        e.preventDefault();
        void decide('approve');
      } else if (action === 'decline') {
        e.preventDefault();
        void decide('reject');
      } else if (action === 'snooze') {
        e.preventDefault();
        setSnoozeOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const title = props.title ?? card.object?.title ?? card.subject?.name ?? card.title;
  const subline = props.subtitle ?? card.object?.subtitle ?? [card.subject?.role, card.subject?.company].filter(Boolean).join(' · ');
  const subtitle = (subline || card.subject?.href)
    ? (
        <>
          {subline}
          {card.subject?.href && (
            <a href={card.subject.href} target="_blank" rel="noreferrer" className={cn('underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground', subline && 'ml-2')}>
              {`Open ${card.subject.name} ↗`}
            </a>
          )}
        </>
      )
    : undefined;

  const metaCells = [
    ...(card.provenance ?? []).map(p => ({ label: p.label, value: p.value as ReactNode })),
    ...(props.meta ?? []),
  ];

  const agent = run.invokedBy?.replace('agent:', '');
  const alignmentRate = run.alignment && run.alignment.n > 0 ? run.alignment.agreementRate : null;
  // Said once. Most presenters build the recommendation's detail and the
  // summary out of the same sentence the run already carries as its
  // rationale, and three copies of one paragraph under one tab reads as three
  // different arguments that happen to agree.
  const rationale = run.proposal?.rationale;
  const detail = card.recommendation?.detail !== rationale ? card.recommendation?.detail : undefined;
  const summary = card.summary !== rationale && card.summary !== detail ? card.summary : undefined;
  // A read-only field that is also an editable property is shown once — in the
  // Changes pane — so "industry" does not read twice.
  const readOnlyFields = d.hasProperties ? (card.fields ?? []).filter(f => !propertyKeys.includes(f.label)) : (card.fields ?? []);

  const renderPane = (id: string) => {
    if (id === 'changes') {
      return (
        <Section eyebrow="Changes" data-testid="changes-pane" commentField="Changes">
          <p className="mb-3 text-[13px] text-muted-foreground">Edit in place; your version is what runs.</p>
          <div className="flex flex-col gap-1">
            {propertyKeys.map(k => (
              <label key={k} className="flex gap-4 text-sm">
                <span className="w-32 shrink-0 pt-1.5 text-[12px] text-muted-foreground">{k}</span>
                {/* Grows to what it holds. A fixed height with a resize grip
                    leaves a drag handle sitting in empty space on a one-line
                    value, which is chrome saying "form field" on a surface
                    meant to read as a record. */}
                {k === 'notes' || k === 'body'
                  ? <textarea rows={1} className={cn(INLINE_FIELD, 'resize-none overflow-hidden leading-relaxed [field-sizing:content]')} value={propertyValue(k)} onChange={ev => d.editProperty(k, ev.target.value)} disabled={d.held} aria-label={k} />
                  : <input className={INLINE_FIELD} value={propertyValue(k)} onChange={ev => d.editProperty(k, ev.target.value)} disabled={d.held} aria-label={k} />}
              </label>
            ))}
          </div>
        </Section>
      );
    }
    if (id === 'why') {
      return (
        <div data-testid="why-pane">
          {rationale && (
            <Section eyebrow="The reasoning">
              <p className="max-w-3xl leading-relaxed break-words text-foreground/85">{rationale}</p>
            </Section>
          )}
          {/* Not folded into "Why" above: that one is the case for the payload,
              this is the case for the recommendation, and on a card the agent
              wants turned down they are different arguments. */}
          {/* An orphan reason renders nothing: a sentence arguing for an
              outcome, with no outcome named, tells a reviewer nothing. */}
          {run.proposal?.suggestedDecision && run.proposal.suggestedDecisionReason && (
            <Section eyebrow="Why it suggests that" data-testid="suggested-decision-reason">
              <p className="max-w-3xl leading-relaxed break-words text-foreground/85">{run.proposal.suggestedDecisionReason}</p>
            </Section>
          )}
          {detail && (
            <Section eyebrow="The recommendation">
              <p className="max-w-3xl leading-relaxed break-words text-foreground/85">{detail}</p>
            </Section>
          )}
          {summary && (
            <Section eyebrow="Summary">
              <p className="max-w-3xl leading-relaxed break-words text-foreground/85">{summary}</p>
            </Section>
          )}
          {!rationale && !(run.proposal?.suggestedDecision && run.proposal.suggestedDecisionReason) && !detail && !summary && (
            <Section eyebrow="Why"><p className="text-muted-foreground">No rationale recorded for this recommendation.</p></Section>
          )}
        </div>
      );
    }
    if (id === 'evidence') {
      return (
        <div data-testid="evidence-pane">
          <Section eyebrow="Citations">
            <EvidenceRefs sources={run.proposal?.evidence ?? []} empty="No citations recorded." />
          </Section>
          {readOnlyFields.length > 0 && (
            <Section eyebrow="Details">
              <FactList facts={readOnlyFields.map(f => ({ label: f.label, value: f.value, href: f.href }))} />
            </Section>
          )}
          {card.links && card.links.length > 0 && (
            <Section eyebrow="Sources">
              <div className="flex flex-wrap gap-4">
                {card.links.map(l => (
                  <a key={l.href} href={l.href} className="text-sm underline decoration-border underline-offset-4 transition hover:decoration-foreground">{`${l.label} ↗`}</a>
                ))}
              </div>
            </Section>
          )}
          {props.evidenceExtra}
          <Section eyebrow="Run details" data-testid="run-details">
            <FactList
              facts={[
                { label: 'Status', value: <StatusDot tone={RED_STATUSES.has(run.status) ? 'fail' : 'pass'} label={STATUS_LABEL[run.status] ?? run.status} /> },
                card.system ? { label: 'System', value: card.system } : null,
                agent ? { label: 'Recommended by', value: agent } : null,
                // Confidence lives on the meta row beside the recommendation it
                // scores; with no recommendation to anchor it, it reads here.
                !card.recommendation && run.proposal?.confidence !== undefined
                  ? { label: card.confidenceSubject ?? 'Recommendation', value: <ConfidenceMeter value={run.proposal.confidence} label={card.confidenceSubject ?? 'Recommendation'} /> }
                  : null,
                run.proposal?.suggestedDecision ? { label: 'Agent suggests', value: SUGGESTION_LABEL[run.proposal.suggestedDecision] } : null,
                alignmentRate !== null && run.alignment
                  ? {
                      label: 'Aligned',
                      value: (
                        <span
                          data-testid="alignment-score"
                          className="tabular-nums"
                          title={`You have agreed with this agent ${Math.round(alignmentRate * 100)}% of the time — ${run.alignment.n} decided recommendation${run.alignment.n === 1 ? '' : 's'} of this kind in the last ${run.alignment.window === 'all' ? 'all time' : run.alignment.window}`}
                        >
                          {`${Math.round(alignmentRate * 100)}% of the time`}
                        </span>
                      ),
                    }
                  : null,
                { label: 'Run', value: `#${run.id}` },
              ]}
            />
          </Section>
        </div>
      );
    }
    const extra = (props.extraTabs ?? []).find(x => `extra-${x.id}` === id);
    if (extra) {
      return <div data-testid={`extra-pane-${extra.id}`}>{extra.children}</div>;
    }
    const item = content.find(c => `item-${c.id}` === id);
    if (!item) {
      return null;
    }
    const label = itemTabs.find(x => x.id === id)!.label;
    const editable = contentKindEditable(item.kind) && !props.guided;
    const Renderer = contentKindRenderer(item.kind);
    const edit = d.contentEdits[item.id];
    return (
      <ItemPane
        item={item}
        label={label}
        editable={editable}
        disabled={d.held}
        canRegenerate={d.canRegenerate}
        regenerating={d.regenerating}
        onRegenerate={instruction => void regenerate(instruction)}
        actions={props.itemActions?.(item, label)}
        edited={edit !== undefined && (edit.subject !== undefined || edit.body !== undefined)}
      >
        <Renderer
          item={item}
          edit={edit}
          onEdit={editable ? patch => d.editContent(item.id, patch) : undefined}
          changed={Boolean(justChanged[item.id])}
          disabled={d.held}
        />
      </ItemPane>
    );
  };

  return (
    <DetailPage
      data-testid={props['data-testid'] ?? 'review-surface'}
      // At least a screen tall, so the sticky bar pins to the bottom of the
      // VIEWPORT rather than to the bottom of whichever pane is open. Without
      // it the decision moves every time you change tabs, which is the one
      // thing a decision bar must never do.
      className="min-h-svh"
      crumbs={props.crumbs}
      title={title}
      subtitle={subtitle}
      actions={(
        <>
          {props.position && <span className="tabular-nums" data-testid="queue-position">{props.position}</span>}
          {props.actions}
        </>
      )}
      meta={(
        <MetaRow
          cells={metaCells}
          recommendation={card.recommendation
            ? { label: card.recommendationLabel ?? 'Recommended action', headline: card.recommendation.headline }
            : null}
          confidence={run.proposal?.confidence}
          confidenceSubject={card.confidenceSubject ?? 'Recommendation'}
        />
      )}
      bar={decidable
        ? (
            <StickyActionBar
              labels={props.barLabels}
              primary={{
                'label': d.execError ? `Retry ${approveVerb}` : approveVerb,
                'onClick': () => void decide('approve'),
                'disabled': heldPrimary,
                'busy': d.busy,
                'icon': Check,
                'shortcut': 'a',
                'hint': props.hold?.reason,
                'data-testid': 'decide-approve',
              }}
              secondary={[
                { 'label': rejectVerb, 'onClick': () => void decide('reject'), 'disabled': d.held, 'icon': X, 'shortcut': 'd', 'tone': 'danger', 'data-testid': 'decide-reject' },
                { 'label': 'Snooze', 'onClick': () => setSnoozeOpen(o => !o), 'disabled': d.held, 'icon': AlarmClock, 'shortcut': 's', 'data-testid': 'decide-snooze' },
              ]}
              aside={snoozeOpen && (
                <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground" role="group" aria-label="Snooze until" data-testid="snooze-picker">
                  <span className="px-1">Until</span>
                  {SNOOZES.map(s => (
                    <button key={s.days} type="button" onClick={() => void snooze(s.days)} disabled={d.held} className="h-8 rounded-lg px-2 text-[13px] text-foreground/80 transition hover:bg-surface-hover hover:text-foreground disabled:opacity-40">
                      {s.label}
                    </button>
                  ))}
                </span>
              )}
              field={{
                label: 'Feedback',
                placeholder: 'Add feedback with your decision. To rewrite something, use Regenerate beside the item it belongs to.',
                value: d.note,
                onChange: d.setNote,
                disabled: d.held,
              }}
            />
          )
        : undefined}
    >
      {props.beforeTabs}

      {(d.regenerating || d.regenStale || d.execError || props.hold) && (
        <div className="flex flex-col gap-2 py-4">
          {d.regenerating && (
            <Notice tone="amber" icon={<Loader2 className="size-4 animate-spin" aria-hidden />} testid="regenerating-banner">
              <span className="font-medium">Regenerating…</span>
              <span className="text-muted-foreground"> the item re-enables here when the new version lands.</span>
              {d.regen?.note && <p className="mt-0.5 truncate text-[13px] text-muted-foreground" title={d.regen.note}>{`“${d.regen.note}”`}</p>}
            </Notice>
          )}
          {d.regenStale && (
            <Notice tone="amber" icon={<TriangleAlert className="size-4" aria-hidden />} testid="regenerating-stale-banner">
              <p className="text-muted-foreground">This regeneration is taking longer than expected. The decision is open again; the regenerated version updates the page if it still arrives.</p>
            </Notice>
          )}
          {d.execError && (
            <Notice tone="red" icon={<TriangleAlert className="size-4" aria-hidden />} testid="execution-failed-banner">
              <p className="font-medium text-brand-fail">The approval did not go through</p>
              <p className="mt-0.5 text-[13px] break-words text-muted-foreground">{d.execError}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{`Fix the cause if it names one, then ${approveVerb} again to retry.`}</p>
            </Notice>
          )}
          {props.hold && (
            <Notice tone="amber" icon={<Ban className="size-4" aria-hidden />} testid="primary-held">
              <span className="font-medium">{`${approveVerb} is held.`}</span>
              <span className="text-muted-foreground">{` ${props.hold.reason}`}</span>
            </Notice>
          )}
        </div>
      )}

      <Tabs value={active} onValueChange={setTab} className="pt-4">
        {/* The one real ceiling: a long sequence scrolls the tab row rather
            than wrapping it, so the panes below never shift down a line. */}
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList variant="line" className="w-max" data-testid="review-tabs">
            {tabIds.map((id) => {
              const label = id === 'changes'
                ? 'Changes'
                : id === 'why'
                  ? 'Why'
                  : id === 'evidence'
                    ? 'Evidence'
                    : (props.extraTabs ?? []).find(x => `extra-${x.id}` === id)?.label
                      ?? itemTabs.find(x => x.id === id)?.label
                      ?? id;
              return <TabsTrigger key={id} value={id} data-testid={`tab-${id}`}>{label}</TabsTrigger>;
            })}
          </TabsList>
        </div>
        {tabIds.map(id => (
          // A minimum height so the decision bar holds its place as you move
          // between a two-line email and a full Evidence pane.
          <TabsContent key={id} value={id} className="min-h-80 pt-2">
            {active === id && renderPane(id)}
          </TabsContent>
        ))}
      </Tabs>
    </DetailPage>
  );
}
