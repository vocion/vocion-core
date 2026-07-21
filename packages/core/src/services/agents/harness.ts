/**
 * The agent HARNESS — the reusable execution layer every Vocion agent
 * runs on. An agent is pure declarative config (workspace YAML → the
 * `agent` table); the harness is everything that turns that definition
 * into a running agent:
 *
 *   definition (agent row)  ──►  compiled graph  ──►  event stream
 *
 * Per `(orgId, agentSlug)` it builds (and LRU-caches) a compiled
 * `createDeepAgent` graph wiring:
 *   - LangChain `BaseChatModel` from the role registry, honoring the
 *     agent's `harness_config` knobs (e.g. `maxTokens`).
 *   - Tool factories from `./tools/*` plus run_operation. Operations
 *     listed in `harness_config.interrupts` pause for human approval
 *     through the hitl_gate flow before executing (tools/runOperation.ts).
 *   - Subagents from the `agent.subagents` JSONB column.
 *   - Playbook mount via deepagents `createSkillsMiddleware`.
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
import { tool as makeTool } from '@langchain/core/tools';
import { createDeepAgent, StateBackend } from 'deepagents';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { buildChatModel } from '@/libs/llm';
import { agentSchema, playbookSchema, projectSchema, teamSchema } from '@/models/Schema';
import { bundleStepMarkdown } from '@/services/LearningsService';
import { mountPlaybooks } from '@/services/playbooks/mount';
import { buildDomainTools } from './tools/registry';

/* ------------------------------------------------------------------ */
/* LRU cache of compiled graphs                                        */
/* ------------------------------------------------------------------ */

// Mirrors rev-ai's @lru_cache(maxsize=8) in server/agents/__init__.py.
// Keep this small: each compiled graph holds a model + N tools + N
// subagents, so the working set per org should stay tight.
const GRAPH_CACHE_LIMIT = 16;
const graphCache = new Map<string, Awaited<ReturnType<typeof buildGraph>>>();

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
/* Build graph                                                         */
/* ------------------------------------------------------------------ */

export type CompiledAgentGraph = {
  /** The compiled deepagents instance. */
  graph: ReturnType<typeof createDeepAgent>;
  /** The agent's row from `agent` (for prompt + few-shot). */
  agentRow: typeof agentSchema.$inferSelect;
};

async function buildGraph(orgId: string, agentSlug: string): Promise<CompiledAgentGraph> {
  const [row] = await db
    .select()
    .from(agentSchema)
    .where(eq(agentSchema.slug, agentSlug));
  if (!row) {
    throw new Error(`agent ${agentSlug} not found`);
  }

  // Build a no-op runtime context; the SSE route swaps in a real
  // `emit` per request. Tool factories close over the per-graph
  // context but call `ctx.emit` on every invocation, so we replace
  // the emit at runtime via mutable reference.
  //
  // (The graph is shared across requests; ctx.emit cannot be shared.
  // We expose a `setEmit` on the returned object so the SSE route can
  // attach its own emit before each `streamEvents` call. See the
  // emitter pattern in `runAgentDeep` in services/AgentService.ts.)
  const noopEmit: RuntimeContext['emit'] = () => {};
  const harnessConfig = row.harnessConfig ?? {};
  const ctx: RuntimeContext = {
    orgId,
    agentSlug: row.slug,
    connectorSources: row.connectorSources ?? [],
    objectTypeSlugs: row.objectTypeSlugs ?? [],
    searchConfig: (row.searchConfig as RuntimeContext['searchConfig']) ?? {},
    operationSlugs: row.skillSlugs ?? [],
    harnessConfig,
    emit: noopEmit,
  };

  // Tools: built-ins from createDeepAgent (ls/read_file/.../task/write_todos)
  // plus our domain-specific tools below.
  //
  // Retrieval is the native pgvector path (`search_knowledge`). Source-typed
  // filtering uses per-connector slugs (knowledge_source.slug).
  // `harness.excludeTools` withholds built-ins by name — the tool never
  // reaches the model's catalog, so the agent can't even offer it (vs.
  // `interrupts`, which keeps the tool but gates execution).
  const excludeTools = new Set(harnessConfig.excludeTools ?? []);
  const tools = buildDomainTools(ctx).filter(t => !excludeTools.has(t.name));

  const subagents = (row.subagents ?? []).map((s): SubAgent => ({
    name: s.name,
    description: s.description,
    systemPrompt: s.systemPrompt,
  }));

  // F1 "consult the leads", chat path: when THIS agent is the workspace
  // lead (project.lead_agent_slug), the team leads from the `team` table
  // merge into its dispatchable subagents — "how's the quarter?" in chat
  // then consults every team, with the team named in each subagent's
  // description for per-team provenance (acceptance #4). JSONB-authored
  // subagents win name collisions. Lead-less teams are named in the
  // system prompt so the answer degrades per team ("no lead yet") rather
  // than silently omitting one (acceptance #5).
  let systemPrompt = row.systemPrompt ?? undefined;
  const [project] = await db
    .select({ leadAgentSlug: projectSchema.leadAgentSlug })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (project?.leadAgentSlug === row.slug) {
    const teams = await db.select().from(teamSchema).where(eq(teamSchema.orgId, orgId));
    const leadSlugs = teams.map(t => t.leadAgentSlug).filter((s): s is string => s !== null && s !== row.slug);
    const leadRows = leadSlugs.length > 0
      ? await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, leadSlugs)))
      : [];
    const taken = new Set(subagents.map(s => s.name));
    for (const team of teams) {
      const lead = leadRows.find(a => a.slug === team.leadAgentSlug);
      if (!lead || taken.has(lead.slug)) {
        continue;
      }
      taken.add(lead.slug);
      subagents.push({
        name: lead.slug,
        description: `${lead.name} — lead of the ${team.name} team. Consult for: ${team.description ?? lead.description ?? `the ${team.name} team's status and work`}.`,
        systemPrompt: lead.systemPrompt ?? `You are ${lead.name}, lead of the ${team.name} team.`,
      });
    }
    const leadless = teams.filter(t => t.leadAgentSlug === null).map(t => t.name);
    if (leadless.length > 0) {
      const note = `Teams with no lead yet — you cannot consult them; say so plainly per team (e.g. "${leadless[0]} has no lead yet"), never silently omit them: ${leadless.join(', ')}.`;
      systemPrompt = [systemPrompt, note].filter(Boolean).join('\n\n');
    }
  }

  // Output discipline (CORE, all agents). The main model reliably PASTES raw
  // tool output — record JSON, search hits — into its reply and ignores "don't
  // paste" rules; fighting that with content-stripping is whack-a-mole (it
  // pretty-prints/reformats so nothing matches). Instead give it a sanctioned
  // place to lay data out — a <scratch> block we strip deterministically — so
  // the user only ever sees what's AFTER it. Delimiter-based = format-agnostic.
  const OUTPUT_DISCIPLINE = [
    'OUTPUT FORMAT (strict):',
    'You may lay out raw data to reason over — record JSON, and ESPECIALLY search results and email contents (From/Subject/body, message lists) — but ONLY inside a single <scratch>…</scratch> block at the very START of your reply.',
    'Everything AFTER </scratch> is the answer the user sees. It must be clean synthesis in plain language: NO raw records, JSON, field:value lists, search hits, email headers/bodies, ids, or /dashboard links. When asked to "find an email" or "go get" something, the answer is the EXTRACTED fact in words (e.g. "Eric — ericb@exactcustomer.com"), never the search results you read to find it.',
    'If you have no raw data to lay out, skip the scratch block and just answer.',
  ].join(' ');
  systemPrompt = [systemPrompt, OUTPUT_DISCIPLINE].filter(Boolean).join('\n\n');

  // deepagents auto-injects a built-in `general-purpose` subagent whose prompt
  // is generic (DEFAULT_SUBAGENT_PROMPT — no answer-style rules). So when the
  // lead delegates "what should I do" to it, that subagent calls lookup_objects
  // and, told nothing otherwise, pastes the raw record back — the lead's
  // "synthesize, never dump" rule never reaches the actor that composes the
  // reply. Pre-define our own `general-purpose` carrying the discipline; the
  // injector skips its default when one already exists by that name.
  if (!subagents.some(s => s.name === 'general-purpose')) {
    subagents.push({
      name: 'general-purpose',
      description: 'General-purpose worker for research and multi-step tasks the lead delegates.',
      systemPrompt: 'You do delegated research and multi-step work, then return a concise, SYNTHESIZED result to the lead. NEVER paste raw tool output, record field-dumps (key: value lists), internal ids, /dashboard/... deep-links, or profile URLs — name people and the human reason in plain language. Return only what the lead needs to answer, tightly.',
    });
  }

  // Per-agent output cap from the harness block (falls back to the
  // langchain provider default when unset).
  const model = buildChatModel('main', {
    ...(harnessConfig.maxTokens ? { maxTokens: harnessConfig.maxTokens } : {}),
  });

  // Only mount deepagents' SkillsMiddleware when the org actually HAS
  // playbooks. The middleware requires initialized state fields and fails in
  // the webpack production bundle ("Middleware SkillsMiddleware has required
  // state fields that must be initialized") — dev/Turbopack tolerated it, so
  // this broke PROD chat only. With zero playbooks the middleware buys
  // nothing; playbook bodies still mount via initialFiles for the file tools.
  const [playbookCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(playbookSchema)
    .where(eq(playbookSchema.orgId, orgId));
  const hasPlaybooks = Number(playbookCount?.n ?? 0) > 0;

  const graph = createDeepAgent({
    model,
    tools,
    subagents,
    // The agent's authored prompt goes HERE — deepagents combines it with its
    // own base/middleware system prompt and guarantees a single leading system
    // message. Passing it as an input `{role:'system'}` message instead makes
    // it a SECOND system message once the middleware prepends its own, which
    // the model API rejects ("System messages are only permitted as the first
    // passed message").
    systemPrompt,
    backend: new StateBackend(),
    // `skills` mounts deepagents's SKILL.md auto-loader (string source PATHS).
    ...(hasPlaybooks ? { skills: ['/playbooks/'] } : {}),
  });

  // Attach the mutable RuntimeContext for the request adapter to update.
  return Object.assign({ graph, agentRow: row }, { __ctx: ctx }) as CompiledAgentGraph;
}

export async function getCompiledAgent(orgId: string, agentSlug: string): Promise<CompiledAgentGraph> {
  const key = cacheKey(orgId, agentSlug);
  const cached = graphCache.get(key);
  if (cached) {
    graphCache.delete(key);
    graphCache.set(key, cached);
    return cached;
  }
  const fresh = await buildGraph(orgId, agentSlug);
  lruSet(graphCache, key, fresh, GRAPH_CACHE_LIMIT);
  return fresh;
}

/** Test/dev hook: flush the cache (e.g. after `workspace:apply`). */
export function resetAgentRuntimeCache(): void {
  graphCache.clear();
}

/* ------------------------------------------------------------------ */
/* Per-request emit binding                                            */
/* ------------------------------------------------------------------ */

// The graph closures captured a `ctx.emit` at build time. To attach a
// per-request emit (the SSE writer for this user's stream) we expose a
// helper that replaces the captured ref. Tools call ctx.emit through
// the same object reference, so mutating its `emit` field is sufficient.

export function bindRequestEmit(
  compiled: CompiledAgentGraph,
  emit: RuntimeContext['emit'],
  userId?: string,
  allowedSourceSlugs?: string[],
  missionSlug?: string,
): void {
  const internal = compiled as unknown as { __ctx: RuntimeContext };
  internal.__ctx.emit = emit;
  internal.__ctx.userId = userId;
  internal.__ctx.allowedSourceSlugs = allowedSourceSlugs;
  internal.__ctx.missionSlug = missionSlug;
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
): Promise<Record<string, MountedFileData>> {
  const [row] = await db
    .select()
    .from(agentSchema)
    .where(eq(agentSchema.slug, agentSlug));
  if (!row) {
    return {};
  }
  const playbooks = await mountPlaybooks({
    orgId,
    agentTags: row.playbookTags ?? null,
  });
  const learnings = await bundleStepMarkdown(orgId, row.learningSteps ?? []);
  return Object.fromEntries(
    Object.entries({ ...playbooks, ...learnings }).map(([path, body]) => [path, toFileData(body)]),
  );
}

/* ------------------------------------------------------------------ */
/* tslint silence for unused makeTool / z imports (used by tool files) */
/* ------------------------------------------------------------------ */

// Re-export so the tool index can be a one-liner if we add more later.
export { makeTool, z };
