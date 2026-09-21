/**
 * PostHog connector — daily event counts as knowledge, aggregates only.
 *
 * Built for the analytics-planner agent: it reads a product's behaviour once a
 * week and files recommendations, and a team measure wants "documents sent per
 * week" with provenance it can point at. Neither needs a person or a payload.
 * So this connector never mirrors events. Each sync run asks PostHog's Query
 * API for counts and unique users per event per day, and writes ONE
 * `knowledge_document` per day — "PostHog · Send · 2026-09-19" — whose body is
 * a compact table plus the day's totals. `search_knowledge` reads it like any
 * other document; `posthog_event_counts` sums the same numbers out of its
 * metadata for a structured answer.
 *
 * What is deliberately not stored: distinct ids, person properties, event
 * properties, session recordings, exception messages or stack traces. Every
 * HogQL statement here is a GROUP BY over counts, and the error line is a
 * count of `$exception` events and of issues, never their text.
 *
 * Auth: a personal API key (`phx_…`) with the host and numeric project id it is
 * spent against, stored together as the `posthog` credential platform. The
 * public project token (`phc_…`) can only send events and is refused.
 *
 * Windows and the checkpoint. Days are whole days in the project's own
 * timezone (HogQL applies it); the newest day written is yesterday, because
 * today is still being counted. Every run re-reads the trailing `windowDays`
 * (default 7) since late-arriving events change recent days, and an incremental
 * run additionally starts one day before the stored watermark so the day the
 * previous run fell on is finished. A full run — Sync now, or the reconcile
 * schedule — re-reads `historyDays` (default 90); that window IS the mirror,
 * and the tombstone pass retires days that fall out of it. Re-syncing a day
 * rewrites the same document: the external id is the day.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { PosthogClient, PosthogCredentials, PosthogFailure } from '@/libs/posthog/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { createPosthogClient, credentialsFrom, projectPath } from '@/libs/posthog/client';
import { InspectInputError } from './inspect';

const posthogConfigSchema = z.object({
  /** How the project is named in document titles. Defaults to the product, then to the project id. */
  projectName: z.string().min(1).optional(),
  /**
   * The events to count. Blank reads the project's event definitions (up to
   * `MAX_DEFAULT_EVENTS`, PostHog's own `$` events left out) — the vocabulary
   * itself is the workspace's, never core's.
   */
  events: z.array(z.string().min(1)).optional(),
  /** Only count events whose `product` property equals this. Blank counts the whole project. */
  product: z.string().min(1).optional(),
  /** Trailing days every run re-reads, because recent days keep changing. */
  windowDays: z.number().int().min(1).max(90).default(7),
  /** Days a FULL run re-reads — what the mirror keeps. Older days are retired. */
  historyDays: z.number().int().min(7).max(400).default(90),
  /** Also count error-tracking issues per day, when this PostHog exposes the API. */
  errorTracking: z.boolean().default(true),
});

type PosthogConfig = z.infer<typeof posthogConfigSchema>;

/** Events read from the project when the workspace pins none. */
const MAX_DEFAULT_EVENTS = 50;
/** Days per HogQL statement. A GROUP BY over a month is one cheap call; a year is not. */
const MAX_DAYS_PER_QUERY = 31;
/** Event definitions per page, PostHog's own maximum. */
const DEFINITIONS_PAGE = 100;
/** The event PostHog's error tracking is built on. Always counted for the Errors line. */
const EXCEPTION_EVENT = '$exception';
/** The one `$` event a product team reads as behaviour rather than plumbing. */
const KEPT_INTERNAL_EVENTS = new Set(['$pageview']);

/**
 * `YYYY-MM-DD` of an instant, in UTC.
 * @param d - The instant.
 */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A day string shifted by whole days.
 * @param day - `YYYY-MM-DD`.
 * @param delta - Days to add (negative to subtract).
 */
function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return isoDay(d);
}

/**
 * Every day from `start` up to but not including `end`.
 * @param start - First day, inclusive.
 * @param end - Day after the last, exclusive.
 */
function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day < end; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/**
 * The half-open day range this run reads. See the module comment.
 * @param input - The run's position and the connector's settings.
 * @param input.since - The previous run's watermark, when incremental.
 * @param input.now - The run's clock.
 * @param input.windowDays - Trailing days always re-read.
 * @param input.historyDays - The most a run reads back.
 */
function syncWindow(input: { since: Date | null | undefined; now: Date; windowDays: number; historyDays: number }): { start: string; end: string } {
  const today = isoDay(input.now);
  const floor = addDays(today, -input.historyDays);
  if (!input.since) {
    return { start: floor, end: today };
  }
  const fromWatermark = addDays(isoDay(input.since), -1);
  const fromWindow = addDays(today, -input.windowDays);
  const start = fromWatermark < fromWindow ? fromWatermark : fromWindow;
  return { start: start < floor ? floor : start, end: today };
}

/**
 * Split a day range into query-sized pieces.
 * @param start - First day, inclusive.
 * @param end - Day after the last, exclusive.
 * @param maxDays - Longest piece.
 */
function chunkDays(start: string, end: string, maxDays: number): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  let from = start;
  while (from < end) {
    const to = addDays(from, maxDays) < end ? addDays(from, maxDays) : end;
    chunks.push({ from, to });
    from = to;
  }
  return chunks;
}

type DayCounts = { count: number; uniques: number };
type DayRows = Map<string, Map<string, DayCounts>>;

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The day a HogQL DateTime cell falls on, whatever offset it was serialised with.
 * @param cell - One result cell.
 */
function dayOf(cell: unknown): string {
  return String(cell ?? '').slice(0, 10);
}

/**
 * Read per-event rows off a `day, event, total, uniques` result set.
 * @param results - The Query API's `results` rows, positional.
 */
function parseBreakdown(results: unknown[][] | undefined): DayRows {
  const byDay: DayRows = new Map();
  for (const row of results ?? []) {
    const [dayCell, eventCell, total, uniques] = row;
    const day = dayOf(dayCell);
    const event = String(eventCell ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || event === '') {
      continue;
    }
    const events = byDay.get(day) ?? new Map<string, DayCounts>();
    events.set(event, { count: asNumber(total), uniques: asNumber(uniques) });
    byDay.set(day, events);
  }
  return byDay;
}

/**
 * Read per-day totals off a `day, total, uniques` result set.
 * @param results - The Query API's `results` rows, positional.
 */
function parseTotals(results: unknown[][] | undefined): Map<string, DayCounts> {
  const byDay = new Map<string, DayCounts>();
  for (const row of results ?? []) {
    const [dayCell, total, uniques] = row;
    const day = dayOf(dayCell);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      byDay.set(day, { count: asNumber(total), uniques: asNumber(uniques) });
    }
  }
  return byDay;
}

/**
 * The product predicate, or nothing. Placeholder-bound, never interpolated.
 * @param product - The `product` property value to filter on.
 */
function productClause(product: string | undefined): string {
  return product ? ' AND properties.product = {product}' : '';
}

/**
 * Counts and unique users per event per day over one range.
 *
 * `{from}`/`{to}` are bound as project-local wall-clock strings, so
 * `toDateTime` applies the project's timezone and `toStartOfDay` buckets in
 * the same one; the day a document is titled with is the day PostHog shows.
 * @param client - The project client.
 * @param range - Half-open day range.
 * @param range.from - First day, inclusive.
 * @param range.to - Day after the last, exclusive.
 * @param events - Event names to count.
 * @param product - Optional `product` property filter.
 */
async function breakdownFor(
  client: PosthogClient,
  range: { from: string; to: string },
  events: string[],
  product: string | undefined,
) {
  return client.hogql(
    'SELECT toStartOfDay(timestamp) AS day, event, count() AS total, count(DISTINCT person_id) AS uniques '
    + 'FROM events '
    + `WHERE timestamp >= toDateTime({from}) AND timestamp < toDateTime({to}) AND event IN {events}${productClause(product)} `
    + 'GROUP BY day, event ORDER BY day, event',
    { from: `${range.from} 00:00:00`, to: `${range.to} 00:00:00`, events, ...(product ? { product } : {}) },
  );
}

/**
 * Total events and active users per day over one range, every event included.
 * @param client - The project client.
 * @param range - Half-open day range.
 * @param range.from - First day, inclusive.
 * @param range.to - Day after the last, exclusive.
 * @param product - Optional `product` property filter.
 */
async function totalsFor(client: PosthogClient, range: { from: string; to: string }, product: string | undefined) {
  return client.hogql(
    'SELECT toStartOfDay(timestamp) AS day, count() AS total, count(DISTINCT person_id) AS uniques '
    + 'FROM events '
    + `WHERE timestamp >= toDateTime({from}) AND timestamp < toDateTime({to})${productClause(product)} `
    + 'GROUP BY day ORDER BY day',
    { from: `${range.from} 00:00:00`, to: `${range.to} 00:00:00`, ...(product ? { product } : {}) },
  );
}

type IssueAggregate = { issues: number; occurrences: number };

/**
 * How many error-tracking issues had occurrences on one day, through the
 * `ErrorTrackingQuery` node. Only counts come back out of it: an issue's name
 * and description are exception text, which is content.
 * @param client - The project client.
 * @param day - The day.
 */
async function issuesOn(client: PosthogClient, day: string): Promise<{ ok: true; data: IssueAggregate } | PosthogFailure> {
  const res = await client.query<{ results?: Array<{ aggregations?: { occurrences?: unknown } }> }>({
    kind: 'ErrorTrackingQuery',
    dateRange: { date_from: day, date_to: day },
    orderBy: 'occurrences',
    orderDirection: 'DESC',
    filterTestAccounts: false,
  });
  if (!res.ok) {
    return res;
  }
  const issues = res.data.results ?? [];
  return {
    ok: true,
    data: {
      issues: issues.length,
      occurrences: issues.reduce((sum, issue) => sum + asNumber(issue.aggregations?.occurrences), 0),
    },
  };
}

/**
 * The events the project defines, PostHog's own `$` plumbing left out, capped
 * and sorted so the table reads the same from one day to the next.
 * @param client - The project client.
 */
async function eventNamesFromProject(client: PosthogClient): Promise<{ ok: true; names: string[]; defined: number } | PosthogFailure> {
  const names: string[] = [];
  let defined = 0;
  for (let offset = 0; offset < MAX_DEFAULT_EVENTS * 4; offset += DEFINITIONS_PAGE) {
    const page = await client.get<{ count?: number; next?: string | null; results?: Array<{ name?: string }> }>(
      `${projectPath(client.credentials.projectId)}/event_definitions/`,
      { limit: String(DEFINITIONS_PAGE), offset: String(offset) },
    );
    if (!page.ok) {
      return page;
    }
    defined = page.data.count ?? defined;
    for (const definition of page.data.results ?? []) {
      const name = definition.name?.trim();
      if (!name) {
        continue;
      }
      if (name.startsWith('$') && !KEPT_INTERNAL_EVENTS.has(name)) {
        continue;
      }
      names.push(name);
    }
    if (!page.data.next) {
      break;
    }
  }
  const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  return { ok: true, names: unique.slice(0, MAX_DEFAULT_EVENTS), defined };
}

/** What one day's document is built from. */
type DayFacts = {
  day: string;
  events: Array<{ event: string; count: number; uniques: number }>;
  totals: DayCounts;
  exceptions: DayCounts;
  issues: IssueAggregate | null;
  /** Why `issues` is null when it is: the API is not exposed, or the workspace turned it off. */
  issuesSkipped: 'unavailable' | 'off' | null;
};

/**
 * The document for one day: a title the search results can be skimmed by, a
 * table the model can read, and metadata the count tool can sum without
 * parsing prose.
 * @param facts - The day's numbers.
 * @param cfg - The connector settings.
 * @param credentials - The project the numbers belong to.
 */
function documentFor(facts: DayFacts, cfg: PosthogConfig, credentials: PosthogCredentials): IngestDoc {
  const label = cfg.projectName ?? cfg.product ?? `project ${credentials.projectId}`;
  const title = `PostHog · ${label} · ${facts.day}`;
  const scope = [
    `Project ${credentials.projectId}`,
    cfg.product ? `product = ${cfg.product}` : 'whole project',
    'days in the project\'s timezone',
    'aggregates only — no people, no event properties, no content',
  ].join(' · ');
  const table = [
    '| Event | Count | Unique users |',
    '|---|---:|---:|',
    ...facts.events.map(row => `| ${row.event} | ${row.count} | ${row.uniques} |`),
  ];
  const errorsLine = facts.issues
    ? `Errors: ${facts.exceptions.count} $exception events · ${facts.exceptions.uniques} users affected · ${facts.issues.issues} issues active (${facts.issues.occurrences} occurrences, error tracking API).`
    : facts.issuesSkipped === 'unavailable'
      ? `Errors: ${facts.exceptions.count} $exception events · ${facts.exceptions.uniques} users affected. Issue counts skipped: this PostHog does not expose the error tracking API.`
      : `Errors: ${facts.exceptions.count} $exception events · ${facts.exceptions.uniques} users affected.`;
  const content = [
    title,
    '',
    scope,
    '',
    ...table,
    '',
    `Totals for the day: ${facts.totals.count} events · ${facts.totals.uniques} active users.`,
    errorsLine,
  ].join('\n');

  return {
    externalId: `posthog:${credentials.projectId}:${facts.day}`,
    title,
    content,
    uri: `${credentials.host}/project/${credentials.projectId}/activity/explore`,
    lastModifiedAt: new Date(`${addDays(facts.day, 1)}T00:00:00.000Z`),
    metadata: {
      kind: 'analytics-daily',
      product: cfg.product ?? label,
      project: label,
      projectId: credentials.projectId,
      date: facts.day,
      events: Object.fromEntries(facts.events.map(row => [row.event, { count: row.count, uniques: row.uniques }])),
      totalEvents: facts.totals.count,
      activeUsers: facts.totals.uniques,
      exceptions: facts.exceptions.count,
      exceptionUsers: facts.exceptions.uniques,
      errorIssues: facts.issues?.issues ?? null,
      errorOccurrences: facts.issues?.occurrences ?? null,
      errorTracking: facts.issues ? 'read' : facts.issuesSkipped,
    },
  };
}

/**
 * Resolve the events to count: the workspace's list, else the project's.
 * @param client - The project client.
 * @param cfg - The connector settings.
 */
async function resolveEvents(client: PosthogClient, cfg: PosthogConfig): Promise<string[]> {
  if (cfg.events && cfg.events.length > 0) {
    return [...new Set(cfg.events.map(name => name.trim()).filter(Boolean))];
  }
  const fromProject = await eventNamesFromProject(client);
  if (!fromProject.ok) {
    throw new Error(`PostHog connector could not read the project's event definitions (${fromProject.message}). List the events to count under \`events\` in the source config instead.`);
  }
  if (fromProject.names.length === 0) {
    throw new Error('PostHog connector found no events defined on this project. List the events to count under `events` in the source config, or send some events first.');
  }
  return fromProject.names;
}

/**
 * Run the checklist behind Test connection: is the key a personal key, does it
 * read this project, what does the project define, does one day of counts
 * come back, and is the error tracking API there. Nothing is saved.
 * @param input - The credential as typed, and the connector settings.
 * @param input.credentials - Decrypted or as-typed credential bag.
 * @param input.config - Source config, possibly partial.
 * @param input.now - The clock, for "yesterday".
 */
export async function inspectPosthog(input: {
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
  now?: Date;
}): Promise<ConnectorInspection> {
  const resolved = credentialsFrom(input.credentials);
  if (!resolved.ok) {
    throw new InspectInputError(resolved.message);
  }
  const cfg = posthogConfigSchema.parse(input.config);
  const client = createPosthogClient(resolved.credentials);
  const checks: ConnectorCheck[] = [];
  const check = (key: string, label: string, ok: boolean, detail: string | null): void => {
    checks.push({ key, label, ok, detail });
  };

  const project = await client.get<{ name?: string; timezone?: string }>(`${projectPath(resolved.credentials.projectId)}/`);
  const unreachable = !project.ok && project.error === 'posthog_error' && project.status === 0;
  check(
    'auth',
    'Personal API key reads the project',
    project.ok,
    project.ok
      ? `PostHog accepted the key. Project "${project.data.name ?? resolved.credentials.projectId}"${project.data.timezone ? `, timezone ${project.data.timezone}` : ''}.`
      : project.message,
  );
  if (!project.ok) {
    return {
      reachable: !unreachable,
      authorized: false,
      checks,
      note: null,
      error: unreachable ? project.message : null,
    };
  }

  let events: string[] = [];
  if (cfg.events && cfg.events.length > 0) {
    events = cfg.events;
    check('events', 'Events to count', true, `${events.length} listed in the source config: ${events.slice(0, 8).join(', ')}${events.length > 8 ? ', …' : ''}.`);
  } else {
    const defined = await eventNamesFromProject(client);
    events = defined.ok ? defined.names : [];
    check(
      'events',
      'Events to count',
      defined.ok && defined.names.length > 0,
      defined.ok
        ? defined.names.length > 0
          ? `The project defines ${defined.defined} events; the sync counts ${defined.names.length} of them (PostHog's own $ events left out${defined.defined > MAX_DEFAULT_EVENTS ? `, capped at ${MAX_DEFAULT_EVENTS}` : ''}). Pin a list under \`events\` to choose.`
          : 'The project defines no events yet. List them under `events` in the source config, or send some first.'
        : `${defined.message} List the events under \`events\` in the source config instead.`,
    );
  }

  const yesterday = addDays(isoDay(input.now ?? new Date()), -1);
  const totals = await totalsFor(client, { from: yesterday, to: addDays(yesterday, 1) }, cfg.product);
  const dayTotals = totals.ok ? parseTotals(totals.data.results).get(yesterday) : undefined;
  check(
    'query',
    'One day of counts (Query API)',
    totals.ok,
    totals.ok
      ? `Yesterday (${yesterday}): ${dayTotals?.count ?? 0} events · ${dayTotals?.uniques ?? 0} active users${cfg.product ? ` for product ${cfg.product}` : ''}.`
      : totals.message,
  );

  if (cfg.errorTracking) {
    const issues = await issuesOn(client, yesterday);
    check(
      'error_tracking',
      'Error tracking API',
      issues.ok,
      issues.ok
        ? `Exposed. Yesterday: ${issues.data.issues} issues active, ${issues.data.occurrences} occurrences. Only counts are ever stored.`
        : `${issues.message} The sync will still count $exception events, skip issue counts, and say so in each day's document.`,
    );
  }

  return {
    reachable: true,
    authorized: true,
    checks,
    note: 'Nothing was saved by this test: no source row, no credential, no vault write. The key was used for these reads and dropped.',
    error: null,
  };
}

export const posthogConnector: SourceConnector<typeof posthogConfigSchema> = {
  slug: 'posthog',
  name: 'PostHog',
  description: 'Daily event counts and unique users per event, plus totals and error counts, as one document per day. Aggregates only — no people, no properties, no content.',
  icon: 'Activity',
  authKind: 'apikey',
  configSchema: posthogConfigSchema,
  inspectNote: 'Reads the project, its event definitions and one day of counts through the Query API. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectPosthog({ config, credentials });
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = posthogConfigSchema.parse(ctx.config);
    const resolved = credentialsFrom(ctx.credentials);
    if (!resolved.ok) {
      throw new Error(`PostHog connector: ${resolved.message}`);
    }
    const client = createPosthogClient(resolved.credentials);
    const events = await resolveEvents(client, cfg);
    const tableEvents = events.filter(name => name !== EXCEPTION_EVENT);
    const queried = [...new Set([...tableEvents, EXCEPTION_EVENT])];

    const { start, end } = syncWindow({ since: ctx.since, now: new Date(), windowDays: cfg.windowDays, historyDays: cfg.historyDays });

    const breakdown: DayRows = new Map();
    const totals = new Map<string, DayCounts>();
    for (const chunk of chunkDays(start, end, MAX_DAYS_PER_QUERY)) {
      const rows = await breakdownFor(client, chunk, queried, cfg.product);
      if (!rows.ok) {
        // Throw rather than report-and-continue: a range we could not read
        // would otherwise become a run of days that all say zero.
        throw new Error(`PostHog connector: event counts for ${chunk.from}..${chunk.to} failed — ${rows.message}`);
      }
      for (const [day, perEvent] of parseBreakdown(rows.data.results)) {
        breakdown.set(day, perEvent);
      }
      const sums = await totalsFor(client, chunk, cfg.product);
      if (!sums.ok) {
        throw new Error(`PostHog connector: day totals for ${chunk.from}..${chunk.to} failed — ${sums.message}`);
      }
      for (const [day, counts] of parseTotals(sums.data.results)) {
        totals.set(day, counts);
      }
    }

    // Issue counts are best-effort: the first refusal marks the API as not
    // exposed for the rest of the run. Reported as a skip, not an error — an
    // error would hold the watermark back over a number we can live without.
    let issuesState: 'read' | 'unavailable' | 'off' = cfg.errorTracking ? 'read' : 'off';

    for (const day of daysBetween(start, end)) {
      const perEvent = breakdown.get(day) ?? new Map<string, DayCounts>();
      let issues: IssueAggregate | null = null;
      if (issuesState === 'read') {
        const res = await issuesOn(client, day);
        if (res.ok) {
          issues = res.data;
        } else {
          issuesState = 'unavailable';
          ctx.onProgress?.({ kind: 'skipped', message: `error tracking API not read: ${res.message}` });
        }
      }
      const doc = documentFor({
        day,
        events: tableEvents.map(event => ({ event, ...(perEvent.get(event) ?? { count: 0, uniques: 0 }) })),
        totals: totals.get(day) ?? { count: 0, uniques: 0 },
        exceptions: perEvent.get(EXCEPTION_EVENT) ?? { count: 0, uniques: 0 },
        issues,
        issuesSkipped: issues ? null : issuesState === 'off' ? 'off' : 'unavailable',
      }, cfg, resolved.credentials);
      ctx.onProgress?.({ kind: 'fetched', uri: doc.externalId });
      yield doc;
    }
  },
};
