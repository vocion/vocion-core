/**
 * Action framework — connector-*writes*, the mutation counterpart to the
 * read-only source connectors.
 *
 * A connector yields documents in (discovery); an **action** changes the
 * outside world (mutation): send an email, update a CRM record, create a task.
 * Actions are narrow and declarative — they declare the authz grant they need,
 * whether they're `external` (so the autonomy gate can require approval), and
 * which source's vault credentials to run with. `ActionService` handles the
 * gating (authz → review queue → execute-on-approval); the action just does
 * the write.
 */

import type { z } from 'zod';

export type ActionContext = {
  orgId: string;
  /** Decrypted credentials for `action.sourceSlug`, resolved from the vault. */
  credentials?: Record<string, unknown>;
  /** `agent:<slug>` / `token:<id>` / user id — for provider audit fields. */
  invokedBy?: string;
  /** The human who decided the run, when it came through the review queue. */
  reviewedBy?: string;
  /**
   * The `action_run` being executed. Present on `execute` only — actions that
   * keep a domain row per run need it to find that row again on approval.
   */
  runId?: number;
  /**
   * The record the approving caller created in its own system, handed over in
   * the same decide call. Lets an action link its domain row to a downstream
   * record without core ever calling that system.
   */
  externalRef?: { system: string; id: string };
};

/**
 * The structured review card — the ONE definition of how a pending proposal
 * of this action reads, on every surface that renders it (the review queue
 * and any domain console deciding the same run). Fields render as labeled
 * rows; `summary` is the work in plain language; `nextAction` says what
 * approving does. Actions without one fall back to the generic card.
 *
 * v2 widens the card into a template any object type reuses: a subject block,
 * provenance rows, a recommendation, a typed content zone (renderer per
 * `ReviewContent.kind`), deep links, and per-object verbs. Every v2 field is
 * optional so v1 cards render unchanged. Confidence and the lane status are
 * NOT here on purpose: the card shell renders them from the run itself
 * (`action_run.proposal.confidence` + `action_run.status`), so no object type
 * can omit them.
 */
export type ReviewCard = {
  /** Plain-language "what am I approving", e.g. `Discovery call detected: Acme <> Metacto intro`. */
  title: string;
  /** System badge, e.g. `Discovery` / `Gmail`. */
  system?: string;
  /**
   * The thing this decision is ABOUT, named for a human. Set it when the
   * record has a name of its own and the generated "<action> — <subject>"
   * title would put an internal identifier where the page's name belongs
   * (`docs/specs/discovery-ledger-v2.md`): the H1 becomes `title`, the line
   * under it `subtitle`, and the middle breadcrumb `section`.
   */
  object?: { title: string; subtitle?: string; section?: string };
  /**
   * What the proposal's confidence is IN, for the meter beside it —
   * "Not discovery", "Enrollment fit". Defaults to "Recommendation"; a score
   * is never drawn without one.
   */
  confidenceSubject?: string;
  /**
   * ONE plain sentence saying what approving does, for the decision header
   * the shell draws above the tabs — "Register stampsend.com in Route 53 for
   * the Stamp rename." Setting it is what opts a card into that header: the
   * sentence, the `badges` beside it, and the recommendation said once as an
   * inline line under them, so Run details need not repeat who recommended
   * it, how sure they were, or what they suggest. Chris, 2026-09-20, on the
   * first hand-off read from a phone: simpler and clearer.
   */
  headline?: string;
  /**
   * The facts a person checks before reading further, as short chips beside
   * the headline: the system, whether it can be undone, what it costs, which
   * account it touches. `warn` is for the one that should stop a thumb —
   * Irreversible. Rendered only with a `headline`.
   */
  badges?: Array<{ label: string; tone?: 'default' | 'warn' }>;
  /**
   * Set by the hand-off presenter (`libs/actions/manual.ts`): the run is
   * approved here and DONE elsewhere, by a person. The shell reads it to draw
   * the lifecycle — Approve → a person runs the steps → Mark done — and to say
   * who runs it; the verbs and the states themselves come from the run.
   */
  handoff?: { reversible: boolean };
  /** Who/what the item is about, e.g. the lead: name / role / company, deep-linked. */
  subject?: { name: string; role?: string; company?: string; href?: string };
  /** Where the item came from: source, campaign, MQL date. Labeled, no links. */
  provenance?: Array<{ label: string; value: string }>;
  /** The recommended action, front and center. `ref` names the thing approving acts on (e.g. the existing sequence it enrolls into). */
  recommendation?: { headline: string; detail?: string; ref?: string };
  /**
   * What the recommendation IS, as the meta row's label over it — "Sequence to
   * enroll", "Record to update". Defaults to "Recommended action", so a
   * presenter that says nothing still reads.
   */
  recommendationLabel?: string;
  /** Heading over the content zone, e.g. `Outreach · 3 sends` / `9 days`. */
  contentHeading?: { label: string; meta?: string };
  /** Typed payload the reviewer decides ON — rendered by the registered renderer for each item's `kind`. */
  content?: ReviewContent[];
  /** Labeled rows, in display order. `href` deep-links into the source system. */
  fields: Array<{ label: string; value: string; href?: string }>;
  /** Evidence links, e.g. `View Research` into the domain console. */
  links?: Array<{ label: string; href: string }>;
  /** Per-object verb labels, e.g. approve `Enroll`, reject `Decline`. */
  verbs?: { approve?: string; reject?: string };
  /** Summary of the work behind the proposal. */
  summary?: string;
  /** Recommended next action — what approving does. */
  nextAction?: string;
  /**
   * Whether the card offers Regenerate. Stamped by the SERVER from the
   * action's declared `regenerate` capability at card-build time — never set
   * by a presenter, so no object type can claim a capability its action does
   * not implement.
   */
  canRegenerate?: boolean;
};

/**
 * A typed content item on a review card. Kinds register renderers the way
 * actions register presenters (`features/review/contentKinds.tsx`); adding a
 * kind never touches the card shell. `email` reviews inline and is editable
 * (edit-then-approve, mapped back via `Action.applyContentEdits`); `document`
 * renders as summary + preview + open-side-by-side with a version stamp so
 * nobody decides on a stale render.
 */
export type ReviewContent
  = | {
    kind: 'email';
    /** Stable id the shell reports edits against, e.g. `send-1`. */
    id: string;
    /** e.g. `Day 0`, numbered by position. */
    label: string;
    /** What the item's tab is called, when `label` is not what a tab should read. */
    tabLabel?: string;
    subject?: string;
    body: string;
  }
  | {
    kind: 'document';
    id: string;
    /** e.g. `Proposal v3 · 12 pages`. */
    label: string;
    /** What the item's tab is called, when `label` is not what a tab should read. */
    tabLabel?: string;
    href: string;
    format?: 'pdf';
    version?: string;
    summary?: string;
    /** Inline preview; `href` opens side-by-side. */
    previewHref?: string;
  }
  | {
    kind: 'image';
    id: string;
    label: string;
    /** What the item's tab is called, when `label` is not what a tab should read. */
    tabLabel?: string;
    /** Image URL — in-app (`/api/v1/s3/object?…`) or absolute. */
    url: string;
    caption?: string;
    /** Short finding lines rendered under the image. */
    findings?: string[];
  }
  | {
    /**
     * A block of text the reviewer reads as written — a recipe of commands,
     * a release note, a config excerpt. Read-only: nothing here is copy a
     * person vouches for line by line, so it never joins the walk.
     */
    kind: 'text';
    id: string;
    label: string;
    /** What the item's tab is called, when `label` is not what a tab should read. */
    tabLabel?: string;
    body: string;
    /** Render in a monospace block with whitespace kept — commands, YAML, a diff. */
    preformatted?: boolean;
  }
  | {
    /**
     * Numbered steps a person performs — the structured recipe of a hand-off.
     * Each step says what to do in words; the command, when there is one, sits
     * in its own monospace block with a copy button, and a link opens where
     * the step happens. Read-only, like `text`: it never joins the walk.
     */
    kind: 'steps';
    id: string;
    label: string;
    /** What the item's tab is called, when `label` is not what a tab should read. */
    tabLabel?: string;
    steps: Array<{ say: string; run?: string; url?: string }>;
  };

/**
 * What a regenerate pass is scoped to.
 *
 * `contentId` is the id of the single `ReviewContent` item the reviewer typed
 * their instruction beside (`send-3`). Absent on a card with one body, which
 * is every non-sequence action.
 */
export type RegenerateOptions = {
  contentId?: string;
};

/** One reviewer edit to a content item, keyed by the item's `id`. */
export type ReviewContentEdit = { id: string; subject?: string; body?: string };

export type Action<S extends z.ZodType = z.ZodType> = {
  /** Stable id, e.g. `gmail.send`. */
  id: string;
  name: string;
  description: string;
  /** Validates the action input at propose-time. */
  inputSchema: S;
  /** authz action grant required to run it, e.g. `send_email`. */
  grant: string;
  /** Touches the outside world → the autonomy gate can require approval. */
  external: boolean;
  /**
   * This kind changes what the SYSTEM knows about how to work — a rule it
   * adopts from a correction, a standing preference it files — rather than
   * the outside world or a customer's record.
   *
   * Declaring it puts the kind on the workspace's learning dial
   * (`defaults.learningEagerness`, `libs/actions/eagerness.ts`): its default
   * bar comes from how eager this workspace is to improve itself, instead of
   * the platform's flat 0.8. A named threshold on a trust rule still wins.
   *
   * The class, not a special case: anything reversible whose only effect is
   * on the system's own knowledge belongs here, and the next such noun costs
   * this one line.
   */
  selfImproving?: boolean;
  /** Which source's vault credentials this action needs (e.g. `gmail`). */
  sourceSlug?: string;
  /**
   * A HAND-OFF: the execution is performed by a person or an external system
   * after approval, never in this process. Approving one does not call
   * `execute`; the run moves to `awaiting_execution` and stays on the queue
   * until whoever did the work marks it done (`ActionService.completeAction`)
   * or says it could not be done (a rejection). The trail — recommendation,
   * decision, execution — lands on the same `action_run` every other kind
   * writes, so a merge a person performed reads back beside a CRM update an
   * agent performed.
   *
   * `reversible` is what "can be put back" means for a kind with no `undo`
   * to declare: a pushed branch is deleted with one command, a deploy is
   * not. It informs the ladder's default the way `undo` does for in-process
   * kinds; it does not put an Undo button on the run.
   *
   * Build one with `libs/actions/manual.ts`, which owns the shared input
   * shape (title, headline, summary, steps or recipe, cost, target, sources,
   * evidence, externalRef) and the card.
   */
  manual?: { reversible?: boolean };
  /**
   * The id the trust ladder keys on for THIS input, when one action id serves
   * several ledgers. A merge is one action with a `riskClass`, and merging
   * docs is not the decision merging a schema is — so the rule, the risk tier
   * and the evidence live under `git.merge.<riskClass>` while the proposal
   * still names `git.merge`. Absent, the action id is the key. Must return a
   * stable string for the same input; `libs/actions/policyKey.ts` applies it.
   */
  policyKeyFor?: (input: z.infer<S>) => string;
  /**
   * Whether a rule on THIS action's bare id governs a derived key that has
   * no rule of its own. Opt-in, because the two families want opposite
   * defaults: `git.merge` wants one rule ("a merge is a person's") to cover
   * every risk class until a class earns its own, while `objects.update_meta`
   * wants each object type's ledger to stand alone, so a bare rule binds to
   * nothing there (2026-09-24).
   */
  parentRuleGoverns?: boolean;
  /**
   * Canonical dedup key derived from the input. Applied when the proposer
   * passes none, so structurally-identical proposals collapse into one PENDING
   * queue item however the proposal was made (job, agent tool, API).
   *
   * Return `undefined` when THIS input carries nothing that identifies it —
   * every such proposal then stands as its own queue item. Never return a
   * constant for that case: a shared key would collapse unrelated proposals
   * into one, and the reviewer would only ever see the last one to arrive.
   */
  dedupKeyFor?: (input: z.infer<S>) => string | undefined;
  /**
   * Collapse a repeat proposal into an already-DECIDED run as well as a
   * pending one. Off unless the action sets it, because for most actions the
   * dedup key names a target rather than a one-off record: `gmail.send` keys
   * on the recipient, so blocking decided runs there would bar that address
   * for good after a single send.
   *
   * Set it on actions where the key names a specific record a person judged
   * once — an extracted candidate, a detected event. Those are re-extracted
   * every time their page is read, and without this each pass hands the
   * moderator back everything they already approved or rejected.
   *
   * `statuses` are the decided statuses that block a fresh card (default
   * `done` and `rejected`; an action that wants a rejection re-proposable
   * sets `['done']`). `reproposeAfterDays` lets a decision go stale, so the
   * same record may be offered again once the decision is that old; omit it
   * and a decision stands for good.
   *
   * What happens when a record comes back CHANGED depends on which fields
   * changed, and it is worth knowing before turning this on:
   *
   * - An identity field changed (whatever `dedupKeyFor` reads — for a
   *   candidate, its `dedupOn` fields). That is a different key, so it is a
   *   different record: a new card. An event moved to another night reads as
   *   new, which is the intent.
   * - Any other field changed, card still pending: the pending row is
   *   refreshed in place and `onProposed` runs again, so the reviewer decides
   *   on the new payload. One card, no duplicate.
   * - Any other field changed, record already decided: the proposal is
   *   blocked and **the change is dropped**. A price that moved on an event
   *   someone already approved does not reach them, and no row records that
   *   it was seen. That is the deliberate trade for a queue that does not
   *   refill; an action that needs those late edits should either narrow
   *   `statuses`, set `reproposeAfterDays`, or handle the update itself
   *   rather than through the review queue.
   *
   * This is a source constant on the action, the same for every org — there
   * is no workspace YAML or per-tenant override behind it. Changing it for
   * one client means changing it here, for all of them.
   */
  dedupAgainstDecided?: {
    statuses?: Array<'done' | 'failed' | 'rejected'>;
    reproposeAfterDays?: number;
    /**
     * Whether THIS input's key identifies one record well enough to answer
     * for it. Return false and the decided-run block is skipped: the record
     * still reaches a human, the way it did before this option existed.
     *
     * For a candidate, the key is built even when the extractor found
     * nothing for a `dedupOn` field — the missing value leaves an empty
     * slot, so two different records can carry one key. Blocking on a
     * decision then answers for a record nobody ever saw. Omit this and
     * every key is trusted.
     */
    keyIsTrustworthy?: (input: z.infer<S>) => boolean;
  };
  /**
   * Last check before anything is written, once the caller is known to be
   * allowed. For conditions the input schema cannot see because they depend
   * on tenant state — an object type the org never defined, a source with no
   * credentials. Return a plain-language reason to refuse the proposal, or
   * nothing to let it through.
   *
   * Refusing here leaves no queue item behind. That matters: an action whose
   * `onProposed` quietly gives up still reports success to its caller, and an
   * agent told "queued for approval" will say so to a person, having stored
   * nothing.
   */
  precheck?: (ctx: ActionContext, input: z.infer<S>) => Promise<string | void>;
  /**
   * Fields a refinement requires that the shape marks optional — so the
   * input hints a model reads (`actionInputHints`) can mark them required.
   * `objects.propose_candidate` requires `dedupOn` this way (2026-09-25:
   * the last refusal standing on walk 17).
   */
  inputRequired?: readonly string[];
  /**
   * Called once per created action_run, right after the row exists (pending or
   * about to execute). For back-linking the run onto the domain record it
   * reviews (e.g. discovery_candidate.reviewActionRunId). Must be idempotent.
   */
  onProposed?: (ctx: ActionContext, input: z.infer<S>, runId: number) => Promise<void>;
  /**
   * What an open run stores when it is proposed again with the same dedup key.
   * Absent, the new input and proposal replace the stored ones whole. For an
   * action whose re-proposals can come from a less complete source than the
   * one that wrote the run. The regeneration stamps and the decision fields
   * are cleared either way, so a run whose hook kept its payload still reads
   * as refreshed.
   * @param previous - The open run's stored input and proposal.
   * @param previous.input - The stored input, as read back from the row.
   * @param previous.proposal - The stored proposal, or null.
   * @param next - The new proposal: its parsed input and its proposal in stored shape.
   * @param next.input - The parsed input.
   * @param next.proposal - The proposal as it would be stored, or null.
   */
  refresh?: (
    previous: { input: Record<string, unknown>; proposal: Record<string, unknown> | null },
    next: { input: z.infer<S>; proposal: Record<string, unknown> | null },
  ) => { input: Record<string, unknown>; proposal: Record<string, unknown> | null };
  /**
   * Build the structured review card for a pending run of this action.
   * Runs server-side at queue-list time, so it may resolve fresh context
   * (record labels, deep links) from the input. Must tolerate missing data —
   * return what resolves. Errors fall back to the generic card.
   */
  reviewCard?: (ctx: ActionContext, input: z.infer<S>) => Promise<ReviewCard>;
  /**
   * Map reviewer edits to this card's content items back onto the action
   * input (edit-then-approve for typed content). The result is re-validated
   * against `inputSchema` before it is persisted, same as any edited input.
   * Required for any action whose card carries editable content.
   */
  applyContentEdits?: (input: z.infer<S>, edits: ReviewContentEdit[]) => z.infer<S>;
  /**
   * Called when a pending run of this action is rejected — for flipping the
   * domain record's lane (e.g. lead_brief → held). Must be idempotent.
   */
  onRejected?: (ctx: ActionContext, input: z.infer<S>, runId: number, reason?: string) => Promise<void>;
  /**
   * Re-run the work behind a pending run, guided by the reviewer's feedback.
   * The action owns what "regenerate" means for its domain (e.g. send the
   * lead's brief back to be researched and drafted again), the same way
   * `applyContentEdits` owns its input mapping. The run itself stays pending:
   * the next pass updates the same queue item through the dedup key, so the
   * reviewer meets the regenerated version, never a duplicate. Declaring this
   * is what puts the Regenerate button on the card (`ReviewCard.canRegenerate`).
   */
  regenerate?: (ctx: ActionContext, input: z.infer<S>, runId: number, feedback: string, opts?: RegenerateOptions) => Promise<void>;
  /** Do the write. Returns a result object persisted on the action_run. */
  execute: (ctx: ActionContext, input: z.infer<S>) => Promise<Record<string, unknown>>;
  /**
   * Put the write back, given what `execute` returned. Declaring this is what
   * makes a kind REVERSIBLE, and reversible is what lets it run on its own by
   * default (`libs/actions/autoAccept.ts`): done for you, with Undo one move
   * away. `execute` has to record whatever undo needs — the previous values,
   * the created id — in its result. Return what undo did, for the run.
   */
  undo?: (ctx: ActionContext, input: z.infer<S>, result: Record<string, unknown>) => Promise<Record<string, unknown> | void>;
};
