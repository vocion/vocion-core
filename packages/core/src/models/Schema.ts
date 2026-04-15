import { relations } from 'drizzle-orm';
import { bigint, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// This file defines the structure of your database tables using the Drizzle ORM.

// To modify the database schema:
// 1. Update this file with your desired changes.
// 2. Generate a new migration by running: `npm run db:generate`

// The generated migration file will reflect your schema changes.
// It automatically run the command `db-server:file`, which apply the migration before Next.js starts in development mode,
// Alternatively, if your database is running, you can run `npm run db:migrate` and there is no need to restart the server.

export const organizationSchema = pgTable(
  'organization',
  {
    id: text('id').primaryKey(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionPriceId: text('stripe_subscription_price_id'),
    stripeSubscriptionStatus: text('stripe_subscription_status'),
    stripeSubscriptionCurrentPeriodEnd: bigint(
      'stripe_subscription_current_period_end',
      { mode: 'number' },
    ),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('stripe_customer_id_idx').on(table.stripeCustomerId),
  ],
);

export const todoSchema = pgTable('todo', {
  id: serial('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Business Objects — the context engineering layer                    */
/* ------------------------------------------------------------------ */

/** Registry of object type definitions per org (e.g. Discovery Call, Deal, Account) */
export const businessObjectTypeSchema = pgTable(
  'business_object_type',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    icon: text('icon'),
    /** JSON Schema describing the shape of `metadata` on instances of this type */
    schema: jsonb('schema').$type<Record<string, unknown>>(),
    /** Source relevance weights — which connectors matter most for this object type */
    sourceRelevance: jsonb('source_relevance').$type<Record<string, number>>(),
    /** Few-shot examples for classification of this object type */
    fewShotExamples: jsonb('few_shot_examples').$type<Array<{
      input: string;
      output: string;
      label?: string;
    }>>(),
    /** Classification prompt — how to identify this object type from raw documents */
    classificationPrompt: text('classification_prompt'),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('business_object_type_org_slug_idx').on(table.orgId, table.slug),
  ],
);

/** Individual business object instances */
export const businessObjectSchema = pgTable('business_object', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  typeId: integer('type_id').notNull().references(() => businessObjectTypeSchema.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').default('active'),
  /** Type-specific structured data (e.g. prospect_company, deal_stage, budget) */
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  /** LLM-generated summary combining linked documents */
  summary: text('summary'),
  summaryGeneratedAt: timestamp('summary_generated_at', { mode: 'date' }),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

/** Links a business object to one or more Onyx documents */
export const objectDocumentLinkSchema = pgTable(
  'object_document_link',
  {
    id: serial('id').primaryKey(),
    objectId: integer('object_id').notNull().references(() => businessObjectSchema.id, { onDelete: 'cascade' }),
    /** Onyx document_id (e.g. zoom_meeting_12345, slack_msg_abc) */
    onyxDocumentId: text('onyx_document_id').notNull(),
    /** Source system: zoom, gmail, hubspot, google_drive, slack, etc. */
    sourceType: text('source_type').notNull(),
    /** Copied from Onyx for display without re-fetching */
    semanticIdentifier: text('semantic_identifier'),
    /** External URL to the source document */
    link: text('link'),
    /** Document's role in this object: transcript, recording, booking, contact, deal, email_thread, follow_up */
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('object_document_link_unique_idx').on(table.objectId, table.onyxDocumentId),
  ],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const businessObjectTypeRelations = relations(businessObjectTypeSchema, ({ many }) => ({
  objects: many(businessObjectSchema),
}));

export const businessObjectRelations = relations(businessObjectSchema, ({ one, many }) => ({
  type: one(businessObjectTypeSchema, {
    fields: [businessObjectSchema.typeId],
    references: [businessObjectTypeSchema.id],
  }),
  documentLinks: many(objectDocumentLinkSchema),
}));

export const objectDocumentLinkRelations = relations(objectDocumentLinkSchema, ({ one }) => ({
  object: one(businessObjectSchema, {
    fields: [objectDocumentLinkSchema.objectId],
    references: [businessObjectSchema.id],
  }),
}));

/* ------------------------------------------------------------------ */
/* Skills — configurable LLM-powered capabilities                     */
/* ------------------------------------------------------------------ */

/** Skill definitions: prompt template, input/output schema, versioning */
export const skillSchema = pgTable(
  'skill',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** The system/user prompt template. Supports {{variable}} interpolation. */
    promptTemplate: text('prompt_template').notNull(),
    /** JSON Schema describing expected input variables */
    inputSchema: jsonb('input_schema').$type<Record<string, unknown>>(),
    /** LLM model to use (e.g. gpt-4o, claude-sonnet-4-20250514) */
    model: text('model').default('gpt-4o'),
    /** Temperature for generation */
    temperature: text('temperature').default('0.3'),
    /** Whether output requires human approval before acting */
    requiresApproval: text('requires_approval').default('true'),
    /** Skill category: query, mutation, composite */
    category: text('category').default('query'),
    /** Status: active, disabled, draft */
    status: text('status').default('active'),
    version: integer('version').default(1),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('skill_org_slug_idx').on(table.orgId, table.slug),
  ],
);

/** Skill execution runs with Langfuse trace IDs */
export const skillRunSchema = pgTable('skill_run', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  skillId: integer('skill_id').notNull().references(() => skillSchema.id, { onDelete: 'cascade' }),
  /** Input variables provided to the prompt */
  input: jsonb('input').$type<Record<string, unknown>>().default({}),
  /** LLM-generated output */
  output: text('output'),
  /** Approval status: pending, approved, rejected, auto */
  status: text('status').default('pending'),
  /** Langfuse trace ID for observability */
  langfuseTraceId: text('langfuse_trace_id'),
  /** Context version SHA active when this run executed — links to context_version.sha */
  contextSha: text('context_sha'),
  /** Who ran it */
  createdBy: text('created_by'),
  /** Who approved/rejected it */
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { mode: 'date' }),
  /** Optional thumb up/down captured alongside approve/reject or later. */
  rating: text('rating'),
  /** Free-form note from the reviewer explaining the rating. */
  feedbackNote: text('feedback_note'),
  feedbackBy: text('feedback_by'),
  feedbackAt: timestamp('feedback_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const skillRelations = relations(skillSchema, ({ many }) => ({
  runs: many(skillRunSchema),
}));

export const skillRunRelations = relations(skillRunSchema, ({ one }) => ({
  skill: one(skillSchema, {
    fields: [skillRunSchema.skillId],
    references: [skillSchema.id],
  }),
}));

/* ------------------------------------------------------------------ */
/* Agents — packaged persona + scope + capabilities                   */
/* ------------------------------------------------------------------ */

/** Agent definitions: system prompt, model config, scoped skills/connectors/objects */
export const agentSchema = pgTable(
  'agent',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** The agent's system prompt — identity, tone, rules, boundaries */
    systemPrompt: text('system_prompt').notNull(),
    /** LLM model (e.g. claude-sonnet-4-20250514, gpt-4o) */
    model: text('model').default('gpt-4o'),
    temperature: text('temperature').default('0.3'),
    /** Skill slugs this agent can invoke */
    skillSlugs: jsonb('skill_slugs').$type<string[]>().default([]),
    /** Onyx source_type values this agent can search (e.g. ["zoom","hubspot","gmail"]) */
    connectorSources: jsonb('connector_sources').$type<string[]>().default([]),
    /** Business object type slugs this agent can read/create */
    objectTypeSlugs: jsonb('object_type_slugs').$type<string[]>().default([]),
    /** Onyx document set IDs for corpus scoping (empty = all) */
    documentSetIds: jsonb('document_set_ids').$type<number[]>().default([]),
    /** JSONB rules for what requires HITL approval */
    approvalPolicy: jsonb('approval_policy').$type<Record<string, unknown>>().default({}),
    /** Search tuning: recency decay, source weights, result limits */
    searchConfig: jsonb('search_config').$type<{
      recencyDecay?: number;
      sourceWeights?: Record<string, number>;
      maxResults?: number;
      minRelevance?: number;
    }>().default({}),
    /** Few-shot examples for response quality and search strategy */
    fewShotExamples: jsonb('few_shot_examples').$type<Array<{
      input: string;
      output: string;
      label?: string;
    }>>().default([]),
    /** Langfuse project ID for observability */
    langfuseProjectId: text('langfuse_project_id'),
    /** Icon name (lucide) */
    icon: text('icon'),
    /** Whether this agent is active */
    active: text('active').default('true'),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('agent_org_slug_idx').on(table.orgId, table.slug),
  ],
);

/* ------------------------------------------------------------------ */
/* Workflows — orchestrations that compose skills + HITL + actions    */
/* ------------------------------------------------------------------ */

/** Workflow definitions — trigger + ordered steps. */
export const workflowSchema = pgTable(
  'workflow',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Semver, advanced manually. */
    version: integer('version').default(1),
    /** `active` | `disabled` | `draft` */
    status: text('status').default('active'),
    /**
     * Trigger config — JSONB since the shape differs per trigger type.
     * Shapes: { type: 'manual' } | { type: 'event', event: 'object.created', filter?: {...} } | (future) schedule/webhook.
     */
    trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull(),
    /**
     * Array of step definitions. Each: { name, type, ...typeSpecific }.
     * Step types: `skill` (run a skill), `approve` (HITL gate), `action` (connector action, v1 stubbed).
     */
    steps: jsonb('steps').$type<Array<Record<string, unknown>>>().notNull(),
    /** Default input schema for manual triggers — JSON Schema. */
    inputSchema: jsonb('input_schema').$type<Record<string, unknown>>(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('workflow_org_slug_idx').on(table.orgId, table.slug),
  ],
);

/** Workflow execution instances. */
export const workflowRunSchema = pgTable('workflow_run', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  workflowId: integer('workflow_id').notNull().references(() => workflowSchema.id, { onDelete: 'cascade' }),
  /** Initial input provided at start (from the trigger). */
  input: jsonb('input').$type<Record<string, unknown>>().default({}),
  /** Context around what caused this run (event payload, trigger metadata). */
  triggerContext: jsonb('trigger_context').$type<Record<string, unknown>>().default({}),
  /** `running` | `paused` | `completed` | `failed` | `cancelled` */
  status: text('status').default('running').notNull(),
  /**
   * Step-indexed results — { [step_name]: { status, output, startedAt, finishedAt, error?, skillRunId? } }.
   * JSONB so we can write partial state as we go; promoted to normalized rows in v2 if needed.
   */
  stepResults: jsonb('step_results').$type<Record<string, {
    status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval';
    output?: unknown;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
    skillRunId?: number;
  }>>().default({}),
  /** Index of the current step (0-based). Null when completed/failed. */
  currentStep: integer('current_step').default(0),
  /** When paused, why — e.g. `awaiting_approval:step_name`. */
  pauseReason: text('pause_reason'),
  /** Set when pause happens, cleared on resume. */
  pausedAt: timestamp('paused_at', { mode: 'date' }),
  /** Error message if status=failed. */
  error: text('error'),
  /** Context SHA active when the run started — stamped for audit. */
  contextSha: text('context_sha'),
  createdBy: text('created_by'),
  /** Post-hoc feedback — thumb up/down + optional note. */
  rating: text('rating'),
  feedbackNote: text('feedback_note'),
  feedbackBy: text('feedback_by'),
  feedbackAt: timestamp('feedback_at', { mode: 'date' }),
  completedAt: timestamp('completed_at', { mode: 'date' }),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const workflowRelations = relations(workflowSchema, ({ many }) => ({
  runs: many(workflowRunSchema),
}));

export const workflowRunRelations = relations(workflowRunSchema, ({ one }) => ({
  workflow: one(workflowSchema, {
    fields: [workflowRunSchema.workflowId],
    references: [workflowSchema.id],
  }),
}));

/* ------------------------------------------------------------------ */
/* Context Versioning — git-backed context-as-code audit trail        */
/* ------------------------------------------------------------------ */

/** Audit record for each `context:apply` — ties skill_run history to a specific context SHA. */
export const contextVersionSchema = pgTable(
  'context_version',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** git SHA of the context directory (or computed hash when not in a git repo) */
    sha: text('sha').notNull(),
    /** Absolute or repo-relative path applied from */
    sourcePath: text('source_path'),
    /** apply | failed */
    status: text('status').default('applied').notNull(),
    /** Per-resource counts: { agents: {created, updated, unchanged}, skills: {...}, objectTypes: {...} } */
    summary: jsonb('summary').$type<Record<string, Record<string, number>>>().default({}),
    /** Any non-fatal errors surfaced during apply */
    errors: jsonb('errors').$type<Array<{ resource: string; slug: string; message: string }>>().default([]),
    /** User ID who triggered the apply (or 'system' for automated) */
    appliedBy: text('applied_by'),
    appliedAt: timestamp('applied_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('context_version_org_applied_idx').on(table.orgId, table.appliedAt),
  ],
);
