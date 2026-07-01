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
  /** Do the write. Returns a result object persisted on the action_run. */
  execute: (ctx: ActionContext, input: z.infer<S>) => Promise<Record<string, unknown>>;
};
