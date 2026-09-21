/**
 * posthog_event_counts — the STRUCTURED read over the PostHog daily mirror.
 *
 * The `posthog` connector writes one document per day whose metadata carries
 * every number in its table. `search_knowledge` finds those days by relevance
 * and can never add seven of them up reliably; this tool does, the way
 * `hubspot_count_*` sums the CRM mirror rather than asking the live API. Same
 * gate, same scoping: present for any agent with a posthog source in scope,
 * narrowed by the per-user ACL, org-isolated in SQL.
 *
 * What it adds up is what the mirror holds — aggregates. Unique users are
 * summed per day (a person active on three days counts three times), which is
 * what the field name says; nothing here can dedupe people, because no person
 * was ever stored.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { knowledgeDocumentSchema, knowledgeSourceSchema } from '@/models/Schema';

/** A source slug that belongs to the PostHog connector family. */
const POSTHOG_SLUG = /^posthog(?:$|-)/;

/**
 * Presence gate: a posthog source in the agent's scope, and (when a per-user
 * ACL is set) one the ACL allows.
 * @param ctx - The runtime context.
 */
export function posthogInScope(ctx: RuntimeContext): boolean {
  if (!ctx.connectorSources.some(slug => POSTHOG_SLUG.test(slug))) {
    return false;
  }
  if (ctx.allowedSourceSlugs) {
    return ctx.allowedSourceSlugs.some(slug => POSTHOG_SLUG.test(slug));
  }
  return true;
}

/**
 * `metadata ->> 'key'` with the key inlined, as CrmRecordsService does it.
 * @param key - A metadata key from this module's own constants.
 */
function meta(key: string) {
  if (!/^[A-Z][A-Z0-9]*$/i.test(key)) {
    throw new Error(`unsafe metadata key: ${key}`);
  }
  return sql`${knowledgeDocumentSchema.metadata} ->> ${sql.raw(`'${key}'`)}`;
}

type DayMetadata = {
  date?: string;
  product?: string;
  project?: string;
  events?: Record<string, { count?: unknown; uniques?: unknown }>;
  totalEvents?: unknown;
  activeUsers?: unknown;
  exceptions?: unknown;
  exceptionUsers?: unknown;
  errorIssues?: unknown;
  errorTracking?: unknown;
};

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return isoDay(d);
}

export type EventCountsArgs = {
  days?: number;
  events?: string[];
  product?: string;
};

/**
 * Sum the daily documents over a trailing window, resolved on the server
 * clock: yesterday is the newest day the mirror holds, so `days: 7` is the
 * seven whole days ending yesterday.
 * @param ctx - The runtime context (org, scope, ACL).
 * @param args - Window, event filter and product filter.
 * @param now - The clock.
 */
export async function eventCountsForScope(ctx: RuntimeContext, args: EventCountsArgs, now: Date = new Date()) {
  const days = Math.min(Math.max(Math.trunc(args.days ?? 7), 1), 400);
  const to = isoDay(now);
  const from = addDays(to, -days);

  const sourceRows = await db
    .select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug, lastSyncedAt: knowledgeSourceSchema.lastSyncedAt })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, ctx.orgId),
      sql`(${knowledgeSourceSchema.configJson} ->> '_connector' = 'posthog' OR ${knowledgeSourceSchema.slug} ~ '^posthog(-|$)')`,
    ));
  const sources = ctx.allowedSourceSlugs
    ? sourceRows.filter(row => ctx.allowedSourceSlugs!.includes(row.slug))
    : sourceRows;
  if (sources.length === 0) {
    return {
      error: 'no_posthog_source',
      message: 'No PostHog source is connected in this agent\'s scope. A person connects one at /dashboard/connectors (PostHog).',
    };
  }

  const conditions = [
    eq(knowledgeDocumentSchema.orgId, ctx.orgId),
    inArray(knowledgeDocumentSchema.sourceId, sources.map(s => s.id)),
    sql`${meta('kind')} = 'analytics-daily'`,
    gte(meta('date'), from),
    lt(meta('date'), to),
  ];
  if (args.product) {
    conditions.push(sql`lower(${meta('product')}) = ${args.product.toLowerCase()}`);
  }
  const rows = await db
    .select({ metadata: knowledgeDocumentSchema.metadata, sourceId: knowledgeDocumentSchema.sourceId })
    .from(knowledgeDocumentSchema)
    .where(and(...conditions));

  const wanted = args.events?.map(name => name.trim()).filter(Boolean);
  const wantedLower = wanted ? new Set(wanted.map(name => name.toLowerCase())) : null;

  const perEvent = new Map<string, { count: number; unique_user_days: number; days_seen: number }>();
  const daysCovered = new Set<string>();
  let totalEvents = 0;
  let activeUserDays = 0;
  let exceptions = 0;
  let exceptionUserDays = 0;
  let issueDays = 0;
  let issuesSum = 0;
  let errorTrackingUnavailable = 0;

  for (const row of rows) {
    const m = (row.metadata ?? {}) as DayMetadata;
    if (typeof m.date !== 'string') {
      continue;
    }
    daysCovered.add(m.date);
    totalEvents += num(m.totalEvents);
    activeUserDays += num(m.activeUsers);
    exceptions += num(m.exceptions);
    exceptionUserDays += num(m.exceptionUsers);
    if (m.errorIssues !== null && m.errorIssues !== undefined) {
      issueDays += 1;
      issuesSum += num(m.errorIssues);
    } else if (m.errorTracking === 'unavailable') {
      errorTrackingUnavailable += 1;
    }
    for (const [event, counts] of Object.entries(m.events ?? {})) {
      if (wantedLower && !wantedLower.has(event.toLowerCase())) {
        continue;
      }
      const acc = perEvent.get(event) ?? { count: 0, unique_user_days: 0, days_seen: 0 };
      acc.count += num(counts?.count);
      acc.unique_user_days += num(counts?.uniques);
      acc.days_seen += 1;
      perEvent.set(event, acc);
    }
  }

  const expectedDays: string[] = [];
  for (let day = from; day < to; day = addDays(day, 1)) {
    expectedDays.push(day);
  }
  const daysMissing = expectedDays.filter(day => !daysCovered.has(day));
  const unknownEvents = wanted
    ? wanted.filter(name => ![...perEvent.keys()].some(known => known.toLowerCase() === name.toLowerCase()))
    : [];
  const asOf = sources
    .map(s => s.lastSyncedAt)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  return {
    from,
    to_exclusive: to,
    days_requested: days,
    days_covered: daysCovered.size,
    // Days the mirror has no document for. A gap means the count EXCLUDES
    // those days — say so rather than reporting the sum as the period.
    days_missing: daysMissing,
    product: args.product ?? null,
    sources_read: sources.map(s => s.slug),
    as_of: asOf ? asOf.toISOString() : null,
    totals: {
      events: totalEvents,
      // Summed per day, not deduplicated across days — no person is stored.
      active_user_days: activeUserDays,
    },
    errors: {
      exception_events: exceptions,
      exception_user_days: exceptionUserDays,
      // Issues active per day, summed over the days that had the API.
      issues_active_day_sum: issueDays > 0 ? issuesSum : null,
      days_without_error_tracking: errorTrackingUnavailable,
    },
    events: [...perEvent.entries()]
      .map(([event, acc]) => ({ event, ...acc }))
      .sort((a, b) => b.count - a.count),
    // Names asked for that no day in the window carries. A non-empty list means
    // the answer is silent on those, not that they happened zero times.
    unknown_events: unknownEvents,
  };
}

export function posthogCountTools(ctx: RuntimeContext) {
  if (!posthogInScope(ctx)) {
    return [];
  }
  return [
    tool(
      async (args: EventCountsArgs) => JSON.stringify(await eventCountsForScope(ctx, args)),
      {
        name: 'posthog_event_counts',
        description: 'Sum the PostHog daily mirror over a trailing window: events and unique users per event, day totals, and error counts. Use for "how many X last 7 days", "events for product send this month". Resolved on the SERVER clock — yesterday is the newest day. Numbers are aggregates the connector stored; nothing here can name a person. Report days_missing and unknown_events alongside any number. Returns compact JSON to SYNTHESIZE, never to paste.',
        schema: z.object({
          days: z.number().int().min(1).max(400).optional().describe('Trailing whole days ending yesterday (default 7).'),
          events: z.array(z.string()).optional().describe('Only these event names (case-insensitive). Omit for every event the mirror carries.'),
          product: z.string().optional().describe('Only days written for this product (the source\'s product filter, or its name). Omit for all.'),
        }),
      },
    ),
  ];
}
