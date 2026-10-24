/**
 * ROUTING, READ — how dynamic routing (ADR 0006) chose, over a period, from
 * the records it already writes:
 *
 *   - agent turns: `model_call.route_selector` / `route_detail`, filed on every
 *     model call a routed turn makes (`services/routing/agentRoute.ts`). A turn
 *     is counted once, by its trace;
 *   - who answers a first message: `conversation_message.routing_json`
 *     (`decidedBy: 'jev'`, or a `jev` note when Jev was asked and the model
 *     read decided);
 *   - spend by model, split by how the model was chosen.
 *
 * The factory's engines are on the Engines page (`engine_run`). With no Jev key
 * nothing is routed, and every count here is zero.
 */

import type { SpendScope } from './spend';
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { conversationMessageSchema, conversationSchema, modelCallSchema, projectSchema } from '@/models/Schema';

export type RoutingSummary = {
  /** Agent turns, counted once each. */
  turns: { jev: number; configured: number };
  /** Turns by run kind (chat, mission, automation, other). */
  byKind: Array<{ kind: string; jev: number; configured: number }>;
  /** Why turns ran on the configured model, most common first (numbers folded so reasons group). */
  fallbacks: Array<{ reason: string; turns: number }>;
  /** First messages: Jev chose the agent, or Jev was asked and the model read decided. */
  agentPicks: { jev: number; modelRead: number };
  /** Spend by model and how it was chosen (`not routed` when no Jev decision was involved). */
  spendByModel: Array<{ model: string; selector: string; calls: number; microCents: number }>;
};

/**
 * Read the period's routing.
 * @param input - What to read.
 * @param input.scope - An Org or one workspace.
 * @param input.from - Period start, inclusive.
 * @param input.to - Period end, exclusive.
 */
export async function routingSummary(input: { scope: SpendScope; from: Date; to: Date }): Promise<RoutingSummary> {
  const m = modelCallSchema;
  const fence = 'accountId' in input.scope ? eq(m.accountId, input.scope.accountId) : eq(m.orgId, input.scope.orgId);
  const inPeriod = and(fence, gte(m.createdAt, input.from), lt(m.createdAt, input.to))!;
  const routed = and(inPeriod, isNotNull(m.routeSelector))!;
  const turn = sql<number>`count(distinct coalesce(${m.traceId}, ${m.id}::text))::int`;
  const kind = sql<string>`coalesce(${m.routeDetail}->>'kind', 'other')`;
  const reason = sql<string>`regexp_replace(coalesce(${m.routeDetail}->>'fallback', 'unknown'), '[0-9]+(\\.[0-9]+)?', 'n', 'g')`;
  const selector = sql<string>`coalesce(${m.routeSelector}, 'not routed')`;
  const micro = sql<number>`coalesce(sum(${m.microCents}), 0)::bigint`;

  const [bySelector, kinds, reasons, spend] = await Promise.all([
    db.select({ selector: m.routeSelector, turns: turn }).from(m).where(routed).groupBy(m.routeSelector),
    db.select({ kind, selector: m.routeSelector, turns: turn }).from(m).where(routed).groupBy(kind, m.routeSelector),
    db.select({ reason, turns: turn }).from(m).where(and(routed, eq(m.routeSelector, 'configured'))).groupBy(reason).orderBy(sql`2 desc`).limit(6),
    db.select({ model: m.model, selector, calls: sql<number>`count(*)::int`, microCents: micro }).from(m).where(inPeriod).groupBy(m.model, selector).orderBy(sql`4 desc`).limit(30),
  ]);

  const turns = { jev: 0, configured: 0 };
  for (const r of bySelector) {
    if (r.selector === 'jev' || r.selector === 'configured') {
      turns[r.selector] = Number(r.turns);
    }
  }
  const kindMap = new Map<string, { kind: string; jev: number; configured: number }>();
  for (const r of kinds) {
    const row = kindMap.get(r.kind) ?? { kind: r.kind, jev: 0, configured: 0 };
    if (r.selector === 'jev' || r.selector === 'configured') {
      row[r.selector] += Number(r.turns);
    }
    kindMap.set(r.kind, row);
  }

  // First messages, from the conversations in scope.
  const c = conversationSchema;
  const msg = conversationMessageSchema;
  const workspaces = 'orgId' in input.scope
    ? [input.scope.orgId]
    : (await db.select({ id: projectSchema.id }).from(projectSchema).where(eq(projectSchema.accountId, input.scope.accountId))).map(r => r.id);
  const picks = workspaces.length === 0
    ? []
    : await db
        .select({ jev: sql<number>`count(*) filter (where ${msg.routingJson}->>'decidedBy' = 'jev')::int`, modelRead: sql<number>`count(*) filter (where ${msg.routingJson}->>'decidedBy' <> 'jev' and (${msg.routingJson} -> 'jev') is not null)::int` })
        .from(msg)
        .innerJoin(c, eq(c.id, msg.conversationId))
        .where(and(inArray(c.orgId, workspaces), isNotNull(msg.routingJson), gte(msg.createdAt, input.from), lt(msg.createdAt, input.to)));

  return {
    turns,
    byKind: [...kindMap.values()].sort((a, b) => (b.jev + b.configured) - (a.jev + a.configured)),
    fallbacks: reasons.map(r => ({ reason: r.reason, turns: Number(r.turns) })),
    agentPicks: { jev: Number(picks[0]?.jev ?? 0), modelRead: Number(picks[0]?.modelRead ?? 0) },
    spendByModel: spend.map(r => ({ model: r.model, selector: r.selector, calls: Number(r.calls), microCents: Number(r.microCents) })),
  };
}
