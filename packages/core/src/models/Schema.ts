import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { bigint, boolean, check, customType, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex, vector } from 'drizzle-orm/pg-core';

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
    /**
     * Optional dashboard surfaces this workspace switched on, by registry id
     * (`features/navigation/surfaces.ts`). Authored as top-level `surfaces:`
     * in workspace.yaml and replaced wholesale at apply. Empty = the default
     * sidebar only.
     */
    enabledSurfaces: jsonb('enabled_surfaces').$type<string[]>().default([]).notNull(),
    /**
     * Which vendor and model produce this workspace's embeddings. Authored as
     * `defaults.embeddingProvider` / `defaults.embeddingModel` in
     * workspace.yaml; NULL keys fall back to `VOCION_EMBEDDING_PROVIDER` /
     * `VOCION_EMBEDDING_MODEL`, then to OpenAI.
     *
     * Deliberately a WORKSPACE setting and never a per-agent one. Every vector
     * in `knowledge_chunk` was produced by one model, and a query vector is
     * only comparable to vectors from that same model — cosine similarity
     * across two embedding spaces returns numbers, just meaningless ones. An
     * agent that embedded its queries on a different provider from the one that
     * ingested the documents would degrade search with no error anywhere, which
     * is the worst possible failure mode for a retrieval bug. Holding it at the
     * workspace makes ingest and query provably the same model.
     *
     * Changing it on a workspace that already has chunks means re-embedding
     * them; a width change means a schema migration too.
     */
    embeddingConfig: jsonb('embedding_config').$type<{
      provider?: 'openai' | 'bedrock';
      model?: string;
    }>(),
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
  /**
   * The system that owns the published record this object mirrors, e.g.
   * `strapi`. Null until something outside actually exists: a proposed
   * candidate is a real row here from the moment it is extracted, and the
   * downstream system stamps its own id back only once it has published.
   */
  externalSystem: text('external_system'),
  /** That system's primary key for the record, as it returns it. */
  externalId: text('external_id'),
  /**
   * The review-queue item this object is waiting on, when it arrived as a
   * proposed candidate. Keeps "what happened to this extraction" a single
   * query in both directions.
   */
  reviewActionRunId: integer('review_action_run_id'),
  /**
   * Where a proposed candidate came from — source links, the raw extract it
   * was parsed from, what the extractor could not resolve, who proposed it.
   * Kept out of `metadata` so the domain payload a consumer reads is only the
   * record's own fields.
   */
  provenance: jsonb('provenance').$type<Record<string, unknown>>(),
  /** LLM-generated summary combining linked documents */
  summary: text('summary'),
  summaryGeneratedAt: timestamp('summary_generated_at', { mode: 'date' }),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, table => [
  // One object per external record: a retried link-back cannot fork the
  // mapping, and "which object is Strapi id 412?" is an indexed lookup.
  uniqueIndex('business_object_external_ref_idx').on(table.orgId, table.externalSystem, table.externalId),
  // The candidate queues: "this org's proposed objects of this type".
  index('business_object_org_status_idx').on(table.orgId, table.status),
  // One object per review item. `onProposed` upserts on this, and two
  // concurrent proposals of the same candidate would otherwise both miss the
  // lookup and insert.
  uniqueIndex('business_object_review_run_idx').on(table.orgId, table.reviewActionRunId),
]);

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
/* Tool calls — the activity record, one row per tool invocation      */
/* ------------------------------------------------------------------ */

/**
 * One row per domain-tool invocation, written at the tool registry so
 * all three harness providers (local, agentcore, runtime) are covered.
 * This is the record of what agents actually do; it replaces the
 * operation-scoped skill_run history. Cost and model latency live on
 * the linked Langfuse trace, not here; durationMs is the tool's own
 * wall time.
 */
export const toolCallSchema = pgTable(
  'tool_call',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    /** The agent that made the call — the delegated specialist when nested, never the lead on its behalf. */
    agentSlug: text('agent_slug').notNull(),
    /** The dispatching lead when the call was made by a delegated specialist. */
    leadAgentSlug: text('lead_agent_slug'),
    tool: text('tool').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().default({}),
    /** Tool output, truncated for storage. */
    output: text('output'),
    /** Error message when the invocation threw; null on success. */
    error: text('error'),
    durationMs: integer('duration_ms'),
    conversationId: integer('conversation_id'),
    missionRunId: integer('mission_run_id'),
    /** Which harness executed the loop: local | agentcore | runtime. */
    provider: text('provider'),
    /** Langfuse trace of the turn — cost and latency are read there. */
    langfuseTraceId: text('langfuse_trace_id'),
    /** Context version SHA active when this call executed. */
    workspaceSha: text('workspace_sha'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('tool_call_org_created_idx').on(table.orgId, table.createdAt),
    index('tool_call_org_agent_idx').on(table.orgId, table.agentSlug),
    index('tool_call_org_tool_idx').on(table.orgId, table.tool),
  ],
);

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
    /** 'skill' (the deepagents unit) or 'playbook' (attached context). */
    kind: text('kind').default('playbook').notNull(),
    /** 'core' (base pack), 'workspace' (workspace-only), or 'override' (workspace replacing the base). */
    origin: text('origin').default('workspace').notNull(),
    /** Playbook slugs a skill attaches — they mount wherever the skill does. */
    attachedPlaybooks: jsonb('attached_playbooks').$type<string[]>().default([]).notNull(),
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
    /** Skill slugs this agent mounts (SKILL.md units). */
    skillSlugs: jsonb('skill_slugs').$type<string[]>().default([]),
    /** Playbook slugs attached to this agent by name — always-present context. */
    playbookSlugs: jsonb('playbook_slugs').$type<string[]>().default([]),
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
      /** Granted-only tool names to hand this agent (e.g. classify_call). Gated tools are absent unless named here. */
      grantTools?: string[];
      /**
       * Model id this agent's main role runs on, overriding the per-role env
       * default. Read by every provider: the agentcore and runtime harnesses
       * pass it to the managed runtime, and the local loop hands it to
       * `buildChatModelForOrg`.
       */
      model?: string;
      /**
       * Which vendor serves this agent's chat model. A different axis from
       * `provider` above, which selects where the agent *loop* executes —
       * an agent can run on the local loop and still answer on Bedrock.
       * Unset inherits `VOCION_LLM_PROVIDER`, so this exists to point one
       * agent at one vendor without moving the whole deployment.
       */
      modelProvider?: 'anthropic' | 'openai' | 'bedrock';
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
    /** `{workflow: '<slug>', input?}` | `{checkMission: '<slug>', prompt?}` (prompt = the authored execution orders for each check) | `{job: '<name>', input?}` (built-in server job). */
    doConfig: jsonb('do_config').$type<{ workflow?: string; checkMission?: string; job?: string; prompt?: string; input?: Record<string, unknown> }>().notNull(),
    /** Owning agent slug. Nullable — `checkMission` inherits the owner from its mission; `job`/`workflow` set it here so the schedule rolls up to an agent. */
    ownerAgentSlug: text('owner_agent_slug'),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().$onUpdate(() => new Date()).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('automation_org_slug_idx').on(table.orgId, table.slug),
  ],
);

/**
 * One row per automation dispatch — the evidence a schedule actually fired.
 * Workflow and mission dispatches already leave a run row of their own; a
 * `job` left nothing at all, so this is the only trace an hourly sweep ran
 * (and the only place its result is kept).
 */
export const automationRunSchema = pgTable(
  'automation_run',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** The automation's slug — not an FK, so a run survives the automation being removed. */
    slug: text('slug').notNull(),
    /** Which do-type dispatched: 'workflow' | 'mission_check' | 'job'. */
    kind: text('kind').notNull(),
    /** 'running' | 'ok' | 'error'. */
    status: text('status').default('running').notNull(),
    /** `automation:<slug>` for a schedule fire, `user:<id>` for a dashboard test run. */
    invokedBy: text('invoked_by'),
    /** True when the caller asked for a no-writes rehearsal (test runs). */
    dryRun: boolean('dry_run').default(false).notNull(),
    /** The merged input the do actually received — what to reproduce a run from. */
    input: jsonb('input').$type<Record<string, unknown>>(),
    /** The do's return value (e.g. the sweep's counts). Null while running or on error. */
    result: jsonb('result'),
    error: text('error'),
    /** workflow_run / mission_run id for those kinds; null for jobs (they have no run row). */
    targetRunId: integer('target_run_id'),
    startedAt: timestamp('started_at', { mode: 'date' }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('automation_run_org_slug_started_idx').on(table.orgId, table.slug, table.startedAt),
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
    /** Owning agent slug — the agent this procedure belongs to. Nullable for legacy/unowned workflows. */
    ownerAgentSlug: text('owner_agent_slug'),
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
    /**
     * The record this conversation is scoped to, when it was opened from a
     * record page's dock — the CRM mirror ref (e.g. `contacts:9412`). Null
     * for everything-scoped conversations (the full-page chat, the bubble).
     * Scoped conversations are per user and never shared: resume filters on
     * (orgId, scopeRef, createdBy). See agent-chat-surface.md §3.1, §8.6.
     */
    scopeRef: text('scope_ref'),
    messageCount: integer('message_count').default(0).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('conversation_org_agent_updated_idx').on(table.orgId, table.agentSlug, table.updatedAt),
    index('conversation_org_scope_idx').on(table.orgId, table.scopeRef, table.updatedAt),
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
   * Cited/pulled source documents for this assistant turn — so inline `[n]`
   * citations still resolve (and the Sources drawer repopulates) after a
   * reload. Nullable for user turns + legacy rows.
   */
  documentsJson: jsonb('documents_json').$type<Array<{
    document_id: string;
    semantic_identifier: string;
    link: string;
    source_type: string;
    blurb: string;
    citationIndex?: number;
    foundBy?: string;
  }>>(),
  /**
   * The turn's typed activity trace (the TraceNode tree the UI folds from
   * `trace_node` SSE events) persisted with the message, so the transcript's
   * expanded levels — the steps and their payloads — survive reload and
   * resume instead of existing only in the live stream. Nullable for user
   * turns + rows written before this column.
   */
  traceJson: jsonb('trace_json').$type<Array<{
    id: string;
    parentId?: string;
    actor: { id: string; kind: string; name: string };
    kind: string;
    status: string;
    label: string;
    detail?: string;
    tool?: string;
    args?: string;
    resultDetail?: string;
    text?: string;
    result?: string;
    confidence?: number;
    citations?: Array<{ sourceType: string; title: string; link?: string; snippet?: string; actorId: string }>;
  }>>(),
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

/**
 * anchored_comment — the reviewer's notes ON a span of a document, kept
 * BESIDE the document rather than in it.
 *
 * The layer never mutates document text, and that is enforced here rather
 * than by convention: this table holds only an anchor (the quoted span plus
 * the text on either side of it) and the note. Nothing in the write path
 * touches `lead_brief.sections`, `lead_brief.draft_sequence`, or any other
 * document column, so a comment cannot corrupt the thing it comments on.
 *
 * The anchor is content-addressed (a W3C-style quote selector), never a DOM
 * offset: a re-render, or an agent edit elsewhere in the document, must not
 * orphan or misplace a highlight. When the quoted text can no longer be
 * found the row resolves as `orphaned` and says so, instead of pointing at
 * the wrong words.
 */
export const anchoredCommentSchema = pgTable(
  'anchored_comment',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** What is being commented on, e.g. `lead_brief:412`. */
    targetRef: text('target_ref').notNull(),
    /** The field inside the target: a brief section heading, or `send:2:body`. */
    field: text('field').notNull(),
    /**
     * Content-addressed anchor. `quote` is the selected text; `prefix` and
     * `suffix` are the characters immediately around it, which disambiguate
     * a quote that appears more than once.
     */
    anchor: jsonb('anchor').$type<{ quote: string; prefix: string; suffix: string }>().notNull(),
    /** What the reviewer wants changed about that span. */
    note: text('note').notNull(),
    /** 'open' — waiting; 'applied' — the agent's change landed; 'orphaned' — the span is gone. */
    status: text('status').default('open').notNull(),
    /** Per user: another reviewer's notes on the same lead are their own. */
    createdBy: text('created_by'),
    /** Set only when an apply verifiably completed — never on a timer. */
    appliedAt: timestamp('applied_at', { mode: 'date' }),
    /** The action run that applied it, so the payload can show what changed. */
    appliedByRunId: integer('applied_by_run_id'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('anchored_comment_org_target_idx').on(table.orgId, table.targetRef, table.status),
  ],
);

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
/* Chat widget state — shared "last viewed conversation" pointer      */
/* ------------------------------------------------------------------ */

// One row per (org, user): which agent + conversation they last VIEWED,
// not necessarily messaged. Read on mount by both the full-page chat and
// the floating chat bubble so either surface resumes exactly where the
// other left off.
export const chatWidgetStateSchema = pgTable(
  'chat_widget_state',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    userId: text('user_id').notNull(),
    agentSlug: text('agent_slug').notNull(),
    conversationId: integer('conversation_id').references(() => conversationSchema.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex('chat_widget_state_org_user_idx').on(table.orgId, table.userId),
  ],
);

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
    /**
     * The stored API credential this connector authenticates with, or `null`
     * when it does not use one.
     *
     * On the connector row rather than on `source_install`, because an install
     * is unique per (org, connector slug) and a workspace may run several
     * connectors of the same kind — a Strapi against staging and another
     * against production. Holding the link here is what lets each of them use
     * its own credential instead of all of them sharing the install's.
     *
     * Unique where set (`knowledge_source_api_token_live_idx`): one credential
     * belongs to one connector. A key is issued for the single instance or
     * account its connector talks to, so a second connector naming it is
     * somebody having picked the wrong row — and revoking it would then take
     * down a connector nobody was looking at.
     *
     * Null for every OAuth connector, which keeps its grant in
     * `source_credential`: a grant is issued to one installation, carries a
     * refresh token, and is not a value a person pastes, so there is nothing to
     * share. Null too for the connectors that need no auth at all, and for an
     * API-key connector created before this column existed and not yet
     * migrated.
     *
     * `restrict` on delete because a credential a connector is using must not
     * vanish underneath it. Retiring one means revoking the row, which leaves
     * the connector pointing at a revoked credential and lets it report a
     * broken credential rather than failing its next sync for no stated
     * reason.
     */
    // `api_token` is declared further down this file, and drizzle only calls
    // this back when it builds the table metadata — which is what the
    // `AnyPgColumn` return type documents.
    // eslint-disable-next-line ts/no-use-before-define
    apiTokenId: text('api_token_id').references((): AnyPgColumn => apiTokenSchema.id, { onDelete: 'restrict' }),
    /**
     * Whether this source is the only one allowed to hold `api_token_id`.
     *
     * Decided by the credential's platform at link time and written here so
     * the database can enforce it: a partial unique index cannot look up a
     * platform descriptor, but it can read a boolean on the row. True for a
     * credential issued for one place — a Strapi token is worthless against
     * any instance but the one that minted it. False for an account-wide
     * grant, where sharing is the point: one Google refresh token serves
     * Gmail, Drive and Calendar, and one Slack bot token every channel the
     * workspace syncs.
     */
    apiTokenExclusive: boolean('api_token_exclusive').default(false).notNull(),
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
    // Unique only over the links that claim exclusivity. It used to cover every
    // link, back when every stored credential was issued for one place. That
    // stopped being true once a platform could serve several connectors — one
    // Google refresh token is meant to be held by Gmail, Drive and Calendar at
    // once — so the rule narrowed to the rows that still want it rather than
    // being given up. `api_token_exclusive` is what a partial index can read in
    // place of the platform descriptor that actually decides.
    //
    // This is the rule, not the pre-check in `linkSourceToStoredCredential`:
    // two people picking one credential at the same moment both pass that
    // check, and this index is what refuses the second write.
    uniqueIndex('knowledge_source_api_token_exclusive_idx')
      .on(table.apiTokenId)
      .where(sql`${table.apiTokenId} is not null and ${table.apiTokenExclusive}`),
    // Plain lookup index for the column, covering the shared links the unique
    // one above leaves out. Partial, so the many sources naming no credential
    // are not all indexed on one null.
    index('knowledge_source_api_token_live_idx')
      .on(table.apiTokenId)
      .where(sql`${table.apiTokenId} is not null`),
  ],
);

/**
 * A rule the system proposes but has not adopted.
 *
 * The feedback worker classifies a `feedback_job` and, when the classification
 * yields rule text, lands it here as `pending` — it never writes a `learning`
 * row itself. A human (in the dashboard, or through
 * `/api/v1/learning-candidates`) edits it, approves it into a real rule, or
 * rejects it with a reason. That keeps the record of *why* a suggestion was
 * turned down, which a plain delete would throw away.
 */
export const learningCandidateSchema = pgTable(
  'learning_candidate',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Phase 1: nullable for backfill; will be set NOT NULL once data migrates. */
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    /** The learning step this rule would attach to, by name (not id — the step may not exist yet). */
    stepName: text('step_name').notNull(),
    /** What the classifier proposed. Never overwritten, so the original stays auditable. */
    ruleText: text('rule_text').notNull(),
    /** What a human changed it to. Null until someone edits it. */
    editedRuleText: text('edited_rule_text'),
    /** The feedback this came from. Kept as a back-link for "why does this rule exist". */
    sourceFeedbackJobId: integer('source_feedback_job_id').references(() => feedbackJobSchema.id, { onDelete: 'set null' }),
    /** The run the feedback was about, when there was one. */
    sourceRunId: integer('source_run_id'),
    /** 'pending' | 'approved' | 'rejected'. */
    status: text('status').default('pending').notNull(),
    /** Required when rejecting — a rejection with no reason teaches nobody anything. */
    rejectedReason: text('rejected_reason'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { mode: 'date' }),
    /** The rule created on approval, so a candidate and its rule stay linked. */
    createdLearningId: integer('created_learning_id').references(() => learningSchema.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    // The queue query is always "this org's candidates in this state".
    orgStatusIdx: index('learning_candidate_org_status_idx').on(table.orgId, table.status),
  }),
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
    /**
     * The non-fatal failures a run hit and carried on past — one Strapi
     * collection returning a 500 while its siblings synced, a document that
     * would not embed. `error` above holds the single fatal error that ended a
     * run; this holds everything the run survived, so the UI can say what was
     * skipped instead of only showing a lower document count.
     *
     * `scope` says which layer reported it: `connector` for a whole slice of the
     * source that never arrived, `document` for one item that would not save.
     * Capped per scope when written (see SourceSyncService) so a run failing on
     * hundreds of documents cannot crowd out the record of a collection that
     * never loaded, nor grow this row without bound.
     */
    failures: jsonb('failures')
      .$type<{ scope: 'connector' | 'document'; uri?: string; message: string; at: string }[]>()
      .default([])
      .notNull(),
  },
  table => [
    uniqueIndex('source_sync_checkpoint_source_idx').on(table.sourceId),
  ],
);

/**
 * Tenant API credentials. One table, two shapes, told apart by `platform`
 * (see `libs/platforms/registry.ts`):
 *
 *   - `platform = 'vocion'` — the control-plane credential. An app (FirstHQ) or
 *     a client integration authenticates with `vcn_live_<id>_<secret>`. We store
 *     the SHA-256 of the secret, which is what authenticates a request, and the
 *     whole token encrypted, which is what lets an admin read it back. The token
 *     carries an authz role + optional grants, so its mutations route through
 *     the same permission model as everything else. See
 *     firsthq/docs/platform-plan.md §5.
 *   - any other platform — a key the org supplied for a third party (OpenAI,
 *     Anthropic, …), encrypted at rest with the same per-org DEK that protects
 *     `source_credential`. Vocion decrypts it to call out on the org's behalf,
 *     so the org's own account is billed. These rows never authenticate anybody
 *     into* Vocion; `verifyToken` refuses them outright.
 *
 * A supplied key is found one of two ways, decided per platform by
 * `credentialsPerOrg` in the registry. An LLM platform has at most one live row
 * per org and callers resolve it implicitly — "the org's Anthropic key". A
 * connector platform (`jira`, `strapi`, `hubspot`, `granola`, `google`, `slack`,
 * `zoom`) may hold as many
 * live rows as the workspace wants, told apart by `name`, and a
 * `knowledge_source.api_token_id` names the one that connector uses.
 * `api_token_org_platform_live_idx` enforces the cap for the first kind and
 * exempts the second.
 *
 * The `api_token_shape_ck` constraint keeps the two shapes from mixing, and the
 * `api_token_platform_immutable_tg` trigger (migration 0069) stops a row
 * crossing from one to the other after it is written. The trigger is needed
 * because a minted row now carries ciphertext too, so a rewritten `platform`
 * alone would leave a row the constraint happily accepts as a supplied key.
 */
export const apiTokenSchema = pgTable(
  'api_token',
  {
    /** Public token id — the `<id>` segment of `vcn_live_<id>_<secret>`. */
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    /** Which platform this credential belongs to. See `CredentialPlatformId`. */
    platform: text('platform').default('vocion').notNull(),
    /**
     * SHA-256 hex of the secret half, compared on every authenticated request.
     * Set only on `vocion` rows — a supplied third-party key never
     * authenticates into Vocion, so it has nothing to hash.
     */
    secretHash: text('secret_hash'),
    /**
     * FK to the DEK that encrypted `ciphertext`. Null on a `vocion` row issued
     * before minted tokens were kept encrypted.
     */
    dekId: integer('dek_id').references(() => sourceDekSchema.id, { onDelete: 'restrict' }),
    /**
     * AES-256-GCM ciphertext — the supplied key, or the whole minted token so
     * the dashboard can show it again. Null on older `vocion` rows.
     */
    ciphertext: text('ciphertext'),
    /** AES-256-GCM nonce (12 bytes, base64). */
    nonce: text('nonce'),
    /** AES-256-GCM auth tag (16 bytes, base64). */
    authTag: text('auth_tag'),
    /** Masked tail of the credential, e.g. `…4a9F`, for display only. */
    keyHint: text('key_hint'),
    /** authz workspace role the token acts as. */
    role: text('role').default('owner').notNull(),
    /** Explicit authz action grants (empty = the role's defaults). */
    grants: jsonb('grants').$type<string[]>().default([]).notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
    revokedAt: timestamp('revoked_at', { mode: 'date' }),
    /**
     * When the token stops authenticating, or `null` for a token that never
     * expires. Nullable on purpose: every token issued before this column
     * existed keeps working, and a long-lived integration credential is a
     * legitimate choice the person issuing it gets to make.
     */
    expiresAt: timestamp('expires_at', { mode: 'date' }),
  },
  table => [
    index('api_token_org_idx').on(table.orgId),
    // One live credential per platform per org, for the platforms a caller
    // resolves implicitly: "the org's OpenAI key" has to be a single
    // deterministic row rather than a guess. Revoked rows are excluded, which
    // is what makes rotation possible: revoke the old key, store a new one.
    //
    // The excluded platforms are the ones a caller names by row id instead.
    // `vocion` — an org holds as many API tokens as it has integrations — and
    // the connector platforms, where "Strapi — staging" and "Strapi — prod"
    // are both live at once and each connector install points at the one it
    // wants. The list is spelled out because a partial index cannot call into
    // TypeScript; `MANY_CREDENTIAL_PLATFORM_IDS` in
    // `src/libs/platforms/registry.ts` is the copy application code reads, and
    // `registry.test.ts` fails if the two drift.
    uniqueIndex('api_token_org_platform_live_idx')
      .on(table.orgId, table.platform)
      .where(sql`${table.revokedAt} is null and ${table.platform} not in ('vocion', 'granola', 'hubspot', 'jira', 'strapi', 'google', 'slack', 'zoom')`),
    // The two credential shapes must never mix. A `vocion` row carries a secret
    // hash, and either a complete set of encryption columns or none of them —
    // none being a token issued before minted tokens were stored encrypted.
    // Anything else carries ciphertext with everything needed to decrypt it and
    // no hash. Enforced in the database because a half-written row here is a
    // credential that can either not be verified or not be decrypted, and
    // neither failure shows up until someone tries to use it. Declared here as
    // well as in migrations 0067 and 0068 so that `drizzle-kit generate` can see
    // it and does not propose dropping it later.
    check(
      'api_token_shape_ck',
      sql`(
      ${table.platform} = 'vocion'
      and ${table.secretHash} is not null
      and (
        (
          ${table.ciphertext} is null
          and ${table.nonce} is null
          and ${table.authTag} is null
          and ${table.dekId} is null
        ) or (
          ${table.ciphertext} is not null
          and ${table.nonce} is not null
          and ${table.authTag} is not null
          and ${table.dekId} is not null
        )
      )
    ) or (
      ${table.platform} <> 'vocion'
      and ${table.secretHash} is null
      and ${table.ciphertext} is not null
      and ${table.nonce} is not null
      and ${table.authTag} is not null
      and ${table.dekId} is not null
    )`,
    ),
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
    /** Team this brief belongs to; NULL = the workspace-wide ROLLUP brief. */
    teamSlug: text('team_slug'),
    /** Agent that published it (plain slug). */
    agentSlug: text('agent_slug'),
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
    /**
     * Idempotency/upsert key for agent-suggested actions — the review-card
     * system keys on (object type + object id + action slug), e.g.
     * `follow-up:1234:gmail.send`. Re-surfacing the same owed action UPDATES
     * the existing PENDING row instead of piling up duplicates. Nullable:
     * direct/ad-hoc proposals don't set it.
     */
    dedupKey: text('dedup_key'),
    /**
     * When this suggestion goes stale and should drop out of the queue /
     * daily brief / todo recommendations. Nullable = never expires.
     */
    expiresAt: timestamp('expires_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    executedAt: timestamp('executed_at', { mode: 'date' }),
  },
  table => [
    index('action_run_org_status_idx').on(table.orgId, table.status),
    // Lookup for upsert-by-key (dedupe only pending items in code, so a decided
    // action can be re-proposed later — hence a plain index, not unique).
    index('action_run_dedup_idx').on(table.orgId, table.dedupKey),
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
    // The DECISION participates in uniqueness (empty for other event types):
    // a run legitimately receives multiple review.decided signals (rewritten →
    // skipped → approved) and the narrower index silently dropped all but the
    // first (0047).
    uniqueIndex('user_activity_event_resource_idx')
      .on(table.orgId, table.eventType, table.resourceType, table.resourceId, sql`(coalesce(${table.metadata}->>'decision',''))`)
      .where(sql`resource_id IS NOT NULL`),
  ],
);

/**
 * discovery_candidate — the record of a meeting the discovery-detection sweep
 * matched to a CRM party the seller owns, plus (once classified) its
 * is-discovery / proposal-ready scores. Ticket 011.
 *
 * This is the feature's provenance ledger and its safety invariant: a row
 * exists ONLY for meetings that passed the CRM match gate, so the presence of a
 * row is itself the proof that the content gate (§3 of the plan) was satisfied
 * before any transcript was read. Ties to ticket 010 (filed context).
 */
export const discoveryCandidateSchema = pgTable(
  'discovery_candidate',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Meeting document's stable externalId, e.g. `zoom:<uuid>` / `gcal:<eventId>`. */
    meetingExternalId: text('meeting_external_id').notNull(),
    /** knowledge_document.id of the meeting — the handle the content gate reads through. */
    meetingDocId: integer('meeting_doc_id'),
    /** Title + start copied at match time (metadata only — never the transcript body). */
    meetingTitle: text('meeting_title'),
    meetingStart: timestamp('meeting_start', { mode: 'date' }),
    /** Why it matched: 'hubspot-contact' | 'hubspot-company' | 'hubspot-deal' | 'calendly-external'. */
    matchType: text('match_type').notNull(),
    /** The matched CRM ref (`deals:123`, `contacts:9`) or the external domain. */
    matchRef: text('match_ref'),
    /** Human-readable reason the match fired. */
    matchReason: text('match_reason'),
    matchedAt: timestamp('matched_at', { mode: 'date' }).defaultNow().notNull(),
    /** Lifecycle: 'matched' | 'classified' | 'routed' | 'dropped'. */
    status: text('status').default('matched').notNull(),
    /** Two-dimensional classification output (null until Stage 2 runs). */
    classification: jsonb('classification').$type<{
      isDiscovery: boolean;
      isDiscoveryConfidence: number;
      proposalReady: boolean;
      proposalReadyConfidence: number;
      reasoning: string;
      model?: string;
    }>(),
    classifiedAt: timestamp('classified_at', { mode: 'date' }),
    /** Route the supervised router chose: 'generate' | 'confirm' | 'drop'. */
    route: text('route'),
    /** The review-queue action_run this candidate was surfaced as (supervised mode). */
    reviewActionRunId: integer('review_action_run_id'),
    /** knowledge_document.contentHash at read time — which exact transcript version was scored. */
    transcriptHash: text('transcript_hash'),
    /** The thresholds the route was decided under. Without them the route cannot be re-derived. */
    thresholds: jsonb('thresholds').$type<{ discovery: number; ready: number }>(),
    /** Model id + fixed prompt version, e.g. `claude-haiku-4-5-20251001#discovery-v1`. */
    classifierVersion: text('classifier_version'),
    /** Workspace sha in force at assessment — same stamp skill/mission runs carry. */
    workspaceSha: text('workspace_sha'),
    /** Who ordered the assessment: agent slug + the mission_run/user turn behind it. */
    assessedBy: jsonb('assessed_by').$type<{ agentSlug?: string; missionRunId?: number; userId?: string }>(),
    /** Matched-but-not-assessed coverage record: 'no-transcript' | 'out-of-window' | 'not-reached'. */
    skippedReason: text('skipped_reason'),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('discovery_candidate_org_meeting_idx').on(table.orgId, table.meetingExternalId),
    index('discovery_candidate_org_status_idx').on(table.orgId, table.status),
  ],
);

/**
 * lead_brief — the personalization ledger. One row per MQL the agent picked
 * up, carrying the researched brief, the drafted sequence, and the audit
 * trail behind both. Mirrors `discovery_candidate`: the row IS the record of
 * the pass, so a brief that was never logged is unreachable.
 *
 * Dropped and held leads are rows here too. An absence means the sweep never
 * saw the lead, which is what `reconcile_mql_window` checks for.
 */
export const leadBriefSchema = pgTable(
  'lead_brief',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** CRM mirror ref, e.g. `contacts:9412`. The join key back to HubSpot. */
    contactRef: text('contact_ref').notNull(),
    /** Contact identity copied at brief time so the queue renders without a CRM read. */
    contactName: text('contact_name').notNull(),
    contactTitle: text('contact_title'),
    companyName: text('company_name'),
    /** Why the sweep picked it up: 'new' (fresh MQL) | 'stale' (aged, unworked). */
    triggerType: text('trigger_type').notNull(),
    /** How the lead arrived — HubSpot's original source, e.g. 'PAID_SOCIAL'. */
    entranceSource: text('entrance_source'),
    /** The source detail behind it: the ad network, the keyword, the campaign. */
    utmCampaign: text('utm_campaign'),
    /** Prior engagement from the CRM mirror — what makes a lead warm, not our sends. */
    engagementSent: integer('engagement_sent').default(0).notNull(),
    engagementOpened: integer('engagement_opened').default(0).notNull(),
    /**
     * Queue lane: 'queued' | 'ready_for_review' | 'handed_off' | 'held' | 'sent'.
     * Defaults to 'queued' because a row is recorded before any research runs,
     * and a lead with no brief has nothing to review.
     */
    status: text('status').default('queued').notNull(),
    /**
     * Agent's self-assessment, 0..1. The confident/uncertain/speculative
     * label is DERIVED from this in one place (`features/personalization/
     * confidence.ts`) so the ladder can move without a backfill.
     */
    confidence: real('confidence'),
    /** The researched claims. Each carries where it came from and when. */
    claims: jsonb('claims').$type<Array<{
      text: string;
      kind: string;
      source: string;
      date?: string;
    }>>().default([]).notNull(),
    /** What research could NOT retrieve. Shown to the reviewer, never inferred around. */
    missing: jsonb('missing').$type<string[]>().default([]).notNull(),
    /**
     * The brief itself, as written prose the page renders in order. `claims`
     * carries the same research structurally; this is what a reviewer reads.
     * Empty means no brief has been written, which is what keeps a lead off
     * the review screen.
     */
    sections: jsonb('sections').$type<Array<{
      heading: string;
      body: string;
    }>>().default([]).notNull(),
    /**
     * The call prep written when the lead LEAVES the agent — where the thread
     * stands, what triggered the handoff, what to test live. Deliberately
     * separate from `sections`: the review brief answers "should we send this
     * copy" and is written at research time, while this answers "what do I say
     * now that a person is in the conversation" and is written at handoff
     * time, when the reply text and the delivery record exist. A handoff
     * re-run must never touch the review brief.
     */
    handoffSections: jsonb('handoff_sections').$type<Array<{
      heading: string;
      body: string;
    }>>().default([]).notNull(),
    /** Why the lead left: 'reply' | 'intent' | 'routed'. */
    handoffTrigger: text('handoff_trigger'),
    handoffAt: timestamp('handoff_at', { mode: 'date' }),
    /** The reviewer's instruction for the next pass, kept so a rewrite has a reason. */
    regenerateNote: text('regenerate_note'),
    /** Briefing tries so far. Three, then the lead surfaces with its error. */
    briefAttempts: integer('brief_attempts').default(0).notNull(),
    /** Why the last try produced no brief. Rendered where the brief would be. */
    briefError: text('brief_error'),
    /** When the last try was handed out — what spaces the retries an hour apart. */
    lastAttemptAt: timestamp('last_attempt_at', { mode: 'date' }),
    /** The drafted, numbered sends awaiting review. `day` is the send's offset in the recommended sequence's cadence, when known. */
    draftSequence: jsonb('draft_sequence').$type<Array<{
      step: number;
      day?: number;
      subject: string;
      body: string;
    }>>().default([]).notNull(),
    /** The review-queue action_run this brief was surfaced as. */
    reviewActionRunId: integer('review_action_run_id'),
    /**
     * The EXISTING HubSpot sequence the agent recommends enrolling into. The
     * agent never invents a sequence: `save_draft_sequence` verifies the id
     * against the live sequence library when credentials allow.
     */
    recommendedSequence: jsonb('recommended_sequence').$type<{
      id: string;
      name: string;
      reason?: string;
      senderEmail?: string;
      hubspotUserId?: string;
      verified?: boolean;
    }>(),
    /** HubSpot's stage-entry date. Null = the mirror had nothing; display falls back to `arrivedAt`, labeled "Arrived", never as stage timing. */
    mqlAt: timestamp('mql_at', { mode: 'date' }),
    /** Drafting tries so far — same three-try budget as the briefs. */
    draftAttempts: integer('draft_attempts').default(0).notNull(),
    /** Why the last drafting try produced nothing. */
    draftError: text('draft_error'),
    /** When the last drafting try was handed out — the retry floor's anchor. */
    lastDraftAttemptAt: timestamp('last_draft_attempt_at', { mode: 'date' }),
    /** Thresholds in force — without them the confidence call cannot be re-derived. */
    thresholds: jsonb('thresholds').$type<Record<string, number>>(),
    /** Model id + prompt version, e.g. `claude-sonnet-4-6#personalization-v1`. */
    briefVersion: text('brief_version'),
    /** Workspace sha at brief time — the same stamp skill/mission runs carry. */
    workspaceSha: text('workspace_sha'),
    /** Who ordered the pass: agent slug + the mission_run/user turn behind it. */
    briefedBy: jsonb('briefed_by').$type<{ agentSlug?: string; missionRunId?: number; userId?: string }>(),
    /** Picked-up-but-not-briefed coverage record: 'no-contact-data' | 'out-of-window' | 'not-reached'. */
    skippedReason: text('skipped_reason'),
    /** When the lead arrived — the CRM create date, copied at queue time. */
    arrivedAt: timestamp('arrived_at', { mode: 'date' }),
    briefedAt: timestamp('briefed_at', { mode: 'date' }),
    decidedAt: timestamp('decided_at', { mode: 'date' }),
    decidedBy: text('decided_by'),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    // One brief per lead — this is what makes a re-fire of the sweep a no-op.
    uniqueIndex('lead_brief_org_contact_idx').on(table.orgId, table.contactRef),
    index('lead_brief_org_status_idx').on(table.orgId, table.status),
  ],
);

// Re-export `sql` so callers can build the GENERATED-ALWAYS-AS-STORED
// tsvector expression in raw migrations. Not used at query-time.
export { sql };
