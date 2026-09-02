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
  /** Who/what the item is about, e.g. the lead: name / role / company, deep-linked. */
  subject?: { name: string; role?: string; company?: string; href?: string };
  /** Where the item came from: source, campaign, MQL date. Labeled, no links. */
  provenance?: Array<{ label: string; value: string }>;
  /** The recommended action, front and center. `ref` names the thing approving acts on (e.g. the existing sequence it enrolls into). */
  recommendation?: { headline: string; detail?: string; ref?: string };
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
    subject?: string;
    body: string;
  }
  | {
    kind: 'document';
    id: string;
    /** e.g. `Proposal v3 · 12 pages`. */
    label: string;
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
    /** Image URL — in-app (`/api/v1/s3/object?…`) or absolute. */
    url: string;
    caption?: string;
    /** Short finding lines rendered under the image. */
    findings?: string[];
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
  /** Which source's vault credentials this action needs (e.g. `gmail`). */
  sourceSlug?: string;
  /**
   * Canonical dedup key derived from the input. Applied when the proposer
   * passes none, so structurally-identical proposals collapse into one PENDING
   * queue item however the proposal was made (job, agent tool, API).
   */
  dedupKeyFor?: (input: z.infer<S>) => string;
  /**
   * Called once per created action_run, right after the row exists (pending or
   * about to execute). For back-linking the run onto the domain record it
   * reviews (e.g. discovery_candidate.reviewActionRunId). Must be idempotent.
   */
  onProposed?: (ctx: ActionContext, input: z.infer<S>, runId: number) => Promise<void>;
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
  /** Do the write. Returns a result object persisted on the action_run. */
  execute: (ctx: ActionContext, input: z.infer<S>) => Promise<Record<string, unknown>>;
};
