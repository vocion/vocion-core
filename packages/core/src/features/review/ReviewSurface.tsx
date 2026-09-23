'use client';

import type { ReactNode } from 'react';
import type { ReviewOutcome } from './useReviewDecision';
import type { Crumb } from '@/components/patterns';
import type { ActionRevision } from '@/libs/actions/revisions';
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
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { useDraftRevision } from '@/features/personalization/draftRevision';
import { EvidenceRefs } from '@/features/preview/EvidenceRefs';
import { isSelfUpdate } from '@/libs/actions/selfUpdate';
import { cn } from '@/utils/Helpers';
import { contentKindEditable, contentKindRenderer } from './contentKinds';
import { approvableItems, isChecked, walkApplies, walkCount } from './contentWalk';
import { shortcutFor } from './reviewShortcuts';
import { showLearnedToast } from './showLearnedToast';
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
 *     decision header            card.headline + badges + the recommendation, said once
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
 * A card with a `headline` reads in the shorter register the first hand-off
 * asked for (Chris, 2026-09-20, on his phone): one sentence and its badges
 * before the tabs, the recommendation as ONE inline line under them rather
 * than three rows under Run details, and Why as one section rather than "The
 * reasoning" beside "Why it suggests that". A card without one renders as it
 * always did. A card that also says `handoff` gets the lifecycle — Approve →
 * a person runs the steps → Mark done — under Run details, with who runs it.
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
  /** Why the LAST regeneration did not land, when it did not; null once one lands. */
  regenerateError?: string | null;
  /**
   * Which content items a reviewer has already approved, keyed by content id,
   * each holding a HASH of the copy that was approved. The check is derived
   * from it and never stored as a flag, so a regeneration or an inline edit
   * clears it on its own (`libs/actions/contentHash.ts`).
   */
  contentReview?: Record<string, { hash: string; at: string; by?: string }> | null;
  /** The per-item history the walk reads: proposed, every ask, approved. */
  revisions?: ActionRevision[] | null;
  /** What the last execution attempt said, set when `status` is `failed`. */
  error?: string | null;
  /** How often this agent's recommendations of this kind matched the person's decision (server-computed, 30d). */
  alignment?: { agreementRate: number | null; n: number; window: string } | null;
  /**
   * What the run recorded on its way through — for a hand-off, `handoff`
   * (who approved it, when) and `executed` (who marked it done, when, the
   * note, the result URL). Read by the lifecycle under Run details.
   */
  result?: Record<string, unknown> | null;
  /** Who is expected to do the work, when the queue routed it to someone. */
  assignee?: string | null;
  decidedBy?: string | null;
  decidedAt?: Date | string | null;
  executedAt?: Date | string | null;
  /**
   * Display names for the ids the run carries (`decidedBy`, `result.handoff
   * .releasedBy`, `result.executed.by`), resolved by the loader. An id with
   * no name here renders as itself rather than as nothing.
   */
  people?: Record<string, string>;
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
  awaiting_execution: 'Approved — waiting to be done',
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

/** The same advice as one word, for "send-lead suggests approving". */
const SUGGESTION_VERB: Record<SuggestedDecision, string> = {
  approve: 'approving',
  reject: 'turning down',
  snooze: 'waiting',
};

/**
 * "Approve" → "Approved", "Confirm" → "Confirmed", "Reject" → "Rejected". The
 * toast used to append `ed` to every approve verb and `d` to every reject
 * verb, which read "Approveed" and "Rejectd" on any card that used the plain
 * words — the hand-off is the first that does.
 * @param verb
 */
function pastTense(verb: string): string {
  return verb.endsWith('e') ? `${verb}d` : `${verb}ed`;
}

/** A moment on the lifecycle — fixed to `en-US` for the same reason as `REVISION_DATE`. */
const MOMENT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * A date the run recorded, or nothing — never "Invalid Date".
 * @param value - An ISO string, a Date, or whatever the row held.
 */
function moment(value: unknown): string | null {
  const d = typeof value === 'string' || value instanceof Date ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? MOMENT.format(d) : null;
}

const SNOOZES = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

/** What a revision entry IS, as the history line names it. */
const REVISION_KIND: Record<NonNullable<ActionRevision['kind']>, string> = {
  proposed: 'proposed',
  regenerated: 'regenerated',
  approved: 'approved',
  failed: 'did not land',
};

/**
 * Day and month on a history line. Fixed to `en-US` rather than the viewer's
 * locale: these render in tests and stories that mount no intl provider, and
 * a date that reads differently per machine makes a screenshot diff noise.
 */
const REVISION_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

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
 * One send's history, read off the run's `revisions` column: what was
 * proposed, every ask made of it, and the copy that was approved.
 *
 * Under the instruction box rather than beside the copy, because it is the
 * context for the NEXT ask — "I already told it to lead with the hiring
 * signal" is the thing a reviewer needs while typing, and it is the thing
 * that used to be gone by the time they could look for it.
 * @param props - The entries for this item.
 * @param props.entries - This item's revisions, oldest first.
 * @param props.id - The content id, for the test hook.
 */
function ItemHistory(props: { entries: readonly ActionRevision[]; id: string }) {
  if (props.entries.length === 0) {
    return null;
  }
  return (
    <div className="mt-5 border-t border-rule pt-3" data-testid={`history-${props.id}`}>
      <h4 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">History</h4>
      <ol className="mt-2 flex flex-col gap-2">
        {props.entries.map((r, i) => (
          <li key={`${r.version}-${r.at}-${i}`} className="text-[13px]">
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground/85">{`v${r.version} ${REVISION_KIND[r.kind ?? 'regenerated']}`}</span>
              {r.by && <span>{` by ${r.by}`}</span>}
              {/* Anything dated is shown with its date (principle 10). */}
              <span>{` · ${REVISION_DATE.format(new Date(r.at))}`}</span>
            </p>
            {r.ask && <p className="mt-0.5 break-words text-muted-foreground/90">{`asked “${r.ask}”`}</p>}
            {/* The outcome under the ask, so the history reads as a
                conversation: asked this, and then this happened. An ask with
                nothing after it was how a failed regenerate hid (ticket 069). */}
            {r.kind === 'failed' && r.failure && <p className="mt-0.5 break-words text-brand-fail" data-testid={`history-failure-${props.id}`}>{r.failure}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * One content item, as a split pane: the copy on the left, the instruction
 * that asks for a rewrite on the right, and that item's history under it.
 *
 * The split is the point. The instruction box used to sit on the decision bar,
 * away from the copy it was about, and Regenerate opened a panel UNDERNEATH
 * the send that pushed the copy off screen exactly when a reviewer needed to
 * read it while writing the instruction. Side by side, the copy stays put and
 * the ask is made against something you can still see.
 *
 * Regenerate is therefore always open, not a disclosure: a control that hides
 * the thing it acts on is the defect, and one fewer click to reach it is the
 * fix. Edit is gone for the same reason — the copy on the left is already
 * editable in place, so a button whose only job was to focus it was chrome
 * naming an affordance that was already there.
 *
 * Narrow (a phone, or the pane squeezed beside an open conversation) it stacks
 * copy-then-instruction, which is the reading order anyway. The breakpoint is
 * a CONTAINER query, not a viewport one, because the thing that takes the
 * width away is the conversation rail rather than the window.
 * @param props - The item, its working copy, and the regenerate path.
 * @param props.item - The content item.
 * @param props.label - What the tab calls it, so the controls can name it.
 * @param props.editable - Whether the kind takes the reviewer's edits.
 * @param props.children - The registered renderer, already built.
 * @param props.actions - A control the surface adds beside the item's own.
 * @param props.edited - True when the working copy differs from what the agent wrote.
 * @param props.disabled - Held while busy or regenerating.
 * @param props.canRegenerate - Whether the action implements regeneration.
 * @param props.regenerating - True while a pass is in flight.
 * @param props.onRegenerate - Runs the pass with the instruction.
 * @param props.history - This item's revisions, oldest first.
 * @param props.approved - Set once this send carries a check: the way back.
 * @param props.scoped - True when a regenerate rewrites this item alone.
 */
/**
 * Regenerate every send from one instruction.
 *
 * Sits under the strip rather than on the bar (one Regenerate on the bar
 * meant whichever item its author had in mind) and rather than inside a
 * pane (a pane is about one send). It says what it costs: every send is
 * redrafted, so any per-send approval whose copy changes is cleared, which
 * the walk derives from the copy's hash without anyone clearing it.
 * @param props
 * @param props.count - How many sends the instruction will rewrite.
 * @param props.disabled
 * @param props.regenerating
 * @param props.onRegenerate - Runs the whole-card pass with the instruction.
 */
function RegenerateAll(props: {
  count: number;
  disabled: boolean;
  regenerating: boolean;
  onRegenerate: (instruction: string) => void;
}) {
  const [instruction, setInstruction] = useState('');
  return (
    <section className="mt-6 border-t border-rule pt-4" data-testid="regenerate-all-open" aria-label="Regenerate all sends">
      <label className="block">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {`What should all ${props.count} sends do differently?`}
        </span>
        <textarea
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          rows={2}
          disabled={props.disabled}
          aria-label="Instruction for regenerating all sends"
          placeholder="e.g. Replace every dash with a comma, and drop the sign-off."
          className="mt-1.5 w-full resize-y rounded-lg bg-surface-soft px-3 py-2 text-sm leading-relaxed transition outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
        />
      </label>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          {`Redrafts all ${props.count} sends from your instruction. Any send you had approved is unapproved if its copy changes.`}
        </p>
        <button
          type="button"
          data-testid="regenerate-all"
          aria-label="Regenerate all sends"
          disabled={props.disabled || instruction.trim().length === 0}
          onClick={() => {
            props.onRegenerate(instruction.trim());
            setInstruction('');
          }}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
        >
          {props.regenerating ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
          {props.regenerating ? 'Regenerating…' : 'Regenerate all'}
        </button>
      </div>
    </section>
  );
}

function ItemPane(props: {
  item: ReviewContent;
  label: string;
  editable: boolean;
  children: ReactNode;
  actions?: ReactNode;
  edited?: boolean;
  disabled?: boolean;
  canRegenerate: boolean;
  regenerating: boolean;
  onRegenerate: (instruction: string) => void;
  history: readonly ActionRevision[];
  approved?: { onUndo: () => void; label: string } | null;
  /** True when a regenerate here rewrites THIS item and nothing else. */
  scoped?: boolean;
}) {
  // The instruction is about THIS send, and the pane is KEYED by content id at
  // the call site, so moving to another send remounts it empty. An ask typed
  // against send 3 arriving on send 4 is the one mistake this layout could
  // newly cause, and a key rules it out where an effect only tidies up after
  // it.
  const [instruction, setInstruction] = useState('');

  return (
    // `data-comment-field`: the item is a region the selection control can
    // anchor to, so highlighting a sentence in it offers *Ask about this* /
    // *Add change* (`docs/design/patterns.md` § Select → talk).
    <div data-comment-field={props.label} data-testid={`item-pane-${props.item.id}`} className="@container">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {props.label}
          {/* Your version, not the agent's — said once, quietly, and it
              survives a tab change where the arrival tint does not. */}
          {props.edited && <span className="ml-2 font-normal normal-case" data-testid={`edited-${props.item.id}`}>edited</span>}
        </h3>
        <div className="flex shrink-0 items-center gap-1">{props.actions}</div>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 @2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0">{props.children}</div>

        <aside className="min-w-0 border-t border-rule pt-5 @2xl:border-t-0 @2xl:border-l @2xl:pt-0 @2xl:pl-6">
          {props.canRegenerate && (
            <div data-testid={`regenerate-${props.item.id}-open`}>
              <label className="block">
                <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  {`What should ${props.label} do differently?`}
                </span>
                <textarea
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  rows={3}
                  disabled={props.disabled}
                  aria-label={`Regenerate instruction for ${props.label}`}
                  placeholder="e.g. Shorter, and lead with the hiring signal rather than the guide."
                  className="mt-1.5 w-full resize-y rounded-lg bg-surface-soft px-3 py-2 text-sm leading-relaxed transition outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
                />
              </label>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  data-testid={`regenerate-${props.item.id}`}
                  aria-label={`Regenerate ${props.label}`}
                  disabled={props.disabled || instruction.trim().length === 0}
                  onClick={() => {
                    props.onRegenerate(instruction.trim());
                    setInstruction('');
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
                >
                  {props.regenerating ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                  {props.regenerating ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>
              {/* What it will actually do, said where the ask is typed. The
                  old line ("re-runs the work behind the recommendation") was
                  written when a regenerate redrafted the whole card, and it
                  was still there after the ask became per-send. */}
              <p className="mt-1 text-[13px] text-muted-foreground">
                {props.scoped
                  ? `This rewrites ${props.label} with your instruction and leaves the others as they are. It holds its place here and re-enables when the new version lands. If the instruction turns out to need new research, the whole card is redrafted and says so.`
                  : 'This re-runs the work behind the recommendation with your instruction. The item holds its place here and re-enables when the new version lands.'}
              </p>
            </div>
          )}

          <ItemHistory entries={props.history} id={props.item.id} />

          {/* Approving happens on the decision bar, so the only control here is
              the way back: a quiet line that says this send is vouched for and
              takes it back. The pane never draws a second dark pill beside the
              bar's — one primary on the screen, which is the rule the two
              competing buttons broke. */}
          {props.approved && (
            <div className="mt-5 border-t border-rule pt-3">
              <button
                type="button"
                data-testid={`unapprove-${props.item.id}`}
                onClick={props.approved.onUndo}
                disabled={props.disabled}
                aria-label={`${props.approved.label} approved — undo`}
                title={`${props.approved.label} approved — undo`}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] text-brand-pass transition hover:bg-surface-hover disabled:opacity-40"
              >
                <Check className="size-4" aria-hidden />
                Approved
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * The decision header: the one sentence a person reads first, the chips that
 * settle the questions a thumb asks before scrolling (which system, can it be
 * undone, what it costs, which account), and the recommendation as ONE line —
 * who suggests what, how sure. Drawn from `card.headline` and `card.badges`,
 * composed here so no presenter can put these anywhere else.
 * @param props
 * @param props.headline
 * @param props.badges
 * @param props.recommendation - "send-lead suggests approving · 90% confident", or nothing.
 */
function DecisionHeader(props: { headline: string; badges: NonNullable<ReviewCard['badges']>; recommendation: string | null }) {
  return (
    <section data-testid="decision-header" className="border-b border-rule py-4">
      <p className="max-w-3xl text-[15px] leading-relaxed break-words text-foreground">{props.headline}</p>
      {props.badges.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid="decision-badges">
          {props.badges.map(b => (
            <Badge key={b.label} variant={b.tone === 'warn' ? 'destructive' : 'outline'} data-tone={b.tone ?? 'default'}>{b.label}</Badge>
          ))}
        </div>
      )}
      {props.recommendation && (
        <p className="mt-2.5 inline-flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground" data-testid="decision-recommendation">
          <Sparkles className="size-3.5 shrink-0 text-brand-amber-deep" aria-hidden />
          {props.recommendation}
        </p>
      )}
    </section>
  );
}

/** One step of a hand-off's life, with what the run recorded for it. */
type LifecycleStep = { label: string; state: 'done' | 'current' | 'next'; detail?: ReactNode };

/**
 * Approve → A person runs the steps → Mark done, with where this run stands.
 * Horizontal where there is room, stacked on a phone; the current step is
 * the one in ink, the ones behind it carry a check and what the run recorded
 * (who, when, the result), the ones ahead are quiet.
 * @param props
 * @param props.steps
 */
function HandoffLifecycle(props: { steps: LifecycleStep[] }) {
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:gap-8" data-testid="handoff-lifecycle">
      {props.steps.map((s, i) => (
        <li
          key={s.label}
          aria-current={s.state === 'current' ? 'step' : undefined}
          data-state={s.state}
          data-testid={`lifecycle-step-${i + 1}`}
          className={cn('flex min-w-0 gap-2.5 text-sm', s.state === 'next' && 'text-muted-foreground')}
        >
          <span
            aria-hidden
            className={cn(
              'mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
              s.state === 'done' && 'bg-brand-pass/15 text-brand-pass',
              s.state === 'current' && 'bg-foreground text-background',
              s.state === 'next' && 'bg-surface-soft text-muted-foreground',
            )}
          >
            {s.state === 'done' ? <Check className="size-3" /> : i + 1}
          </span>
          <span className="min-w-0">
            <span className={cn('block', s.state === 'current' && 'font-medium text-foreground')}>{s.label}</span>
            {s.detail && <span className="mt-0.5 block text-[12px] break-words text-muted-foreground">{s.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
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

  // An approved hand-off has one job left: whoever did the work says so. The
  // bar's primary becomes Mark done, its secondary the honest failure, and
  // snooze goes — there is nothing to come back and decide.
  const awaitingExecution = run.status === 'awaiting_execution';
  const approveVerb = awaitingExecution ? 'Mark done' : card.verbs?.approve ?? 'Approve';
  const rejectVerb = awaitingExecution ? 'Could not be done' : card.verbs?.reject ?? 'Decline';
  // The shorter register (see the file comment): one header, one line for the
  // recommendation, one Why. Opted into by the presenter naming a headline.
  const brief = Boolean(card.headline);
  const handoff = card.handoff;

  const [snoozeOpen, setSnoozeOpen] = useState(false);
  /** Content ids that moved in the last couple of seconds — the tint fades on its own. */
  const [justChanged, setJustChanged] = useState<Record<string, number>>({});

  const content = card.content ?? [];
  // Read the KEYS off the run, not off the hook's working copy: the copy is
  // seeded in an effect, so deriving the tabs from it would open the screen on
  // Why for one paint and leave a fields-only type there.
  const propertyKeys = d.hasProperties ? Object.keys((run.input.properties ?? {}) as Record<string, unknown>) : [];
  const propertyValue = (k: string) => d.propertyEdits[k] ?? str((run.input.properties as Record<string, unknown>)[k]);

  /**
   * The walk. `applies` is count-based, not type-based: two or more items a
   * reviewer can vouch for is the case it exists for, one is approve-then-
   * confirm (two clicks for one thing), and none has nothing to walk. So a
   * follow-up email, a CRM update and a discovery proposal are untouched, and
   * the lead page gets the walk for free by mounting the same shell.
   */
  const walks = walkApplies(content);
  const count = walkCount(content, d.contentEdits, d.approvals);
  const checkedIds = new Set(content.filter(i => isChecked(i, d.contentEdits[i.id], d.approvals)).map(i => i.id));

  // The tabs, derived. Nothing here enumerates object types, kinds or counts:
  // N items produce N tabs, the surface's own tabs slot in, and Why and
  // Evidence are always built — Evidence last.
  const before = (props.extraTabs ?? []).filter(x => x.first);
  const after = (props.extraTabs ?? []).filter(x => !x.first);
  const itemTabs = content.map(item => ({ id: `item-${item.id}`, label: (item as { tabLabel?: string }).tabLabel ?? item.label }));
  /**
   * The name a send is known by on screen — "Day 3" — for anything naming one.
   * @param item - The content item.
   */
  const labelOf = (item: ReviewContent) => itemTabs.find(x => x.id === `item-${item.id}`)?.label ?? item.label;
  /**
   * The tab strip is what there is to REVIEW, and nothing else.
   *
   * Why and Evidence used to sit on it, which put two tabs a reviewer never
   * opens beside the four they came to read (Chris, 2026-09-20: *"i don't
   * like the additional tabs for WHY and EVIDENCE. remove them. should just
   * be the email tabs for review"*). They still render, stacked under the
   * content as ordinary sections: the run is what supplies them and no object
   * type may ship without its evidence, so taking them OFF the page would
   * drop the citations behind a recommendation rather than tidy a strip.
   */
  const tabIds = [
    ...(propertyKeys.length > 0 ? ['changes'] : []),
    ...before.map(x => `extra-${x.id}`),
    ...itemTabs.map(x => x.id),
    ...after.map(x => `extra-${x.id}`),
  ];
  // `''` rather than undefined when there is no strip at all: a card with
  // nothing to review (a CRM update with no editable properties) is all
  // dossier, and Radix's Tabs wants a string either way.
  const opening = props.defaultTab && tabIds.includes(props.defaultTab) ? props.defaultTab : tabIds[0] ?? '';
  const [tab, setTab] = useState(opening);
  useEffect(() => {
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setTab(opening);
    setSnoozeOpen(false);
  }, [run.id]);
  // A tab that stops existing (the content came back shorter) must not leave
  // the pane blank; fall back to the first one rather than rendering nothing.
  const active = tabIds.includes(tab) ? tab : tabIds[0] ?? '';

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

  const decide = async (decision: 'approve' | 'reject' | 'done') => {
    landed.current = false;
    const verbLabel = decision === 'reject' ? rejectVerb : approveVerb;
    try {
      await d.decide(decision);
      if (!landed.current) {
        // A failed execution is NOT a completed decision: the surface stays
        // with the error on it and the primary becomes Retry.
        toast.error(`${verbLabel}ed, but it failed to run · ${card.title}`, { description: `${approveVerb} again to retry.` });
        return;
      }
      if (decision === 'done') {
        toast.success(`Marked done · ${card.title}`, { description: 'The run records who did it and when.' });
        return;
      }
      if (awaitingExecution) {
        toast.success(`Recorded as not done · ${card.title}`, { description: 'Declined after approval; your note says what was found.' });
        return;
      }
      toast.success(`${pastTense(verbLabel)} · ${card.title}`, {
        description: decision === 'approve' ? (card.nextAction ?? 'Executing now.') : 'Nothing runs; the agent learns from it.',
      });
      showLearnedToast({ decision, actionId: run.actionId, runId: run.id, hasNote: d.note.trim().length > 0, undoable: isSelfUpdate(run.actionId) });
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

  const regenerate = async (instruction: string, contentId?: string) => {
    try {
      await d.regenerate(instruction, contentId);
      toast.info(`Regenerating · ${card.title}`, { description: 'The item re-enables here when the new version lands.' });
    } catch (err) {
      toast.error(`Could not regenerate · ${card.title}`, { description: err instanceof Error ? err.message : String(err) });
    }
  };

  /**
   * Approve one send, then move to the next one still unapproved.
   *
   * The advance is what makes this a walk rather than a checklist: the screen
   * puts the next thing it is asking you to vouch for in front of you. The
   * last one advances nowhere and leaves you on it, with the count full and
   * the primary now reading Enroll.
   * @param contentId - The send being approved.
   */
  const approveItem = async (contentId: string) => {
    try {
      await d.approveContent(contentId);
    } catch (err) {
      toast.error('Could not approve that item', { description: err instanceof Error ? err.message : String(err) });
      return;
    }
    const next = content.find(i => i.id !== contentId && !checkedIds.has(i.id) && contentKindEditable(i.kind));
    if (next) {
      setTab(`item-${next.id}`);
    }
  };

  /**
   * Take one send's check back off. The history it already wrote stands.
   * @param contentId - The send being unapproved.
   */
  const unapproveItem = async (contentId: string) => {
    try {
      await d.unapproveContent(contentId);
    } catch (err) {
      toast.error('Could not undo that approval', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  /**
   * The walk IS the primary: one button, and the walk is what it does.
   *
   * There used to be two of them — a dark Approve inside the pane and a dead
   * Enroll on the bar — which left a reviewer to work out that the second was
   * waiting on the first (Chris, 2026-09-19: *"as a user I should just be
   * cycled through what I need to approve ... so there shouldn't be two
   * buttons"*). So the bar's primary reads **Approve** while sends are
   * outstanding, approves the send on screen and advances, and becomes the
   * card's own verb — **Enroll** — only once the count is full.
   *
   * That holds the send harder than the disabled primary it replaces: Enroll
   * cannot be pressed early because, until the last check lands, the button is
   * not Enroll. The count over the tab row says how far along you are, and no
   * banner repeats it.
   *
   * Two modes, because the button must never approve copy that is not on
   * screen. On an unapproved send it approves that send. Anywhere else — Why,
   * Evidence, a send already checked — it OPENS the send still waiting, and
   * the next press approves it. Approving something you were not looking at is
   * the one mistake this button could newly make, and the mode rules it out.
   *
   * A retry never walks. A run whose execution failed was already decided once
   * — the copy was approved, the decision's backstop recorded it, and what
   * went wrong was HubSpot, not the reading. Walking four sends again to
   * re-send copy already approved would be the count blocking a queue.
   */
  const activeItem = content.find(i => `item-${i.id}` === active);
  const waiting = walks && !count.complete && !d.execError
    ? approvableItems(content).filter(i => !checkedIds.has(i.id))
    : [];
  const onDeck = waiting.find(i => i.id === activeItem?.id) ?? waiting[0];
  const walkStep = onDeck
    ? { open: onDeck.id !== activeItem?.id, item: onDeck, label: labelOf(onDeck) }
    : null;
  const heldPrimary = d.held || Boolean(props.hold);

  /** What the bar's primary does: the next step of the walk, or the decision. */
  const pressPrimary = () => {
    if (awaitingExecution) {
      void decide('done');
      return;
    }
    if (!walkStep) {
      void decide('approve');
      return;
    }
    if (walkStep.open) {
      setTab(`item-${walkStep.item.id}`);
      return;
    }
    void approveItem(walkStep.item.id);
  };

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
        pressPrimary();
      } else if (action === 'decline') {
        e.preventDefault();
        void decide('reject');
      } else if (action === 'snooze' && !awaitingExecution) {
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

  // The recommendation, said once: "send-lead suggests approving · 90%
  // confident". The reason joins it under Why, where there is room to read it.
  const suggested = run.proposal?.suggestedDecision;
  const confidencePct = run.proposal?.confidence !== undefined ? `${Math.round(run.proposal.confidence * 100)}% confident` : null;
  const suggests = suggested ? `${agent ?? 'The agent'} suggests ${SUGGESTION_VERB[suggested]}` : agent ? `Recommended by ${agent}` : null;
  const recommendationLine = [suggests, confidencePct].filter(Boolean).join(' · ') || null;
  const suggestionReason = suggested && run.proposal?.suggestedDecisionReason ? run.proposal.suggestedDecisionReason : null;

  /**
   * An id the run recorded, as a name where the loader found one. The ladder
   * is not a person and says so.
   * @param id
   */
  const who = (id: unknown): string | null => {
    if (typeof id !== 'string' || !id) {
      return null;
    }
    if (id === 'trust-ladder') {
      return 'the trust ladder';
    }
    return run.people?.[id] ?? id.replace(/^agent:/, '');
  };
  const trail = (run.result ?? {}) as { handoff?: { releasedBy?: string; releasedAt?: string }; executed?: { by?: string; at?: string; note?: string; resultUrl?: string; externalRef?: { system: string; id: string } } };
  /**
   * "by Rowan Pike · Sep 20, 3:12 PM" — the who and when of one lifecycle step.
   * @param by
   * @param at
   */
  const stamp = (by: unknown, at: unknown): string | null => {
    const parts = [who(by) ? `by ${who(by)}` : null, moment(at)].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  };
  const lifecycle: LifecycleStep[] | null = handoff
    ? (() => {
        const approved = run.status === 'awaiting_execution' || run.status === 'done' || Boolean(trail.handoff);
        const done = run.status === 'done';
        const result = trail.executed;
        const ref = result?.resultUrl
          ? <a href={result.resultUrl} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground" data-testid="handoff-result">{result.resultUrl.replace(/^https?:\/\//, '')}</a>
          : result?.externalRef
            ? <span data-testid="handoff-result">{`${result.externalRef.system} ${result.externalRef.id}`}</span>
            : null;
        const doneDetail = done
          ? (
              <>
                {stamp(result?.by, result?.at ?? run.executedAt)}
                {ref && (
                  <>
                    {' · '}
                    {ref}
                  </>
                )}
                {result?.note && <span className="block">{`“${result.note}”`}</span>}
              </>
            )
          : undefined;
        return [
          { label: 'Approve', state: approved ? 'done' : run.status === 'pending' || run.status === 'failed' ? 'current' : 'next', detail: approved ? stamp(trail.handoff?.releasedBy ?? run.decidedBy, trail.handoff?.releasedAt ?? run.decidedAt) ?? undefined : undefined },
          { label: 'A person runs the steps', state: done ? 'done' : run.status === 'awaiting_execution' ? 'current' : 'next' },
          { label: 'Mark done', state: done ? 'done' : 'next', detail: doneDetail },
        ];
      })()
    : null;
  const whoRunsIt = run.assignee ?? 'Anyone with the account; mark done when finished';

  /**
   * This item's slice of the run's history. A run written before the record
   * shipped carries none, and the column simply does not render.
   * @param contentId
   */
  const historyFor = (contentId: string): ActionRevision[] =>
    (run.revisions ?? []).filter(r => r.contentId === contentId);

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
      if (brief) {
        // One Why. The case for the payload, the case for the recommendation
        // and the agent's advice are three sentences about one decision, and
        // a phone reads them best as one section.
        const whyLine = [suggests, confidencePct, suggestionReason].filter(Boolean).join(' · ') || null;
        const empty = !rationale && !summary && !detail && !whyLine;
        return (
          <div data-testid="why-pane">
            <Section eyebrow="Why" data-testid="why-merged">
              {rationale && <p className="max-w-3xl leading-relaxed break-words text-foreground/85">{rationale}</p>}
              {summary && <p className={cn('max-w-3xl leading-relaxed break-words text-foreground/85', rationale && 'mt-3')}>{summary}</p>}
              {detail && <p className="mt-3 max-w-3xl leading-relaxed break-words text-foreground/85">{detail}</p>}
              {whyLine && (
                <p className="mt-3 inline-flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground" data-testid="why-suggestion">
                  <Sparkles className="size-3.5 shrink-0 text-brand-amber-deep" aria-hidden />
                  {whyLine}
                </p>
              )}
              {empty && <p className="text-muted-foreground">No rationale recorded for this recommendation.</p>}
            </Section>
          </div>
        );
      }
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
            {lifecycle && <HandoffLifecycle steps={lifecycle} />}
            <FactList
              className={lifecycle ? 'mt-4' : undefined}
              facts={[
                { label: 'Status', value: <StatusDot tone={RED_STATUSES.has(run.status) ? 'fail' : 'pass'} label={STATUS_LABEL[run.status] ?? run.status} /> },
                card.system ? { label: 'System', value: card.system } : null,
                // The recommendation is said once, under the decision header,
                // on a card that has one; these three rows are for the rest.
                agent && !brief ? { label: 'Recommended by', value: agent } : null,
                // Confidence lives on the meta row beside the recommendation it
                // scores; with no recommendation to anchor it, it reads here.
                !brief && !card.recommendation && run.proposal?.confidence !== undefined
                  ? { label: card.confidenceSubject ?? 'Recommendation', value: <ConfidenceMeter value={run.proposal.confidence} label={card.confidenceSubject ?? 'Recommendation'} /> }
                  : null,
                !brief && run.proposal?.suggestedDecision ? { label: 'Agent suggests', value: SUGGESTION_LABEL[run.proposal.suggestedDecision] } : null,
                { label: 'Run', value: `#${run.id}` },
                handoff ? { label: 'Who runs it', value: <span data-testid="who-runs-it">{whoRunsIt}</span> } : null,
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
        key={item.id}
        item={item}
        label={label}
        editable={editable}
        disabled={d.held}
        canRegenerate={d.canRegenerate}
        regenerating={d.regenerating}
        onRegenerate={instruction => void regenerate(instruction, item.id)}
        actions={props.itemActions?.(item, label)}
        edited={edit !== undefined && (edit.subject !== undefined || edit.body !== undefined)}
        history={historyFor(item.id)}
        approved={walks && checkedIds.has(item.id)
          ? { onUndo: () => void unapproveItem(item.id), label }
          : null}
        scoped={walks}
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
                // One word, and the walk is what it does: Approve until every
                // send carries a check, then the card's own verb.
                'label': walkStep ? 'Approve' : d.execError ? `Retry ${approveVerb}` : approveVerb,
                'onClick': pressPrimary,
                'disabled': heldPrimary,
                'busy': d.busy,
                'icon': Check,
                'shortcut': 'a',
                'hint': props.hold?.reason ?? (walkStep?.open ? `Opens ${walkStep.label}, which is still waiting to be approved.` : undefined),
                'data-testid': 'decide-approve',
              }}
              secondary={[
                // A hand-off's verbs keep their words on a phone: Reject and
                // Snooze as icons alone read as two mystery buttons beside
                // Approve on the first one Chris met there.
                { 'label': rejectVerb, 'onClick': () => void decide('reject'), 'disabled': d.held, 'icon': X, 'shortcut': 'd', 'tone': 'danger', 'labelAlways': Boolean(handoff), 'data-testid': 'decide-reject' },
                ...(awaitingExecution
                  ? []
                  : [{ 'label': 'Snooze', 'onClick': () => setSnoozeOpen(o => !o), 'disabled': d.held, 'icon': AlarmClock, 'shortcut': 's' as const, 'labelAlways': Boolean(handoff), 'data-testid': 'decide-snooze' }]),
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
                label: 'Note',
                placeholder: awaitingExecution
                  ? 'What you did, and where the result is — a PR link, a deployment URL. Rides the run as its execution record.'
                  : 'A note that rides this decision and trains the agent. To rewrite a draft, use the instruction box beside it.',
                value: d.note,
                onChange: d.setNote,
                disabled: d.held,
              }}
            />
          )
        : undefined}
    >
      {/* First thing on the card: what approving does, the facts that settle
          it, and the recommendation — before any tab. */}
      {brief && <DecisionHeader headline={card.headline!} badges={card.badges ?? []} recommendation={recommendationLine} />}

      {props.beforeTabs}

      {(d.regenerating || d.regenStale || d.regenError || d.execError || props.hold) && (
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
          {d.regenError && !d.regenerating && (
            <Notice tone="red" icon={<TriangleAlert className="size-4" aria-hidden />} testid="regenerate-failed-banner">
              <p className="font-medium text-brand-fail">The last regenerate did not land</p>
              <p className="mt-0.5 text-[13px] break-words whitespace-pre-line text-muted-foreground">{d.regenError}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">The copy on the card is unchanged. Fix what it names, or word the instruction differently, and regenerate again.</p>
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

      {tabIds.length > 0 && (
        <Tabs value={active} onValueChange={setTab} className="pt-4">
          {/* How far through the walk you are, over the row it is about. A card
            that does not walk shows no count rather than "1 of 1". */}
          {walks && (
            <div className="flex items-baseline justify-between gap-3 pb-2">
              <h2 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Review content</h2>
              <span className="text-[13px] text-muted-foreground tabular-nums" data-testid="walk-count">
                {`${count.approved} of ${count.total} approved`}
              </span>
            </div>
          )}
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
                const item = content.find(c => `item-${c.id}` === id);
                const checked = item !== undefined && checkedIds.has(item.id);
                return (
                  <TabsTrigger key={id} value={id} data-testid={`tab-${id}`} data-approved={checked ? 'true' : undefined}>
                    {checked && <Check className="mr-1.5 inline size-3.5 align-[-2px] text-brand-pass" data-testid={`tab-check-${item.id}`} aria-label="approved" />}
                    {label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          {tabIds.map(id => (
          // A minimum height so the decision bar holds its place as you move
          // between a two-line email and a longer pane.
            <TabsContent key={id} value={id} className="min-h-80 pt-2">
              {active === id && renderPane(id)}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* The whole card, when the note is about all of it. Each send has its
          own Regenerate beside it, and that is the right tool for one send;
          "take the dashes out everywhere" is not a note about one send, and
          the only way to say it was to type it four times (ticket 069). The
          server has always taken a regenerate with no send named as a
          redraft of every send; this is the first control that reaches it. */}
      {/* And only while a SEND is what you are looking at. The lead page
          mounts this shell with a Brief tab beside the sends, and an
          instruction box about the sends under the research brief was the
          first thing Valerie noticed (2026-09-23). */}
      {decidable && d.canRegenerate && active.startsWith('item-') && content.filter(i => contentKindEditable(i.kind)).length > 1 && (
        <RegenerateAll
          count={content.filter(i => contentKindEditable(i.kind)).length}
          disabled={d.held}
          regenerating={d.regenerating}
          onRegenerate={instruction => void regenerate(instruction)}
        />
      )}

      {/* The case and the citations, under what they are about. Off the tab
          strip (above), on the page: a recommendation whose evidence needs a
          tab click is a claim you have to take on trust, and this shell
          builds both from the run precisely so no card can ship without
          them. A card with nothing to review — a CRM update, a proposal —
          has an empty strip and these are the whole screen, which is why
          they render here rather than in a tab that would be the only one. */}
      <div data-testid="review-dossier">
        {renderPane('why')}
        {renderPane('evidence')}
      </div>
    </DetailPage>
  );
}
