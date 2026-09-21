/**
 * The agent HARNESS — the reusable execution layer every Vocion agent
 * runs on. An agent is pure declarative config (workspace YAML → the
 * `agent` table); the harness is everything that turns that definition
 * into a running agent:
 *
 *   definition (agent row)  ──►  compiled graph  ──►  event stream
 *
 * Per `(orgId, agentSlug)` it loads (and LRU-caches) a BLUEPRINT — the
 * parts of an agent that are identical on every request — and compiles a
 * FRESH graph for each request from it, so nothing a single turn owns is
 * ever shared (see `compileAgentForRequest`). A compiled graph wires:
 *   - LangChain `BaseChatModel` from the role registry, honoring the
 *     agent's `harness_config` knobs (e.g. `maxTokens`).
 *   - Tool factories from `./tools/*` (the single registry).
 *   - Subagents from registered child agents + the `agent.subagents`
 *     JSONB column.
 *   - Skill + playbook mount via deepagents `createSkillsMiddleware`.
 *
 * The harness DEPLOYS AS PART OF CORE — in-process with the Next.js
 * app, same compose/EC2 topology; there is no separate runtime service
 * to host per agent. Entry points: chat SSE (`/rpc/agent/stream` →
 * AgentService.runAgentDeep), missions, workflows.
 *
 * The harness is OPT-IN behind `VOCION_AGENT_RUNTIME=deepagents`. The
 * legacy hand-rolled loop in services/AgentService.ts stays the default
 * until the new path is verified end-to-end against existing flows.
 */

import type { SubAgent } from 'deepagents';
import type { RuntimeContext } from './types';
import type { LangChainProvider } from '@/libs/llm';
import { tool as makeTool } from '@langchain/core/tools';
import { CompositeBackend, createDeepAgent, StateBackend, StoreBackend } from 'deepagents';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { buildChatModelForOrg, inferProviderForModel } from '@/libs/llm';
import { logger } from '@/libs/Logger';
import { readOnlyBackend } from '@/libs/memory/readOnlyBackend';
import { DrizzleMemoryStore, MEMORY_STORE_NAMESPACE } from '@/libs/memory/store';
import { workspaceTimeZone } from '@/libs/time/workspaceTimeZone';
import { resolveTimeZone } from '@/libs/time/zone';
import { agentSchema, playbookSchema } from '@/models/Schema';
import { assembleAgentMemory } from '@/services/MemoryService';
import { mountSkills } from '@/services/playbooks/mount';
import { CLOCK_RULES } from './clockRules';
import { deriveDelegationRoster } from './delegationRoster';
import { createMemoryDigestMiddleware } from './memoryDigest';
import { buildDomainTools } from './tools/registry';

/* ------------------------------------------------------------------ */
/* LRU cache of agent blueprints — never of per-request state          */
/* ------------------------------------------------------------------ */

// Only what every request on an agent shares is cached: the agent's DB
// row, its compiled system prompt, its delegable subagent descriptions,
// and its chat model. Everything one turn owns — who asked, which
// sources that person may read, where their events go, this turn's
// citation numbers — is built fresh per request.
//
// This used to cache the compiled graph itself, whose tools had closed
// over a single shared RuntimeContext that each request then overwrote
// in place. Two overlapping turns on the same agent therefore traded
// identities: one person's tokens arrived on the other's stream, and one
// person's retrieval ran under the other's source permissions. A
// background `refresh_briefing` run overlapping the turn that started it
// was enough to trigger it (issue #109), so this is not a rare race.
//
// Keep the cache small: each blueprint holds a model plus N subagent
// descriptions, so the working set per org should stay tight.
const BLUEPRINT_CACHE_LIMIT = 16;
const blueprintCache = new Map<string, AgentBlueprint>();

function cacheKey(orgId: string, agentSlug: string): string {
  return `${orgId}::${agentSlug}`;
}

function lruSet<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > limit) {
    const first = cache.keys().next().value;
    if (first === undefined) {
      break;
    }
    cache.delete(first);
  }
}

/* ------------------------------------------------------------------ */
/* Model selection                                                     */
/* ------------------------------------------------------------------ */

/** The subset of `agent.harnessConfig` that decides which chat model is built. */
export type HarnessModelConfig = {
  model?: string;
  modelProvider?: 'anthropic' | 'openai' | 'bedrock';
  maxTokens?: number;
};

/**
 * Turn an agent's harness block into `buildChatModelForOrg` options.
 *
 * Each key is omitted when unset, so an agent that names none falls all the way
 * through to the per-role env defaults and behaves exactly as it did before
 * this function existed.
 *
 * `modelProvider` is the axis that lets one agent answer on a different vendor
 * from the rest of the deployment: `modelProvider: bedrock` on a
 * `provider: local` agent runs the in-process loop against Amazon Bedrock, on
 * the org's own stored AWS key. Passing it explicitly is what makes
 * `buildChatModelForOrg` resolve that org's credential for the right vendor
 * rather than for the env-configured one.
 *
 * `model` is honoured ONLY alongside `modelProvider`, and that condition is
 * load-bearing rather than tidiness. The local loop used to ignore `model`
 * entirely, so every `model:` already written in workspace YAML was authored
 * for the agentcore or runtime harness and holds a Bedrock id
 * (`global.anthropic.claude-sonnet-4-6` in Larkfield's own agent). Reading it
 * unconditionally would hand that id to ChatAnthropic the moment an agentcore
 * agent fell back to the local loop — which `VOCION_DISABLE_AGENTCORE=1` does
 * routinely in dev — and every turn would fail on an unknown model. Naming the
 * provider is how an author says which vendor's id this is.
 * @param harnessConfig - The agent's harness block, or an empty object.
 */
export function chatModelOptionsFor(harnessConfig: HarnessModelConfig): {
  provider?: LangChainProvider;
  model?: string;
  maxTokens?: number;
} {
  const provider = harnessConfig.modelProvider;
  return {
    ...(provider ? { provider } : {}),
    ...(provider && harnessConfig.model ? { model: harnessConfig.model } : {}),
    ...(harnessConfig.maxTokens ? { maxTokens: harnessConfig.maxTokens } : {}),
  };
}

/**
 * A model named by the caller for ONE compiled graph, over whatever the agent's
 * harness block says. The model-upgrade test is the caller: it runs the same
 * agent on a baseline and a candidate model and compares the two.
 *
 * `provider` is optional; when absent it is read off the id's shape by
 * `inferProviderForModel`, and an id whose shape says nothing is refused —
 * handing an unknown id to the env-default vendor would fail on the first
 * turn with a less useful error than this one.
 */
export type ModelOverride = {
  model: string;
  provider?: LangChainProvider;
};

/**
 * The `buildChatModelForOrg` options for an agent, with an override applied.
 *
 * The override's `model` and `provider` win over the harness block; the
 * harness block's `maxTokens` still applies, because a cap is about the
 * agent's job, not about which model does it.
 * @param harnessConfig - The agent's harness block, or an empty object.
 * @param override - The caller's model, or undefined for the agent's own.
 */
export function chatModelOptionsWithOverride(
  harnessConfig: HarnessModelConfig,
  override: ModelOverride | undefined,
): ReturnType<typeof chatModelOptionsFor> {
  const base = chatModelOptionsFor(harnessConfig);
  if (!override) {
    return base;
  }
  const provider = override.provider ?? inferProviderForModel(override.model);
  if (!provider) {
    throw new Error(
      `cannot tell which provider serves model "${override.model}"; pass provider explicitly (anthropic | openai | bedrock)`,
    );
  }
  return { ...base, provider, model: override.model };
}

/* ------------------------------------------------------------------ */
/* Blueprint — what every request on one agent shares                  */
/* ------------------------------------------------------------------ */

export type CompiledAgentGraph = {
  /** The compiled deepagents instance, built for ONE request. */
  graph: ReturnType<typeof createDeepAgent>;
  /** The agent's row from `agent` (for prompt + few-shot). */
  agentRow: typeof agentSchema.$inferSelect;
  /**
   * The runtime context this request's tools closed over. It belongs to this
   * request alone — no other turn reads it and no other turn writes it — so
   * the caller may safely stamp this turn's own details on it (the Langfuse
   * `traceId`, for one) after the graph is compiled.
   */
  ctx: RuntimeContext;
};

/**
 * Everything about an agent that does not change from one request to the
 * next, so it can be built once and reused. Per-request state — the
 * person, their source permissions, their event stream — is deliberately
 * absent: it lives in the `RuntimeContext` that `compileAgentForRequest`
 * builds fresh each time.
 */
type AgentBlueprint = {
  /** The agent's row from `agent`. */
  agentRow: typeof agentSchema.$inferSelect;
  /** The fully compiled system prompt: authored text + the shared rules appended to it. */
  systemPrompt?: string;
  /**
   * The agents this one may delegate to, WITHOUT their tools. Tools carry
   * the requesting person's context, so they are attached per request.
   */
  subagentSpecs: Array<Omit<SubAgent, 'tools'>>;
  /** This agent's chat model. Stateless per call, so one instance serves every request. */
  model: Awaited<ReturnType<typeof buildChatModelForOrg>>;
  /** The workspace's own zone (`project.time_zone`), the fallback when a turn names none. */
  defaultTimeZone: string;
  /** Whether this agent mounts any skill or playbook folders (decides the skills middleware). */
  hasMounts: boolean;
};

/**
 * What ONE request brings to an agent: who is asking, what they may read,
 * and where their events go. Every field here is per-turn, which is why
 * none of it may be cached alongside the agent.
 */
export type AgentRequest = {
  /** Where this turn's structured events go — this person's SSE stream. */
  emit: RuntimeContext['emit'];
  /** Who triggered the run; omitted for schedules, MCP and API callers. */
  userId?: string;
  /** This person's source ACL (`SourceAccessService`); omitted means no narrowing. */
  allowedSourceSlugs?: string[];
  /** The mission this run belongs to, for mission-scoped tools. */
  missionSlug?: string;
  /** The `mission_run` driving this turn, for the audit trail. */
  missionRunId?: number;
  /** The persisted conversation this turn belongs to, stamped on `tool_call` rows. */
  conversationId?: number;
  /** Where the person is in the app right now, read by the `page_context` tool. */
  pageContext?: RuntimeContext['pageContext'];
  /** The person's own time zone for this turn; falls back to the workspace's. */
  timeZone?: string;
};

async function buildBlueprint(orgId: string, agentSlug: string, modelOverride?: ModelOverride): Promise<AgentBlueprint> {
  // Org-scoped, not slug-only: slugs repeat across projects (two workspaces on
  // one box, plus orphaned rows from older deploys), and an unscoped pick is
  // arbitrary — one org's chat silently compiling ANOTHER org's prompt/config.
  // Bit us in prod: the revenue-lead graph compiled a stale duplicate row, so
  // freshly granted tools never reached the model.
  const [row] = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agentSlug)));
  if (!row) {
    throw new Error(`agent ${agentSlug} not found in org ${orgId}`);
  }

  const harnessConfig = row.harnessConfig ?? {};
  const defaultTimeZone = await workspaceTimeZone(orgId);

  // ONE mechanism: agents are agents. A lead's delegable roster DERIVES from
  // the registry (agent-chat-surface.md §9 — routing is delegation): agents
  // that name this agent as their parent, plus — for the workspace lead —
  // every team's lead AND members, and — for a team lead — its own team's
  // members. Same rows the Agents page/org chart shows, so delegation and the
  // registry can't drift, and a workspace author never enumerates
  // `subagents` by hand. The inline `subagents` JSONB is DEPRECATED: kept
  // only as a fallback for names not registered (legacy brief-runner etc.).
  // See services/agents/delegationRoster.ts for the ordering rules.
  const roster = await deriveDelegationRoster(orgId, row);
  // Authored config first, and it WINS a name collision with the derived
  // roster: an author who wrote a `subagents` entry for a slug tuned its
  // description/prompt on purpose; the registry row is the fallback, not the
  // override. The team-table entry for that slug is skipped.
  //
  // Tools are absent here on purpose. Specialists get the SAME domain tool
  // surface as the lead (deepagents defaults a custom subagent's tools to
  // [], which silently left every registered specialist with filesystem
  // tools only), but those tools carry the requesting person's context, so
  // `compileAgentForRequest` attaches this request's own set.
  const authored = row.subagents ?? [];
  const authoredNames = new Set(authored.map(s => s.name));
  const subagentSpecs: Array<Omit<SubAgent, 'tools'>> = authored.map(s => ({
    name: s.name,
    description: s.description,
    systemPrompt: s.systemPrompt,
  }));
  for (const d of roster.delegates) {
    if (!authoredNames.has(d.slug)) {
      subagentSpecs.push({ name: d.slug, description: d.description, systemPrompt: d.systemPrompt });
    }
  }

  // Lead-less teams are named in the workspace lead's system prompt so the
  // answer degrades per team ("no lead yet") rather than silently omitting
  // one (F1 acceptance #5).
  let systemPrompt = row.systemPrompt ?? undefined;
  if (roster.leadlessTeams.length > 0) {
    const leadless = roster.leadlessTeams;
    const note = `Teams with no lead yet — you cannot consult them; say so plainly per team (e.g. "${leadless[0]} has no lead yet"), never silently omit them: ${leadless.join(', ')}.`;
    systemPrompt = [systemPrompt, note].filter(Boolean).join('\n\n');
  }

  // THE CLOCK (CORE, all agents).
  //
  // The agent did not know what day it was. Nowhere in the prompt, for any
  // agent, was there a date — and it shows: `crm.ts` works around it per tool
  // ("so you never have to know today's date"), briefing titles are authored
  // by the model and one of them copied the example date out of its own schema
  // description, and on 2026-09-17 the lead read a stale briefing's critical
  // path and served it as "right now", naming a call that was not on the
  // calendar. Chris: *"WTF. do you know what day it is?"* It did not.
  //
  // A model with no clock cannot tell a stale document from a current one, and
  // will always resolve that ambiguity in favour of answering. So: state the
  // time, and say plainly that a dated document older than today is history.
  // The time itself is NOT written here: this prompt is compiled once and the
  // graph is cached across requests for hours, so a NOW baked into it was the
  // time of whichever request built the graph (found 2026-09-18). Each turn
  // states NOW at the top of the person's message instead (`clockLine`, in
  // `runAgentDeep`), in the person's own zone.
  const CLOCK = CLOCK_RULES;
  systemPrompt = [systemPrompt, CLOCK].filter(Boolean).join('\n\n');
  // A place in Vocion is a link, not a description (2026-09-18: eight paragraphs of Zoom scope steps, no link). The tool holds the table; this line makes the call.
  systemPrompt = `${systemPrompt}\n\nWhen a person has to do something in Vocion themselves (connect or re-authorise a system, fix a credential, approve a proposal, adopt a learning), call where_to first and put the link it returns inline in your reply — never describe where to click without the link.`;

  // Output discipline (CORE, all agents). The main model reliably PASTES raw
  // tool output — record JSON, search hits — into its reply and ignores "don't
  // paste" rules; fighting that with content-stripping is whack-a-mole (it
  // pretty-prints/reformats so nothing matches). Instead give it a sanctioned
  // place to lay data out — a <scratch> block we strip deterministically — so
  // the user only ever sees what's AFTER it. Delimiter-based = format-agnostic.
  const OUTPUT_DISCIPLINE = [
    'OUTPUT FORMAT (strict):',
    'You may lay out raw data to reason over — record JSON, and ESPECIALLY search results and email contents (From/Subject/body, message lists) — but ONLY inside a single <scratch>…</scratch> block at the very START of your reply.',
    'Everything AFTER </scratch> is the answer the user sees. It must be clean synthesis in plain language: NO raw records, JSON, field:value lists, search hits, email headers/bodies, ids, or /dashboard links. When asked to "find an email" or "go get" something, the answer is the EXTRACTED fact in words (e.g. "Eric — erinb@northwind.example"), never the search results you read to find it.',
    'If you have no raw data to lay out, skip the scratch block and just answer.',
    'VOICE (chat replies): write like a sharp human chief of staff texting a busy founder — not a chatbot. In a conversational reply, hard bans: NO decorative or "stoplight" emoji (🔴🟡🟢✅) as bullets or status markers; NO templated scaffolding ("Here are your top three moves right now:", "I hope this helps", "Let me know if…"); NO filler closers ("Want me to draft all three now for your review?"). Keep a short ranked list tight (a bold lead-in + one line each), no per-item ##/### headers or --- rules. Lead with the move, be specific, cut hedging. EXCEPTION — a PUBLISHED, scannable document (a daily briefing via publish_briefing, or an explicitly long report): there, clear section structure and priority markers ARE appropriate (that\'s a document meant to be scanned, not a chat message). The ban is on chatbot slop in conversation, not on structure in documents.',
    'CITATIONS: tool output that carries a bracketed number — search_knowledge hits rendered as "[3] **title** [source]", and a briefing returned as "[4] Latest … briefing" — is a citable source. When a sentence states a fact you took from one, cite it inline with that number immediately after the claim, e.g. "He owns healthcare-IT at Kestrel [3]." Use the exact numbers you were given (they are globally unique for this turn); cite more than one where relevant ("[2][5]"); never invent a number or cite a source you did not use. Not every sentence needs a marker — your own synthesis, judgement and sequencing do not. But ANY concrete claim about the reader\'s world does: a meeting and its time, a dollar amount, a deal stage, a date, a person\'s name, how long something has been waiting. Those are the claims a reader needs to check, and an uncited one is indistinguishable from an invented one.',
  ].join(' ');
  systemPrompt = [systemPrompt, OUTPUT_DISCIPLINE].filter(Boolean).join('\n\n');

  // deepagents auto-injects a built-in `general-purpose` subagent whose prompt
  // is generic (DEFAULT_SUBAGENT_PROMPT — no answer-style rules). So when the
  // lead delegates "what should I do" to it, that subagent calls lookup_objects
  // and, told nothing otherwise, pastes the raw record back — the lead's
  // "synthesize, never dump" rule never reaches the actor that composes the
  // reply. Pre-define our own `general-purpose` carrying the discipline; the
  // injector skips its default when one already exists by that name.
  if (!subagentSpecs.some(s => s.name === 'general-purpose')) {
    subagentSpecs.push({
      name: 'general-purpose',
      description: 'General-purpose worker for research and multi-step tasks the lead delegates.',
      systemPrompt: 'You do delegated research and multi-step work, then return a concise, SYNTHESIZED result to the lead. NEVER paste raw tool output, record field-dumps (key: value lists), internal ids, /dashboard/... deep-links, or profile URLs — name people and the human reason in plain language. Return only what the lead needs to answer, tightly.',
    });
  }

  const model = await buildChatModelForOrg('main', orgId, chatModelOptionsWithOverride(harnessConfig, modelOverride));

  // Only mount deepagents' SkillsMiddleware when THIS AGENT actually
  // mounts something. The middleware requires initialized state fields and
  // fails in the webpack production bundle ("Middleware SkillsMiddleware
  // has required state fields that must be initialized") — dev/Turbopack
  // tolerated it, so this broke PROD chat only. With nothing mounted the
  // middleware buys nothing; bodies still mount via initialFiles for the
  // file tools.
  const [playbookCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(playbookSchema)
    .where(eq(playbookSchema.orgId, orgId));
  const hasAnyFolders = Number(playbookCount?.n ?? 0) > 0;
  const hasMounts = hasAnyFolders && ((row.skillSlugs ?? []).length > 0 || (row.playbookSlugs ?? []).length > 0);

  return { agentRow: row, systemPrompt, subagentSpecs, model, defaultTimeZone, hasMounts };
}

/**
 * This agent's blueprint, from the cache when it is already there.
 *
 * Reading it moves the key to the back of the LRU, so a busy agent stays
 * in the cache and an idle one falls out of it.
 * @param orgId - Tenant scope.
 * @param agentSlug - The agent to load.
 */
async function getBlueprint(orgId: string, agentSlug: string): Promise<AgentBlueprint> {
  const key = cacheKey(orgId, agentSlug);
  const cached = blueprintCache.get(key);
  if (cached) {
    blueprintCache.delete(key);
    blueprintCache.set(key, cached);
    return cached;
  }
  const fresh = await buildBlueprint(orgId, agentSlug);
  lruSet(blueprintCache, key, fresh, BLUEPRINT_CACHE_LIMIT);
  return fresh;
}

/**
 * The runtime context for ONE request: the agent's fixed scope plus who is
 * asking, what they may read, and where their events go.
 *
 * A fresh object every time is the whole point. The tools this request
 * builds close over THIS object, so nothing another turn does can reach
 * into it — which is what went wrong when one context was shared and
 * overwritten per request (issue #109).
 * @param orgId - Tenant scope.
 * @param blueprint - The agent's cached, request-independent parts.
 * @param request - What this one request brings.
 */
function buildRequestContext(orgId: string, blueprint: AgentBlueprint, request: AgentRequest): RuntimeContext {
  const row = blueprint.agentRow;
  return {
    orgId,
    agentSlug: row.slug,
    connectorSources: row.connectorSources ?? [],
    objectTypeSlugs: row.objectTypeSlugs ?? [],
    searchConfig: (row.searchConfig as RuntimeContext['searchConfig']) ?? {},
    harnessConfig: row.harnessConfig ?? {},
    defaultTimeZone: blueprint.defaultTimeZone,
    // The person's zone for this turn, else the workspace's.
    timeZone: resolveTimeZone(request.timeZone, blueprint.defaultTimeZone),
    emit: request.emit,
    userId: request.userId,
    allowedSourceSlugs: request.allowedSourceSlugs,
    missionSlug: request.missionSlug,
    missionRunId: request.missionRunId,
    conversationId: request.conversationId,
    pageContext: request.pageContext,
    provider: 'local',
    // Delegation attribution for this turn only: the tool-call record reads
    // it to credit a specialist's calls (taskId → specialist name).
    delegations: new Map(),
    // Citation numbering restarts each turn, and the numbers the model cites
    // must belong to the sources THIS turn retrieved.
    citationSeq: { current: 0 },
  };
}

/**
 * Compile a graph to answer ONE request, on this agent's cached blueprint.
 *
 * The blueprint (row, prompt, subagent descriptions, model) is shared; the
 * runtime context and the tools that close over it are not. That split is
 * the fix for issue #109: the graph used to be cached with its tools bound
 * to a single context that every request overwrote in place, so two
 * overlapping turns on one agent swapped identities — events to the wrong
 * stream, retrieval under the wrong source permissions, `tool_call` rows
 * stamped with the wrong person. Compiling per request costs a graph build
 * against a turn that already costs seconds of model time.
 * @param orgId - Tenant scope.
 * @param agentSlug - The agent to run.
 * @param request - Who is asking, what they may read, where their events go.
 * @param opts - Per-request overrides.
 * @param opts.modelOverride - Run this one request on a named model instead of the agent's own.
 */
export async function compileAgentForRequest(
  orgId: string,
  agentSlug: string,
  request: AgentRequest,
  opts: { modelOverride?: ModelOverride } = {},
): Promise<CompiledAgentGraph> {
  // An overridden model is never cached: the cache is keyed on the agent, and
  // a blueprint holding the candidate model would answer the next ordinary
  // chat turn on it. Building it per call keeps the agent's own model the
  // only one the cache ever holds.
  const blueprint = opts.modelOverride
    ? await buildBlueprint(orgId, agentSlug, opts.modelOverride)
    : await getBlueprint(orgId, agentSlug);

  const ctx = buildRequestContext(orgId, blueprint, request);

  // Tools: built-ins from createDeepAgent (ls/read_file/.../task/write_todos)
  // plus our domain-specific tools below.
  //
  // Retrieval is the native pgvector path (`search_knowledge`). Source-typed
  // filtering uses per-connector slugs (knowledge_source.slug).
  // `harness.excludeTools` withholds built-ins by name — the tool never
  // reaches the model's catalog, so the agent can't even offer it (vs.
  // `interrupts`, which keeps the tool but gates execution).
  const excludeTools = new Set(ctx.harnessConfig.excludeTools ?? []);
  const tools = buildDomainTools(ctx).filter(t => !excludeTools.has(t.name));
  // Specialists answer with the SAME tool surface as the lead, on this
  // request's context — a delegate must not read more than the person who
  // asked.
  const subagents: SubAgent[] = blueprint.subagentSpecs.map(spec => ({ ...spec, tools: tools as SubAgent['tools'] }));

  const graph = createDeepAgent({
    model: blueprint.model,
    tools,
    subagents,
    // The agent's authored prompt goes HERE — deepagents combines it with its
    // own base/middleware system prompt and guarantees a single leading system
    // message. Passing it as an input `{role:'system'}` message instead makes
    // it a SECOND system message once the middleware prepends its own, which
    // the model API rejects ("System messages are only permitted as the first
    // passed message").
    systemPrompt: blueprint.systemPrompt,
    // Scratch stays ephemeral graph state; /memories/ routes to the LangGraph
    // Store over Postgres, so an agent's file reads there see the org's full
    // approved memory across threads. Writes under /memories/ are refused —
    // the human approval gate is the only write path into durable memory
    // (a poisoned "learning" is a persistent prompt injection; see the
    // PolinRider incident). Refused via readOnlyBackend, NOT deepagents
    // `permissions`: permission rules throw and a thrown tool error aborts
    // the whole turn, verified live.
    backend: new CompositeBackend(new StateBackend(), {
      '/memories/': readOnlyBackend(new StoreBackend({ store: new DrizzleMemoryStore(orgId), namespace: MEMORY_STORE_NAMESPACE })),
    }),
    // Approved learnings are injected into every model call's system message
    // (structural, not discoverable — see memoryDigest.ts). Safe to mount
    // unconditionally: it declares no required state fields.
    middleware: [createMemoryDigestMiddleware()],
    // `skills` mounts deepagents's SKILL.md auto-loader (string source PATHS).
    ...(blueprint.hasMounts ? { skills: ['/skills/', '/playbooks/'] } : {}),
  });

  return { graph, agentRow: blueprint.agentRow, ctx };
}

/** Test/dev hook: flush the cache (e.g. after `workspace:apply`). */
export function resetAgentRuntimeCache(): void {
  blueprintCache.clear();
}

/* ------------------------------------------------------------------ */
/* Initial-files builder — playbooks + AGENTS.md + (Phase 5) learnings */
/* ------------------------------------------------------------------ */

/**
 * deepagents' FilesystemMiddleware validates the `files` state as
 * `Record<string, FileData>` (content + mimeType + timestamps) — NOT
 * plain strings. Passing raw strings fails the middleware's state
 * validation the moment the mount is non-empty ("Middleware
 * "FilesystemMiddleware" has required state fields that must be
 * initialized" with issue paths like `files./learnings/global.md`).
 * Orgs with no playbooks/learnings passed `{}` and never noticed.
 */
type MountedFileData = {
  content: string;
  mimeType: string;
  created_at: string;
  modified_at: string;
};

function toFileData(content: string): MountedFileData {
  const now = new Date().toISOString();
  return { content, mimeType: 'text/markdown', created_at: now, modified_at: now };
}

export async function buildInitialFiles(
  orgId: string,
  agentSlug: string,
  memoryCtx: { userId?: string; missionSlug?: string; workflowSlug?: string } = {},
): Promise<Record<string, MountedFileData>> {
  const [row] = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agentSlug)));
  if (!row) {
    return {};
  }
  // An unresolvable {{env.NAME}} token throws here. Log it and let it
  // through: an agent started with the raw token invents a value, which
  // is far harder to spot than a failed run.
  let mounted: Record<string, string>;
  try {
    mounted = await mountSkills({
      orgId,
      skillSlugs: row.skillSlugs ?? [],
      playbookSlugs: row.playbookSlugs ?? [],
    });
  } catch (error) {
    logger.error(`agent "${agentSlug}" cannot start: mounting its workspace files failed`, { error });
    throw error;
  }
  // Pre-rendered store content, one file per rule under /memories/…: the
  // digest middleware reads these out of graph state, and the same paths are
  // readable through the StoreBackend route. Rendering happened at write
  // time; this is one indexed select per mounted namespace. The layer stack
  // (workspace → agent → workflow → mission → user) resolves from who this
  // turn is for.
  const memories = await assembleAgentMemory(orgId, {
    agentSlug,
    workspaceSteps: row.learningSteps ?? [],
    ...memoryCtx,
  });
  return Object.fromEntries(
    Object.entries({ ...mounted, ...memories }).map(([path, body]) => [path, toFileData(body)]),
  );
}

/* ------------------------------------------------------------------ */
/* tslint silence for unused makeTool / z imports (used by tool files) */
/* ------------------------------------------------------------------ */

// Re-export so the tool index can be a one-liner if we add more later.
export { makeTool, z };
