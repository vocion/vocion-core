/**
 * Which model actually wrote a step of an SEO page — read from the call that
 * issued the tool call, never from what the agent says or what its YAML
 * asked for.
 *
 * A seat is pinned to a model (`harness.model`), but a turn can run on
 * another: the person picks Quick or Deep, or the work is done by a teammate
 * consulted through `task`, on its own model. So the stamp is read, in order:
 *
 *   1. the model message that made THIS tool call (the tool runtime's state):
 *      the model id its response reported, and the seat that ran it — a
 *      teammate's own call, not the newest call in the conversation;
 *   2. for the lead's own call with no message to read (a tool run through
 *      the agent runtime's callback), the newest call the ledger
 *      (`model_call`) filed for this conversation or run;
 *   3. only when no call was logged, the seat's configured model, marked as
 *      such: "configured" is a weaker claim than "ran", and the page says
 *      which (Principle 10).
 */

import type { RuntimeContext } from '@/services/agents/types';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { modelName } from '@/libs/llm/modelPrefs';
import { modelIdOf } from '@/libs/llm/usage';
import { agentSchema, modelCallSchema } from '@/models/Schema';

export type SeoModelStamp = {
  /** The model id, as the vendor reported it. */
  id: string;
  /** As a person reads it: "Opus 5.5". */
  name: string;
  /** `call`: the response that made this tool call; `ledger`: the newest call filed; `configured`: the seat's pinned model, no call logged. */
  source: 'call' | 'ledger' | 'configured';
  /** The seat that recorded the step. */
  agent: string | null;
  at: string;
};

/** What a tool sees of the turn that called it (`ToolRuntime`): its state and its config. */
export type ToolCallRuntime = {
  toolCallId?: string;
  state?: unknown;
  metadata?: Record<string, unknown>;
  config?: { metadata?: Record<string, unknown> };
};

/** How far back a call can be and still be the one handling this tool call. */
const WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * The model message that made this tool call, and the model it reported.
 * @param runtime - The tool's runtime.
 */
export function modelOfToolCall(runtime: ToolCallRuntime | undefined): string | null {
  const messages = (runtime?.state as { messages?: unknown[] } | undefined)?.messages;
  if (!Array.isArray(messages) || !runtime?.toolCallId) {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { tool_calls?: Array<{ id?: string }> } | null;
    if (m && Array.isArray(m.tool_calls) && m.tool_calls.some(c => c?.id === runtime.toolCallId)) {
      return modelIdOf(m);
    }
  }
  return null;
}

/**
 * The seat whose loop made this tool call: a teammate's name when it ran
 * inside one (`lc_agent_name`, set on each teammate's own graph), else the
 * lead's.
 * @param ctx - The turn.
 * @param runtime - The tool's runtime.
 */
export function seatOf(ctx: Pick<RuntimeContext, 'agentSlug'>, runtime: ToolCallRuntime | undefined): string | null {
  const name = runtime?.metadata?.lc_agent_name ?? runtime?.config?.metadata?.lc_agent_name;
  return typeof name === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(name) && name !== 'general-purpose' ? name : ctx.agentSlug ?? null;
}

async function configuredModel(orgId: string, seat: string | null, ctx: Pick<RuntimeContext, 'agentSlug' | 'harnessConfig'>): Promise<string | null> {
  if (!seat || seat === ctx.agentSlug) {
    return ctx.harnessConfig?.model ?? null;
  }
  const [row] = await db.select({ harness: agentSchema.harnessConfig }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, seat))).limit(1);
  return (row?.harness as { model?: string } | null)?.model ?? null;
}

/**
 * The model behind the step being recorded now, or null when nothing says.
 * @param ctx - The turn.
 * @param runtime - The tool's runtime, when the tool was called by a model in this process.
 * @param now - The clock (tests).
 */
export async function modelThatRan(ctx: Pick<RuntimeContext, 'orgId' | 'agentSlug' | 'conversationId' | 'missionRunId' | 'harnessConfig'>, runtime?: ToolCallRuntime, now: Date = new Date()): Promise<SeoModelStamp | null> {
  const at = now.toISOString();
  const agent = seatOf(ctx, runtime);
  const called = modelOfToolCall(runtime);
  if (called) {
    return { id: called, name: modelName(called), source: 'call', agent, at };
  }
  // The ledger's newest call is the lead's own only when no teammate is
  // involved: a teammate's step is never stamped with whatever ran last.
  const scope = ctx.missionRunId
    ? and(eq(modelCallSchema.runKind, 'mission_run'), eq(modelCallSchema.runId, String(ctx.missionRunId)))
    : ctx.conversationId
      ? eq(modelCallSchema.conversationId, ctx.conversationId)
      : null;
  if (scope && agent === (ctx.agentSlug ?? null)) {
    try {
      const [row] = await db
        .select({ model: modelCallSchema.model })
        .from(modelCallSchema)
        .where(and(eq(modelCallSchema.orgId, ctx.orgId), scope, gte(modelCallSchema.createdAt, new Date(now.getTime() - WINDOW_MS))))
        .orderBy(desc(modelCallSchema.createdAt), desc(modelCallSchema.id))
        .limit(1);
      if (row?.model) {
        return { id: row.model, name: modelName(row.model), source: 'ledger', agent, at };
      }
    } catch {
      // The ledger is evidence, not a dependency: fall through to the seat's model.
    }
  }
  const configured = await configuredModel(ctx.orgId, agent, ctx).catch(() => null);
  return configured ? { id: configured, name: modelName(configured), source: 'configured', agent, at } : null;
}
