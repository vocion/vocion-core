/**
 * Deepagents runtime — Phase 4.
 *
 * Builds (and LRU-caches) compiled `createDeepAgent` graphs per
 * `(orgId, agentSlug)`. Each graph wires:
 *   - LangChain `BaseChatModel` from the role registry (Phase 1).
 *   - Tool factories from `./tools/*` (Phase 4) plus run_operation.
 *   - Subagents from the `agent.subagents` JSONB column.
 *   - Playbook mount via deepagents `createSkillsMiddleware`
 *     (Phase 3 supplied the `playbookSchema` rows and mount helper).
 *
 * The runtime is OPT-IN behind `VOCION_AGENT_RUNTIME=deepagents`. The
 * legacy hand-rolled loop in services/AgentService.ts stays the default
 * until the new path is verified end-to-end against existing flows.
 */

import type { SubAgent } from 'deepagents';
import type { RuntimeContext } from './types';
import { tool as makeTool } from '@langchain/core/tools';
import { createDeepAgent, StateBackend } from 'deepagents';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { buildChatModel } from '@/libs/llm';
import { agentSchema } from '@/models/Schema';
import { bundleStepMarkdown } from '@/services/LearningsService';
import { mountPlaybooks } from '@/services/playbooks/mount';
import { requestHumanReviewTool } from './tools/hitl';
import {
  addLearningTool,
  checkLearningDedupTool,
  getLearningsTool,
  listLearningStepsTool,
  removeLearningTool,
  updateLearningTool,
} from './tools/learnings';
import { lookupObjectsTool } from './tools/lookupObjects';
import { runOperationTool } from './tools/runOperation';
import { listRecentRunsTool, listRunFeedbackTool } from './tools/runs';
import { searchKnowledgeTool } from './tools/searchKnowledge';

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
  const ctx: RuntimeContext = {
    orgId,
    connectorSources: row.connectorSources ?? [],
    objectTypeSlugs: row.objectTypeSlugs ?? [],
    searchConfig: (row.searchConfig as RuntimeContext['searchConfig']) ?? {},
    operationSlugs: row.skillSlugs ?? [],
    emit: noopEmit,
  };

  // Tools: built-ins from createDeepAgent (ls/read_file/.../task/write_todos)
  // plus our domain-specific tools below.
  //
  // Retrieval is the native pgvector path (`search_knowledge`). The
  // legacy Onyx tools (`search_onyx`, `search_everything`,
  // `find_related_conversations`) were removed in L.6. Source-typed
  // retrieval comes back via M.1's Source SDK + per-connector slugs.
  const tools = [
    searchKnowledgeTool(ctx),
    lookupObjectsTool(ctx),
    runOperationTool(ctx),
    listLearningStepsTool(ctx),
    getLearningsTool(ctx),
    checkLearningDedupTool(ctx),
    addLearningTool(ctx),
    updateLearningTool(ctx),
    removeLearningTool(ctx),
    listRecentRunsTool(ctx),
    listRunFeedbackTool(ctx),
    requestHumanReviewTool(ctx),
  ];

  const subagents = (row.subagents ?? []).map((s): SubAgent => ({
    name: s.name,
    description: s.description,
    systemPrompt: s.systemPrompt,
  }));

  const model = buildChatModel('main');

  const graph = createDeepAgent({
    model,
    tools,
    subagents,
    backend: new StateBackend(),
    // `skills` mounts deepagents's SKILL.md auto-loader at the given
    // virtual-FS path. Playbook bodies are seeded into `initialFiles`
    // per-turn via `mountPlaybooks`; the middleware lazy-loads on
    // `task` activation.
    skills: [{ source: '/playbooks/', name: 'playbooks' }] as never,
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

/** Test/dev hook: flush the cache (e.g. after `context:apply`). */
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
): void {
  const internal = compiled as unknown as { __ctx: RuntimeContext };
  internal.__ctx.emit = emit;
  internal.__ctx.userId = userId;
}

/* ------------------------------------------------------------------ */
/* Initial-files builder — playbooks + AGENTS.md + (Phase 5) learnings */
/* ------------------------------------------------------------------ */

export async function buildInitialFiles(
  orgId: string,
  agentSlug: string,
): Promise<Record<string, string>> {
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
  return {
    ...playbooks,
    ...learnings,
  };
}

/* ------------------------------------------------------------------ */
/* tslint silence for unused makeTool / z imports (used by tool files) */
/* ------------------------------------------------------------------ */

// Re-export so the tool index can be a one-liner if we add more later.
export { makeTool, z };
