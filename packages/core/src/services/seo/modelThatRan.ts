/**
 * Which model actually wrote a step of an SEO page — read from the spend
 * ledger, never from what the agent says or what its YAML asked for.
 *
 * A seat is pinned to a model (`harness.model`), but a turn can run on
 * another: the person picks Quick or Deep, or the work is done by a teammate
 * consulted through `task`. The ledger (`model_call`) files every call with
 * the model id the response reported, so the latest call in this
 * conversation or run is the call that issued the tool call being handled.
 * When the ledger has nothing (a call not yet filed, a test), the seat's
 * configured model is recorded and marked as such: "configured" is a weaker
 * claim than "ran", and the page says which (Principle 10).
 */

import type { RuntimeContext } from '@/services/agents/types';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { modelName } from '@/libs/llm/modelPrefs';
import { modelCallSchema } from '@/models/Schema';

export type SeoModelStamp = {
  /** The model id, as the vendor reported it. */
  id: string;
  /** As a person reads it: "Opus 5.5". */
  name: string;
  /** `ledger`: read from the call that ran; `configured`: the seat's pinned model, nothing filed yet. */
  source: 'ledger' | 'configured';
  /** The seat that recorded the step. */
  agent: string | null;
  at: string;
};

/** How far back a call can be and still be the one handling this tool call. */
const WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * The model behind the step being recorded now, or null when nothing says.
 * @param ctx - The turn.
 * @param now - The clock (tests).
 */
export async function modelThatRan(ctx: Pick<RuntimeContext, 'orgId' | 'agentSlug' | 'conversationId' | 'missionRunId' | 'harnessConfig'>, now: Date = new Date()): Promise<SeoModelStamp | null> {
  const at = now.toISOString();
  const agent = ctx.agentSlug ?? null;
  const scope = ctx.missionRunId
    ? and(eq(modelCallSchema.runKind, 'mission_run'), eq(modelCallSchema.runId, String(ctx.missionRunId)))
    : ctx.conversationId
      ? eq(modelCallSchema.conversationId, ctx.conversationId)
      : null;
  if (scope) {
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
  const configured = ctx.harnessConfig?.model;
  return configured ? { id: configured, name: modelName(configured), source: 'configured', agent, at } : null;
}
