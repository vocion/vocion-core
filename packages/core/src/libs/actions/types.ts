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
};

/**
 * The structured review card — the ONE definition of how a pending proposal
 * of this action reads in the review queue. Fields render as labeled rows in
 * the card's description area (with optional deep links into the source
 * system); `summary` is the work in plain language; `nextAction` says what
 * approving does. Actions without one fall back to the generic card.
 */
export type ReviewCard = {
  /** Plain-language "what am I approving", e.g. `Discovery call detected: Acme <> Metacto intro`. */
  title: string;
  /** System badge, e.g. `Discovery` / `Gmail`. */
  system?: string;
  /** Labeled rows, in display order. `href` deep-links into the source system. */
  fields: Array<{ label: string; value: string; href?: string }>;
  /** Summary of the work behind the proposal. */
  summary?: string;
  /** Recommended next action — what approving does. */
  nextAction?: string;
};

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
  /** Do the write. Returns a result object persisted on the action_run. */
  execute: (ctx: ActionContext, input: z.infer<S>) => Promise<Record<string, unknown>>;
};
