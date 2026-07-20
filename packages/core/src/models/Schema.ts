import { relations, sql } from 'drizzle-orm';
import { bigint, customType, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex, vector } from 'drizzle-orm/pg-core';

/**
 * Postgres `tsvector` column type. Drizzle doesn't ship one out of the
 * box, so we declare it via customType. Stored as text in the DB
 * (Postgres handles the cast at the column level via GENERATED ALWAYS
 * AS).
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

// This file defines the structure of your database tables using the Drizzle ORM.

// To modify the database schema:
// 1. Update this file with your desired changes.
// 2. Generate a new migration by running: `npm run db:generate`

// The generated migration file will reflect your schema changes.
// It automatically run the command `db-server:file`, which apply the migration before Next.js starts in development mode,
// Alternatively, if your database is running, you can run `npm run db:migrate` and there is no need to restart the server.

/* ==================================================================== */
/* Phase 1 — Auth + Tenancy                                              */
/*                                                                       */
/* Local auth.js-backed users + a tenancy model of:                      */
/*   tenant_account  →  project  →  business content (skills, agents…)   */
/*   account_membership joins users ↔ tenant_account with a role         */
/*                                                                       */
/* Self-hosted ("team mode"): exactly 1 tenant_account row, N projects,  */
/* M users invited into the account. Constraint enforced in code, not    */
/* schema, so vocion-cloud can use the same schema for multi-account.    */
/*                                                                       */
/* Names:                                                                */
/*   - `user`, `auth_account`, `session`, `verification_token` follow    */
/*     auth.js / @auth/drizzle-adapter conventions (don't rename).       */
/*   - `tenant_account` is our domain "account" (renamed to avoid clash  */
/*     with auth.js's OAuth-link `account` concept).                     */
/*   - `project` replaces today's `orgId` scope on business content.     */
/*     Columns are added in a follow-up migration after callers migrate. */
/* ==================================================================== */

/** A person. Drizzle adapter shape for auth.js v5. */
export const userSchema = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  /** bcrypt hash for the Credentials provider. NULL for OAuth-only users. */
  passwordHash: text('password_hash'),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

/**
 * auth.js OAuth-link table. Keeps the auth.js field-name conventions
 *  (snake_case in the DB but matching the JS field names exactly so
 *  the @auth/drizzle-adapter can introspect it).
 */
export const authAccountSchema = pgTable(
  'auth_account',
  {
    userId: text('user_id').notNull().references(() => userSchema.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  table => [
    uniqueIndex('auth_account_provider_idx').on(table.provider, table.providerAccountId),
    index('auth_account_user_idx').on(table.userId),
  ],
);

/** auth.js session table. */
export const sessionSchema = pgTable(
  'session',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: text('user_id').notNull().references(() => userSchema.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  table => [
    index('session_user_idx').on(table.userId),
  ],
);

/** auth.js verification-token table (magic links, email verification). */
export const verificationTokenSchema = pgTable(
  'verification_token',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  table => [
    uniqueIndex('verification_token_idx').on(table.identifier, table.token),
  ],
);

/**
 * A tenant account. Self-hosted: exactly 1 row. Cloud: N rows.
 *  Billing columns are populated in vocion-cloud only; null in self-hosted.
 */
export const tenantAccountSchema = pgTable(
  'tenant_account',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Cloud-only billing fields. Will be migrated out to vocion-cloud in Phase 5. */
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionPriceId: text('stripe_subscription_price_id'),
    stripeSubscriptionStatus: text('stripe_subscription_status'),
    stripeSubscriptionCurrentPeriodEnd: bigint('stripe_subscription_current_period_end', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('tenant_account_slug_idx').on(table.slug),
    uniqueIndex('tenant_account_stripe_customer_id_idx').on(table.stripeCustomerId),
  ],
);

/**
 * A workspace within a tenant account. Replaces today's `orgId` scope on
 *  business-content tables. Self-hosted: N projects per the single account.
 *  Cloud: N projects per each of M accounts.
 */
export const projectSchema = pgTable(
  'project',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => tenantAccountSchema.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /**
     * Workspace lead agent (F1) — slug of the agent that runs the whole
     * workspace and consults the team leads. Slug reference, no FK
     * (same convention as `agent.parentAgentSlug`). The workspace lead
     * is project CONFIG, not a special team row. Authored as top-level
     * `lead:` in workspace.yaml. NULL = no workspace lead configured.
     */
    leadAgentSlug: text('lead_agent_slug'),
    /**
     * Workspace-default accountable human (F1). Teams whose own
     * `accountableUserId` is NULL inherit this at read time. Authored
     * as top-level `accountableUser:` (an email) in workspace.yaml,
     * resolved to a user id at apply.
     */
    accountableUserId: text('accountable_user_id').references(() => userSchema.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('project_account_slug_idx').on(table.accountId, table.slug),
  ],
);

/** A user's role in a tenant account. */
export const accountMembershipSchema = pgTable(
  'account_membership',
  {
    accountId: text('account_id').notNull().references(() => tenantAccountSchema.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => userSchema.id, { onDelete: 'cascade' }),
    /** 'admin' | 'member'. Admins can invite + manage projects. */
    role: text('role').notNull(),
    /** Stamped on each credentials sign-in (JWT issue). */
    lastLoginAt: timestamp('last_login_at', { mode: 'date' }),
    /** Touched by the throttled activity heartbeat — dormancy is a one-column query. */
    lastActiveAt: timestamp('last_active_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('account_membership_idx').on(table.accountId, table.userId),
    index('account_membership_user_idx').on(table.userId),
  ],
);

/** One-time invite tokens for adding users to a tenant account. */
export const inviteSchema = pgTable(
  'invite',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => tenantAccountSchema.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    token: text('token').notNull().unique(),
    invitedBy: text('invited_by').references(() => userSchema.id),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('invite_account_email_idx').on(table.accountId, table.email),
  ],
);

/* ==================================================================== */
/* End of Phase 1 new tables. Existing schema continues below.           */
/* ==================================================================== */

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
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
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
  /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
  projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
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

/** Links a business object to one or more indexed source documents. */
export const objectDocumentLinkSchema = pgTable(
  'object_document_link',
  {
    id: serial('id').primaryKey(),
    objectId: integer('object_id').notNull().references(() => businessObjectSchema.id, { onDelete: 'cascade' }),
    /**
     * External document id from the source system (e.g. zoom_meeting_12345,
     * slack_msg_abc). Column name `onyx_document_id` is a v0.2 fossil pending
     * rename to `external_document_id` in v0.5.5.
     */
    onyxDocumentId: text('onyx_document_id').notNull(),
    /** Source system: zoom, gmail, hubspot, google_drive, slack, etc. */
    sourceType: text('source_type').notNull(),
    /** Copied from the source system for display without re-fetching. */
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
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** The system/user prompt template. Supports {{variable}} interpolation. */
    promptTemplate: text('prompt_template').notNull(),
    /**
     * Optional path to a postprocess script (e.g. `postprocess.js`)
     * stored in the skill's context folder. When set, the runtime imports
     * it after the prompt runs and calls `default(output, input, ctx)` to
     * transform the output before it lands in the review queue.
     */
    scriptFile: text('script_file'),
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
    /**
     * Kind of operation (v0.2). `operation` (default) is a typed
     * Zod-validated single LLM call or plugin invocation — what this
     * table has always represented. `playbook-ref` will be used in a
     * later phase if a playbook needs a DB-row mirror; today the
     * playbook table is the canonical store and this column is
     * future-proofing.
     */
    kind: text('kind').default('operation').notNull(),
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

/**
 * v0.2 — canonical TS alias. The underlying Postgres table stays `skill`
 *  (renaming risks data loss) but new code should reference this name.
 */
export const operationSchema = skillSchema;

/** Skill execution runs with Langfuse trace IDs */
export const skillRunSchema = pgTable('skill_run', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
  projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
  skillId: integer('skill_id').notNull().references(() => skillSchema.id, { onDelete: 'cascade' }),
  /** Input variables provided to the prompt */
  input: jsonb('input').$type<Record<string, unknown>>().default({}),
  /** LLM-generated output */
  output: text('output'),
  /** Approval status: pending, approved, rejected, auto */
  status: text('status').default('pending'),
  /** Langfuse trace ID for observability */
  langfuseTraceId: text('langfuse_trace_id'),
  /** Context version SHA active when this run executed — links to workspace_version.sha */
  workspaceSha: text('workspace_sha'),
  /** Who ran it */
  createdBy: text('created_by'),
  /** Who approved/rejected it */
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { mode: 'date' }),
  /**
   * Agent's self-assessment of output confidence — drives the
   * <ConfidenceIndicator /> in the UI. Nullable when the runtime
   * doesn't expose a signal. One of: 'confident' | 'uncertain' |
   * 'speculative'. See `types/Status.ts`.
   */
  confidence: text('confidence'),
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

/** v0.2 canonical alias — see {@link operationSchema}. */
export const operationRunSchema = skillRunSchema;

/* ------------------------------------------------------------------ */
/* Playbooks — markdown + YAML procedural guides for agents           */
/* ------------------------------------------------------------------ */

// A Playbook is content (markdown body) + metadata (YAML frontmatter
// validated by PlaybookManifestSchema). The body lives in
// workspace/<org>/playbooks/<slug>/SKILL.md plus arbitrary sibling
// resources. The DB row is a catalog entry so we can filter by tags
// (per-agent mount) and list in the UI without re-reading every file.

export const playbookSchema = pgTable(
  'playbook',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    /** Per-agent mount filter. Empty array = all agents see it. */
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),
    /** Full frontmatter snapshot (for catalog UI). */
    frontmatter: jsonb('frontmatter').$type<Record<string, unknown>>().default({}).notNull(),
    /** SHA-256 of the SKILL.md body (not the frontmatter). Used to detect file changes on re-apply. */
    contentSha: text('content_sha').notNull(),
    /** Paths of sibling resource files (REFERENCE.html, COMPONENTS.md, etc.) relative to the playbook folder. */
    sourceFiles: jsonb('source_files').$type<string[]>().default([]).notNull(),
    /** Optional license string. */
    license: text('license'),
    version: integer('version').default(1).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('playbook_org_slug_idx').on(table.orgId, table.slug),
  ],
);

/* ------------------------------------------------------------------ */
/* Agents — packaged persona + scope + capabilities                   */
/* ------------------------------------------------------------------ */

/** Agent definitions: system prompt, model config, scoped skills/connectors/objects */
export const agentSchema = pgTable(
  'agent',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
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
    /** Source slugs this agent can search (e.g. ["zoom","hubspot","gmail"]). Maps to knowledge_source.slug. */
    connectorSources: jsonb('connector_sources').$type<string[]>().default([]),
    /** Business object type slugs this agent can read/create */
    objectTypeSlugs: jsonb('object_type_slugs').$type<string[]>().default([]),
    /** Document set / corpus IDs for retrieval scoping (empty = all). v0.2 fossil; superseded by sourceSlugs filtering in RetrievalService. */
    documentSetIds: jsonb('document_set_ids').$type<number[]>().default([]),
    /** JSONB rules for what requires HITL approval */
    approvalPolicy: jsonb('approval_policy').$type<Record<string, unknown>>().default({}),
    /**
     * Harness config (v0.3) — per-agent knobs for the reusable agent
     * harness (services/agents/harness.ts). Authored as the `harness:`
     * block in workspace agent YAML. `interrupts` lists tool/operation
     * slugs that must pause for human approval (routed through the
     * existing hitl_gate machinery) before executing.
     */
    harnessConfig: jsonb('harness_config').$type<{
      /** Which harness executes this agent: 'local' (in-process deepagents loop, default), 'agentcore' (AWS AgentCore managed harness), or 'runtime' (BYOA agent-runtime artifact). */
      provider?: 'local' | 'agentcore' | 'runtime';
      interrupts?: string[];
      maxTokens?: number;
      /** Built-in tool names to withhold from this agent (e.g. propose_action for agents with no CRM writes). */
      excludeTools?: string[];
      /** agentcore provider only: Bedrock model id for the managed harness (defaults to the harness service default). */
      model?: string;
    }>().default({}).notNull(),
    /**
     * agentcore provider only: ARN of the provisioned AgentCore harness.
     * Written by workspace:apply when it creates/updates the harness;
     * read by the invoke adapter. NULL for local-provider agents.
     */
    harnessArn: text('harness_arn'),
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
    /**
     * Sub-agent definitions (v0.2 — deepagents `SubAgent` shape).
     * Each entry compiles into a child agent the parent can dispatch
     * via the `task("name", "...")` tool.
     */
    subagents: jsonb('subagents').$type<Array<{
      name: string;
      description: string;
      systemPrompt: string;
      tools?: string[];
      model?: string;
    }>>().default([]).notNull(),
    /**
     * Playbook-tag filter (v0.2). Empty array = mount every playbook
     * in this org. Non-empty = mount only playbooks whose `tags` field
     * intersects this set. Used by services/playbooks/mount.ts.
     */
    playbookTags: jsonb('playbook_tags').$type<string[]>().default([]).notNull(),
    /**
     * Learning-step ownership (v0.2). Names of the per-step rule
     * buckets this agent reads from + can write to. Each entry must
     * match a row in `learning_step.name`. (Phase 5 wires the table;
     * the column is added here so the agent schema is complete in v0.2.)
     */
    learningSteps: jsonb('learning_steps').$type<string[]>().default([]).notNull(),
    /**
     * Empty-state suggestions shown in the chat UI when no prior
     * turn exists. Mirrors rev-ai's `suggestions: [{label, prompt}]`.
     */
    suggestions: jsonb('suggestions').$type<Array<{ label: string; prompt: string }>>().default([]).notNull(),
    /** CSS color name for the agent's chat header / sidebar (v0.2). */
    accent: text('accent'),
    /** Short tagline shown above the chat title (v0.2). */
    eyebrow: text('eyebrow'),
    /** Langfuse project ID for observability */
    langfuseProjectId: text('langfuse_project_id'),
    /** Icon name (lucide) */
    icon: text('icon'),
    /** Whether this agent is active */
    active: text('active').default('true'),
    /**
     * Hierarchy role, derived from `parentAgentSlug` by workspace:apply —
     * 'lead' (primary agent, no parent) | 'specialist' (has a parent).
     * Do not author directly; kept as a column for chat-surface grouping.
     */
    role: text('role').default('specialist').notNull(),
    /** Primary work mode: 'mission' | 'workflow' | 'operational'. */
    agentType: text('agent_type'),
    /** Legacy display label. Hierarchy comes from `parentAgentSlug`, not this. */
    team: text('team'),
    /**
     * Slug of the team this agent belongs to (see `team.slug`, same
     * org). Slug reference, no FK — same convention as
     * `parentAgentSlug`. Authored as `team:` in workspace agent YAML;
     * validated against the workspace's teams/ dir at check/apply.
     * NULL = not on a team. Distinct from the legacy `team` label above.
     */
    teamSlug: text('team_slug'),
    /**
     * Slug of the primary agent this specialist reports to (same org).
     * NULL = primary agent. One level deep: a parent cannot itself have
     * a parent. Slug reference, no FK — same convention as skillSlugs.
     */
    parentAgentSlug: text('parent_agent_slug'),
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
/* Teams — the org-chart grouping of agents (F1)                       */
/* ------------------------------------------------------------------ */

/**
 * A team: an org-chart grouping of agents under a lead agent and an
 * accountable HUMAN. Catalog only — a team executes nothing itself, so
 * there is no `team_run` table. Flat by construction: no parent-team
 * column exists, so nesting is impossible by schema shape, not by
 * validation. Authored as workspace/<org>/teams/<slug>.yaml.
 *
 * The team row's serial PK is the future attachment point for KPIs
 * (F3) and feedback routing (F4) — those land as FKs to `team.id`,
 * zero columns here now.
 */
export const teamSchema = pgTable(
  'team',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /**
     * Slug of the agent leading this team (same org). Slug reference,
     * no FK — same convention as `agent.parentAgentSlug`. NULL = no
     * lead assigned yet (the team still renders, marked "no lead").
     */
    leadAgentSlug: text('lead_agent_slug'),
    /**
     * The human accountable for this team. NULL = inherit the
     * workspace default (`project.accountableUserId`) — inheritance is
     * resolved at read time (TeamService), never baked into the row.
     */
    accountableUserId: text('accountable_user_id').references(() => userSchema.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('team_org_slug_idx').on(table.orgId, table.slug),
  ],
);

export const teamRelations = relations(teamSchema, ({ one }) => ({
  project: one(projectSchema, {
    fields: [teamSchema.projectId],
    references: [projectSchema.id],
  }),
  accountableUser: one(userSchema, {
    fields: [teamSchema.accountableUserId],
    references: [userSchema.id],
  }),
}));

/* ------------------------------------------------------------------ */
/* Automations — the WHEN of the system, as a first-class object       */
/* ------------------------------------------------------------------ */

/**
 * Agents are WHO, missions are GOALS, workflows are PROCEDURES; an
 * automation binds a trigger to one of them: `{when: schedule|event,
 * do: run workflow | check mission}`. Authored in
 * workspace/<org>/automations/*.yaml; schedule-whens materialize as
 * Temporal Schedules; event-whens are matched by EventService on emit.
 */
export const automationSchema = pgTable(
  'automation',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** `active` | `disabled` */
    status: text('status').default('active'),
    /** `{schedule: '<cron UTC>'}` or `{event: '<type>', filter?: {...}}`. */
    whenConfig: jsonb('when_config').$type<{ schedule?: string; event?: string; filter?: Record<string, unknown> }>().notNull(),
    /** `{workflow: '<slug>', input?: {...}}` or `{checkMission: '<slug>'}`. */
    doConfig: jsonb('do_config').$type<{ workflow?: string; checkMission?: string; input?: Record<string, unknown> }>().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().$onUpdate(() => new Date()).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('automation_org_slug_idx').on(table.orgId, table.slug),
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
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
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
  /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
  projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
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
  workspaceSha: text('workspace_sha'),
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
/* Missions — open-ended, goal-driven team work (the third work mode). */
/* A Mission is the open envelope; Workflows are the structured one.   */
/* ------------------------------------------------------------------ */

/** Mission templates — authored starting points in workspace/<org>/missions/. */
export const missionSchema = pgTable(
  'mission',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    version: integer('version').default(1),
    /** `active` | `disabled` | `draft` */
    status: text('status').default('active'),
    /** The open-ended goal this mission pursues. */
    goal: text('goal').notNull(),
    /**
     * The single agent that owns this mission. If that agent is a lead
     *  (some other agents have parent_agent_slug pointing to it — see 0041),
     *  the runtime resolves the team by reverse-lookup.
     */
    agentSlug: text('agent_slug').notNull(),
    /** Per-action autonomy policy (see services/missions/autonomy.ts). */
    autonomyPolicy: jsonb('autonomy_policy').$type<Record<string, unknown>>().default({}),
    /** Plain-language success criteria + expected artifacts. */
    successCriteria: jsonb('success_criteria').$type<string[]>().default([]),
    desiredArtifacts: jsonb('desired_artifacts').$type<string[]>().default([]),
    /**
     * Standing-responsibility schedule — 5-field cron (UTC). When set, a
     * Temporal Schedule fires a check run (the lead reviews the charter,
     * does only what's needed) on this cadence. Null = brief-only.
     */
    schedule: text('schedule'),
    /**
     * Working memory across checks: open threads (with how many checks
     * they've been open), commitments + due dates, escalation state.
     * Read into every check brief; rewritten by the lead via the
     * update_mission_notes tool. Never set by workspace:apply.
     */
    workingNotes: text('working_notes'),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().$onUpdate(() => new Date()).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('mission_org_slug_idx').on(table.orgId, table.slug),
  ],
);

/** Mission execution instances — one open-ended assignment in flight. */
export const missionRunSchema = pgTable('mission_run', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
  /** Nullable — missions can start ad-hoc from a freeform brief (no template). */
  missionId: integer('mission_id').references(() => missionSchema.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  /** The natural-language assignment the owner gave. */
  brief: text('brief').notNull(),
  goal: text('goal'),
  /** `planning` | `running` | `paused` | `awaiting_review` | `completed` | `failed` | `cancelled` */
  status: text('status').default('planning').notNull(),
  /** Generated task graph — the live plan. */
  plan: jsonb('plan').$type<{
    tasks: Array<{
      id: string;
      title: string;
      ownerAgentSlug: string;
      type: 'analysis' | 'creative' | 'synthesis' | 'artifact' | 'diagnostic' | 'action';
      status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'skipped';
      dependsOn?: string[];
      approvalRequired?: boolean;
      output?: string;
      traceId?: string;
      error?: string;
    }>;
  }>().default({ tasks: [] }),
  /** Resolved team for this run: { lead, members[] }. */
  team: jsonb('team').$type<{ lead: string; members: string[] }>().notNull(),
  /** Autonomy policy in effect for this run. */
  autonomyPolicy: jsonb('autonomy_policy').$type<Record<string, unknown>>().default({}),
  /** Produced artifacts — refs from the artifact store. */
  artifacts: jsonb('artifacts').$type<Array<{ taskId: string; kind: string; url: string; title?: string }>>().default([]),
  /** When paused/awaiting review, why — e.g. `awaiting_approval:task_id`. */
  pauseReason: text('pause_reason'),
  pausedAt: timestamp('paused_at', { mode: 'date' }),
  error: text('error'),
  /** Workspace SHA active when the run started — stamped for audit. */
  workspaceSha: text('workspace_sha'),
  createdBy: text('created_by'),
  rating: text('rating'),
  feedbackNote: text('feedback_note'),
  feedbackBy: text('feedback_by'),
  feedbackAt: timestamp('feedback_at', { mode: 'date' }),
  completedAt: timestamp('completed_at', { mode: 'date' }),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().$onUpdate(() => new Date()).notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const missionRelations = relations(missionSchema, ({ many }) => ({
  runs: many(missionRunSchema),
}));

export const missionRunRelations = relations(missionRunSchema, ({ one }) => ({
  mission: one(missionSchema, {
    fields: [missionRunSchema.missionId],
    references: [missionSchema.id],
  }),
}));

/* ------------------------------------------------------------------ */
/* Workspace Versioning — git-backed workspace-as-code audit trail        */
/* ------------------------------------------------------------------ */

/** Audit record for each `workspace:apply` — ties skill_run history to a specific context SHA. */
export const workspaceVersionSchema = pgTable(
  'workspace_version',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    /** git SHA of the workspace directory (or computed hash when not in a git repo) */
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
    uniqueIndex('workspace_version_org_applied_idx').on(table.orgId, table.appliedAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Learnings — per-step rule store (Phase 5)                          */
/* ------------------------------------------------------------------ */

// Each `learning_step` is a named bucket (e.g. global, meeting_triage,
// proposal_drafting). Per-step rules live in `learning` rows. Steps are
// whitelisted via context (`workspace/<org>/learnings/<step>.yaml`) so we
// don't drift into a junk drawer of near-duplicates. See rev-ai's
// /var/www/metacto/spinutech/kickoff-demo/server/learnings.py for the
// originating pattern.

export const learningStepSchema = pgTable(
  'learning_step',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    /** Step slug, e.g. `meeting_triage`. Lowercased, alpha+underscore. */
    name: text('name').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    /** Optional intro shown above the rule list in `/learnings/<step>.md`. */
    preamble: text('preamble'),
    /** Which agent slugs own / read this step. */
    agentSlugs: jsonb('agent_slugs').$type<string[]>().default([]).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('learning_step_org_name_idx').on(table.orgId, table.name),
  ],
);

export const learningSchema = pgTable(
  'learning',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    stepId: integer('step_id').notNull().references(() => learningStepSchema.id, { onDelete: 'cascade' }),
    /** The rule text — typically one-paragraph directive. */
    ruleText: text('rule_text').notNull(),
    /** Where the rule came from: 'manual', 'feedback:<id>', 'self-improver:<run_id>', etc. */
    source: text('source'),
    createdBy: text('created_by'),
    /** Optional last-applied timestamp for staleness UI; updated when the agent reads the step. */
    lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
);

export const learningStepRelations = relations(learningStepSchema, ({ many }) => ({
  rules: many(learningSchema),
}));

export const learningRelations = relations(learningSchema, ({ one }) => ({
  step: one(learningStepSchema, {
    fields: [learningSchema.stepId],
    references: [learningStepSchema.id],
  }),
}));

/* ------------------------------------------------------------------ */
/* Conversations — persistent chat threads (Phase 5)                  */
/* ------------------------------------------------------------------ */

// Mirrors rev-ai's server/conversations.py 1:1 — one row per thread,
// one row per turn, runs_json stores the [{type:'text'|'tool', ...}]
// breadcrumb array the UI replays. Tool runs are intentionally dropped
// from the history that gets replayed back to the agent (UI-only).

export const conversationSchema = pgTable(
  'conversation',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    agentSlug: text('agent_slug').notNull(),
    title: text('title').notNull(),
    createdBy: text('created_by'),
    messageCount: integer('message_count').default(0).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('conversation_org_agent_updated_idx').on(table.orgId, table.agentSlug, table.updatedAt),
  ],
);

export const conversationMessageSchema = pgTable('conversation_message', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id')
    .notNull()
    .references(() => conversationSchema.id, { onDelete: 'cascade' }),
  /** 'user' | 'assistant' */
  role: text('role').notNull(),
  /** Rendered text content the agent sees on history replay. */
  content: text('content').notNull().default(''),
  /**
   * Structured breadcrumb array for the chat UI: a series of text
   * runs interleaved with tool breadcrumbs. Tool entries are dropped
   * when this row is replayed as history to the agent.
   */
  runsJson: jsonb('runs_json').$type<Array<
    | { type: 'text'; text: string }
    | { type: 'tool'; name: string; input?: Record<string, unknown>; output?: string }
  >>(),
  /**
   * Per-message Langfuse trace id for the assistant turn that
   * produced this row. Populated by AgentService at write time so the
   * chat UI can deep-link to the trace. Nullable for legacy rows + for
   * user messages (which don't produce a trace).
   */
  langfuseTraceId: text('langfuse_trace_id'),
  /**
   * Agent's self-assessment of confidence for this turn — same enum as
   * skill_run.confidence. Nullable when the runtime doesn't expose a
   * signal (most current paths). Powers the <ConfidenceIndicator /> in
   * AgentMessage.
   */
  confidence: text('confidence'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const conversationRelations = relations(conversationSchema, ({ many }) => ({
  messages: many(conversationMessageSchema),
}));

export const conversationMessageRelations = relations(conversationMessageSchema, ({ one }) => ({
  conversation: one(conversationSchema, {
    fields: [conversationMessageSchema.conversationId],
    references: [conversationSchema.id],
  }),
}));

/* ------------------------------------------------------------------ */
/* Feedback jobs — async worker queue (Phase 6)                       */
/* ------------------------------------------------------------------ */

// Drive comment events / Slack reactions / manual UI feedback all
// land in this table for the comment-feedback worker to classify and
// act on. At-least-once delivery via FOR UPDATE SKIP LOCKED.

/* ------------------------------------------------------------------ */
/* Evals — gold-standard datasets + run history (Phase 7)             */
/* ------------------------------------------------------------------ */

// One dataset = N test cases authored in context. Running a dataset
// produces an eval_run row and N eval_case_result rows scored by an
// LLM judge. Determinism: temperature=0 + workspaceSha stamped on every
// run so prompt changes show as eval drift.

export const evalDatasetSchema = pgTable(
  'eval_dataset',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** Which agent slug this dataset targets. Required — datasets are agent-scoped. */
    agentSlug: text('agent_slug').notNull(),
    description: text('description'),
    /** Test cases. Each: input + optional expectedOutput + optional rubric. */
    items: jsonb('items').$type<Array<{
      input: string;
      expectedOutput?: string;
      rubric?: string;
      tags?: string[];
    }>>().default([]).notNull(),
    version: integer('version').default(1).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('eval_dataset_org_slug_idx').on(table.orgId, table.slug),
  ],
);

export const evalRunSchema = pgTable('eval_run', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
  projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
  datasetId: integer('dataset_id').notNull().references(() => evalDatasetSchema.id, { onDelete: 'cascade' }),
  agentSlug: text('agent_slug').notNull(),
  /** Context SHA active when the dataset was run — for drift attribution. */
  workspaceSha: text('workspace_sha'),
  /** running | succeeded | failed */
  status: text('status').default('running').notNull(),
  metrics: jsonb('metrics').$type<{
    passRate?: number;
    toolCallCount?: number;
    medianLatencyMs?: number;
    failed?: number;
  }>().default({}).notNull(),
  startedAt: timestamp('started_at', { mode: 'date' }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { mode: 'date' }),
});

export const evalCaseResultSchema = pgTable('eval_case_result', {
  id: serial('id').primaryKey(),
  runId: integer('run_id').notNull().references(() => evalRunSchema.id, { onDelete: 'cascade' }),
  itemIndex: integer('item_index').notNull(),
  /** Free-form input echoed for context. */
  input: text('input').notNull(),
  output: text('output'),
  /** 0..1 score from the judge. */
  score: text('score'),
  /** pass | fail | error */
  verdict: text('verdict'),
  rationale: text('rationale'),
  /** Langfuse trace id for drill-down. */
  traceId: text('trace_id'),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const evalDatasetRelations = relations(evalDatasetSchema, ({ many }) => ({
  runs: many(evalRunSchema),
}));
export const evalRunRelations = relations(evalRunSchema, ({ one, many }) => ({
  dataset: one(evalDatasetSchema, {
    fields: [evalRunSchema.datasetId],
    references: [evalDatasetSchema.id],
  }),
  results: many(evalCaseResultSchema),
}));

/* ------------------------------------------------------------------ */
/* Agent budgets — per-period spend caps (Phase 7)                    */
/* ------------------------------------------------------------------ */

export const agentBudgetSchema = pgTable(
  'agent_budget',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    agentSlug: text('agent_slug').notNull(),
    /** daily | monthly */
    period: text('period').default('daily').notNull(),
    /** Tokens consumed in the current period (sum of input + output). */
    currentTokens: bigint('current_tokens', { mode: 'number' }).default(0).notNull(),
    /** Dollars (in USD cents to keep math integer-safe). */
    currentCents: bigint('current_cents', { mode: 'number' }).default(0).notNull(),
    /** Soft cap — warn but don't refuse. */
    softTokenLimit: bigint('soft_token_limit', { mode: 'number' }),
    softCentsLimit: bigint('soft_cents_limit', { mode: 'number' }),
    /** Hard cap — refuse new runs. */
    hardTokenLimit: bigint('hard_token_limit', { mode: 'number' }),
    hardCentsLimit: bigint('hard_cents_limit', { mode: 'number' }),
    /** When the current period began. Worker resets on rollover. */
    periodStartedAt: timestamp('period_started_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('agent_budget_org_slug_period_idx').on(table.orgId, table.agentSlug, table.period),
  ],
);

/* ------------------------------------------------------------------ */
/* Sources / Connectors framework (v0.3 — Phase G)                    */
/* ------------------------------------------------------------------ */

// Five tables. source_definition is the catalog (one row per plugin slug);
// source_install is per-org enablement; source_credential holds the encrypted
// OAuth/API-key blobs; source_dek wraps the KMS data-encryption keys;
// source_audit is an append-only log of every credential lifecycle event.

export const sourceDefinitionSchema = pgTable(
  'source_definition',
  {
    id: serial('id').primaryKey(),
    /** Plugin slug, e.g. `hubspot`, `google_drive_native`. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    version: text('version').notNull(),
    /** `oauth2` | `api_key` | `none`. */
    authType: text('auth_type').notNull(),
    /** `org` | `user` | `both`. */
    scope: text('scope').notNull(),
    /** Reverse-DNS plugin id (PluginManifest.id) — useful for "uninstall this whole plugin". */
    pluginId: text('plugin_id').notNull(),
    /** Brand tokens (color, lucideIcon, iconUrl) for the catalog UI. */
    brand: jsonb('brand').$type<{ color?: string; lucideIcon?: string; iconUrl?: string }>().default({}),
    /** OAuth scopes the plugin declares (for the install consent screen). */
    oauthScopes: jsonb('oauth_scopes').$type<string[]>().default([]),
    /** Hide from the public catalog (still installable via API). */
    discoverable: text('discoverable').default('true').notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('source_definition_slug_idx').on(table.slug),
  ],
);

export const sourceInstallSchema = pgTable(
  'source_install',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    /** FK-by-slug to source_definition.slug (loose — definitions can be re-registered). */
    sourceSlug: text('source_slug').notNull(),
    /** Clerk user id of the admin who installed. */
    installedBy: text('installed_by').notNull(),
    installedAt: timestamp('installed_at', { mode: 'date' }).defaultNow().notNull(),
    /** Soft-disable without losing credentials/audit. */
    disabled: text('disabled').default('false').notNull(),
    /** Per-install configuration (validated against Source.configSchema). */
    config: jsonb('config').$type<Record<string, unknown>>().default({}),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex('source_install_org_slug_idx').on(table.orgId, table.sourceSlug),
  ],
);

/**
 * KMS-wrapped data encryption keys, one per tenant. In dev mode the
 * `wrappedDek` is the master key directly (no KMS wrap); in production
 * it's the KMS-encrypted ciphertext.
 */
export const sourceDekSchema = pgTable(
  'source_dek',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    /** KMS key ARN that wrapped this DEK. Null in dev / localVault. */
    kmsKeyArn: text('kms_key_arn'),
    /** Wrapped DEK bytes (KMS ciphertext blob in production; raw master key in dev). */
    wrappedDek: text('wrapped_dek').notNull(),
    algorithm: text('algorithm').default('AES_256_GCM').notNull(),
    rotatedAt: timestamp('rotated_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('source_dek_org_active_idx').on(table.orgId, table.createdAt),
  ],
);

export const sourceCredentialSchema = pgTable('source_credential', {
  id: serial('id').primaryKey(),
  installId: integer('install_id')
    .notNull()
    .references(() => sourceInstallSchema.id, { onDelete: 'cascade' }),
  /** Null for org-wide credentials; set for user-scope credentials. */
  userId: text('user_id'),
  /** Human label shown in the UI, e.g. "chris@metacto.com". */
  displayName: text('display_name').notNull(),
  /** FK to the DEK used to encrypt `ciphertext`. */
  dekId: integer('dek_id')
    .notNull()
    .references(() => sourceDekSchema.id, { onDelete: 'restrict' }),
  /** AES-256-GCM ciphertext of the JSON-encoded RawCredentials. */
  ciphertext: text('ciphertext').notNull(),
  /** AES-256-GCM nonce (12 bytes, base64). */
  nonce: text('nonce').notNull(),
  /** AES-256-GCM auth tag (16 bytes, base64). */
  authTag: text('auth_tag').notNull(),
  /** Token expiry as supplied by the provider (unix seconds). */
  expiresAt: timestamp('expires_at', { mode: 'date' }),
  lastRefreshedAt: timestamp('last_refreshed_at', { mode: 'date' }),
  revokedAt: timestamp('revoked_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const sourceAuditSchema = pgTable('source_audit', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
  projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  /** `installed` | `uninstalled` | `connected` | `refreshed` | `revoked` | `failed_auth`. */
  event: text('event').notNull(),
  installId: integer('install_id'),
  credentialId: integer('credential_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  at: timestamp('at', { mode: 'date' }).defaultNow().notNull(),
});

export const sourceInstallRelations = relations(sourceInstallSchema, ({ many }) => ({
  credentials: many(sourceCredentialSchema),
}));

export const sourceCredentialRelations = relations(sourceCredentialSchema, ({ one }) => ({
  install: one(sourceInstallSchema, {
    fields: [sourceCredentialSchema.installId],
    references: [sourceInstallSchema.id],
  }),
  dek: one(sourceDekSchema, {
    fields: [sourceCredentialSchema.dekId],
    references: [sourceDekSchema.id],
  }),
}));

export const feedbackJobSchema = pgTable('feedback_job', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
  projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
  /** Source system: 'drive', 'slack', 'manual', or any registered connector slug. */
  source: text('source').notNull(),
  /** External identifier — Drive comment id, Slack ts, etc. (idempotency key). */
  externalId: text('external_id').notNull(),
  /** Raw payload from the source. Worker re-fetches authoritative state. */
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
  /** queued | processing | classified | applied | failed | ignored */
  status: text('status').default('queued').notNull(),
  /** Classifier output once processed. */
  classification: jsonb('classification').$type<{
    bucket: 'edit' | 'rule' | 'both' | 'ignore';
    editSummary?: string;
    ruleText?: string;
    targetSlug?: string;
  }>(),
  attempts: integer('attempts').default(0).notNull(),
  error: text('error'),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Native pgvector retrieval — first-party, no third-party engine.    */
/*                                                                    */
/* Three tables underpin the retrieval stack:                          */
/*   - knowledge_source   ··· one row per installed source connector  */
/*   - knowledge_document  ··· one row per ingested document          */
/*   - knowledge_chunk     ··· one row per ~512-token chunk           */
/*                                                                    */
/* Embedding model: OpenAI text-embedding-3-small (1536-d).           */
/* Vector index: HNSW with vector_cosine_ops.                         */
/* Keyword index: GIN on a generated tsvector column.                  */
/* Hybrid fusion: RRF in the service layer.                           */
/*                                                                    */
/* Migration 0019_pgvector_retrieval.sql adds the pgvector extension  */
/* + these tables. Indexes attached as customType-emitted SQL in the  */
/* migration since Drizzle's `index()` builder doesn't natively know   */
/* HNSW operator classes yet.                                          */
/* ------------------------------------------------------------------ */

export const knowledgeSourceSchema = pgTable(
  'knowledge_source',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    /** Source plugin slug — e.g. `google-drive`, `github`, `vocion-docs`. */
    slug: text('slug').notNull(),
    /** Human-facing source kind — 'web', 'plugin', 'upload'. */
    kind: text('kind').default('plugin').notNull(),
    /** Source-plugin-specific config (folder ids, repo names, etc.) */
    configJson: jsonb('config_json').$type<Record<string, unknown>>().default({}).notNull(),
    /**
     * Per-connection ACL. Null / `{visibility:'org'}` = every member can
     * retrieve from this source. `{visibility:'restricted', users:[emails]}`
     * = only the listed members see its content in chat + search. Enforced
     * as an INTERSECTION at query time (agent scope ∩ user grants); runs
     * with no human in the loop (schedules) keep team access.
     */
    accessPolicy: jsonb('access_policy').$type<{ visibility?: 'org' | 'restricted'; users?: string[] }>(),
    enabled: text('enabled').default('true').notNull(),
    lastSyncedAt: timestamp('last_synced_at', { mode: 'date' }),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('knowledge_source_org_slug_idx').on(table.orgId, table.slug),
  ],
);

export const knowledgeDocumentSchema = pgTable(
  'knowledge_document',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => knowledgeSourceSchema.id, { onDelete: 'cascade' }),
    /** Stable identifier from the upstream source — Drive fileId, repo path, slug. */
    externalId: text('external_id').notNull(),
    /** Canonical URL/URI the user can navigate to. */
    uri: text('uri'),
    title: text('title'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    /** SHA-256 of the canonical content. Re-ingest is a no-op when unchanged. */
    contentHash: text('content_hash').notNull(),
    /** Last-modified hints from the upstream source (HTTP ETag / mtime). */
    etag: text('etag'),
    lastModifiedAt: timestamp('last_modified_at', { mode: 'date' }),
    ingestedAt: timestamp('ingested_at', { mode: 'date' }).defaultNow().notNull(),
    /** Touched on every sync, even when content unchanged. Drives tombstoning. */
    lastSeenAt: timestamp('last_seen_at', { mode: 'date' }).defaultNow().notNull(),
    /**
     * Scope (sub-org segmentation). NULL = org-wide / shared. A non-null
     * `clientId` makes the doc visible only to retrievals scoped to that
     * client — the cross-client isolation boundary. `teamId` narrows further.
     */
    clientId: text('client_id'),
    teamId: text('team_id'),
  },
  table => [
    uniqueIndex('knowledge_document_org_source_external_idx').on(table.orgId, table.sourceId, table.externalId),
    index('knowledge_document_content_hash_idx').on(table.contentHash),
    index('knowledge_document_org_client_idx').on(table.orgId, table.clientId),
  ],
);

export const knowledgeChunkSchema = pgTable(
  'knowledge_chunk',
  {
    id: serial('id').primaryKey(),
    documentId: integer('document_id')
      .notNull()
      .references(() => knowledgeDocumentSchema.id, { onDelete: 'cascade' }),
    /**
     * Denormalized for org-scoped queries (avoids join + lets us put the
     * filter directly on the partial vector-index condition).
     */
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    chunkIdx: integer('chunk_idx').notNull(),
    content: text('content').notNull(),
    contentTokens: integer('content_tokens').notNull(),
    /** OpenAI text-embedding-3-small produces 1536-d float32 vectors. */
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    /**
     * Generated tsvector. The DEFAULT expression below is best-effort;
     * the migration replaces it with a proper GENERATED ALWAYS AS
     * STORED column (Drizzle can't emit that syntax directly).
     */
    tsv: tsvector('tsv'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    /** Denormalized scope (mirrors the document) so retrieval can ACL-filter on the chunk directly. */
    clientId: text('client_id'),
    teamId: text('team_id'),
  },
  table => [
    index('knowledge_chunk_org_doc_idx_idx').on(table.orgId, table.documentId, table.chunkIdx),
    index('knowledge_chunk_org_client_idx').on(table.orgId, table.clientId),
  ],
);

/** Relations — lets Drizzle's query layer eagerly load the join graph. */
export const knowledgeSourceRelations = relations(knowledgeSourceSchema, ({ many }) => ({
  documents: many(knowledgeDocumentSchema),
}));

export const knowledgeDocumentRelations = relations(knowledgeDocumentSchema, ({ one, many }) => ({
  source: one(knowledgeSourceSchema, {
    fields: [knowledgeDocumentSchema.sourceId],
    references: [knowledgeSourceSchema.id],
  }),
  chunks: many(knowledgeChunkSchema),
}));

export const knowledgeChunkRelations = relations(knowledgeChunkSchema, ({ one }) => ({
  document: one(knowledgeDocumentSchema, {
    fields: [knowledgeChunkSchema.documentId],
    references: [knowledgeDocumentSchema.id],
  }),
}));

/**
 * Resumable ingestion state — one row per source. Drives durable, incremental
 * sync: `since` is the watermark (only fetch docs changed after it), `cursor`
 * is the opaque resume position for a large crawl, `status` tracks the in-flight
 * run. See SourceSyncService + firsthq/docs/platform-plan.md §3.
 */
export const sourceSyncCheckpointSchema = pgTable(
  'source_sync_checkpoint',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => knowledgeSourceSchema.id, { onDelete: 'cascade' }),
    /** `running` | `completed` | `failed` */
    status: text('status').default('running').notNull(),
    /** Opaque connector-defined resume position for a partially-crawled source. */
    cursor: text('cursor'),
    /** Incremental watermark — last successful sync's cutoff; connectors fetch only newer docs. */
    since: timestamp('since', { mode: 'date' }),
    startedAt: timestamp('started_at', { mode: 'date' }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { mode: 'date' }),
    counts: jsonb('counts').$type<Record<string, number>>().default({}).notNull(),
    error: text('error'),
  },
  table => [
    uniqueIndex('source_sync_checkpoint_source_idx').on(table.sourceId),
  ],
);

/**
 * Tenant API tokens — the control-plane credential. An app (FirstHQ) or a
 * client integration authenticates with `vcn_live_<id>_<secret>`; we store only
 * the SHA-256 of the secret. A token carries an authz role + optional grants, so
 * its mutations route through the same permission model as everything else.
 * See firsthq/docs/platform-plan.md §5.
 */
export const apiTokenSchema = pgTable(
  'api_token',
  {
    /** Public token id — the `<id>` segment of `vcn_live_<id>_<secret>`. */
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    /** SHA-256 hex of the secret half. The plaintext is shown once, at issue. */
    secretHash: text('secret_hash').notNull(),
    /** authz workspace role the token acts as. */
    role: text('role').default('owner').notNull(),
    /** Explicit authz action grants (empty = the role's defaults). */
    grants: jsonb('grants').$type<string[]>().default([]).notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
    revokedAt: timestamp('revoked_at', { mode: 'date' }),
  },
  table => [
    index('api_token_org_idx').on(table.orgId),
  ],
);

// review_assignment overlays the unified review queue (ReviewService) with
// per-item routing: who a pending skill/workflow/mission run is assigned to,
// plus snooze. Keyed by (kind, run_id) so it decorates the derived queue
// without touching the three run tables. Makes the queue a team queue.
export const reviewAssignmentSchema = pgTable(
  'review_assignment',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** 'skill' | 'workflow' | 'mission' — matches ReviewKind. */
    kind: text('kind').notNull(),
    /** The run id in the owning table (skill_run / workflow_run / mission_run). */
    runId: integer('run_id').notNull(),
    /** Org user this item is routed to. NULL = unassigned (visible to all). */
    assignedTo: text('assigned_to').references(() => userSchema.id, { onDelete: 'set null' }),
    /** Who assigned it (user id or `token:<id>`). */
    assignedBy: text('assigned_by'),
    /** 'open' | 'snoozed' | 'done'. */
    status: text('status').default('open').notNull(),
    note: text('note'),
    /** When snoozed, hide from the active queue until this time. */
    snoozedUntil: timestamp('snoozed_until', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex('review_assignment_item_idx').on(table.kind, table.runId),
    index('review_assignment_assignee_idx').on(table.orgId, table.assignedTo),
  ],
);

/**
 * Briefings — the daily front door. Published by the team at the end of a
 * briefing check (publish_briefing tool); rendered newest-first under
 * Workspace → Briefings.
 */
export const briefingSchema = pgTable(
  'briefing',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    title: text('title').notNull(),
    /** Markdown body. */
    content: text('content').notNull(),
    /** Who published — usually `agent:<slug>` via a mission check. */
    publishedBy: text('published_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('briefing_org_created_idx').on(table.orgId, table.createdAt),
  ],
);

/**
 * Trust ladder execution rules. `{actionId, threshold, enabled}` per org —
 * a pending proposal whose confidence >= threshold on an ENABLED rule
 * executes without waiting for review (audited via proposal.autoApproved).
 * Authored in workspace/<org>/trust.yaml; default OFF.
 */
export const trustRuleSchema = pgTable(
  'trust_rule',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    actionId: text('action_id').notNull(),
    /** Minimum confidence (0-1) to auto-execute. */
    threshold: real('threshold').notNull(),
    /** 'true' | 'false' — string for consistency with sibling tables. */
    enabled: text('enabled').default('false').notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().$onUpdate(() => new Date()).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('trust_rule_org_action_idx').on(table.orgId, table.actionId),
  ],
);

// action_run — a proposed connector-write action (gmail.send, hubspot.update).
// Gated actions persist here as 'pending' and surface in the review queue as a
// 4th kind; they execute only on approval. Non-gated actions record their run
// too (status 'done') for the audit trail.
export const actionRunSchema = pgTable(
  'action_run',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Registered action id, e.g. `gmail.send`. */
    actionId: text('action_id').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().default({}).notNull(),
    /** pending | approved | executing | done | failed | rejected */
    status: text('status').default('pending').notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    /** Who proposed it — `agent:<slug>` / `token:<id>` / a user id. */
    invokedBy: text('invoked_by'),
    /** The source whose vault credentials the action needs (e.g. `gmail`). */
    sourceSlug: text('source_slug'),
    /**
     * Agent-proposal envelope: confidence (0–1), rationale, evidence doc uris.
     * Surfaced in the review queue + daily brief; feeds the trust ladder.
     */
    proposal: jsonb('proposal').$type<{ confidence?: number; rationale?: string; evidence?: string[]; autoApproved?: boolean; autoApprovedThreshold?: number }>(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    executedAt: timestamp('executed_at', { mode: 'date' }),
  },
  table => [
    index('action_run_org_status_idx').on(table.orgId, table.status),
  ],
);

// event_log — inbound events (webhook or internal) the trigger runner dispatches.
// Records + dedups each event and audits which workflows it started.
export const eventLogSchema = pgTable(
  'event_log',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Event type, e.g. `prospect.reply`, `external.hubspot.deal_stage_changed`. */
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
    /** Provider-namespaced idempotency key; redelivered webhooks with the same key no-op. */
    dedupeKey: text('dedupe_key'),
    /** What this event started — `[{ slug, runId }]`. */
    triggered: jsonb('triggered').$type<Array<{ slug: string; runId: number }>>().default([]).notNull(),
    invokedBy: text('invoked_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('event_log_dedupe_idx').on(table.orgId, table.dedupeKey),
    index('event_log_org_type_idx').on(table.orgId, table.type),
  ],
);

// user_activity_event — append-only adoption stream. One narrow row per user
// action (login, heartbeat, chat message, review decision, feedback, learning),
// written fire-and-forget by `services/adoption/track.ts`. Every adoption
// metric reads from this one shape; historical rows are synthesized once by
// `scripts/backfill-adoption-events.ts` from the source tables.
export const userActivityEventSchema = pgTable(
  'user_activity_event',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    projectId: text('project_id'),
    userId: text('user_id').notNull(),
    /** Set whenever the event is agent-attributable. */
    agentSlug: text('agent_slug'),
    /** `category.verb` taxonomy — see `services/adoption/events.ts`. */
    eventType: text('event_type').notNull(),
    /** 'conversation' | 'skill_run' | 'workflow_run' | 'mission_run' | 'learning' | ... */
    resourceType: text('resource_type'),
    /** Powers drill-down deep links into existing detail pages. */
    resourceId: text('resource_id'),
    /** Small envelope only — counts and enums (decision, rating, latency), never content. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('user_activity_event_org_created_idx').on(table.orgId, table.createdAt),
    index('user_activity_event_org_user_created_idx').on(table.orgId, table.userId, table.createdAt),
    index('user_activity_event_org_agent_created_idx').on(table.orgId, table.agentSlug, table.createdAt),
    // Resource-anchored events are naturally unique — this makes the backfill
    // idempotent (insert ... on conflict do nothing) and guards live double-fires.
    uniqueIndex('user_activity_event_resource_idx')
      .on(table.orgId, table.eventType, table.resourceType, table.resourceId)
      .where(sql`resource_id IS NOT NULL`),
  ],
);

// Re-export `sql` so callers can build the GENERATED-ALWAYS-AS-STORED
// tsvector expression in raw migrations. Not used at query-time.
export { sql };
