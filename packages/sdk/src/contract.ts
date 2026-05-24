import type OpenAI from 'openai';
import type { z } from 'zod';
import type { AnyCardRenderer } from './cards';
import type { LLMClient, LLMProviderName } from './llm';

/**
 * Plugin SDK — v0.1 contract.
 *
 * A plugin is a typed, distributable unit of capability. v0.1 covers Skills
 * (input → work → output); v0.2 adds Sources (data ingestion + connector auth)
 * and a separate `@vocion/sdk` package. For now the types live in-tree
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
  /**
   * Generic pluggable LLM client bound to the skill's declared `provider`
   * (defaults to `openai`). Prefer this over `ctx.openai` — the LLM host
   * switches from openai → anthropic/vertex/azure-openai via one skill-
   * manifest field, with no code change inside the skill.
   */
  readonly llm: LLMClient;
  /**
   * Direct OpenAI client. Kept for back-compat + access to features not
   * yet in the generic `LLMClient` interface (tool calling, streaming,
   * assistants API). Will be deprecated when the generic interface covers
   * those.
   */
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
 * An Operation plugin (formerly `Skill` — see {@link Skill} alias).
 * Declarative metadata up top, executable logic in `run`.
 *
 * Plugins export a default `Operation<Input, Output>` — or a factory if
 * they need per-org configuration. See `defineOperation` below for the
 * ergonomic constructor.
 *
 * **Naming note (v0.2):** what was called a "Skill" in v0.1 is renamed
 * **`Operation`** in v0.2 to disambiguate from procedural Playbooks
 * (markdown + YAML frontmatter that agents read on demand). The
 * `Skill` / `defineSkill` / `AnySkill` / `PluginManifest.skills`
 * names remain as deprecated aliases for one release cycle.
 */
export type Operation<Input = unknown, Output = unknown> = {
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
   * LLM provider for `ctx.llm`. Defaults to `openai`. Override per-skill
   * to use Anthropic, Vertex, or Azure OpenAI. The provider must have its
   * credentials configured in env (e.g. `ANTHROPIC_API_KEY`) or the first
   * invocation throws.
   */
  readonly provider?: LLMProviderName;
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
 * Type-erased Operation — what plugin manifests declare and the
 * registry stores. Input/Output types are preserved at authoring time
 * via `defineOperation`, then erased at the manifest boundary so
 * heterogeneous operation arrays type-check. Runtime validation via
 * the Zod schemas is what enforces the real shape.
 */
export type AnyOperation = Operation<any, any>;

/**
 * Ergonomic constructor — infers types from the schemas so callers can
 * write `defineOperation({ inputSchema, outputSchema, run, ... })`
 * without restating generic parameters. Returns the erased type so
 * callers can drop the operation into an `operations: AnyOperation[]`
 * field without casts.
 * @param op
 */
export function defineOperation<Input, Output>(op: Operation<Input, Output>): AnyOperation {
  return op as AnyOperation;
}

/* ------------------------------------------------------------------ */
/* v0.1 back-compat aliases                                            */
/* ------------------------------------------------------------------ */

/** @deprecated Use {@link Operation} instead. Kept for v0.1 plugin back-compat. */
export type Skill<Input = unknown, Output = unknown> = Operation<Input, Output>;

/** @deprecated Use {@link AnyOperation} instead. */
export type AnySkill = AnyOperation;

/** @deprecated Use {@link defineOperation} instead. */
export const defineSkill = defineOperation;

/* ================================================================== */
/* Source plugin contract (v0.3)                                        */
/* ================================================================== */

/**
 * Source plugin = a connector to an external data system.
 *
 * Pairs with the Operation contract. Together they cover both ends
 * of an agent's data flow: Sources bring data in (OAuth + pull +
 * optional direct retrieval), Operations act on it (typed LLM calls
 * + plugin code).
 *
 * Two flavors:
 *   - **Wrap-Onyx sources** delegate `pull` + `retrieve` to Vocion's
 *     existing Onyx integration. Owns OAuth + credentials; ingestion
 *     happens in Onyx.
 *   - **Vocion-native sources** implement `pull` (and optionally
 *     `retrieve`) directly against the external API. No Onyx in the
 *     loop. Real-time. Useful when freshness > index-quality.
 */

/** What auth scheme this source uses. */
export type SourceAuthType = 'oauth2' | 'api_key' | 'none';

/**
 * Whether this source's credentials are tenant-wide or per-user.
 *  - `org`:  one credential serves the whole organization.
 *  - `user`: each user connects their own account; agents only see
 *            credentials belonging to the invoking user.
 *  - `both`: support either pattern; the operator chooses at install.
 */
export type SourceScope = 'org' | 'user' | 'both';

/** Decrypted credential payload — never logged, never written to state. */
export type RawCredentials = {
  /** Access token (OAuth) or static key (api_key). */
  accessToken?: string;
  /** Refresh token for OAuth flows that issue one. */
  refreshToken?: string;
  /** OAuth issuer-specified expiry (unix seconds, optional). */
  expiresAt?: number;
  /** Scopes granted at consent time (OAuth). */
  scopes?: string[];
  /** Arbitrary auxiliary fields a connector wants to carry. */
  metadata?: Record<string, unknown>;
};

/**
 * Env handed to OAuth handlers. Vocion fills in `clientId`,
 * `clientSecret`, and `redirectUri` from operator-supplied env vars
 * named `VOCION_OAUTH_<SLUG>_CLIENT_ID` / `_SECRET`.
 */
export type SourceEnv = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

/** OAuth 2.0 authorization-code flow declarations. */
export type OAuth2Config = {
  /** Where to send the user to begin the consent flow. */
  authorizationUrl: string;
  /** Where Vocion exchanges the auth code for tokens. */
  tokenUrl: string;
  /** OAuth scopes requested. */
  scopes: string[];
  /**
   * Exchange an authorization code for credentials. Vocion calls this
   * after the user is redirected back to `/api/oauth/<slug>/callback`.
   */
  exchangeCode: (env: SourceEnv, code: string, redirectUri: string) => Promise<RawCredentials>;
  /** Refresh an expiring access token. Optional but recommended. */
  refresh?: (env: SourceEnv, creds: RawCredentials) => Promise<RawCredentials>;
  /** Revoke at the provider on disconnect. Best-effort. */
  revoke?: (env: SourceEnv, creds: RawCredentials) => Promise<void>;
};

/** A document yielded by `Source.pull()`. Shape matches Onyx's ingestion API. */
export type SourceDocument = {
  /** Stable identifier in the source system (e.g. Drive file id). */
  externalId: string;
  /** Human-readable title (file name, page title). */
  title: string;
  /** Plain-text body. Connectors are responsible for extraction. */
  content: string;
  /** Deep link back to the source system. */
  link?: string;
  /** ISO-8601 timestamp. */
  updatedAt?: string;
  /** Arbitrary tags / fields exposed to retrieval filters. */
  metadata?: Record<string, string | number | boolean | null>;
};

export type PullOptions = {
  /** Resume from a sync cursor (per-connector opaque string). */
  since?: string;
  /** Soft cap on docs yielded per call. */
  limit?: number;
};

export type RetrieveOptions = {
  limit?: number;
};

/** Context passed to `pull()`, `retrieve()`, and `healthCheck()`. */
export type SourceContext<Config = unknown> = {
  readonly orgId: string;
  /** Present when retrieving against a user-scope credential. */
  readonly userId?: string;
  readonly config: Config;
  /** Decrypted credentials. Already auto-refreshed if expiry was near. */
  readonly credentials: RawCredentials;
  readonly log: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
};

/**
 * A Source plugin declaration. Authored via `defineSource()` for type
 * inference. Mounted via a `PluginManifest.sources` entry.
 */
export type Source<Config = unknown> = {
  /** Stable slug, e.g. `hubspot`, `google_drive_native`. */
  readonly slug: string;
  /** Display name shown in the catalog. */
  readonly name: string;
  /** One-paragraph description for the catalog. */
  readonly description: string;
  /** Plugin semver. */
  readonly version: string;
  /** Visual brand tokens for the catalog UI. */
  readonly brand?: {
    color: string;
    iconUrl?: string;
    lucideIcon?: string;
  };
  readonly authType: SourceAuthType;
  readonly scope: SourceScope;
  /**
   * Optional per-install configuration (e.g. a workspace id, region).
   * Zod schema validated when the org admin clicks "Install".
   */
  readonly configSchema?: import('zod').ZodType<Config>;
  /** OAuth2 config — required when `authType === 'oauth2'`. */
  readonly oauth?: OAuth2Config;
  /** Hint shown when `authType === 'api_key'` — markdown for the "how to get a key" panel. */
  readonly apiKey?: { instructionsMarkdown: string };
  /**
   * Pull documents from the source into the indexer. Yielded docs flow
   * into Onyx (v0.3) or pgvector (v0.4). Implementers should yield in
   * batches and respect `opts.since` / `opts.limit`.
   */
  readonly pull: (ctx: SourceContext<Config>, opts: PullOptions) => AsyncIterable<SourceDocument>;
  /**
   * Direct retrieval — bypass the indexer entirely. Useful for sources
   * where freshness matters more than corpus-quality search. Returns
   * `RetrievalHit[]` (same shape as `PluginContext.retrieve()`).
   */
  readonly retrieve?: (ctx: SourceContext<Config>, query: string, opts?: RetrieveOptions) => Promise<RetrievalHit[]>;
  /** Health probe surfaced on the source detail page. */
  readonly healthCheck?: (ctx: SourceContext<Config>) => Promise<{ ok: boolean; message?: string }>;
};

/** Type-erased Source — what the registry stores + manifests declare. */
export type AnySource = Source<any>;

/**
 * Ergonomic constructor with type inference.
 * @param source
 */
export function defineSource<Config>(source: Source<Config>): AnySource {
  return source as AnySource;
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
  /** Reverse-DNS style identifier for the plugin itself (not individual operations). */
  readonly id: string;
  /** Plugin package semver. */
  readonly version: string;
  /** Human description. */
  readonly description?: string;
  /** Eager — plugin exports a fixed list of operations. */
  readonly operations?: AnyOperation[];
  /**
   * @deprecated Use {@link operations} instead. Kept as an alias for
   * v0.1 plugins. When both are provided, `operations` wins.
   */
  readonly skills?: AnyOperation[];
  /** Lazy — plugin exports a factory called once at boot. */
  readonly register?: (env: PluginRegistrationEnv) => Promise<AnyOperation[]> | AnyOperation[];
  /**
   * Source plugins (v0.3+). Plugins can export operations, sources, or
   * both. Each source must declare `slug`, `authType`, `pull` at minimum.
   */
  readonly sources?: AnySource[];
  /** Lazy factory variant for sources, same role as `register` for operations. */
  readonly registerSources?: (env: PluginRegistrationEnv) => Promise<AnySource[]> | AnySource[];
  /**
   * Card renderers (v0.4+, @experimental). Plugins ship typed UI components
   * for their workflow outputs. The framework looks up renderers by slug;
   * slug priority resolves collisions so a plugin can override a generic
   * first-party card for its own runs. See `./cards.ts` for the contract.
   */
  readonly renderers?: AnyCardRenderer[];
  /** Lazy factory variant for renderers, same role as `register` for operations. */
  readonly registerRenderers?: (env: PluginRegistrationEnv) => Promise<AnyCardRenderer[]> | AnyCardRenderer[];
};

/** Minimal env passed to plugin factories. Kept narrow — no DB / no LLM here. */
export type PluginRegistrationEnv = {
  readonly orgId: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};
