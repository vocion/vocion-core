import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { BriefingV2 } from '@/services/briefings/document';
import type { StoredClassification } from '@/services/discovery/classification';
import { relations, sql } from 'drizzle-orm';
import { bigint, boolean, check, customType, doublePrecision, index, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex, vector } from 'drizzle-orm/pg-core';

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

// Before hand-writing a migration, read packages/core/migrations/CONVENTIONS.md.
// An index on a table that already exists must not use a plain `CREATE INDEX` —
// it blocks every write to that table until the build finishes — and column
// changes go through expand and contract across releases. `npm run
// check:migrations` enforces the index rule and runs in CI.

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

/**
 * The role a person holds IN ONE WORKSPACE. Mirrors `WorkspaceRole` in
 * `services/authz.ts`, which owns the grant model these map to; the DDL pins
 * the same four with a CHECK. Declared here rather than imported so the schema
 * stays free of service imports — `workspaceAccessRole.test.ts` fails if the
 * two ever drift.
 */
type WorkspaceAccessRole = 'owner' | 'pm' | 'specialist' | 'client_reviewer';

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
     * `shared` — a workspace the team works in, the only kind before 0142.
     * `personal` — one person's own workspace, holding their exec assistant.
     *
     * The distinction is load-bearing in two places that have nothing to do
     * with the UI: a personal workspace is never a target of a group grant,
     * and the deploy's stale-row sweep keys on this rather than on a list of
     * known slugs (a slug list swept every personal workspace's agents,
     * missions and ingested mail on every deploy).
     */
    kind: text('kind').$type<'shared' | 'personal'>().default('shared').notNull(),
    /** Set iff `kind = 'personal'`: the person the workspace belongs to. */
    ownerUserId: text('owner_user_id').references(() => userSchema.id, { onDelete: 'set null' }),
    /**
     * Optional dashboard surfaces this workspace switched on, by registry id
     * (`features/navigation/surfaces.ts`). Authored as top-level `surfaces:`
     * in workspace.yaml and replaced wholesale at apply. Empty = the default
     * sidebar only.
     */
    enabledSurfaces: jsonb('enabled_surfaces').$type<string[]>().default([]).notNull(),
    /**
     * Plugins this workspace turned on (migration 0124), by slug, dependency-
     * closed and in load order — `workspace.yaml` `plugins:` as the loader
     * resolved it (`libs/workspace/plugins.ts`). Replaced wholesale at apply.
     * Read by the shell (plugin-owned nav rows), the agent runtime
     * (plugin-owned tools, the capabilities note) and the collectors that
     * only run for a workspace that asked for them. Empty = no plugins.
     */
    enabledPlugins: jsonb('enabled_plugins').$type<string[]>().default([]).notNull(),
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
    /**
     * Which workspace skill regenerates each review-item type's card, keyed
     * by action id (`personalization.enroll` → `regenerate-sequence-copy`).
     * Authored as `defaults.regenerateSkills` in workspace.yaml; read by the
     * scoped skill-turn executor, so core never hardcodes a workspace slug.
     * NULL or a missing key = no fast path; the action's regenerate falls
     * back to its full pass.
     */
    regenerateSkills: jsonb('regenerate_skills').$type<Record<string, string>>(),
    /**
     * Which document playbooks are client-facing (migration 0125), and so
     * cannot be printed to a PDF until the document has been read as the
     * sceptical buyer on its current version. Authored as
     * `defaults.clientFacingPlaybooks` in workspace.yaml; read by the export
     * gate (`services/documents/exportGate.ts`).
     *
     * NULL means the workspace authored none and core's defaults apply
     * (`proposal`, `scope`, `partnership-update`). An empty ARRAY is a
     * workspace that deliberately gates nothing — the distinction is the
     * whole reason this is nullable rather than defaulting to `[]`.
     */
    clientFacingPlaybooks: jsonb('client_facing_playbooks').$type<string[]>(),
    /**
     * How eager this workspace is to improve itself, 0–10 (migration 0127).
     *
     * Moves the confidence bar for the class of actions that change what the
     * system knows about how to work — adopting a rule from a correction
     * today, more nouns later (`libs/actions/eagerness.ts`; an action opts in
     * with `selfImproving`). 0 always asks; 10 runs on anything it is plainly
     * confident about. It never moves the confidence itself, so an inferred
     * rule still asks at 10.
     *
     * Authored as `defaults.learningEagerness` in workspace.yaml. NULL means
     * the workspace authored nothing and the shipped default (7) applies — a
     * column default would make "unset" and "deliberately 7" the same fact.
     */
    learningEagerness: integer('learning_eagerness'),
    /**
     * The workspace's voice rules (migration 0108) — the banned constructions
     * outbound copy is linted against before it can reach a review queue.
     * Authored as `workspace/<org>/voice.yaml`; shape is
     * `libs/workspace/schemas.ts` `VoiceManifestSchema`, read through
     * `libs/writing/loadVoiceRules.ts` which merges it over core's platform
     * floor. NULL = the floor only.
     *
     * A workspace setting rather than a per-agent one on purpose: the voice
     * belongs to the person whose name is on the send, and two agents drafting
     * for the same signature must not disagree about it.
     */
    voiceRules: jsonb('voice_rules').$type<{
      never?: Array<{ id?: string; pattern: string; match?: 'phrase' | 'regex'; reason: string }>;
      prefer?: Array<{ pattern: string; match?: 'phrase' | 'regex'; use: string; reason?: string }>;
      allow?: string[];
      maxWordsPerSend?: number;
      maxAsksPerSend?: number;
      noExclamation?: boolean;
      noEmoji?: boolean;
      noEmDash?: boolean;
      playbook?: string;
      learningStep?: string;
    }>(),
    /**
     * The workspace's top-line goal — one sentence every team's weight and
     * progress is read against on the team report. Authored as top-level
     * `goal:` in workspace.yaml. NULL = none stated.
     */
    goal: text('goal'),
    /**
     * The workspace's operating intent (migration 0135): what a person wants
     * the factory doing now: outcomes, priorities, constraints, budget,
     * autonomy policy and product judgment. Authored as workspace-as-code in
     * `operating-intent.yaml`, shape in `libs/workspace/schemas.ts`
     * `OperatingIntentManifestSchema`, composed into the prompts of the agents
     * that choose and prioritise work.
     *
     * NULL = the factory has been told nothing. That is deliberately not the
     * same fact as an authored intent with empty lists, which is a person
     * saying there are no constraints; the agents report the two differently.
     */
    operatingIntent: jsonb('operating_intent').$type<{
      outcomes?: Array<{ statement: string; because?: string; by?: string }>;
      priorities?: Array<{ statement: string; over?: string }>;
      constraints?: Array<{ statement: string; because?: string }>;
      budget?: { limitCents: number; window: 'day' | 'week' | 'month'; note?: string };
      autonomy?: Array<{ actionClass: string; policy: 'unattended' | 'ask' | 'never'; because?: string }>;
      productJudgment?: string[];
      reviewedAt?: string;
    }>(),
    /**
     * The workspace's mailbox (migration 0097): the address people write to,
     * answered by the workspace lead. Authored as `mailbox:` in workspace.yaml;
     * default address `<slug>@<VOCION_MAIL_DOMAIN>`. Null/false = no mailbox.
     */
    mailboxAddress: text('mailbox_address'),
    mailboxEnabled: boolean('mailbox_enabled').default(false).notNull(),
    /**
     * IANA zone the workspace lives in (`defaults.timezone` in workspace.yaml).
     * The day boundary for everything no browser is behind — missions,
     * briefings, mail — and the fallback when a turn arrives without one.
     */
    timeZone: text('time_zone'),
    /**
     * The workspace's off switch (migration 0132) — a person's hold on
     * everything the factory does by itself: automation fires, mission runs,
     * worker runs, and gated actions that are not a hand-off. Chat with an
     * agent stays open; a turn that tries one of those is refused with this
     * note. `services/workspacePause.ts` is the one guard every caller uses.
     *
     * A DIFFERENT fact from `automation.paused_at`, and that is the point: a
     * workspace pause writes no automation row, so resuming the workspace
     * restores exactly the per-automation state that was there before. An
     * automation someone paused last Tuesday is still paused afterwards,
     * because nothing touched it.
     *
     * NULL = running. `pausedBy` is the `user.id`, or `token:<id>` when an
     * API token placed the hold; the name is resolved when shown. Never
     * written by `workspace:apply` — a deploy does not lift a person's stop.
     */
    pausedAt: timestamp('paused_at', { mode: 'date' }),
    pausedBy: text('paused_by'),
    pausedNote: text('paused_note'),
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
/* Workspace access (0142)                                               */
/*                                                                       */
/* Account membership says a person is in the deployment. These say      */
/* WHICH workspaces they reach and at what role:                         */
/*                                                                       */
/*   user_group ──< user_group_member >── user                           */
/*        │                                                              */
/*        └──< group_project_grant >── project     (role per workspace)   */
/*                                                                       */
/*   project_member                                 (a direct grant)     */
/*                                                                       */
/* `user_group`, never `team`: `team` above is an org chart of AGENTS.    */
/* A group grant is resolved at READ time rather than expanded into      */
/* project_member rows, so removing someone from a group takes effect on */
/* their next request instead of waiting for a re-expansion.             */
/* ==================================================================== */

/** A named group of people, e.g. the sales team or the delivery team. */
export const userGroupSchema = pgTable(
  'user_group',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => tenantAccountSchema.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /**
     * 'yaml' | 'ui'. Provenance for display only. It never gates a write:
     * `people:apply` is create-if-absent and never updates a row that exists,
     * whichever door made it.
     */
    managedFrom: text('managed_from').$type<'yaml' | 'ui'>().default('ui').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('user_group_account_slug_idx').on(table.accountId, table.slug),
  ],
);

/** Who is in a group. */
export const userGroupMemberSchema = pgTable(
  'user_group_member',
  {
    groupId: text('group_id').notNull().references(() => userGroupSchema.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => userSchema.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { mode: 'date' }).defaultNow().notNull(),
    /** A user id, or 'yaml' when the seed applier put the row there. */
    addedBy: text('added_by'),
  },
  table => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    // The resolver asks what a PERSON may reach, and `user_id` trails the key.
    index('user_group_member_user_idx').on(table.userId),
  ],
);

/** What a group grants: one workspace, at one role. */
export const groupProjectGrantSchema = pgTable(
  'group_project_grant',
  {
    groupId: text('group_id').notNull().references(() => userGroupSchema.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull().references(() => projectSchema.id, { onDelete: 'cascade' }),
    /** A `WorkspaceRole` (`services/authz.ts`), constrained in the DDL. */
    role: text('role').$type<WorkspaceAccessRole>().notNull(),
    grantedAt: timestamp('granted_at', { mode: 'date' }).defaultNow().notNull(),
    grantedBy: text('granted_by'),
  },
  table => [
    primaryKey({ columns: [table.groupId, table.projectId] }),
    index('group_project_grant_project_idx').on(table.projectId),
  ],
);

/** A person granted one workspace directly, outside any group. */
export const projectMemberSchema = pgTable(
  'project_member',
  {
    projectId: text('project_id').notNull().references(() => projectSchema.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => userSchema.id, { onDelete: 'cascade' }),
    role: text('role').$type<WorkspaceAccessRole>().notNull(),
    /**
     * Why the row exists: 'direct' (someone granted it) or 'owner' (the person
     * a personal workspace belongs to). Group grants never appear here.
     */
    source: text('source').$type<'direct' | 'owner'>().default('direct').notNull(),
    addedAt: timestamp('added_at', { mode: 'date' }).defaultNow().notNull(),
    addedBy: text('added_by'),
  },
  table => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index('project_member_user_idx').on(table.userId),
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
      /**
       * Which machinery runs this agent's turn:
       *   - 'in-process' — our deepagents loop, in this process
       *   - 'agentcore-container' — the same loop, in our container on AWS
       *     AgentCore Runtime
       *   - 'aws-managed-harness' — AWS owns the loop; the agent is reduced to
       *     configuration and one tool
       *
       * Left unset by workspace:apply on purpose — `defaultHarnessTargetFor`
       * derives it from `modelProvider`, and a stored value would shadow that.
       */
      runsOn?: 'in-process' | 'agentcore-container' | 'aws-managed-harness' | 'external-worker';
      /**
       * Pre-rename spelling of `runsOn`, kept for rows written before the
       * rename. Read through `normalizeHarnessTarget`, never written.
       */
      provider?: 'local' | 'agentcore' | 'runtime';
      interrupts?: string[];
      maxTokens?: number;
      /** Graph steps one turn may take; unset keeps each provider's own backstop. See `services/agents/stepLimit.ts`. */
      maxSteps?: number;
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
      /**
       * Cache this agent's prompt prefix at the vendor. Unset means the
       * process default (on), so this exists to turn caching OFF for one
       * agent — a prompt that changes on every turn pays the 1.25x write
       * rate for a cache nothing ever reads back. See `libs/llm/promptCache.ts`.
       */
      promptCache?: boolean;
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
    /**
     * The face this agent wears on a chat surface: the name and avatar a
     * Slack reply is posted under (`chat:write.customize`). A channel
     * binding's own persona still wins — that is an explicit per-channel
     * override — so this is what the agent looks like everywhere else.
     * NULL means the app's own name and icon, as before personas existed.
     * A persona is presentation only: it changes no identity and no
     * authorisation, and must never imply a human.
     */
    persona: jsonb('persona').$type<{ displayName?: string; iconUrl?: string }>(),
    /** CSS color name for the agent's chat header / sidebar (v0.2). */
    accent: text('accent'),
    /** Short tagline shown above the chat title (v0.2). */
    eyebrow: text('eyebrow'),
    /**
     * What this agent answers for — short topics, intents or example asks
     * (`handles: [wiki, standing rules, research]`). The router matches a
     * message against these first, then the description and suggestions
     * (`services/agents/router.ts`). Empty means the agent is reached only by
     * name, by delegation, or as the workspace lead's default.
     */
    handles: jsonb('handles').$type<string[]>().default([]).notNull(),
    /**
     * How much the agent volunteers: `low` | `normal` | `high`. Breaks routing
     * ties, decides whether a turn ends with an offer to carry the work
     * forward, and whether the agent takes part in debriefs — the automations
     * that turn completed work into updates. NULL reads as `normal`, so a row
     * applied before the column exists behaves exactly as it did.
     */
    initiative: text('initiative').$type<'low' | 'normal' | 'high'>(),
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
/**
 * One team KPI as stored on `team.kpis`. `source` names what is counted:
 * `counts.<key>` sums that key of `worker_run.counts` over the team's agents,
 * within `window` (default: all time).
 */
export type TeamKpi = {
  key: string;
  label: string;
  target: number;
  /** Where the reading stood when the contract was set; progress is measured from here. */
  baseline?: number;
  unit?: string;
  source: string;
  window?: '24h' | '7d' | 'all';
};

/**
 * Where a measure's reading comes from (`docs/specs/team-report-v2.md` §2).
 * Mirrors `MeasureSourceSchema` in `libs/workspace/schemas.ts`; stored as
 * authored, read by `services/team-report/provenance.ts`.
 */
export type TeamMeasureSource
  = | { kind: 'verified'; connector: 'hubspot'; query: { object: 'deals' | 'contacts' | 'companies'; filter: { dealStages?: string[]; pipelines?: string[]; dealStatus?: 'open' | 'closed'; lifecycleStages?: string[]; industries?: string[]; ownerIds?: string[] }; aggregate: string } }
    | { kind: 'verified'; connector: 'web-analytics'; query: { metric: 'sessions' | 'users' | 'conversions' | 'signups'; filter: { pathPrefix?: string; channel?: string; event?: string } } }
    | { kind: 'observed'; actions?: string[]; counts?: string; rows?: 'workspace-members' | 'artifacts' | 'data-rooms' | 'data-room-sources'; where?: { kind?: string; folder?: string; playbook?: string; verified?: boolean } }
    | { kind: 'human-confirmed'; actions?: string[]; askKinds?: string[] }
    | { kind: 'agent-reported'; counts: string };

/**
 * One team measure as stored on `team.measures` — the outcome contract's
 * measurement half. Attainment, trend, cost per outcome and human load are
 * DERIVED from readings at report time and never stored (manifesto #2).
 */
export type TeamMeasure = {
  key: string;
  label: string;
  dimension: 'outcome' | 'quality' | 'velocity' | 'economics';
  target: number;
  baseline?: number;
  unit?: string;
  window: '24h' | '7d' | '30d' | 'quarter';
  direction: 'higher' | 'lower';
  source: TeamMeasureSource;
  contributesTo?: 'workspace-goal';
  weight?: number;
};

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
    /** The team's standing goal, authored as `goal:` in teams/<slug>.yaml. */
    goal: text('goal'),
    /**
     * @deprecated Legacy `kpis:` (F3) — worker-reported counts only. Kept for
     * one release so rows applied before `measures` existed still read; the
     * report folds them in as `agent-reported` measures when `measures` is
     * empty. No longer written by apply.
     */
    kpis: jsonb('kpis').$type<TeamKpi[]>().default([]).notNull(),
    /**
     * The measures the team is graded on, with provenance (migration 0100).
     * Authored as `measures:` in teams/<slug>.yaml; a legacy `kpis:` block is
     * folded in at parse. Readings are computed at report time — never stored.
     */
    measures: jsonb('measures').$type<TeamMeasure[]>().default([]).notNull(),
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
    /**
     * `{schedule: cron}` | `{event: type | [types], filter?, maxFiresPer10m?}` —
     * an array fires on any of the named types. `maxFiresPer10m` is the
     * event-when's ceiling (default 6, `services/automations/fireGuards.ts`):
     * fires beyond it in a ten-minute window are held and coalesced into one.
     */
    whenConfig: jsonb('when_config').$type<{ schedule?: string; event?: string | string[]; filter?: Record<string, unknown>; maxFiresPer10m?: number }>().notNull(),
    /** `{workflow: '<slug>', input?}` | `{checkMission: '<slug>', prompt?}` (prompt = the authored execution orders for each check) | `{job: '<name>', input?}` (built-in server job). */
    doConfig: jsonb('do_config').$type<{ workflow?: string; checkMission?: string; job?: string; prompt?: string; input?: Record<string, unknown> }>().notNull(),
    /** Owning agent slug. Nullable — `checkMission` inherits the owner from its mission; `job`/`workflow` set it here so the schedule rolls up to an agent. */
    ownerAgentSlug: text('owner_agent_slug'),
    /**
     * A person's pause, held apart from the authored `status`. `status` is what
     * the YAML says and is replaced on every apply; this is an operational hold
     * a person placed from the app, and apply leaves it alone. Set together:
     * when, who (`user.id`), and the note they left. All null when not paused.
     */
    pausedAt: timestamp('paused_at', { mode: 'date' }),
    pausedBy: text('paused_by'),
    pausedNote: text('paused_note'),
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
    /** Which do-type dispatched: 'workflow' | 'mission_check' | 'job' — or 'control' for a person's pause/resume and 'skipped' for a fire the matcher refused (its own run's event, or the rate ceiling), recorded here so the log holds the whole history. */
    kind: text('kind').notNull(),
    /** 'running' | 'ok' | 'error'. */
    status: text('status').default('running').notNull(),
    /** `automation:<slug>` for a schedule fire, `dashboard:test-run` for a test run, `user:<id>` for a person's pause or resume. */
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
  /**
   * The automation fires that led to this run, newest first — the check that
   * started it, then whatever started that. Null for a run a person or the
   * planner started. Rides every event the run raises, so an automation is
   * never fired by its own run's residue (`services/automations/fireGuards.ts`).
   */
  causedBy: jsonb('caused_by').$type<Array<{ automationSlug: string; automationRunId?: number; missionRunId?: number }>>(),
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
// `server/learnings.py` for the originating pattern.

/**
 * The namespace manifest — the whitelist of memory buckets, seeded by
 * `workspace:apply` (successor of `learning_step`, which it replaced in
 * migration 0103/0104). A namespace is a scoped shelf in the memory store:
 * `workspace/<name>` for org-wide buckets today; agent / object / user /
 * workflow / mission / run scopes arrive in Phase 2 of the scoped-memory
 * plan. Rules live in the `memory` table under the namespace's `path`.
 */
export const memoryNamespaceSchema = pgTable(
  'memory_namespace',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Short slug, e.g. `crm-updates`. What agents' `learningSteps` lists name. */
    name: text('name').notNull(),
    /**
     * Which kind of Vocion entity scopes this namespace:
     * 'workspace' | 'agent' | 'object' | 'user' | 'workflow' | 'mission' | 'run'.
     * Phase 1 migrates every step as 'workspace'; the rest arrive in Phase 2.
     */
    scopeKind: text('scope_kind').default('workspace').notNull(),
    /** The scoped entity: agent slug, user id, `type/id` for an object; null for workspace scope. */
    scopeRef: text('scope_ref'),
    /**
     * The namespace's directory inside the store, e.g. `workspace/crm-updates`
     * or `agents/revenue-lead/procedures`. Rules are files under
     * `/memories/<path>/`. Derived from (scopeKind, scopeRef, name) at write
     * time and stored so reads never re-derive it.
     */
    path: text('path').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    /** Optional intro surfaced above the rules in the agent's memory digest. */
    preamble: text('preamble'),
    /** Which agent slugs mount this namespace (workspace-scoped ones; narrower scopes attach by ref). */
    agentSlugs: jsonb('agent_slugs').$type<string[]>().default([]).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('memory_namespace_org_name_idx').on(table.orgId, table.name),
    uniqueIndex('memory_namespace_org_path_idx').on(table.orgId, table.path),
  ],
);

/**
 * The memory store — the generic LangGraph `BaseStore` backing table
 * (`libs/memory/store.ts` implements the protocol over it). One row per
 * stored item; for approved rules the key is the rule's file path
 * (`/memories/<namespace path>/<key>.md`), the value is FileData-compatible
 * (`content`, `mimeType`, `created_at`, `modified_at`) so deepagents'
 * StoreBackend can read it as a file, plus a `meta` block carrying
 * provenance (source, createdBy, occurrenceCount, polarity, adoptedAt).
 *
 * Content is rendered ONCE, at write time — runtime reads never re-render.
 * The human approval gate is the only write path for behavior-changing
 * entries; agents get read-only access (a write-deny permission on
 * `/memories/**` in both loops).
 */
export const memorySchema = pgTable(
  'memory',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** BaseStore namespace WITHIN the org (the org rides the column, not the array). `{memories}` today. */
    namespace: text('namespace').array().notNull(),
    /** Store key; for rule entries, the full file path. */
    key: text('key').notNull(),
    value: jsonb('value').$type<Record<string, unknown>>().notNull(),
    /** Phase 4: episodic entries expire; null = permanent. Expired rows are invisible to reads. */
    expiresAt: timestamp('expires_at', { mode: 'date' }),
    /**
     * Staleness signal: when an agent last had this entry mounted. A dedicated
     * column (not value.meta) so stamping never rewrites the jsonb or churns
     * `updated_at`.
     */
    lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('memory_org_ns_key_idx').on(table.orgId, table.namespace, table.key),
  ],
);

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
    /**
     * Where the conversation started (migration 0097): 'app' (the dock or the
     * full page), 'slack', 'email'. Presentation hint for history — an
     * envelope chip on a thread that began as a mail — never authorisation.
     */
    surface: text('surface').default('app').notNull(),
    /**
     * Where the conversation STARTED: the page context of its first turn
     * (path, title, the record the page was about, the highlighted passage).
     * Set once; later turns carry their own context on the wire only. Null
     * for threads opened from the hotkey or the full-page chat with nothing
     * in view. Shape: `PageContext` in services/chat/pageContext.ts.
     */
    contextJson: jsonb('context_json').$type<import('@/services/chat/pageContext').PageContext>(),
    /**
     * How recommended actions behave in this thread (0094): `ask` — each
     * recommendation is a card the person taps into the review queue;
     * `act-within-bounds` — recommendations are proposed as they arrive and
     * the card reports "in review". Neither executes anything; the review
     * queue and trust rules still gate every outward action. Text, not an
     * enum, so a new rung is a code change.
     */
    // Done for you by default since 2026-09-18 (migration 0123); a person can pull a thread back to 'ask'.
    autonomy: text('autonomy').default('act-within-bounds').notNull(),
    /** How strong a model answers this thread (`libs/llm/modelPrefs.ts`): fast | balanced | deep. Null = balanced, the agent's own. */
    modelStrength: text('model_strength').$type<'fast' | 'balanced' | 'deep'>(),
    /** How much it thinks: off | low | medium | high. Null = off. */
    thinkingEffort: text('thinking_effort').$type<'off' | 'low' | 'medium' | 'high'>(),
    messageCount: integer('message_count').default(0).notNull(),
    /**
     * When the conversation was judged over — no turn for the idle window
     * the `sweep-idle-conversations` job runs with — and `conversation.ended`
     * was raised for it. Cleared by the next message, so a thread picked up
     * again ends again later, under a new dedupe key. NULL means open.
     */
    endedAt: timestamp('ended_at', { mode: 'date' }),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    // Full-text search over titles for the rail's history search. Built
    // CONCURRENTLY in migrations/concurrent/0094 — declared here for the ORM.
    index('conversation_title_fts_idx').using('gin', sql`to_tsvector('simple', ${table.title})`),
    // Not unique. It serves `listConversations`, which filters on org and agent
    // and sorts by `updated_at` — a sort key, not an identity. Uniqueness only
    // meant that two conversations with one agent landing in the same
    // millisecond could not both exist, which two people opening a chat at once
    // would hit, and which `$onUpdate` could reproduce on two rows bumped
    // together.
    index('conversation_org_agent_updated_idx').on(table.orgId, table.agentSlug, table.updatedAt),
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
   * How this message reached its agent, when the workspace chose one rather
   * than the person: the candidates considered, the slug picked and why
   * (`RoutingDecision` in services/agents/router.ts). On the `user` row the
   * decision was made for. NULL when the agent was named — by the composer,
   * an `@mention`, a channel binding — or for assistant turns.
   */
  routingJson: jsonb('routing_json').$type<import('@/services/agents/router').RoutingDecision>(),
  /**
   * Which agent spoke an assistant turn — the slug the runtime actually ran,
   * stamped when the row is written. The transcript's "via <specialist>"
   * eyebrow reads THIS after a reload, never a guess made on the client
   * before the turn ran (backlog 009: a label that said "via QA" on a turn
   * the product manager answered). NULL on user rows and on turns written
   * before the column existed.
   */
  agentSlug: text('agent_slug'),
  /**
   * Structured breadcrumb array for the chat UI: a series of text
   * runs interleaved with tool breadcrumbs. Tool entries are dropped
   * when this row is replayed as history to the agent.
   */
  runsJson: jsonb('runs_json').$type<Array<
    | { type: 'text'; text: string }
    | { type: 'tool'; name: string; input?: Record<string, unknown>; output?: string; state?: 'pending' | 'done' | 'error' }
    | { type: 'card'; id?: string; kind?: string; label: string; actionId: string; input?: Record<string, unknown>; runId?: number; state?: string }
    | { type: 'card_decision'; cardId: string; action: string; runId?: number; label?: string }
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
    labels?: { running: string; done: string };
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
   * How the turn ended — one of `services/chat/turnStatus.ts`'s values:
   * `complete`, `incomplete`, `failed`, `refused`, `stopped`, `truncated`,
   * `continued`. NULL means the row predates the vocabulary and is treated as
   * `complete`, which is what those rows were.
   *
   * Free-form text rather than an enum on purpose: the vocabulary is young and
   * a new ending should not need a migration. `TurnStatus` and the tests around
   * it are what keep it honest.
   *
   * Three things read it — the notice under the turn, whether the text is
   * replayed to the model next turn (`toHistoryTurns` drops `incomplete`,
   * `failed` and `refused`), and any count of how turns are ending.
   */
  status: text('status'),
  /**
   * Why the turn ended that way, in the runtime's own words — "Budget exceeded
   * for …", "socket hang up". NULL on an ordinary turn. Shown under the notice
   * so a person reporting a broken turn can say what happened, and so the same
   * turn reads the same way after a reload as it did live.
   */
  statusReason: text('status_reason'),
  /**
   * Agent's self-assessment of confidence for this turn — same enum as
   * skill_run.confidence. Nullable when the runtime doesn't expose a
   * signal (most current paths). Powers the <ConfidenceIndicator /> in
   * AgentMessage.
   */
  confidence: text('confidence'),
  /**
   * A thumb on this assistant turn (0094): `up` | `down` | null. The optional
   * note beside it is what teaches the system — queued for the feedback
   * classifier and, when it proposes a rule, a pending learning candidate.
   */
  feedbackRating: text('feedback_rating'),
  feedbackNote: text('feedback_note'),
  feedbackAt: timestamp('feedback_at', { mode: 'date' }),
  feedbackBy: text('feedback_by'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, table => [
  // Full-text search over message content for the rail's history search.
  // Built CONCURRENTLY in migrations/concurrent/0094 — declared here for the ORM.
  index('conversation_message_content_fts_idx').using('gin', sql`to_tsvector('simple', ${table.content})`),
]);

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
/**
 * Per-user sidebar preferences: pinned nav URLs in pin order and dismissed
 * shell prompts. One row per (org, user); localStorage is the fast path and
 * this is the cross-device truth. Migration 0098.
 */
export const userNavPrefSchema = pgTable(
  'user_nav_pref',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    userId: text('user_id').notNull(),
    pins: jsonb('pins').$type<string[]>().default([]).notNull(),
    dismissed: jsonb('dismissed').$type<string[]>().default([]).notNull(),
    /**
     * Page slug -> ISO instant this person last opened that page. Absent slug
     * means never opened, and a surface that says "since you last looked"
     * must say so rather than substitute a window. Migration 0133.
     */
    pageSeen: jsonb('page_seen').$type<Record<string, string>>().default({}).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex('user_nav_pref_org_user_idx').on(table.orgId, table.userId),
  ],
);

export const chatWidgetStateSchema = pgTable(
  'chat_widget_state',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    userId: text('user_id').notNull(),
    agentSlug: text('agent_slug').notNull(),
    conversationId: integer('conversation_id').references(() => conversationSchema.id, { onDelete: 'set null' }),
    /**
     * The rail's width in px and whether it is open (0094), so a second
     * browser opens it the way the first left it. localStorage is the fast
     * path; this row is what a new device reads. Null = never set.
     */
    railWidth: integer('rail_width'),
    railOpen: boolean('rail_open'),
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
    /**
     * Which grader scores this dataset: `vocion` for our own judge, `agentcore`
     * for AWS.
     *
     * One grader per dataset, chosen in the workspace file. Two graders scoring
     * the same cases produced two numbers that disagreed with no way to say
     * which was right, and a run list that looked like the agent had been run
     * twice. Comparing graders is still possible — copy the dataset and point
     * the copy at the other one — but it is then an explicit thing someone set
     * up, not the default reading of every page.
     */
    provider: text('provider').default('vocion').notNull(),
    /**
     * Pass rate a run of this dataset has to reach before `eval:run` exits 0.
     *
     * Null means the runner's own floor decides, which is what every dataset
     * written before this column had. It belongs to the dataset because the
     * right bar differs between them: a handful of deterministic cases can be
     * held to all of them passing, while a set spread across a dozen live
     * sites will lose one to a page redesign and should not fail a build for
     * it.
     */
    passThreshold: doublePrecision('pass_threshold'),
    description: text('description'),
    /**
     * Test cases, the same shape `EvalDatasetItem` in
     * `services/evals/types.ts` describes. Spelled out again here rather than
     * imported, because a model reaching into a service is a cycle waiting to
     * happen.
     *
     * It listed only the first four fields once, while the applier wrote all
     * of them and every reader cast the column back to the full type. A
     * declaration that lies costs the next writer the ground truth AgentCore
     * scores against, so it says everything we store.
     */
    items: jsonb('items').$type<Array<{
      input: string;
      expectedOutput?: string;
      rubric?: string;
      tags?: string[];
      /** Tool names the agent should call, in order. */
      expectedTrajectory?: string[];
      /** Natural-language facts the answer must contain, read by a judge. */
      assertions?: string[];
      /** Deterministic checks, run in this process. `EvalCheck` in the same file. */
      checks?: Array<Record<string, unknown>>;
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
  /**
   * The model the agent under test ran on when the caller named one (the
   * model-upgrade test does). NULL = the agent's own configured model, which
   * is what every run before this column existed used.
   */
  model: text('model'),
  /**
   * Which scorer produced this run's scores — `vocion` for our own judge,
   * `agentcore` for AWS. One execution can be graded by several providers,
   * one run row each, so their histories stay separate while the transcript
   * they graded is the same one.
   */
  provider: text('provider').default('vocion').notNull(),
  /**
   * The dataset's `version` at the moment this run happened. A trend line
   * that blends runs taken against different item sets is lying about
   * improvement, and `workspaceSha` only catches prompt drift. NULL on runs
   * recorded before this column existed — they genuinely do not know which
   * items they used, and saying so is better than guessing.
   */
  datasetVersion: integer('dataset_version'),
  /**
   * The one execution a set of provider runs share. Set by the refresh
   * workflow and unique per provider, so a retried activity collides instead
   * of adding a second trend point for work that only happened once. NULL for
   * a run started outside a workflow.
   */
  runGroupId: text('run_group_id'),
  /** running | succeeded | failed */
  status: text('status').default('running').notNull(),
  /**
   * Why the run failed, in the grader's own words. A run that died because AWS
   * refused the whole request is a different problem from one whose cases
   * failed on their merits, and a bare "failed" badge tells a reader neither.
   * NULL while a run is running and on every run that finished.
   */
  errorMessage: text('error_message'),
  metrics: jsonb('metrics').$type<{
    /** Null when no score said pass or fail; see `scoresWithoutVerdict`. */
    passRate?: number | null;
    /**
     * Scores that ran but gave no pass-or-fail verdict — AWS's ratings on
     * their own scales. Tells a null pass rate that means "rated, not gated"
     * apart from one that means "nothing was scored".
     */
    scoresWithoutVerdict?: number;
    toolCallCount?: number;
    medianLatencyMs?: number;
    failed?: number;
    passed?: number;
    /** Sum of per-case `usage.cents`; 0 when the model is unpriced. */
    totalCents?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    /** Mean model turns per case — retries and tool loops make this climb. */
    meanTurns?: number;
    /** totalCents / passed — the number the model-upgrade test compares. Null when nothing passed. */
    costPerPassedCaseCents?: number | null;
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
  /**
   * What this one case cost: the agent run's token usage priced by
   * `tokenCostMicroCents`, plus how many model turns and tool calls it took.
   * NULL on rows written before the column existed and on errored cases.
   */
  usage: jsonb('usage').$type<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cents: number;
    turns: number;
    toolCalls: number;
  }>(),
  /**
   * The tool names this case called, in the order it called them. AgentCore's
   * trajectory evaluators compare this against an expected sequence, and that
   * comparison is the one thing AgentCore scores without a model call. Before
   * this column only the count survived, in `usage.toolCalls`, which cannot
   * tell "looked up the order then refunded" from "refunded then looked up".
   * Empty array on a case whose agent run threw; NULL on rows written before
   * the column existed.
   */
  trajectory: text('trajectory').array(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

/**
 * One evaluator's opinion of one run, or of one case within it.
 *
 * Separate from `eval_case_result` because a case graded by AgentCore comes
 * back as an array — one result per evaluator, on scales that do not compare
 * to each other. "Tool selection was 0.8" and "the answer was Perfectly
 * Correct" are both true of the same case and neither is the score.
 *
 * `runId` rather than `caseResultId` alone: a transcript belongs to exactly
 * one run, so a second provider's run row would have no case children and
 * nothing could join its scores back to it.
 *
 * `caseResultId` is nullable because TRACE- and SESSION-level evaluators
 * judge a whole run rather than one case, and forcing those onto a case would
 * leave them nowhere to go.
 *
 * Rows are append-only. A score measures one execution at one moment;
 * overwriting it to show "the latest" destroys the history the trend line is
 * made of. Re-scoring means a new run.
 */
export const evalScoreSchema = pgTable('eval_score', {
  id: serial('id').primaryKey(),
  runId: integer('run_id').notNull().references(() => evalRunSchema.id, { onDelete: 'cascade' }),
  /** NULL for a score about the whole run rather than one case. */
  caseResultId: integer('case_result_id').references(() => evalCaseResultSchema.id, { onDelete: 'cascade' }),
  /** `vocion` | `agentcore`. Open text so a third provider needs no migration. */
  provider: text('provider').notNull(),
  /** Our evaluator name, or AWS's id such as `Builtin.ToolSelectionAccuracy`. */
  evaluatorSlug: text('evaluator_slug').notNull(),
  /** The provider's own display name, when it gives one. */
  evaluatorName: text('evaluator_name'),
  evaluatorArn: text('evaluator_arn'),
  /** TOOL_CALL | TRACE | SESSION — the grain this evaluator judges at. */
  level: text('level').default('TRACE').notNull(),
  /** Numeric score, normally 0..1. NULL when the evaluator only returns a label. */
  value: real('value'),
  /**
   * The provider's own categorical verdict, stored exactly as it came back.
   * Never coerced to pass/fail: "Perfectly Correct" and "Yes" come from
   * different rating scales, and only the evaluator's name gives one meaning.
   */
  label: text('label'),
  explanation: text('explanation'),
  /** What the judging itself cost, when the provider reports it. */
  tokenUsage: jsonb('token_usage').$type<{
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }>(),
  /** Set when this evaluator failed. A failure is recorded, never scored as zero. */
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  /**
   * The grader's own response, untouched.
   *
   * The columns above are the ones the dashboard aggregates, and they stay
   * columns for that reason — a pass rate that has to dig through JSON cannot
   * be indexed or grouped. Everything a grader returns that we have not
   * modelled lands here instead of being dropped, and a field moves out into a
   * column of its own the moment something reads it to draw a number.
   */
  raw: jsonb('raw').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, table => [
  index('eval_score_run_idx').on(table.runId),
  index('eval_score_run_evaluator_idx').on(table.runId, table.provider, table.evaluatorSlug),
  index('eval_score_case_idx').on(table.caseResultId),
]);

/**
 * An evaluator a workspace authored, and where it lives remotely once synced.
 *
 * Workspace apply writes the desired state here and stops. The AWS call that
 * creates the remote evaluator happens later, in a Temporal activity, because
 * apply makes no external calls today and must not start failing for every
 * other resource in the file when AWS is unreachable.
 *
 * `remoteId` is what makes the sync idempotent — reusing it turns the second
 * sync into an update instead of a duplicate evaluator in the AWS account.
 */
export const evalEvaluatorSchema = pgTable('eval_evaluator', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  datasetSlug: text('dataset_slug').notNull(),
  provider: text('provider').notNull(),
  slug: text('slug').notNull(),
  /** TOOL_CALL | TRACE | SESSION. NULL for a built-in, which carries its own. */
  level: text('level'),
  /** Instructions, rating scale and model for a judge; or a Lambda ARN. */
  config: jsonb('config').$type<Record<string, unknown>>().default({}).notNull(),
  /** The provider's id for this evaluator. NULL until the first sync lands. */
  remoteId: text('remote_id'),
  remoteArn: text('remote_arn'),
  syncedAt: timestamp('synced_at', { mode: 'date' }),
  /** Why the last sync failed. Kept so the UI can say so rather than look synced. */
  syncError: text('sync_error'),
  /**
   * Set when the workspace file stopped declaring this evaluator.
   *
   * Retired rather than deleted, the same way an unauthored workflow is
   * retired: a retired evaluator grades nothing, but it keeps its `remoteId`,
   * so putting it back in the file reuses the evaluator that already exists in
   * the customer's AWS account. Deleting the row would strand that evaluator —
   * we never call AWS `DeleteEvaluator` — and the next create would collide
   * with its name and fail to sync.
   */
  retiredAt: timestamp('retired_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, table => [
  uniqueIndex('eval_evaluator_org_dataset_slug_idx').on(table.orgId, table.datasetSlug, table.provider, table.slug),
]);

/**
 * Where a dataset lives in a grader's own account.
 *
 * A dataset graded by AgentCore is published into the customer's AWS account
 * as a real dataset with its own versions, so "an AgentCore eval" is one, and
 * so a support engineer can open it in the console. Nothing about scoring
 * depends on it: `Evaluate` carries the expected answer in the request, and
 * reproducibility comes from `eval_run.datasetVersion`. That is exactly why a
 * failed publish is recorded here and the run goes ahead anyway.
 *
 * Its own table rather than columns on `eval_dataset`, because a dataset's
 * `provider` is mutable — a rewritten workspace file can flip it — and a row
 * per provider means flipping to Vocion and back needs no clearing logic, and
 * a third grader needs no migration.
 */
export const evalDatasetRemoteSchema = pgTable('eval_dataset_remote', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  datasetId: integer('dataset_id').notNull().references(() => evalDatasetSchema.id, { onDelete: 'cascade' }),
  /** Which grader's account this row describes. */
  provider: text('provider').notNull(),
  /** The grader's id for the dataset. NULL until the first publish lands. */
  remoteId: text('remote_id'),
  /** The version the grader published, as it names it — AWS counts from "1". */
  remoteVersion: text('remote_version'),
  /**
   * Hash of the cases we last published, and the whole reason a run usually
   * makes no AWS calls at all. Left untouched when a publish fails partway, so
   * the next attempt resends the complete diff rather than assuming half of it
   * landed.
   */
  casesHash: text('cases_hash'),
  /** The grader's status at the last sync: ACTIVE, CREATE_FAILED, and so on. */
  status: text('status'),
  /** Why the last publish failed. Kept so the page can say so rather than look synced. */
  syncError: text('sync_error'),
  /** When the last publish was attempted, whether or not it landed. */
  syncedAt: timestamp('synced_at', { mode: 'date' }),
  /**
   * Held by whoever is publishing this dataset right now, until this moment.
   *
   * A lease rather than a Postgres advisory lock because the work it guards is
   * a sequence of AWS calls: an advisory lock is tied to one connection, and
   * every query here comes off a pool, so the unlock would usually land on a
   * different connection and free nothing. A row that outlives the process
   * holding it is the other half of the same problem — hence an expiry rather
   * than a flag, so a crashed publish does not lock the dataset forever.
   */
  publishLeaseUntil: timestamp('publish_lease_until', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, table => [
  uniqueIndex('eval_dataset_remote_dataset_provider_idx').on(table.datasetId, table.provider),
]);

/**
 * One AgentCore batch evaluation job, and where it got to.
 *
 * The on-demand path needs no table like this: `Evaluate` answers in the same
 * call, so there is nothing to come back to. A batch job runs for minutes on
 * AWS's side and outlives the process that started it, so its identifiers have
 * to be written down before the wait begins — otherwise a restart loses the
 * job while AWS carries on billing for it.
 *
 * It also holds the two identifiers that make the whole batch path worth
 * having: the job id and the output log group, so a person can open the result
 * in their own AWS console and check the number without going through Vocion.
 */
export const evalBatchJobSchema = pgTable('eval_batch_job', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  runId: integer('run_id').notNull().references(() => evalRunSchema.id, { onDelete: 'cascade' }),
  /** Which region's AgentCore holds the job — needed to build the console link. */
  region: text('region').notNull(),
  /**
   * Our idempotency key, written before the job is started.
   *
   * A Temporal activity is at-least-once, so the start call can run twice for
   * one run. AWS reuses the existing job when it sees the same token, which
   * turns a retry into a no-op instead of a second job billing for the same
   * sessions twice.
   */
  clientToken: text('client_token').notNull(),
  /** AWS's id for the job. NULL between the row being written and the start landing. */
  batchEvaluationId: text('batch_evaluation_id'),
  batchEvaluationArn: text('batch_evaluation_arn'),
  /** AWS's own status word, kept verbatim: PENDING, IN_PROGRESS, COMPLETED… */
  status: text('status').notNull().default('PENDING'),
  /**
   * Why this job is not a clean success.
   *
   * Set for a failed job, for one that finished with errors, and for one that
   * completed having graded nothing — which AWS reports as success and is what
   * a wrong service name or log group looks like.
   */
  failure: text('failure'),
  /** How many sessions AWS found, graded, failed on and skipped. */
  sessionsTotal: integer('sessions_total').notNull().default(0),
  sessionsCompleted: integer('sessions_completed').notNull().default(0),
  sessionsFailed: integer('sessions_failed').notNull().default(0),
  sessionsIgnored: integer('sessions_ignored').notNull().default(0),
  /** Where AWS wrote the per-session detail, for a person to open. */
  outputLogGroup: text('output_log_group'),
  outputLogStream: text('output_log_stream'),
  startedAt: timestamp('started_at', { mode: 'date' }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { mode: 'date' }),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, table => [
  // One batch job per run. A second job over the same sessions measures the
  // same thing twice and bills for it twice.
  uniqueIndex('eval_batch_job_run_idx').on(table.runId),
  index('eval_batch_job_status_idx').on(table.status),
]);

/**
 * The standing online evaluation configuration for one workspace.
 *
 * Unlike a batch job this is not a record of something that happened — it is a
 * mirror of a resource that exists in the customer's AWS account and is
 * spending their money right now. So the row is a pointer plus the last thing
 * AWS said about it, refreshed rather than accumulated, and the two status
 * columns are kept apart on purpose: a config can exist and be switched off,
 * which costs nothing, and that is the difference someone asking "is this
 * billing me?" needs to see.
 *
 * One per org and region. A second config over the same traffic would sample
 * it twice and bill for it twice.
 */
export const evalOnlineConfigSchema = pgTable('eval_online_config', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  /** Which region's AgentCore holds it — needed to build the console link. */
  region: text('region').notNull(),
  /** AWS's id and ARN for the configuration. */
  configId: text('config_id').notNull(),
  configArn: text('config_arn').notNull(),
  /** The resource's own lifecycle word: CREATING, ACTIVE, UPDATE_FAILED… */
  status: text('status').notNull().default('CREATING'),
  /**
   * Whether it is sampling traffic right now, and therefore billing.
   *
   * Separate from `status` because they answer different questions. An ACTIVE
   * config that is disabled is a resource sitting there costing nothing.
   */
  enabled: boolean('enabled').notNull().default(false),
  /** How much live traffic is scored, as a percentage. The cost dial. */
  samplingPercentage: integer('sampling_percentage').notNull().default(5),
  /** Which evaluators are running. Never a ground-truth one — see agentcoreOnline.ts. */
  evaluatorIds: text('evaluator_ids').array().notNull().default([]),
  /** Where AWS writes the per-session results, for a person to open. */
  outputLogGroup: text('output_log_group'),
  /** Whatever AWS last said went wrong. */
  failureReason: text('failure_reason'),
  /** When we last asked AWS what state this was in. */
  syncedAt: timestamp('synced_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, table => [
  uniqueIndex('eval_online_config_org_region_idx').on(table.orgId, table.region),
]);

export const evalDatasetRelations = relations(evalDatasetSchema, ({ many }) => ({
  runs: many(evalRunSchema),
  remotes: many(evalDatasetRemoteSchema),
}));

export const evalDatasetRemoteRelations = relations(evalDatasetRemoteSchema, ({ one }) => ({
  dataset: one(evalDatasetSchema, {
    fields: [evalDatasetRemoteSchema.datasetId],
    references: [evalDatasetSchema.id],
  }),
}));
export const evalRunRelations = relations(evalRunSchema, ({ one, many }) => ({
  dataset: one(evalDatasetSchema, {
    fields: [evalRunSchema.datasetId],
    references: [evalDatasetSchema.id],
  }),
  results: many(evalCaseResultSchema),
  scores: many(evalScoreSchema),
}));

export const evalScoreRelations = relations(evalScoreSchema, ({ one }) => ({
  run: one(evalRunSchema, {
    fields: [evalScoreSchema.runId],
    references: [evalRunSchema.id],
  }),
  caseResult: one(evalCaseResultSchema, {
    fields: [evalScoreSchema.caseResultId],
    references: [evalCaseResultSchema.id],
  }),
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
    /**
     * What the row budgets. Either an agent's slug, or one of the reserved
     * platform scopes `platform:all` (everything this org spent) and
     * `platform:<feature>` (one non-agent surface, e.g.
     * `platform:retrieval.embed`). `BudgetService` owns the spelling — see
     * `ORG_SCOPE_SLUG` and `featureScopeSlug` there.
     *
     * The scope rides in this column rather than in a column of its own
     * because the unique index below is what makes a charge atomic, and
     * widening a unique index on a populated table is an expand-and-contract
     * migration (migrations/CONVENTIONS.md §2) rather than a one-line change.
     */
    agentSlug: text('agent_slug').notNull(),
    /**
     * The Langfuse feature dimension this row rolls up, for a
     * `platform:<feature>` row — null on an agent row and on `platform:all`.
     * A typed label to group by, so a report never has to parse the slug.
     */
    feature: text('feature'),
    /** daily | monthly */
    period: text('period').default('daily').notNull(),
    /** Tokens consumed in the current period (sum of input + output). */
    currentTokens: bigint('current_tokens', { mode: 'number' }).default(0).notNull(),
    /**
     * Spend in the current period, in micro-cents — a millionth of a cent.
     *
     * The only money column, and a whole number, so a charge is exact and so
     * is every sum of charges. Charging moved from one call per agent turn to
     * one call per embedding batch, and a batch of chunks costs a fraction of
     * a cent: counting in whole cents rounded a tenth of a cent up to one on
     * every batch and billed a $1 sync as $10.
     *
     * Cents for reading are divided out of this at the point of display.
     * There used to be a `current_cents` column holding that division, and it
     * was removed: it was a second copy of the same money that could disagree
     * with this one, and because it was floored per row, the agents' cents
     * never added up to the workspace's. The database column outlives this
     * line by one release — nothing reads or writes it now, and a later
     * migration drops it (see `migrations/CONVENTIONS.md`, expand and
     * contract).
     */
    currentMicroCents: bigint('current_micro_cents', { mode: 'number' }).default(0).notNull(),
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
    /**
     * 'correct' (the agent should change what it does) or 'reinforce' (the
     * agent should keep doing something a reviewer praised). Correction is the
     * default because every candidate that existed before positive feedback
     * was collected came from someone disagreeing.
     */
    polarity: text('polarity').default('correct').notNull(),
    /**
     * How many separate pieces of feedback asked for this rule. New feedback
     * that restates a pending candidate increments this instead of inserting a
     * second row, so the queue can be ordered by weight of evidence. See
     * `learningFeedbackOccurrenceSchema` for the individual submissions.
     */
    occurrenceCount: integer('occurrence_count').default(1).notNull(),
    /**
     * What kind of memory this rule is: 'preference' | 'knowledge' |
     * 'procedure'. Proposed by the classifier, editable on the card; null is
     * the pre-Phase-2 default (a procedure-flavoured workspace rule).
     */
    memoryType: text('memory_type'),
    /**
     * Where the rule lands on approval: null/'workspace' → the namespace
     * named by stepName; 'agent'/'user'/'object' + scopeRef → the matching
     * scoped namespace, created on first use. Storing rule: the broadest
     * scope where the rule is consistently true, and no broader.
     */
    scopeKind: text('scope_kind'),
    scopeRef: text('scope_ref'),
    /** 'pending' | 'approved' | 'rejected'. */
    status: text('status').default('pending').notNull(),
    /** Required when rejecting — a rejection with no reason teaches nobody anything. */
    rejectedReason: text('rejected_reason'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { mode: 'date' }),
    /** The store entry created on approval (its key), so a candidate and its rule stay linked. */
    createdMemoryKey: text('created_memory_key'),
    /**
     * The eval run an approval kicked off on the affected agent's dataset —
     * the card's before/after evidence. Null when the agent has no dataset.
     */
    evalRunId: integer('eval_run_id'),
    /**
     * Consolidation proposals only: the store keys this rule replaces.
     * Approving the candidate writes the new rule AND retires these — one
     * human decision covers the whole compaction.
     */
    replacesKeys: jsonb('replaces_keys').$type<string[]>(),
    /**
     * Where this came from when it did not come from a `feedback_job` (0102):
     * a Slack permalink, an ask ref, a conversation. Free text, because the
     * provenance of "someone told us something" is a URL more often than it is
     * a row id, and a candidate whose origin is unfindable teaches nobody why
     * the rule exists.
     */
    sourceRef: text('source_ref'),
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

/**
 * One row per piece of feedback that landed on a proposed or adopted rule.
 *
 * The first submission creates a candidate and one occurrence. Every later
 * submission that says substantively the same thing adds an occurrence and
 * increments the target's `occurrenceCount` — it does not create a second
 * candidate. That is what lets the queue answer "how many people asked for
 * this, and who" without showing the same idea five times.
 *
 * Exactly one of `candidateId` / `memoryKey` is set: feedback attaches to a
 * pending suggestion, or to a rule that has already been adopted (a store
 * entry, referenced by its key).
 */
export const learningFeedbackOccurrenceSchema = pgTable(
  'learning_feedback_occurrence',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** Set when the feedback landed on a candidate still awaiting a decision. */
    candidateId: integer('candidate_id').references(() => learningCandidateSchema.id, { onDelete: 'cascade' }),
    /** Set when the feedback restated a rule that is already adopted — the store entry's key. */
    memoryKey: text('memory_key'),
    /** 'correct' or 'reinforce' — the polarity of this individual submission. */
    polarity: text('polarity').notNull(),
    /** What the person actually wrote, kept so a reviewer can read the evidence. */
    note: text('note'),
    /** The agent whose recommendation drew the feedback, when there was one. */
    agentSlug: text('agent_slug'),
    sourceFeedbackJobId: integer('source_feedback_job_id').references(() => feedbackJobSchema.id, { onDelete: 'set null' }),
    /** The run being reacted to — an action run, workflow run or mission run id. */
    sourceRunId: integer('source_run_id'),
    submittedBy: text('submitted_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('learning_feedback_occurrence_candidate_idx').on(table.orgId, table.candidateId),
    index('learning_feedback_occurrence_memory_idx').on(table.orgId, table.memoryKey),
    // A row with neither target is an orphan nothing would ever read; a row
    // with both would be counted twice. Declared here as well as in migration
    // 0104 so `drizzle-kit generate` does not later propose dropping it.
    check(
      'learning_feedback_occurrence_target_ck',
      sql`(
        (${table.candidateId} is not null and ${table.memoryKey} is null)
        or (${table.candidateId} is null and ${table.memoryKey} is not null)
      )`,
    ),
  ],
);

export const learningFeedbackOccurrenceRelations = relations(learningFeedbackOccurrenceSchema, ({ one }) => ({
  candidate: one(learningCandidateSchema, {
    fields: [learningFeedbackOccurrenceSchema.candidateId],
    references: [learningCandidateSchema.id],
  }),
}));

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
    /** The `contentHash` a document processor last finished on. */
    processedHash: text('processed_hash'),
    /** Processor tries on this content without finishing; above zero and under the cap, the sync runs it again. */
    processorAttempts: integer('processor_attempts').default(0).notNull(),
    /** Why the last try did not finish. */
    processorError: text('processor_error'),
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
     * source that never arrived, `document` for one item that would not save,
     * `processor` for a per-document stage that ran after ingestion and failed
     * on its own terms (which never counts as an ingest error). Capped per
     * scope when written (see SourceSyncService) so a run failing on hundreds
     * of documents cannot crowd out the record of a collection that never
     * loaded, nor grow this row without bound.
     */
    failures: jsonb('failures')
      .$type<{ scope: 'connector' | 'document' | 'processor'; uri?: string; message: string; at: string }[]>()
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
      .where(sql`${table.revokedAt} is null and ${table.platform} not in ('vocion', 'apollo', 'granola', 'hubspot', 'jira', 'strapi', 'google', 'slack', 'zoom')`),
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
    /** Markdown body — what the document renders to, and what pre-v2 rows carry. */
    content: text('content').notNull(),
    /**
     * The typed `BriefingV2` document (migration 0110,
     * `docs/specs/briefing-v2.md`). NULL on every row written before v2 and on
     * any row an older publisher writes; the page falls back to rendering
     * `content` as markdown when it is absent, so nothing needs backfilling.
     */
    document: jsonb('document').$type<BriefingV2>(),
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

/**
 * The autonomy ladder as a first-class object — one row per (org, action id),
 * the manifesto's "Automation is earned" made into a record. `rung` is where
 * the action kind stands today (`services/autonomy/rungs.ts`); `risk_tier`
 * decides how much evidence the next rung takes; `min_confidence` is the
 * proposal confidence an auto-execution needs once the rung allows one.
 *
 * `trust_rule` stays the EXECUTION record ActionService reads. This table is
 * the POLICY behind it: a promotion to `execute-within-bounds` or above writes
 * an enabled trust rule at `min_confidence`; any rung below leaves the rule
 * disabled. `evidence` freezes the alignment numbers the promotion was earned
 * on, so a later reader can see why. `flagged` marks an automatic demotion
 * (a rejected auto-execution, or a rejection on a high-risk kind) that a
 * person has not yet looked at.
 *
 * `source` says who last wrote the row: `trust.yaml` on apply, `app` from the
 * dashboard or the API, `system` for an automatic demotion.
 */
export const autonomyPolicySchema = pgTable(
  'autonomy_policy',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    actionId: text('action_id').notNull(),
    /** observe | recommend | assist | execute-with-approval | execute-within-bounds | autonomous */
    rung: text('rung').default('execute-with-approval').notNull(),
    /** low | medium | high */
    riskTier: text('risk_tier').notNull(),
    /** Proposal confidence (0-1) an auto-execution needs; null = the tier default. */
    minConfidence: real('min_confidence'),
    promotedAt: timestamp('promoted_at', { mode: 'date' }),
    promotedBy: text('promoted_by'),
    /** The alignment numbers the last rung change was decided on. */
    evidence: jsonb('evidence').$type<Record<string, unknown>>(),
    flagged: boolean('flagged').default(false).notNull(),
    flagReason: text('flag_reason'),
    /** trust.yaml | app | system */
    source: text('source').default('app').notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().$onUpdate(() => new Date()).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('autonomy_policy_org_action_idx').on(table.orgId, table.actionId),
  ],
);

/**
 * The alignment ledger — one row per human decision on something an agent
 * recommended, so every approve, reject and "other" counts as evidence and not
 * only as a way to get unblocked (manifesto #6, #8).
 *
 * `subject_kind` is `action` (an `action_run`, keyed by action id) or `ask`
 * (an `ask`, keyed by ask kind). `recommended` is what the agent advised — the
 * proposal's `suggestedDecision`, or the ask option marked `recommended` — and
 * `agreed` whether the person chose it. An action proposed with no explicit
 * recommendation stores a null `recommended`, never an inferred `approve`:
 * silence is not a recommendation, and scoring it as one made an agent that
 * said nothing look wrong every time a reviewer turned its work down. Such a
 * row still records that a decision happened — it just sits outside the
 * agreement rate, whose denominator counts only a stated recommendation.
 *
 * `auto_executed` is set when the run had already executed under a trust rule
 * before the person saw it — a rejection there is the strongest demotion signal
 * there is. Append-only; the unique index makes a re-decided run idempotent.
 */
export const decisionAlignmentSchema = pgTable(
  'decision_alignment',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** action | ask */
    subjectKind: text('subject_kind').notNull(),
    /** The action id, or the ask kind. */
    subjectKey: text('subject_key').notNull(),
    /** action_run.id or ask.id */
    subjectId: integer('subject_id').notNull(),
    agentSlug: text('agent_slug'),
    /** approved | edited | rejected | done | other | <option id> */
    decision: text('decision').notNull(),
    /** approve | reject | snooze | <option id>; null when nothing was recommended. */
    recommended: text('recommended'),
    /**
     * Legacy. Marked a `recommended` that was inferred rather than stated,
     * back when an action proposed without a `suggestedDecision` was recorded
     * as an implicit `approve`. Nothing writes `true` any more — an unstated
     * recommendation is a null `recommended` — and the column stays only so
     * the rows written under the old rule remain readable as what they were.
     */
    implicit: boolean('implicit').default(false).notNull(),
    /** Whether the decision matched the recommendation; null when nothing was recommended. */
    agreed: boolean('agreed'),
    /** The recommendation's confidence (0-1) when the agent gave one. */
    confidence: real('confidence'),
    autoExecuted: boolean('auto_executed').default(false).notNull(),
    hasNote: boolean('has_note').default(false).notNull(),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('decision_alignment_subject_decision_idx').on(table.orgId, table.subjectKind, table.subjectId, table.decision),
    index('decision_alignment_org_key_decided_idx').on(table.orgId, table.subjectKey, table.decidedAt),
    index('decision_alignment_org_agent_decided_idx').on(table.orgId, table.agentSlug, table.decidedAt),
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
    /** pending | approved | executing | done | failed | rejected | undone (a done run a person put back) */
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
    proposal: jsonb('proposal').$type<{
      confidence?: number;
      /**
       * Why the proposer believes this payload is RIGHT — the case for the
       * record itself, citing what it read: "the Sep 14 call moved the close
       * date; the deal stage in HubSpot still says Proposal Sent".
       *
       * Pairs with `suggestedDecisionReason` below and answers a different
       * question. This one argues the content is correct; that one argues what
       * should happen to it. They agree on an `approve` and diverge on a
       * `reject`, where the payload can be flawless and the record still not
       * belong in the queue — so a card that carries only this one leaves a
       * reviewer to guess at the recommendation's grounds.
       */
      rationale?: string;
      evidence?: string[];
      autoApproved?: boolean;
      autoApprovedThreshold?: number;
      /** Why it ran without a person, in one clause (`libs/actions/autoAccept.ts`). */
      autoApprovedReason?: string;
      /** Which rule released it: `trust-rule` (a promoted kind) or `default` (reversible, low-risk, above the bar). */
      autoApprovedBy?: string;
      /**
       * Which agent's judgement this proposal represents. `invokedBy` cannot
       * always answer that: a proposal made over the API records the human or
       * token that called in, so without this the action has no agent and
       * drops out of every per-agent metric and learning attribution.
       */
      agentSlug?: string;
      /**
       * What the agent thinks the reviewer should DO with this item, as
       * opposed to how sure it is that its payload is right. Confidence
       * answers "how certain am I"; this answers "approve it, turn it down,
       * or come back to it later".
       *
       * Advisory in one direction only, and deliberately so. No trust rule
       * reads it to release work: an agent that could recommend `approve` into
       * the auto-execute gate would be approving its own work. It can still
       * hold work back — a `reject` or `snooze` recommendation keeps the item
       * pending whatever its confidence (`ActionService.proposeAction`),
       * because a rule keyed on confidence alone would otherwise run the thing
       * the agent just advised against. Beyond that it feeds only the
       * agreement metric, which compares it against what the person did.
       *
       * Absent on every run proposed before this shipped, and absent whenever
       * an agent declines to give one — treat missing as "no recommendation",
       * never as `approve`.
       */
      suggestedDecision?: 'approve' | 'reject' | 'snooze';
      /**
       * One short sentence for WHY the agent recommended what it did, in its
       * own words — "third listing of this show this week", "date has passed",
       * "venue outside the coverage area".
       *
       * Separate from `rationale` above on purpose. `rationale` argues that
       * the payload is right; this argues what should happen to it, and the two
       * come apart hardest exactly where it matters: a `reject` recommendation
       * has a perfectly sound payload and a reason it should still be turned
       * down. Kept so a person can see the argument before deciding, and so
       * the recommendations themselves can be read back and judged later
       * rather than only scored as a percentage.
       *
       * Asked for as one short sentence and stored whole — a reason cut at a
       * character count reads worse than a long one. Absent on runs proposed
       * before this shipped.
       */
      suggestedDecisionReason?: string;
      /**
       * Only meaningful alongside `suggestedDecision: 'snooze'`: an ISO
       * timestamp for when the agent thinks this is worth another look. A
       * snooze recommendation without one still stands — the reviewer picks
       * the horizon themselves.
       */
      suggestedSnoozeUntil?: string;
      /**
       * Payload field NAMES the proposer wrote as a judgement of its own
       * rather than read off the document it was working from: a series
       * label, a group key. Names only; the values live in `input.fields`
       * where the reviewer edits them.
       *
       * Declared so `ReviewService.decide` can say what the reviewer did with
       * each one before `updateActionInput` replaces `input` wholesale, which
       * is the last moment the proposed values still exist. Absent means the
       * proposer judged nothing, and nothing is measured, never that every
       * field was read off the page.
       */
      labels?: string[];
      /** Named 0..1 judgements, names from the source's config. */
      scores?: Record<string, number>;
      /** Adopted rules the proposer said decided its verdict. Absent: not recorded. [] : checked, none did. */
      matchedRules?: Array<{ id: string; title?: string; text: string; evidence?: string }>;
    }>(),
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
    /**
     * Who took the human decision (user id) and when. `executedAt` is when the
     * machine ran; these are when a person said yes or no, so a surface can
     * tell a second reviewer "decided by X on Y" instead of just "decided".
     */
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { mode: 'date' }),
    /**
     * Who made the approval call — an agent, or a person. Three states, and
     * the third one is the point:
     *
     * - `null` — nobody has decided yet (the run is still open in the queue),
     *   and every run decided before this column shipped
     * - `true` — the trust ladder released it without a person
     * - `false` — a person approved or rejected it in the review queue
     *
     * A plain boolean defaulting to false would be cheaper to query and wrong:
     * it would make every run still waiting in the queue read as
     * human-approved. "Nobody has looked at this yet" and "a person said yes"
     * are the two facts this column exists to tell apart, so a missing value
     * is never a human approval — treat it as unknown.
     *
     * The LAST decider owns the row. A run can only be decided twice while it
     * sits in the queue as `failed` — an agent released it, the execution
     * threw, and a person then retried or rejected it — because a `done` or
     * `rejected` run is never re-decided and a later proposal opens a new run.
     * In that one case the person's call replaces the agent's, which is the
     * honest reading: the ladder did not get this through on its own, so it
     * should not be counted as though it had. The agent's original approval
     * stays visible in the adoption stream.
     *
     * `decidedBy` names the deciding agent as `agent:<slug>` on the auto path,
     * so "which agent, and when" is answerable from the same row.
     */
    approvedByAgent: boolean('approved_by_agent'),
    /**
     * Server truth for an in-flight regeneration: stamped by the regenerate
     * route before the work dispatches, cleared by the dedup refresh that
     * lands the new content (or by a failed fast-path turn). While fresh
     * (under 15 minutes), every surface renders the run disabled and the
     * decide/regenerate routes refuse it — a mid-regeneration approve would
     * execute stale copy. Past staleness the guards expire on their own.
     */
    regeneratingSince: timestamp('regenerating_since', { mode: 'date' }),
    /** The reviewer's instruction behind the in-flight regeneration, so every surface can show it. */
    regenerateNote: text('regenerate_note'),
    /**
     * Why the LAST regeneration did not land, when it did not. Set by the
     * regenerate route's dispatch failure handler, cleared when the next
     * regeneration starts and when a redraft lands through the dedup refresh.
     * Without it a failed regenerate was indistinguishable from one that
     * changed nothing (ticket 069).
     */
    regenerateError: text('regenerate_error'),
    /**
     * The audit record of AI rewrites asked during review, newest last. The
     * DRAFT itself is never touched by a rewrite (the reviewer carries the
     * copy and passes it back on approve); this is the record of what was
     * asked and what came back, so a recap and its before/after are readable
     * after the fact. `discardedEdit` holds the body a regeneration replaced.
     */
    revisions: jsonb('revisions').$type<Array<{
      contentId?: string;
      step?: number;
      version: number;
      body: string;
      ask?: string;
      discardedEdit?: string;
      at: string;
      by?: string;
      /**
       * What this entry IS, so one column reads as a history rather than a
       * list of bodies: `proposed` is the copy the agent wrote before any
       * rewrite touched it, `regenerated` a version that came back, and
       * `approved` the copy a reviewer vouched for. Optional because every
       * row written before this shipped is a rewrite's answer, which is what
       * an absent kind reads as.
       */
      kind?: 'proposed' | 'regenerated' | 'approved' | 'failed';
      /** Why a regeneration asked here did not land; only on a `failed` entry. */
      failure?: string;
    }>>(),
    /**
     * Which content items a reviewer has approved one at a time, keyed by the
     * card's content id (`send-2`).
     *
     * The value is a HASH of the copy that was approved, never a boolean. A
     * check is then derived: the tab is checked only while the hash still
     * matches what is on screen, so a regeneration or an inline edit clears it
     * on its own. A flag would need clearing logic in three places — the
     * regenerate route, the dedup refresh that lands a redraft, and the
     * editor — and the first one anybody forgot would leave a check standing
     * over copy nobody approved.
     *
     * `libs/actions/contentHash.ts` owns the hash, for both the route that
     * writes it and the surface that compares against it.
     */
    contentReview: jsonb('content_review').$type<Record<string, {
      hash: string;
      at: string;
      by?: string;
    }>>(),
    /**
     * The exact artifact VERSIONS this decision approved (0112).
     *
     * Once the research brief, the outreach recommendation and the draft
     * sequence are separate artifacts, "what did the human approve" and "what
     * does this look like now" stop being the same question — a regeneration
     * writes a new `artifact_version` and the page moves on. The pin is
     * written at decide time and never rewritten, so the audit answers the
     * first question (design principles 1 and 9).
     */
    pinnedArtifacts: jsonb('pinned_artifacts').$type<Array<{
      artifactId: number;
      /** `brief` | `recommendation` | `sequence`. */
      role: string;
      version: number;
      title: string;
    }>>(),
  },
  table => [
    index('action_run_org_status_idx').on(table.orgId, table.status),
    // Lookup for upsert-by-key (dedupe only pending items in code, so a decided
    // action can be re-proposed later — hence a plain index, not unique).
    index('action_run_dedup_idx').on(table.orgId, table.dedupKey),
    // Filtering the queue by what the agent recommended reads a value inside
    // the proposal blob, which no other index can serve. Kept to open work
    // only (`status IN ('pending','failed')`, the same rows the queue draws
    // from) so the index stays the size of the queue rather than the size of
    // every decision ever made.
    index('action_run_suggested_decision_idx')
      .on(table.orgId, sql`(${table.proposal} ->> 'suggestedDecision')`)
      .where(sql`${table.status} IN ('pending', 'failed')`),
    // The auto-approved list asks for exactly the rows where an agent took the
    // decision, newest first. Partial on true because those are a small
    // fraction of every run ever decided, and indexing the false and null rows
    // too would be most of the table to answer a question nobody asks of it.
    // The direction matches `listAutoExecuted`'s ORDER BY so a page is read
    // off the index rather than sorted out of the org's whole history;
    // changing either one without the other loses the index quietly.
    index('action_run_approved_by_agent_idx')
      .on(table.orgId, sql`${table.decidedAt} DESC NULLS LAST`)
      .where(sql`${table.approvedByAgent}`),
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
    /** The automation fires whose work raised this event, newest first. Null when no automation was behind it. */
    causedBy: jsonb('caused_by').$type<Array<{ automationSlug: string; automationRunId?: number; missionRunId?: number }>>(),
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
    // `review.snoozed` is exempt entirely: an item can be deferred any number
    // of times and no metadata field tells one deferral from the next, so
    // uniqueness here would drop every snooze after the first (0079).
    uniqueIndex('user_activity_event_resource_idx')
      .on(table.orgId, table.eventType, table.resourceType, table.resourceId, sql`(coalesce(${table.metadata}->>'decision',''))`)
      .where(sql`resource_id IS NOT NULL AND event_type <> 'review.snoozed'`),
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
    /**
     * Classifier output (null until Stage 2 runs). Two shapes live here, told
     * apart by `confidenceSemantics` on the document itself and mirrored into
     * `confidence_semantics` for querying:
     *
     *  - `stated-class` — the defined contract. Both confidences are
     *    confidence IN THE STATED CLASS.
     *  - legacy (no `confidenceSemantics`) — rows written under the v1 prompt,
     *    which never said what its confidence meant. The booleans are readable;
     *    the numbers are carried, never converted.
     *
     * `services/discovery/classification.ts` is the one definition, and
     * `readClassification()` the one reader.
     */
    classification: jsonb('classification').$type<StoredClassification>(),
    /**
     * Which reading this row's confidences were written under:
     * 'stated-class' | 'legacy'. Duplicated out of the jsonb so the ledger can
     * filter and count without unpacking every document.
     */
    confidenceSemantics: text('confidence_semantics'),
    /** The closed-set reason the classifier gave. Null on legacy rows — v1 had no reason codes. */
    reasonCode: text('reason_code'),
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
    /** Why the lead left: 'reply' | 'meeting' | 'intent' | 'routed'. */
    handoffTrigger: text('handoff_trigger'),
    handoffAt: timestamp('handoff_at', { mode: 'date' }),
    /**
     * The newest reply and meeting timestamps the handoff watcher has already
     * seen on the CRM mirror for this lead (`HandoffTriggerService`). A mirror
     * value newer than the stored one, and newer than the enrollment decision,
     * is a trigger; anything equal or older is not. Null until the first watch
     * after enrollment, which baselines without firing.
     */
    handoffReplySeenAt: timestamp('handoff_reply_seen_at', { mode: 'date' }),
    handoffMeetingSeenAt: timestamp('handoff_meeting_seen_at', { mode: 'date' }),
    /**
     * First time the watcher looked at this lead after enrollment. A meeting
     * signal that is a plain boolean has no date of its own, so "already true
     * on the first watch" is baselined and only a flip seen on a later watch
     * fires. Null until that first watch.
     */
    handoffWatchedAt: timestamp('handoff_watched_at', { mode: 'date' }),
    /**
     * The reviewer's instruction for the next pass, kept so a rewrite has a
     * reason. OUTSTANDING only: `saveLeadBrief` clears it and files it in
     * `regenerateHistory`, because a satisfied instruction that still reads as
     * pending misleads the reviewer on the lead page and the agent on the next
     * pass alike.
     */
    regenerateNote: text('regenerate_note'),
    /** Instructions already addressed, each with the time the brief that answered it was written. */
    regenerateHistory: jsonb('regenerate_history').$type<Array<{
      note: string;
      addressedAt: string;
    }>>().default([]).notNull(),
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
    /**
     * The contact's CURRENT sequence enrollment, as last observed on the CRM
     * mirror (0112). The page must resolve this against `recommendedSequence`
     * BEFORE it offers an Enroll button: the CEO's review found a page
     * recommending enrollment on a contact the CRM said was enrolled in a
     * sequence minutes after becoming an MQL, with no way to tell whether
     * approving would add, replace, or duplicate.
     *
     * `status: 'unknown'` — and the column being null — is the honest fourth
     * answer, and `resolveSequenceState` refuses a one-click Enroll on it
     * rather than guessing which it meant.
     */
    currentSequence: jsonb('current_sequence').$type<{
      id?: string;
      name?: string;
      /** 'active' | 'completed' | 'none' | 'unknown' */
      status: string;
      /** 1-based position in the running sequence, when the mirror carries it. */
      step?: number;
      totalSteps?: number;
      /** 'automated' (a CRM workflow enrolled them) | 'manual' | 'unknown' */
      kind?: string;
      /** What the agent proposes doing to it: 'replace' | 'add'. Absent = it did not say. */
      disposition?: string;
      observedAt?: string;
      source?: string;
    }>(),
    /**
     * Research confidence per dimension (0112). One global 0.20 collapsed five
     * different questions; separately computed, the recommendation engine can
     * reason "identity known, company context insufficient, engagement
     * unavailable → curiosity nurture, not fabricated personalization".
     *
     * A `value` of null means UNAVAILABLE, which is not the same as low:
     * engagement fields the CRM never returned cannot be graded, and a brief
     * that grades them anyway is the contradiction the chat repeated.
     * `confidence` stays as the headline reading.
     */
    confidenceDimensions: jsonb('confidence_dimensions').$type<Record<string, {
      value: number | null;
      basis: string;
    }>>(),
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

/* ------------------------------------------------------------------ */
/* Worker runs — long-running agent runs executed OUTSIDE the app       */
/* (ADR 0004, `harness.runsOn: external-worker`)                        */
/* ------------------------------------------------------------------ */

/**
 * A long-running agent run executed by a process Vocion does NOT host. Vocion
 * is the control plane: it queues the run, hands out a lease, records
 * heartbeats, checkpoints and cost, and reaps a run whose lease lapses. The
 * worker owns its own working state (files, git, its own store); this row
 * holds only what a human or another agent needs to see about it.
 *
 * Modelled on `source_sync_checkpoint` — the one resumable-work table before
 * it — plus the columns a lease protocol needs. Status is text on purpose: a
 * new state is a code change, not a migration.
 */
export const workerRunSchema = pgTable(
  'worker_run',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    agentSlug: text('agent_slug').notNull(),
    /**
     * What sort of run: `lead` (a lead's planning/dispatch cycle), `board`
     * (the board-level review of the whole company), `worker` (one dispatched
     * job — the default), `red-team` (an adversarial grade), `compact`
     * (bookkeeping), `snapshot` (a periodic state report). Text, like status.
     */
    kind: text('kind').default('worker').notNull(),
    /** `queued` | `running` | `paused` | `awaiting_review` | `completed` | `failed` | `cancelled` | `lost` */
    status: text('status').default('queued').notNull(),
    /** The model the worker reported (first heartbeat's `usage.model`, or set at create). */
    model: text('model'),
    /** The worker's own one-paragraph account of the run, set on complete. */
    summary: text('summary'),
    /** What the worker was asked to do — free-form, worker-defined. */
    input: jsonb('input').$type<Record<string, unknown>>().default({}).notNull(),
    /** Whoever holds the lease. Set on claim; a re-claim after `lost` bumps `attempt`. */
    workerId: text('worker_id'),
    attempt: integer('attempt').default(0).notNull(),
    leaseSeconds: integer('lease_seconds').default(300).notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { mode: 'date' }),
    heartbeatAt: timestamp('heartbeat_at', { mode: 'date' }),
    claimedAt: timestamp('claimed_at', { mode: 'date' }),
    /** Hard deadline, echoed to the worker on every heartbeat. */
    endsAt: timestamp('ends_at', { mode: 'date' }),
    completedAt: timestamp('completed_at', { mode: 'date' }),
    /** Coarse, worker-defined progress for the run page — not a token stream. */
    progress: jsonb('progress').$type<Record<string, unknown>>().default({}).notNull(),
    /** Opaque worker-defined resume position. */
    cursor: text('cursor'),
    counts: jsonb('counts').$type<Record<string, number>>().default({}).notNull(),
    tokens: integer('tokens').default(0).notNull(),
    cents: integer('cents').default(0).notNull(),
    /** Per-run dollar cap in cents; the heartbeat reports what is left. */
    capCents: integer('cap_cents'),
    /** A human asked the run to stop; the worker learns it on its next heartbeat. */
    stopRequested: boolean('stop_requested').default(false).notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    /** Non-fatal failures the worker carried on past, capped by the service. */
    failures: jsonb('failures').$type<{ scope: string; message: string; at: string }[]>().default([]).notNull(),
    workspaceSha: text('workspace_sha'),
    langfuseTraceId: text('langfuse_trace_id'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('worker_run_org_status_idx').on(table.orgId, table.status),
    index('worker_run_org_agent_idx').on(table.orgId, table.agentSlug),
    index('worker_run_lease_idx').on(table.status, table.leaseExpiresAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Asks — everything that is waiting on a human (migration 0089)        */
/* ------------------------------------------------------------------ */

/** One named answer to an ask. `recommended` is set on at most one per ask. */
export type AskOption = {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
  /**
   * How sure the asker is that this option is the right answer, 0-1. Meant
   * for the recommended option, so an ask exposes the same confidence +
   * alignment shape as an action proposal on the sheet. Advisory only.
   */
  confidence?: number;
};

/**
 * One record an ask is about: an object type slug and the object's id, as a
 * string. Carried on `ask.decided` so a subscriber can write the answer back
 * where the question came from.
 */
export type AskObjectRef = { type: string; id: string };

/**
 * What sort of thing an ask is waiting for, and how much rides on it. Defined
 * here, beside the row, so an action module (`libs/actions/ask-file.ts`) can
 * read the vocabulary without importing the service — the action registry
 * sits under the service's import graph, and a static import back into it
 * is a cycle. `AskService` re-exports both.
 */
export const ASK_KINDS = ['approval', 'input', 'ruling', 'credential', 'merge', 'recommendation', 'gate'] as const;
export type AskKind = typeof ASK_KINDS[number];
export const ASK_RISKS = ['low', 'medium', 'high'] as const;
export type AskRisk = typeof ASK_RISKS[number];

/**
 * One QUESTION waiting on a PERSON: an approval, a ruling, an input or
 * credential, a merge, a recommendation, a gate. Unlike `action_run` nothing
 * executes when it is answered — the answer IS the outcome, and whoever filed
 * the ask (an agent, an external worker, a sync script) reads it back.
 *
 * Shaped to be answered from a phone: a short `body` (the question and a few
 * lines of why), named `options`, always a free-text "other" answer, the long
 * form behind `context_url` / `context_md`. `group_key` gathers several asks
 * into one decision sheet answered as a stepper.
 *
 * `source_ref` is the idempotency key for asks mirrored in from outside
 * (`workforce:approvals/003-…`): unique per org when present, so re-filing the
 * same item updates it instead of doubling it.
 */
export const askSchema = pgTable(
  'ask',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    projectId: text('project_id'),
    /** `approval` | `input` | `ruling` | `credential` | `merge` | `recommendation` | `gate` */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    /** Markdown, SHORT: the question plus 2–4 lines of why or what happens. */
    body: text('body'),
    sourceRef: text('source_ref'),
    agentSlug: text('agent_slug'),
    teamSlug: text('team_slug'),
    /** `low` | `medium` | `high` */
    risk: text('risk'),
    /** Named answers. The free-text "other" answer is always available on top. */
    options: jsonb('options').$type<AskOption[]>().default([]).notNull(),
    /**
     * The records this question is about — `[{ type, id }]`, an object type
     * slug and the object's id (migration 0129). Read back onto the record
     * when the ask is decided: `ask.decided` carries them, so an automation
     * can write the person's answer where the question came from. Filed by
     * an agent's `file_ask` or over `POST /api/v1/asks`.
     */
    objectRefs: jsonb('object_refs').$type<AskObjectRef[]>().default([]).notNull(),
    /**
     * Minutes of a person's attention this decision is estimated to take —
     * what a batch of asks costs against a daily decision budget. Said by the
     * asker; null when it did not say.
     */
    decisionCost: integer('decision_cost'),
    /** Several asks sharing a key form one decision sheet. */
    groupKey: text('group_key'),
    groupTitle: text('group_title'),
    /** The long form — the approval file, the PR, the run. */
    contextUrl: text('context_url'),
    /** Optional collapsed "Details" markdown. */
    contextMd: text('context_md'),
    /** `open` | `approved` | `rejected` | `done` | `superseded` */
    status: text('status').default('open').notNull(),
    /** What was chosen: `approve`, `reject`, `done`, `other`, or an option id. */
    decision: text('decision'),
    decisionNote: text('decision_note'),
    /** An "other" answer on a ruling/approval/recommendation: the asker must read the note and may re-ask. */
    followUp: boolean('follow_up').default(false).notNull(),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { mode: 'date' }),
    dueAt: timestamp('due_at', { mode: 'date' }),
    /** Earliest time a notifier may ping about this ask; null = whenever. */
    notifyAt: timestamp('notify_at', { mode: 'date' }),
    notified: boolean('notified').default(false).notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('ask_org_status_idx').on(table.orgId, table.status),
    index('ask_org_agent_idx').on(table.orgId, table.agentSlug),
    index('ask_org_group_idx').on(table.orgId, table.groupKey),
    uniqueIndex('ask_org_source_ref_uq').on(table.orgId, table.sourceRef).where(sql`${table.sourceRef} IS NOT NULL`),
  ],
);

/* ------------------------------------------------------------------ */
/* Chat surfaces — which agent answers in which channel (item 025)      */
/* ------------------------------------------------------------------ */

/**
 * Binds a chat-platform channel to an agent. The inbound event carries only a
 * channel id, so this row is how an event finds its org AND its agent — the
 * unique key is (surface, channel, team), not per org. `channel_id = '*'` with
 * a `team_id` is the per-workspace catch-all that direct messages resolve to.
 */
export const chatChannelBindingSchema = pgTable(
  'chat_channel_binding',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** `slack` today. */
    surface: text('surface').notNull(),
    teamId: text('team_id'),
    channelId: text('channel_id').notNull(),
    agentSlug: text('agent_slug').notNull(),
    /**
     * Persona the replies in this channel wear (migration 0083). Null means the
     * app's own name and icon — i.e. exactly today's behaviour.
     */
    displayName: text('display_name'),
    /** Public https URL of the persona avatar; Slack fetches it per message. */
    iconUrl: text('icon_url'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('chat_channel_binding_surface_channel_idx').on(table.surface, table.channelId, table.teamId),
    index('chat_channel_binding_org_idx').on(table.orgId),
  ],
);

/** An image a Slack post carries: a URL Slack (or a reader) can open, and what it shows. */
export type SlackPostImage = { url: string; caption: string };

/**
 * Every message Vocion PUTS INTO Slack (migration 0102) — an announcement, a
 * reply in a thread, the channel introduction.
 *
 * It exists because the `app_mention` payload carries the mention and nothing
 * else: not the message it replies to. Reading that parent back out of Slack
 * needs `channels:history` / `groups:history`, and a workspace may never grant
 * them. When the parent is OUR OWN post — a release announcement somebody
 * replied "any screenshots to go with this?" to — Vocion should not need a
 * scope to remember what it said. This table is that memory, and
 * `announced_label` / `announced_url` are what "this" resolves to.
 *
 * Deliberately not folded into `email_thread`: that table is keyed by RFC 5322
 * Message-ID and requires a `conversation_id`, and an announcement has neither.
 */
export const slackPostSchema = pgTable(
  'slack_post',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    projectId: text('project_id'),
    /** Slack workspace (`team_id`), when the poster knew it. */
    teamId: text('team_id'),
    channelId: text('channel_id').notNull(),
    /** This message's own Slack timestamp id. */
    ts: text('ts').notNull(),
    /** The thread it landed in; null for a post that starts one. */
    threadTs: text('thread_ts'),
    /** `announcement` | `reply` | `introduction` */
    kind: text('kind').default('reply').notNull(),
    agentSlug: text('agent_slug'),
    text: text('text').notNull(),
    /** What the post was announcing — the thing "this" refers to in a reply. */
    announcedLabel: text('announced_label'),
    announcedUrl: text('announced_url'),
    images: jsonb('images').$type<SlackPostImage[]>().default([]).notNull(),
    /**
     * True when this post already named the missing Slack scope out loud, so
     * the sentence is said once per thread instead of on every reply.
     */
    degradedNotice: boolean('degraded_notice').default(false).notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('slack_post_channel_ts_uq').on(table.channelId, table.ts),
    index('slack_post_channel_thread_idx').on(table.channelId, table.threadTs),
    index('slack_post_org_created_idx').on(table.orgId, table.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Artifacts — rendered output as data (0095), live + versioned (0101) */
/* ------------------------------------------------------------------ */

/**
 * canvas — DEAD as of migration 0101. The tile grid it saved was replaced by
 * one live artifact beside the conversation, so nothing reads or writes this
 * table any more. The declaration stays only so drizzle's model matches the
 * database until the DROP lands in a later release (CONVENTIONS.md rule 2:
 * dropping is a contract step). Do not add readers.
 * @deprecated Unused since 0101; slated for DROP.
 */
export const canvasSchema = pgTable(
  'canvas',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    conversationId: integer('conversation_id').references(() => conversationSchema.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    layout: jsonb('layout').$type<Array<{ artifactId: number; slot: number; span: 1 | 2 | 3 }>>().default([]).notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => [
    index('canvas_org_updated_idx').on(table.orgId, table.updatedAt),
  ],
);

/**
 * artifact — one live, versioned thing: a data table, a markdown note, a
 * chart, a record card, a link, or a file. `spec` is the typed card payload
 * that `libs/cards` renders on the chat and artifact surfaces (validated by
 * whichever tool or human edit wrote it). `title`/`spec` always mirror the
 * head `artifact_version` row named by `headVersionId` / `currentVersion`;
 * `folder` groups it in the log. Files (the `create_artifact` path) keep
 * their served `url`.
 *
 * `canvasId`, `tile` and `pinned` are dead columns from the 0095 tile grid,
 * kept until the contract migration drops them. Nothing reads them.
 */
export const artifactSchema = pgTable(
  'artifact',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    projectId: text('project_id').references(() => projectSchema.id, { onDelete: 'cascade' }),
    conversationId: integer('conversation_id').references(() => conversationSchema.id, { onDelete: 'set null' }),
    messageId: integer('message_id'),
    canvasId: integer('canvas_id').references(() => canvasSchema.id, { onDelete: 'set null' }),
    /** 'table' | 'markdown' | 'chart' | 'record' | 'link' | 'file' */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    spec: jsonb('spec').$type<Record<string, unknown>>().default({}).notNull(),
    url: text('url'),
    tile: jsonb('tile').$type<{ slot: number; span: 1 | 2 | 3 }>(),
    pinned: boolean('pinned').default(true).notNull(),
    /** Head version number (0101). Starts at 1; every edit increments it. */
    currentVersion: integer('current_version').default(1).notNull(),
    /** `artifact_version.id` of the head. Nullable only in the instant between the two inserts. */
    headVersionId: integer('head_version_id'),
    /** Path-like grouping for the log, e.g. `revenue/weekly`. Flat text, not a tree. */
    folder: text('folder'),
    /**
     * Who this artifact is FOR (0119). `user` is what a person opens — briefs,
     * docs, tables, charts, files, sequences. `system` is produced as part of
     * the work and read only when someone is auditing: mission check reports,
     * outreach recommendations already rendered on their decision card.
     *
     * A flag rather than a deletion, because `action_run.pinned_artifacts`
     * records the exact versions a human approved; dropping a recommendation
     * would move the audit answer.
     */
    visibility: text('visibility').$type<'user' | 'system'>().default('user').notNull(),
    /** Who a share opens for (`libs/share/audience.ts`): me | workspace | anyone. Defaulted, so nothing changes for a row nobody touched. */
    shareAudience: text('share_audience').$type<'me' | 'workspace' | 'anyone'>().default('workspace').notNull(),
    /** The person who chose `me`; null otherwise. */
    shareOwnerId: text('share_owner_id'),
    /** Denormalised head author, so the log lists "last editor" without a join. */
    lastAuthorKind: text('last_author_kind').$type<'agent' | 'human' | 'system'>().default('agent').notNull(),
    lastAuthorId: text('last_author_id'),
    /**
     * The RECORD this artifact belongs to (0112), as a flat `RecordRef`
     * (`services/chat/pageContext.ts`). Artifacts were conversation-scoped;
     * a research brief belongs to a lead, not to whichever conversation
     * happened to produce it. Null for a conversation-only artifact.
     */
    recordType: text('record_type'),
    recordId: text('record_id'),
    /**
     * What this artifact IS to that record — `brief`, `recommendation`,
     * `sequence`. One artifact per (record, role), enforced in
     * `ArtifactService.upsertRecordArtifact` rather than by a unique index,
     * because `artifact` is populated and CONVENTIONS.md rule 1 sends its
     * index builds to `concurrent/`, where UNIQUE is refused.
     */
    recordRole: text('record_role'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => [
    index('artifact_org_conversation_idx').on(table.orgId, table.conversationId, table.createdAt),
    index('artifact_org_canvas_idx').on(table.orgId, table.canvasId),
    // Built concurrently in production — see concurrent/0101_artifact_org_updated_index.sql.
    index('artifact_org_updated_idx').on(table.orgId, table.updatedAt),
    // Built concurrently in production — see concurrent/0112_artifact_record_index.sql.
    index('artifact_org_record_idx').on(table.orgId, table.recordType, table.recordId, table.recordRole),
  ],
);

/**
 * artifact_version — one immutable row per edit of an artifact (0101).
 *
 * Both halves of the product write through it: an agent tool call and a
 * person's Save land the same way, so "who changed this and why" is one
 * query and one audit trail. Restoring an older version writes a NEW head
 * version carrying that content; history is never rewritten. Rapid saves by
 * the same human within ~30s collapse into the head row rather than filling
 * the menu with keystroke-sized versions.
 */
export const artifactVersionSchema = pgTable(
  'artifact_version',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    artifactId: integer('artifact_id').notNull().references(() => artifactSchema.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** Copied from the artifact so a version row reads on its own. */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    spec: jsonb('spec').$type<Record<string, unknown>>().default({}).notNull(),
    /** Who wrote it: an agent turn, a person in the pane, or the system (backfill/import). */
    authorKind: text('author_kind').$type<'agent' | 'human' | 'system'>().default('agent').notNull(),
    /** `agent:<slug>` or a user id. */
    authorId: text('author_id'),
    /** The agent run this version came out of, when there was one. */
    runId: text('run_id'),
    messageId: integer('message_id'),
    /** One line the version menu shows: "made the third column currency". */
    changeSummary: text('change_summary'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('artifact_version_artifact_version_idx').on(table.artifactId, table.version),
    index('artifact_version_org_artifact_idx').on(table.orgId, table.artifactId, table.createdAt),
  ],
);

/**
 * Email threading for the mailbox surface (migration 0097). One row per mail
 * in or out of a conversation, keyed by RFC 5322 Message-ID, so a reply
 * carrying In-Reply-To / References finds its conversation, and a redelivered
 * webhook (same `received_email_id`) is dropped before it runs an agent twice.
 */
export const emailThreadSchema = pgTable(
  'email_thread',
  {
    id: serial('id').primaryKey(),
    orgId: text('org_id').notNull(),
    conversationId: integer('conversation_id').notNull().references(() => conversationSchema.id, { onDelete: 'cascade' }),
    /** RFC 5322 Message-ID, angle brackets stripped. */
    messageId: text('message_id').notNull(),
    /** Resend's id for a received email — the idempotency key for the webhook. */
    receivedEmailId: text('received_email_id'),
    /** 'in' (a person wrote to the workspace) | 'out' (the workspace replied). */
    direction: text('direction').notNull(),
    fromAddress: text('from_address'),
    subject: text('subject'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('email_thread_org_message_id_uq').on(table.orgId, table.messageId),
    uniqueIndex('email_thread_received_email_id_uq').on(table.receivedEmailId).where(sql`${table.receivedEmailId} IS NOT NULL`),
    index('email_thread_conversation_idx').on(table.conversationId),
  ],
);

/** One lead's outcome inside a bulk job. */
export type BulkLeadOutcome = {
  leadId: number;
  contactName: string | null;
  state: 'queued' | 'landed' | 'failed';
  /** Why it failed, in the words a reviewer reads. */
  error?: string;
  at?: string;
};

/**
 * A bulk action on the personalization queue, as the record a person watches
 * while it runs and what remains afterwards (Metacto ticket 071). The work
 * itself is a Temporal workflow keyed to this row's id; `outcomes` carries
 * one entry per lead, and `done` / `failed` are recomputed from it on every
 * write so a retried lead never double-counts.
 */
export const personalizationBulkJobSchema = pgTable('personalization_bulk_job', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  /** What the job does to each lead: `regenerate_brief` is the first kind. */
  kind: text('kind').notNull(),
  /** The reviewer's one instruction, carried to every lead. */
  note: text('note').notNull(),
  leadIds: jsonb('lead_ids').$type<number[]>().notNull(),
  total: integer('total').notNull(),
  done: integer('done').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  /** queued → running → done. */
  status: text('status').notNull().default('queued'),
  outcomes: jsonb('outcomes').$type<BulkLeadOutcome[]>().notNull().default([]),
  workflowId: text('workflow_id'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
}, table => [
  index('personalization_bulk_job_org_idx').on(table.orgId, table.createdAt),
]);
