/**
 * SPEND, READ — what model calls cost, grouped one way, over a period, from
 * the ledger (`model_call`, `services/spend/ledger.ts`).
 *
 * One read answers every slice a person asks for: by workspace across an Org,
 * by agent, by person, by feature, by model, by run, by conversation or by day.
 * Scope is an Org (every workspace in it) or one workspace, and every query is
 * fenced to it, so two Orgs never see each other's rows.
 */

import type { SQL } from 'drizzle-orm';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, conversationSchema, modelCallSchema, projectSchema, userSchema } from '@/models/Schema';

export const SPEND_GROUPS = ['workspace', 'agent', 'user', 'feature', 'model', 'run', 'conversation', 'day'] as const;
export type SpendGroup = typeof SPEND_GROUPS[number];

/** Who may be read: an Org's every workspace, or one workspace. */
export type SpendScope = { accountId: string } | { orgId: string };

export type SpendFilters = {
  orgId?: string;
  agentSlug?: string;
  userId?: string;
  feature?: string;
  model?: string;
  runKind?: string;
  runId?: string;
  conversationId?: number;
};

export type SpendRow = {
  /** What the group is keyed by: a workspace id, an agent slug, `mission_run:42`, `2026-10-23`. Null for calls with nothing in that column. */
  key: string | null;
  /** The key as a person reads it. */
  label: string;
  calls: number;
  tokens: number;
  microCents: number;
};

export type SpendResult = {
  rows: SpendRow[];
  total: { calls: number; tokens: number; microCents: number };
};

/** The most rows a group returns; the total always counts everything. */
export const SPEND_ROW_LIMIT = 200;

/**
 * The column a group is keyed on.
 * @param group - The group.
 */
function keyOf(group: SpendGroup): SQL<string | null> {
  const m = modelCallSchema;
  switch (group) {
    case 'workspace': return sql<string>`${m.orgId}`;
    case 'agent': return sql<string | null>`${m.agentSlug}`;
    case 'user': return sql<string | null>`${m.userId}`;
    case 'feature': return sql<string>`${m.feature}`;
    case 'model': return sql<string>`${m.model}`;
    case 'run': return sql<string | null>`case when ${m.runKind} is null then null else ${m.runKind} || ':' || ${m.runId} end`;
    case 'conversation': return sql<string | null>`${m.conversationId}::text`;
    case 'day': return sql<string>`to_char(date_trunc('day', ${m.createdAt}), 'YYYY-MM-DD')`;
  }
}

/**
 * The fence and filters as one condition.
 * @param scope - Whose rows.
 * @param from - Period start, inclusive.
 * @param to - Period end, exclusive.
 * @param filters - Narrowing.
 */
function whereOf(scope: SpendScope, from: Date, to: Date, filters: SpendFilters): SQL {
  const m = modelCallSchema;
  const parts: SQL[] = [
    'accountId' in scope ? eq(m.accountId, scope.accountId) : eq(m.orgId, scope.orgId),
    gte(m.createdAt, from),
    lt(m.createdAt, to),
  ];
  if (filters.orgId) {
    parts.push(eq(m.orgId, filters.orgId));
  }
  if (filters.agentSlug) {
    parts.push(eq(m.agentSlug, filters.agentSlug));
  }
  if (filters.userId) {
    parts.push(eq(m.userId, filters.userId));
  }
  if (filters.feature) {
    parts.push(eq(m.feature, filters.feature));
  }
  if (filters.model) {
    parts.push(eq(m.model, filters.model));
  }
  if (filters.runKind) {
    parts.push(eq(m.runKind, filters.runKind));
  }
  if (filters.runId) {
    parts.push(eq(m.runId, filters.runId));
  }
  if (filters.conversationId !== undefined) {
    parts.push(eq(m.conversationId, filters.conversationId));
  }
  return and(...parts)!;
}

/**
 * The workspaces a scope covers.
 * @param scope - An Org or one workspace.
 */
async function workspacesOf(scope: SpendScope): Promise<string[]> {
  if ('orgId' in scope) {
    return [scope.orgId];
  }
  return (await db.select({ id: projectSchema.id }).from(projectSchema).where(eq(projectSchema.accountId, scope.accountId))).map(r => r.id);
}

/** A run's kind as a person reads it. */
const RUN_LABELS: Record<string, string> = {
  mission_run: 'Mission run',
  browser_run: 'Browser run',
  routine_run: 'Routine run',
  workflow_run: 'Workflow run',
  eval_run: 'Eval',
  worker_run: 'Engineering run',
};

/**
 * What a group's keys read as, looked up once per page of rows.
 * @param group - The group.
 * @param keys - The keys on the page.
 * @param scope - Whose rows: names are read only from inside it.
 */
async function labelsFor(group: SpendGroup, keys: string[], scope: SpendScope): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) {
    return out;
  }
  if (group === 'workspace') {
    const orgIds = await workspacesOf(scope);
    for (const r of await db.select({ id: projectSchema.id, name: projectSchema.name }).from(projectSchema).where(and(inArray(projectSchema.id, keys), inArray(projectSchema.id, orgIds.length ? orgIds : [''])))) {
      out.set(r.id, r.name);
    }
  } else if (group === 'agent') {
    // An agent's slug is unique only within its workspace: read names from the scope's own.
    const orgIds = await workspacesOf(scope);
    for (const r of orgIds.length ? await db.select({ slug: agentSchema.slug, name: agentSchema.name }).from(agentSchema).where(and(inArray(agentSchema.slug, keys), inArray(agentSchema.orgId, orgIds))) : []) {
      out.set(r.slug, r.name);
    }
  } else if (group === 'user') {
    for (const r of await db.select({ id: userSchema.id, name: userSchema.name, email: userSchema.email }).from(userSchema).where(inArray(userSchema.id, keys))) {
      out.set(r.id, r.name?.trim() || r.email);
    }
  } else if (group === 'conversation') {
    const ids = keys.map(Number).filter(Number.isInteger);
    const orgIds = await workspacesOf(scope);
    for (const r of ids.length && orgIds.length ? await db.select({ id: conversationSchema.id, title: conversationSchema.title }).from(conversationSchema).where(and(inArray(conversationSchema.id, ids), inArray(conversationSchema.orgId, orgIds))) : []) {
      out.set(String(r.id), r.title);
    }
  } else if (group === 'run') {
    for (const k of keys) {
      const [kind, id] = k.split(':');
      out.set(k, `${RUN_LABELS[kind!] ?? kind} ${id}`);
    }
  }
  return out;
}

/** What a call with nothing in the grouped column is shown as. */
const UNSET_LABELS: Record<SpendGroup, string> = {
  workspace: 'Unknown workspace',
  agent: 'No agent',
  user: 'No person (scheduled or system work)',
  feature: 'Unattributed',
  model: 'Unknown model',
  run: 'Not in a run',
  conversation: 'Not in a conversation',
  day: 'Unknown day',
};

/**
 * Spend grouped one way over a period.
 * @param input - What to read.
 * @param input.scope - An Org or one workspace.
 * @param input.groupBy - How to group.
 * @param input.from - Period start, inclusive.
 * @param input.to - Period end, exclusive.
 * @param input.filters - Narrowing (an agent, a person, a model…).
 */
export async function spendBy(input: { scope: SpendScope; groupBy: SpendGroup; from: Date; to: Date; filters?: SpendFilters }): Promise<SpendResult> {
  const m = modelCallSchema;
  const where = whereOf(input.scope, input.from, input.to, input.filters ?? {});
  const key = keyOf(input.groupBy);
  const calls = sql<number>`count(*)::int`;
  const tokens = sql<number>`coalesce(sum(${m.inputTokens} + ${m.outputTokens}), 0)::bigint`;
  const micro = sql<number>`coalesce(sum(${m.microCents}), 0)::bigint`;
  const grouped = await db
    .select({ key, calls, tokens, microCents: micro })
    .from(m)
    .where(where)
    .groupBy(key)
    .orderBy(input.groupBy === 'day' ? desc(key) : desc(micro))
    .limit(SPEND_ROW_LIMIT);
  const [total] = await db.select({ calls, tokens, microCents: micro }).from(m).where(where);
  const keys = grouped.map(r => r.key).filter((k): k is string => typeof k === 'string');
  const labels = await labelsFor(input.groupBy, keys, input.scope);
  return {
    rows: grouped.map(r => ({
      key: r.key,
      label: r.key === null ? UNSET_LABELS[input.groupBy] : labels.get(r.key) ?? r.key,
      calls: Number(r.calls),
      tokens: Number(r.tokens),
      microCents: Number(r.microCents),
    })),
    total: { calls: Number(total?.calls ?? 0), tokens: Number(total?.tokens ?? 0), microCents: Number(total?.microCents ?? 0) },
  };
}

/**
 * A period from what a person picked: the last N days, or an explicit range.
 * @param period - `7d`, `30d`, `90d`, or `today`.
 * @param now - The clock.
 */
export function periodRange(period: string, now: Date = new Date()): { from: Date; to: Date } {
  const to = new Date(now.getTime() + 1);
  if (period === 'today') {
    const from = new Date(now);
    from.setUTCHours(0, 0, 0, 0);
    return { from, to };
  }
  const days = Number(/^(\d+)d$/.exec(period)?.[1] ?? 30);
  return { from: new Date(now.getTime() - Math.min(Math.max(days, 1), 366) * 86_400_000), to };
}
