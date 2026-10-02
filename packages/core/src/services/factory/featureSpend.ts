/**
 * WHAT A FEATURE COST, in one place (Chris, 2026-10-02: "Can we get costs for
 * the agent run steps in the activity feed and counted toward the total
 * feature cost?" and "chat and agent cost in chat should also be tracked per
 * chat. And included in the feature cost.").
 *
 * A feature's spend is three figures added together:
 *
 * - **engineering** — its tasks' worker runs, each at the worker's own final
 *   account (`libs/worker/runCost.ts`). The same figure the run rows show.
 * - **agents** — the mission runs that served it: a plan, a QA review, a
 *   design run, a live check, an announcement. Each run's recorded cost
 *   (`mission_run.micro_cents`, `services/budget/runCost.ts`).
 * - **chat** — the chat turns that were about it (`conversation_message.micro_cents`).
 *
 * WHICH RUNS SERVED IT is read from record links, never from type or tool
 * names. The feature is its request and every record that points at it: the
 * tasks and plans that carry its `requestId`, the releases that carry it or
 * its tasks. An agent run served the feature when
 *
 * 1. a tool call it made named one of those records by id or code (the same
 *    id the Activity list has always joined on, `toolCallNamedId`), or
 * 2. the automation fire that started it carried one in its input — an id
 *    under `id`, `…Id` or `…Ids`, or the URL of one of its tasks' pull requests.
 *
 * A chat turn is about the records its own tool calls named in that turn;
 * a turn that named none is about the record the conversation is anchored
 * to — the record page it was started on, or the requests it filed. A turn
 * about nothing stays with the conversation alone.
 *
 * A run or turn that served several features is split evenly between them,
 * so the features' figures add up to what was spent and nothing is counted
 * twice.
 *
 * The figures are computed here and nowhere else. The feature page computes
 * them live; the request carries the same figures materialised
 * (`spentCents`, `agentCents`, `chatCents`), which the Work cost line and
 * every list read, refreshed by `refreshFeatureSpend` when a run or turn that
 * spent anything ends.
 */

import type { FactoryTypes } from '@/libs/factory/types';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { isCoreNounCode, parseCode } from '@/libs/codes';
import { db } from '@/libs/DB';
import { factoryTypes } from '@/libs/factory/types';
import { runCostCents } from '@/libs/worker/runCost';
import { automationRunSchema, businessObjectSchema, businessObjectTypeSchema, conversationMessageSchema, conversationSchema, missionRunSchema, toolCallSchema, workerRunSchema } from '@/models/Schema';
import { taskOfRun, toolCallNamedId } from './liveStatusData';

/** The metadata keys the feature graph reads — the links, nothing else. */
const LINK_KEYS = ['requestId', 'requestIds', 'taskIds', 'prUrl', 'url'] as const;

/** Micro-cents in a cent. */
const MICRO = 1_000_000;

/** One feature's spend, split three ways. */
export type FeatureSpend = {
  requestId: number;
  /** Its worker runs, in cents; null when none ran. */
  engineeringCents: number | null;
  /** Its share of the agent runs that served it, in micro-cents. */
  agentMicroCents: number;
  /** Its share of the chat turns about it, in micro-cents. */
  chatMicroCents: number;
  /** Mission run id → this feature's share of it, in micro-cents. */
  agentRuns: Map<number, number>;
  /** Conversation id → this feature's share of its turns, in micro-cents. */
  conversations: Map<number, number>;
};

/** The three figures in cents, and their total. */
export type SpendSplit = {
  engineeringCents: number | null;
  agentCents: number;
  chatCents: number;
  /** All three; null only when nothing at all is recorded. */
  totalCents: number | null;
};

/**
 * The split a page shows, in cents.
 * @param spend - The feature's spend.
 */
export function splitOf(spend: Pick<FeatureSpend, 'engineeringCents' | 'agentMicroCents' | 'chatMicroCents'>): SpendSplit {
  const agentCents = Math.round(spend.agentMicroCents / MICRO);
  const chatCents = Math.round(spend.chatMicroCents / MICRO);
  const nothing = spend.engineeringCents === null && spend.agentMicroCents === 0 && spend.chatMicroCents === 0;
  return {
    engineeringCents: spend.engineeringCents,
    agentCents,
    chatCents,
    totalCents: nothing ? null : (spend.engineeringCents ?? 0) + agentCents + chatCents,
  };
}

/** A record in the feature graph. */
export type GraphRecord = { id: number; type: string; meta: Record<string, unknown> };

/** Which features each record belongs to, and each task's pull request. */
export type FeatureGraph = {
  /** Record id → the request ids it belongs to. */
  owners: Map<number, Set<number>>;
  /** Pull request URL → the request ids whose tasks opened it. */
  pulls: Map<string, Set<number>>;
  /** The request ids. */
  requests: Set<number>;
};

/**
 * A positive integer id from a metadata value, or null.
 * @param v - The value.
 */
function idOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Ids from a value that is one id or a list of them.
 * @param v - The value.
 */
function idsOf(v: unknown): number[] {
  return (Array.isArray(v) ? v : [v]).map(idOf).filter((n): n is number => n !== null);
}

/**
 * Add `owner` to the set under `key`.
 * @param map - The map.
 * @param key - The key.
 * @param owners - The owners to add.
 */
function addAll<K>(map: Map<K, Set<number>>, key: K, owners: Iterable<number>): void {
  const set = map.get(key) ?? new Set<number>();
  for (const o of owners) {
    set.add(o);
  }
  if (set.size > 0) {
    map.set(key, set);
  }
}

/**
 * The feature graph: each request, and every task, plan and release that
 * points at it, by the links the records themselves carry.
 * @param types - The factory's types.
 * @param records - Every request, task, plan and release.
 */
export function featureGraph(types: Pick<FactoryTypes, 'request' | 'task' | 'plan' | 'release'>, records: readonly GraphRecord[]): FeatureGraph {
  const owners = new Map<number, Set<number>>();
  const pulls = new Map<string, Set<number>>();
  const requests = new Set<number>();
  for (const r of records) {
    if (r.type === types.request) {
      requests.add(r.id);
      addAll(owners, r.id, [r.id]);
    }
  }
  for (const r of records) {
    if (r.type === types.task || r.type === types.plan) {
      const rid = idOf(r.meta.requestId);
      if (rid !== null && requests.has(rid)) {
        addAll(owners, r.id, [rid]);
        for (const key of ['prUrl', 'url']) {
          const url = r.meta[key];
          if (r.type === types.task && typeof url === 'string' && url.startsWith('http')) {
            addAll(pulls, url, [rid]);
          }
        }
      }
    }
  }
  for (const r of records) {
    if (r.type === types.release) {
      const via = [
        ...idsOf(r.meta.requestIds).filter(id => requests.has(id)),
        ...idsOf(r.meta.taskIds).flatMap(id => [...(owners.get(id) ?? [])]),
      ];
      addAll(owners, r.id, via);
    }
  }
  return { owners, pulls, requests };
}

/**
 * The record id a tool call's named value refers to: a bare id, or a type's
 * code (`REL-375`). A core noun's code (`RUN-439`) is not a record.
 * @param named - The value `toolCallNamedId` read.
 */
export function namedRecordId(named: string | null): number | null {
  const parsed = parseCode(named);
  if (!parsed || (parsed.prefix !== null && isCoreNounCode(parsed.prefix))) {
    return null;
  }
  return parsed.id;
}

/**
 * The features an automation fire's input names: ids under `id`, `…Id` and
 * `…Ids`, and any value that is one of the feature tasks' pull request URLs.
 * Key shape, not key names: nothing here knows what a request is called.
 * @param graph - The feature graph.
 * @param input - The fire's input.
 */
export function featuresInFireInput(graph: FeatureGraph, input: Record<string, unknown> | null | undefined): Set<number> {
  const out = new Set<number>();
  for (const [key, value] of Object.entries(input ?? {})) {
    if (key === 'id' || /Ids?$/.test(key)) {
      for (const id of idsOf(value)) {
        for (const o of graph.owners.get(id) ?? []) {
          out.add(o);
        }
      }
    }
    if (typeof value === 'string') {
      for (const o of graph.pulls.get(value) ?? []) {
        out.add(o);
      }
    }
  }
  return out;
}

/** What `attributeSpend` reads. */
export type SpendInputs = {
  graph: FeatureGraph;
  /** Engineering cents per request (worker runs). */
  engineering: Map<number, number>;
  /** Costed mission runs. */
  missionRuns: Array<{ id: number; microCents: number }>;
  /** Mission run id → the record ids its tool calls named. */
  runNamed: Map<number, number[]>;
  /** Mission run id → the inputs of the fires that started it. */
  runFires: Map<number, Array<Record<string, unknown> | null>>;
  /** Costed chat turns, each with the record ids its tool calls named. */
  turns: Array<{ id: number; conversationId: number; microCents: number; named: number[] }>;
  /** Conversation id → the record ids it is anchored to. */
  anchors: Map<number, number[]>;
};

/**
 * Every feature's spend, from what the runs recorded and what they named.
 * Pure: the loader reads, this decides.
 * @param inputs - What was read.
 */
export function attributeSpend(inputs: SpendInputs): Map<number, FeatureSpend> {
  const out = new Map<number, FeatureSpend>();
  const of = (requestId: number): FeatureSpend => {
    let s = out.get(requestId);
    if (!s) {
      s = { requestId, engineeringCents: null, agentMicroCents: 0, chatMicroCents: 0, agentRuns: new Map(), conversations: new Map() };
      out.set(requestId, s);
    }
    return s;
  };
  const featuresOf = (ids: readonly number[]): Set<number> => {
    const set = new Set<number>();
    for (const id of ids) {
      for (const o of inputs.graph.owners.get(id) ?? []) {
        set.add(o);
      }
    }
    return set;
  };
  for (const [requestId, cents] of inputs.engineering) {
    of(requestId).engineeringCents = cents;
  }
  for (const run of inputs.missionRuns) {
    const served = featuresOf(inputs.runNamed.get(run.id) ?? []);
    for (const fire of inputs.runFires.get(run.id) ?? []) {
      for (const o of featuresInFireInput(inputs.graph, fire)) {
        served.add(o);
      }
    }
    if (served.size === 0 || run.microCents <= 0) {
      continue;
    }
    const share = run.microCents / served.size;
    for (const requestId of served) {
      const s = of(requestId);
      s.agentMicroCents += share;
      s.agentRuns.set(run.id, (s.agentRuns.get(run.id) ?? 0) + share);
    }
  }
  for (const turn of inputs.turns) {
    let about = featuresOf(turn.named);
    if (about.size === 0) {
      about = featuresOf(inputs.anchors.get(turn.conversationId) ?? []);
    }
    if (about.size === 0 || turn.microCents <= 0) {
      continue;
    }
    const share = turn.microCents / about.size;
    for (const requestId of about) {
      const s = of(requestId);
      s.chatMicroCents += share;
      s.conversations.set(turn.conversationId, (s.conversations.get(turn.conversationId) ?? 0) + share);
    }
  }
  return out;
}

/**
 * Every feature's spend in an org, read from the run rows. Empty for an org
 * without the factory's types.
 * @param orgId - Tenant.
 */
export async function loadFeatureSpend(orgId: string): Promise<Map<number, FeatureSpend>> {
  const types = await factoryTypes(orgId).catch(() => null);
  if (!types?.request || !types.task) {
    return new Map();
  }
  const slugs = [types.request, types.task, types.plan, types.release].filter((s): s is string => typeof s === 'string' && s !== '');
  const [records, workerRuns, missionRuns, turns] = await Promise.all([
    // Only the link fields: a task's metadata carries its whole contract.
    db.select({ id: businessObjectSchema.id, type: businessObjectTypeSchema.slug, meta: sql<Record<string, unknown>>`jsonb_build_object(${sql.join(LINK_KEYS.map(k => sql`${k}::text, ${businessObjectSchema.metadata} -> ${k}::text`), sql`, `)})` })
      .from(businessObjectSchema)
      .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
      .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectTypeSchema.slug, slugs))),
    db.select({
      record: sql<unknown>`${workerRunSchema.input} -> 'record'`,
      cents: workerRunSchema.cents,
      finalUsd: sql<string | null>`coalesce(${workerRunSchema.result} -> 'token_usage' ->> 'cost_usd', ${workerRunSchema.result} ->> 'cost_usd')`,
    })
      .from(workerRunSchema)
      .where(eq(workerRunSchema.orgId, orgId)),
    db.select({ id: missionRunSchema.id, microCents: missionRunSchema.microCents })
      .from(missionRunSchema)
      .where(and(eq(missionRunSchema.orgId, orgId), gt(missionRunSchema.microCents, 0))),
    db.select({ id: conversationMessageSchema.id, conversationId: conversationMessageSchema.conversationId, microCents: conversationMessageSchema.microCents, at: conversationMessageSchema.createdAt })
      .from(conversationMessageSchema)
      .innerJoin(conversationSchema, eq(conversationSchema.id, conversationMessageSchema.conversationId))
      .where(and(eq(conversationSchema.orgId, orgId), gt(conversationMessageSchema.microCents, 0))),
  ]);
  const graph = featureGraph(types, records.map(r => ({ id: r.id, type: r.type, meta: (r.meta ?? {}) as Record<string, unknown> })));

  const engineering = new Map<number, number>();
  for (const run of workerRuns) {
    const task = taskOfRun({ record: run.record }, types.task);
    // The run's figure exactly as its row shows it (`runCost.ts`).
    const final = run.finalUsd === null ? undefined : Number(run.finalUsd);
    const cents = runCostCents({ cents: run.cents, result: final === undefined ? null : { cost_usd: final } });
    for (const requestId of task === null ? [] : graph.owners.get(task) ?? []) {
      engineering.set(requestId, (engineering.get(requestId) ?? 0) + (cents ?? 0));
    }
  }

  const runIds = missionRuns.map(r => r.id);
  const [calls, fires] = runIds.length === 0
    ? [[], []]
    : await Promise.all([
        db.selectDistinct({ runId: toolCallSchema.missionRunId, named: toolCallNamedId })
          .from(toolCallSchema)
          .where(and(eq(toolCallSchema.orgId, orgId), inArray(toolCallSchema.missionRunId, runIds))),
        db.select({ runId: automationRunSchema.targetRunId, input: automationRunSchema.input })
          .from(automationRunSchema)
          .where(and(eq(automationRunSchema.orgId, orgId), isNotNull(automationRunSchema.targetRunId), inArray(automationRunSchema.targetRunId, runIds))),
      ]);
  const runNamed = new Map<number, number[]>();
  for (const c of calls) {
    const id = namedRecordId(c.named);
    if (c.runId !== null && id !== null) {
      runNamed.set(c.runId, [...(runNamed.get(c.runId) ?? []), id]);
    }
  }
  const runFires = new Map<number, Array<Record<string, unknown> | null>>();
  for (const f of fires) {
    if (f.runId !== null) {
      runFires.set(f.runId, [...(runFires.get(f.runId) ?? []), (f.input ?? null) as Record<string, unknown> | null]);
    }
  }

  const { named: turnNamed, anchors } = await chatLinks(orgId, graph, turns);

  return attributeSpend({
    graph,
    engineering,
    missionRuns: missionRuns.map(r => ({ id: r.id, microCents: r.microCents ?? 0 })),
    runNamed,
    runFires,
    turns: turns.map(t => ({ id: t.id, conversationId: t.conversationId, microCents: t.microCents ?? 0, named: turnNamed.get(t.id) ?? [] })),
    anchors,
  });
}

/**
 * What each costed chat turn named, and what each conversation is anchored
 * to. A tool call belongs to the first assistant message written at or after
 * it in its conversation — the turn it ran in.
 * @param orgId - Tenant.
 * @param graph - The feature graph.
 * @param turns - The costed turns.
 */
async function chatLinks(orgId: string, graph: FeatureGraph, turns: ReadonlyArray<{ id: number; conversationId: number; at: Date }>): Promise<{ named: Map<number, number[]>; anchors: Map<number, number[]> }> {
  const named = new Map<number, number[]>();
  const anchors = new Map<number, number[]>();
  const convIds = [...new Set(turns.map(t => t.conversationId))];
  if (convIds.length === 0) {
    return { named, anchors };
  }
  const [answers, calls, convs] = await Promise.all([
    db.select({ id: conversationMessageSchema.id, conversationId: conversationMessageSchema.conversationId, at: conversationMessageSchema.createdAt })
      .from(conversationMessageSchema)
      .where(and(inArray(conversationMessageSchema.conversationId, convIds), eq(conversationMessageSchema.role, 'assistant'))),
    db.select({ conversationId: toolCallSchema.conversationId, named: toolCallNamedId, at: toolCallSchema.createdAt })
      .from(toolCallSchema)
      .where(and(eq(toolCallSchema.orgId, orgId), inArray(toolCallSchema.conversationId, convIds))),
    db.select({ id: conversationSchema.id, context: conversationSchema.contextJson })
      .from(conversationSchema)
      .where(and(eq(conversationSchema.orgId, orgId), inArray(conversationSchema.id, convIds))),
  ]);
  const byConv = new Map<number, Array<{ id: number; at: number }>>();
  for (const a of answers) {
    byConv.set(a.conversationId, [...(byConv.get(a.conversationId) ?? []), { id: a.id, at: a.at.getTime() }]);
  }
  for (const list of byConv.values()) {
    list.sort((x, y) => x.at - y.at || x.id - y.id);
  }
  for (const c of calls) {
    const id = namedRecordId(c.named);
    const turn = c.conversationId === null || id === null ? undefined : byConv.get(c.conversationId)?.find(a => a.at >= c.at.getTime());
    if (turn) {
      named.set(turn.id, [...(named.get(turn.id) ?? []), id!]);
    }
  }
  // The anchor: the record page the conversation was started on, else the
  // requests that name it as the chat they were requested in.
  for (const c of convs) {
    const rec = c.context?.record;
    const id = rec && rec.type === 'object' ? idOf(rec.id) : null;
    if (id !== null && graph.owners.has(id)) {
      anchors.set(c.id, [id]);
    }
  }
  const originRows = await db.select({ id: businessObjectSchema.id, conv: sql<string | null>`${businessObjectSchema.metadata} -> 'origin' ->> 'conversationId'` })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), inArray(sql`${businessObjectSchema.metadata} -> 'origin' ->> 'conversationId'`, convIds.map(String))));
  for (const r of originRows) {
    const conv = idOf(r.conv);
    if (conv !== null && !anchors.has(conv) && graph.requests.has(r.id)) {
      anchors.set(conv, [...(anchors.get(conv) ?? []), r.id]);
    }
  }
  return { named, anchors };
}

/**
 * Write each request's figures onto it — `spentCents` (all three),
 * `engineeringCents`, `agentCents`, `chatCents` — where they changed, merged
 * into the metadata in one statement so no other field is touched.
 * @param orgId - Tenant.
 * @param now - The clock.
 * @returns How many requests changed.
 */
export async function refreshFeatureSpend(orgId: string, now: Date = new Date()): Promise<number> {
  const spend = await loadFeatureSpend(orgId);
  if (spend.size === 0) {
    return 0;
  }
  const current = await db.select({ id: businessObjectSchema.id, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, [...spend.keys()])));
  let changed = 0;
  for (const row of current) {
    const split = splitOf(spend.get(row.id)!);
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    if (split.totalCents === null || (meta.spentCents === split.totalCents && meta.agentCents === split.agentCents && meta.chatCents === split.chatCents && meta.engineeringCents === split.engineeringCents)) {
      continue;
    }
    const fields = {
      spentCents: split.totalCents,
      engineeringCents: split.engineeringCents,
      agentCents: split.agentCents,
      chatCents: split.chatCents,
      spendUpdatedAt: now.toISOString(),
    };
    await db.update(businessObjectSchema)
      .set({ metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify(fields)}::jsonb` })
      .where(eq(businessObjectSchema.id, row.id));
    changed += 1;
  }
  return changed;
}

/** How long a refresh waits for more of the same org's runs to end. */
const REFRESH_DEBOUNCE_MS = 5_000;

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Re-total the org's features a moment after a run or turn that spent
 * something ends — one pass for a burst of them. Never throws; a failed pass
 * is logged and the next one corrects it.
 * @param orgId - Tenant.
 */
export function scheduleFeatureSpendRefresh(orgId: string): void {
  if (pending.has(orgId)) {
    return;
  }
  const timer = setTimeout(() => {
    pending.delete(orgId);
    refreshFeatureSpend(orgId).catch((error) => {
      import('@/libs/Logger')
        .then(({ logger }) => logger.warn('feature spend refresh failed', { orgId, error: error instanceof Error ? error.message : String(error) }))
        .catch(() => {});
    });
  }, REFRESH_DEBOUNCE_MS);
  timer.unref?.();
  pending.set(orgId, timer);
}
