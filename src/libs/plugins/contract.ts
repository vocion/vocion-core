import type OpenAI from 'openai';
import type { z } from 'zod';

/**
 * Plugin SDK — v0.1 contract.
 *
 * A plugin is a typed, distributable unit of capability. v0.1 covers Skills
 * (input → work → output); v0.2 adds Sources (data ingestion + connector auth)
 * and a separate `@corecontext/sdk` package. For now the types live in-tree
 * so we can iterate without npm publishing friction.
 *
 * Two kinds of "skills" coexist:
 *
 *   1. **Prompt skills** (Phase 1) — defined in `context/<org>/skills/<slug>/`
 *      as YAML + prompt.md. Executed by the built-in prompt runner: interpolate
 *      {{vars}}, call LLM, return text.
 *
 *   2. **Plugin skills** (Phase 3) — TypeScript modules implementing the
 *      `Skill<Input, Output>` interface. Can do anything a TS module can: custom
 *      logic, multiple LLM calls, validation, external API calls, deterministic
 *      computation. Authored by MetaCTO (core plugins) or partners (client
 *      plugins). Published as npm packages OR loaded from local paths.
 *
 * Conflict rule: if a plugin registers a skill with the same slug as a prompt
 * skill in the DB, the plugin wins. This lets a partner "upgrade" a
 * prompt-only skill to a code-powered one without any migration.
 */

/**
 * Runtime context handed to every skill invocation. Intentionally narrow —
 * plugins shouldn't rummage in the broader app.
 */
export type PluginContext = {
  /** Clerk org id — scope for any multi-tenant data access. */
  readonly orgId: string;
  /** Shared OpenAI client. Rate-limited and observability-wrapped upstream. */
  readonly openai: OpenAI;
  /** Active context SHA — stamped on skill_run for audit. Null if no context applied. */
  readonly contextSha: string | null;
  /** Who triggered the run (user id, 'mcp', 'scheduled', etc.) */
  readonly invokedBy: string;
  /**
   * Scoped logger. Keys `skill`, `orgId`, `runId` are auto-populated by
   * the executor; plugins add their own structured fields.
   */
  readonly log: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
  /**
   * Call `retrieve` to run a retrieval query via the platform's configured
   * search backend (Onyx today, pgvector in Phase 4). Plugins should prefer
   * this over calling Onyx directly — it gets them the retrieval config
   * (embedding model, k, filters) from `context/<org>/retrieval.yaml`.
   */
  readonly retrieve: (query: string, options?: { sources?: string[]; k?: number }) => Promise<RetrievalHit[]>;
};

export type RetrievalHit = {
  documentId: string;
  identifier: string;
  source: string;
  blurb: string;
  link: string | null;
  score: number;
  updatedAt: string | null;
};

/**
 * A Skill plugin. Declarative metadata up top, executable logic in `run`.
 *
 * Plugins export a default `Skill<Input, Output>` — or a factory if they need
 * per-org configuration. See `defineSkill` below for the ergonomic constructor.
 */
export type Skill<Input = unknown, Output = unknown> = {
  /** Stable identifier. Same conventions as context slugs (lowercase, _ or -). */
  readonly slug: string;
  /** Display name. */
  readonly name: string;
  /** One-line description for the catalog. */
  readonly description?: string;
  /** Semver of the plugin itself (separate from prompt version). */
  readonly version: string;
  /** `query` (read-only) | `mutation` (may cause side effects) | `composite` */
  readonly category?: 'query' | 'mutation' | 'composite';
  /**
   * Whether the output needs human review before any downstream action.
   * When true, skill_run.status = 'pending' until approved.
   */
  readonly requiresApproval: boolean;
  /** Zod schema for validating input before invoking `run`. */
  readonly inputSchema: z.ZodType<Input>;
  /** Zod schema for validating output from `run`. */
  readonly outputSchema: z.ZodType<Output>;
  /**
   * The actual work. Runs within a Langfuse-traced span; log via `ctx.log`.
   * Throw to surface a structured error; non-thrown failures should be encoded
   * in the output shape.
   */
  readonly run: (ctx: PluginContext, input: Input) => Promise<Output>;
};

/**
 * Type-erased Skill — what plugin manifests declare and the registry stores.
 * Input/Output types are preserved at authoring time via `defineSkill`, then
 * erased at the manifest boundary so heterogeneous skill arrays type-check.
 * Runtime validation via the Zod schemas is what enforces the real shape.
 */

export type AnySkill = Skill<any, any>;

/**
 * Ergonomic constructor — infers types from the schemas so callers can write
 * `defineSkill({ inputSchema, outputSchema, run, ... })` without restating
 * generic parameters. Returns the erased type so callers can drop the skill
 * into a `skills: AnySkill[]` field without casts.
 * @param skill
 */
export function defineSkill<Input, Output>(skill: Skill<Input, Output>): AnySkill {
  return skill as AnySkill;
}

/**
 * Manifest shape for plugin packages — what a plugin author exports from
 * their entry point. The loader validates against this.
 *
 * Entry point can export either `skills` (array of Skill) or a `register(ctx)`
 * factory that returns skills. The factory form is useful when a plugin needs
 * to read env/config at boot time.
 */
export type PluginManifest = {
  /** Reverse-DNS style identifier for the plugin itself (not individual skills). */
  readonly id: string;
  /** Plugin package semver. */
  readonly version: string;
  /** Human description. */
  readonly description?: string;
  /** Eager — plugin exports a fixed list of skills. */
  readonly skills?: AnySkill[];
  /** Lazy — plugin exports a factory called once at boot. */
  readonly register?: (env: PluginRegistrationEnv) => Promise<AnySkill[]> | AnySkill[];
};

/** Minimal env passed to plugin factories. Kept narrow — no DB / no LLM here. */
export type PluginRegistrationEnv = {
  readonly orgId: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};
