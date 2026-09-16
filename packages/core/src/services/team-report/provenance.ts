/**
 * Provenance — reading a measure from where its source says the truth lives
 * (docs/specs/team-report-v2.md §2). Four kinds, strongest first:
 *
 *   verified         a system of record through a connector. Two today:
 *                    HubSpot, read from the synced mirror
 *                    (`CrmRecordsService`), so the reading carries the
 *                    mirror's own freshness and says "verified (synced 2h
 *                    ago)" rather than pretending to be live; and web
 *                    analytics, read live from the GA4 Data API as a service
 *                    account the workspace supplies;
 *   observed         Vocion saw it happen in our own tables — `action_run`
 *                    rows that reached `done` for the named action ids,
 *                    completed `worker_run`s carrying the named `counts` key,
 *                    or rows of a kind Vocion keeps itself;
 *   human-confirmed  a person approved it — approve / edit decisions on the
 *                    named action ids (`decision_alignment`), or asks of the
 *                    named kinds decided with anything but a reject;
 *   agent-reported   the worker said so — Σ `worker_run.counts.<key>`.
 *
 * "Agents do the work. Systems of record measure the outcome whenever
 * possible." Every reading is returned with its kind, so a surface can never
 * show a number without saying where it came from.
 *
 * **Nothing in this file ever answers 0 for a question it did not ask.** A
 * source with no credential, a read that failed, a query the system cannot
 * answer — each comes back as `value: null` with an
 * {@link MeasureUnavailableKind} the report renders as a state. The only
 * zeroes are counted ones.
 */

import type { Freshness, MeasureReading, MeasureUnavailableKind, Range, TeamMeasure, TeamMeasureSource } from './measures';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { resolveWebAnalyticsCredentials } from '@/libs/analytics/credentials';
import { GA4_WINDOW_NOTE, runWebAnalyticsReport, WEB_ANALYTICS_SOURCE_LABEL } from '@/libs/analytics/ga4';
import { db } from '@/libs/DB';
import { accountMembershipSchema, actionRunSchema, askSchema, decisionAlignmentSchema, projectSchema, workerRunSchema } from '@/models/Schema';
import { queryCrmRecords } from '@/services/CrmRecordsService';
import { deriveReading } from './derive';
import { actionAgentSlug } from './humanLoad';
import { measureRange, priorRange } from './measures';

/** A raw reading before derivation. */
export type RawReading = {
  value: number | null;
  asOf: Date | null;
  freshness: Freshness;
  sourceLabel: string;
  unavailableReason: string | null;
  unavailableKind: MeasureUnavailableKind | null;
};

/** Which team a measure is read for — its agents, and its slug for asks filed against the team itself. */
export type MeasureScope = { teamSlug: string; agentSlugs: string[] };

const live = (now: Date): Freshness => ({ asOf: now, ageMs: 0, stale: false, note: null });

/**
 * The no-value answer. The ONLY way this module declines to produce a number,
 * so there is one place to be sure a decline never becomes a zero.
 * @param kind - Which no-value state this is.
 * @param reason - What to tell a person.
 * @param sourceLabel - The system that was asked, or would have been.
 */
function unavailable(kind: MeasureUnavailableKind, reason: string, sourceLabel: string): RawReading {
  return { value: null, asOf: null, freshness: { asOf: null, ageMs: null, stale: true, note: reason }, sourceLabel, unavailableReason: reason, unavailableKind: kind };
}

/**
 * Σ `worker_run.counts.<key>` over the scope's agents, runs created in range.
 * @param orgId
 * @param scope
 * @param key - The counts key.
 * @param range
 */
async function sumCounts(orgId: string, scope: MeasureScope, key: string, range: Range): Promise<number> {
  if (scope.agentSlugs.length === 0) {
    return 0;
  }
  const [row] = await db.select({
    total: sql<number>`coalesce(sum((${workerRunSchema.counts} ->> ${key})::numeric), 0)::float`,
  })
    .from(workerRunSchema)
    .where(and(
      eq(workerRunSchema.orgId, orgId),
      inArray(workerRunSchema.agentSlug, scope.agentSlugs),
      gte(workerRunSchema.createdAt, range.since),
      lt(workerRunSchema.createdAt, range.until),
      sql`${workerRunSchema.counts} ? ${key}`,
    ));
  return Number(row?.total ?? 0);
}

/**
 * Executed actions (`status = done`) of the named ids by the scope's agents,
 * executed in range. Auto-executed and approved alike — the point of
 * `observed` is that the thing happened.
 * @param orgId
 * @param scope
 * @param actions
 * @param range
 */
async function countExecutedActions(orgId: string, scope: MeasureScope, actions: string[], range: Range): Promise<number> {
  if (scope.agentSlugs.length === 0) {
    return 0;
  }
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.status, 'done'),
      inArray(actionRunSchema.actionId, actions),
      sql`${actionAgentSlug} in (${sql.join(scope.agentSlugs.map(s => sql`${s}`), sql`, `)})`,
      gte(actionRunSchema.executedAt, range.since),
      lt(actionRunSchema.executedAt, range.until),
    ));
  return Number(row?.n ?? 0);
}

/**
 * Completed worker runs carrying the counts key, completed in range.
 * @param orgId
 * @param scope
 * @param key
 * @param range
 */
async function countCompletedRunsWith(orgId: string, scope: MeasureScope, key: string, range: Range): Promise<number> {
  if (scope.agentSlugs.length === 0) {
    return 0;
  }
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(workerRunSchema)
    .where(and(
      eq(workerRunSchema.orgId, orgId),
      eq(workerRunSchema.status, 'completed'),
      inArray(workerRunSchema.agentSlug, scope.agentSlugs),
      gte(workerRunSchema.completedAt, range.since),
      lt(workerRunSchema.completedAt, range.until),
      sql`${workerRunSchema.counts} ? ${key}`,
    ));
  return Number(row?.n ?? 0);
}

/**
 * Approve / edit decisions on the named action ids, by the scope's agents,
 * decided in range — the alignment ledger is the record of what a person
 * said yes to.
 * @param orgId
 * @param scope
 * @param actions
 * @param range
 */
async function countApprovedActions(orgId: string, scope: MeasureScope, actions: string[], range: Range): Promise<number> {
  if (scope.agentSlugs.length === 0) {
    return 0;
  }
  const [row] = await db.select({ n: sql<number>`count(distinct ${decisionAlignmentSchema.subjectId})::int` })
    .from(decisionAlignmentSchema)
    .where(and(
      eq(decisionAlignmentSchema.orgId, orgId),
      eq(decisionAlignmentSchema.subjectKind, 'action'),
      inArray(decisionAlignmentSchema.subjectKey, actions),
      inArray(decisionAlignmentSchema.agentSlug, scope.agentSlugs),
      inArray(decisionAlignmentSchema.decision, ['approved', 'edited']),
      gte(decisionAlignmentSchema.decidedAt, range.since),
      lt(decisionAlignmentSchema.decidedAt, range.until),
    ));
  return Number(row?.n ?? 0);
}

/**
 * Asks of the named kinds, filed by the team or its agents, decided in range
 * with anything but a reject.
 * @param orgId
 * @param scope
 * @param kinds
 * @param range
 */
async function countDecidedAsks(orgId: string, scope: MeasureScope, kinds: string[], range: Range): Promise<number> {
  const who = scope.agentSlugs.length > 0
    ? sql`(${askSchema.teamSlug} = ${scope.teamSlug} or ${askSchema.agentSlug} in (${sql.join(scope.agentSlugs.map(s => sql`${s}`), sql`, `)}))`
    : eq(askSchema.teamSlug, scope.teamSlug);
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(askSchema)
    .where(and(
      eq(askSchema.orgId, orgId),
      inArray(askSchema.kind, kinds),
      inArray(askSchema.status, ['approved', 'done']),
      who,
      gte(askSchema.decidedAt, range.since),
      lt(askSchema.decidedAt, range.until),
    ));
  return Number(row?.n ?? 0);
}

/**
 * A verified reading from the HubSpot mirror. Count or sum(amount) of the
 * matching records CREATED in range, with the mirror's freshness attached.
 * @param orgId - Tenant.
 * @param source - The declared HubSpot source.
 * @param range - The window.
 * @param now - The clock.
 */
async function readVerifiedHubspot(orgId: string, source: Extract<TeamMeasureSource, { kind: 'verified'; connector: 'hubspot' }>, range: Range, now: Date): Promise<RawReading> {
  const label = 'HubSpot';
  const q = source.query;
  const result = await queryCrmRecords(orgId, q.object, {
    ...q.filter,
    createdAfter: range.since.toISOString(),
    createdBefore: range.until.toISOString(),
    limit: 1,
  });
  if (result.sources.length === 0) {
    return unavailable('unconfigured', 'No HubSpot source is connected to this workspace, so nothing can be verified against it.', label);
  }
  const unknown = Object.entries(result.unknownFilterValues);
  if (unknown.length > 0) {
    const [key, u] = unknown[0]!;
    return unavailable('unsupported', `The filter names ${key} value${u.notFound.length === 1 ? '' : 's'} the CRM does not have (${u.notFound.join(', ')}); the count would exclude what was asked for.`, label);
  }
  const value = q.aggregate === 'count'
    ? result.total
    : result.totalAmount ?? (result.total === 0 ? 0 : null);
  const f = result.freshness;
  const freshness: Freshness = { asOf: f.asOf, ageMs: f.ageMs, stale: f.stale, note: f.reason };
  if (value === null) {
    return { value: null, asOf: result.asOf, freshness, sourceLabel: label, unavailableReason: 'The mirror does not carry deal amounts, so they cannot be summed.', unavailableKind: 'unsupported' };
  }
  return { value, asOf: result.asOf ?? now, freshness, sourceLabel: label, unavailableReason: null, unavailableKind: null };
}

/**
 * A verified reading from web analytics — GA4, read live through the Data API
 * as the service account the workspace stored.
 *
 * Three outcomes and no fourth. A workspace with no analytics credential gets
 * `unconfigured`: the report says "not connected — showing nothing", because
 * nobody asked Google anything and a 0 here would be a claim that the site had
 * no traffic. A read that fails gets `error`. A read that succeeds gets
 * whatever GA4 counted, INCLUDING zero — a zero GA4 actually produced is a
 * measurement and is shown as one.
 * @param orgId - The workspace the measure belongs to.
 * @param source - The declared web-analytics source.
 * @param range - The measure's window.
 * @param now - The clock.
 */
async function readVerifiedWebAnalytics(orgId: string, source: Extract<TeamMeasureSource, { kind: 'verified'; connector: 'web-analytics' }>, range: Range, now: Date): Promise<RawReading> {
  const label = WEB_ANALYTICS_SOURCE_LABEL;
  const credentials = await resolveWebAnalyticsCredentials(orgId);
  if (!credentials) {
    return unavailable(
      'unconfigured',
      'No web analytics property is connected to this workspace. Add a Google Analytics credential at /dashboard/developers to measure this.',
      label,
    );
  }
  const value = await runWebAnalyticsReport(credentials, source.query, range, now);
  return {
    value,
    asOf: now,
    // `asOf: null` on purpose: this is not a mirror with a sync time, so the
    // chip says "Verified · Google Analytics" without claiming a sync age it
    // does not have. The note carries the day-boundary caveat instead.
    freshness: { asOf: null, ageMs: null, stale: false, note: GA4_WINDOW_NOTE },
    sourceLabel: label,
    unavailableReason: null,
    unavailableKind: null,
  };
}

/**
 * People who joined this workspace's account in the window —
 * `account_membership` rows for the account that owns the project.
 *
 * Scoped through `project.account_id` rather than counting `user` rows, which
 * carry no workspace of their own: a person exists once across the deployment
 * and joins accounts, so the join is the event a workspace can honestly call
 * its own.
 * @param orgId - The project the measure is read for.
 * @param range - The measure's window.
 */
async function countWorkspaceMembers(orgId: string, range: Range): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(accountMembershipSchema)
    .innerJoin(projectSchema, eq(projectSchema.accountId, accountMembershipSchema.accountId))
    .where(and(
      eq(projectSchema.id, orgId),
      gte(accountMembershipSchema.createdAt, range.since),
      lt(accountMembershipSchema.createdAt, range.until),
    ));
  return Number(row?.n ?? 0);
}

/**
 * Dispatch a `verified` source to the connector it names.
 * @param orgId - Tenant.
 * @param source - The declared verified source.
 * @param range - The window.
 * @param now - The clock.
 */
async function readVerified(orgId: string, source: Extract<TeamMeasureSource, { kind: 'verified' }>, range: Range, now: Date): Promise<RawReading> {
  switch (source.connector) {
    case 'hubspot':
      return readVerifiedHubspot(orgId, source, range, now);
    case 'web-analytics':
      return readVerifiedWebAnalytics(orgId, source, range, now);
  }
}

/**
 * Read one measure over one range. Never throws for a misconfigured source —
 * the reading comes back with `value: null` and a reason a person can read.
 * @param orgId - Tenant.
 * @param measure - The declared measure.
 * @param scope - The team it is read for.
 * @param range - The window.
 * @param now - The clock.
 */
export async function readRaw(orgId: string, measure: TeamMeasure, scope: MeasureScope, range: Range, now: Date): Promise<RawReading> {
  const s = measure.source;
  try {
    switch (s.kind) {
      // This switch and `readVerified`'s are exhaustive over
      // `TeamMeasureSource`, and tsc proves it: a new kind or a new connector
      // with no arm is a compile error, not a measure that silently reads 0.
      case 'verified':
        return await readVerified(orgId, s, range, now);
      case 'observed':
        if (s.actions && s.actions.length > 0) {
          return { value: await countExecutedActions(orgId, scope, s.actions, range), asOf: now, freshness: live(now), sourceLabel: 'executed actions', unavailableReason: null, unavailableKind: null };
        }
        if (s.counts) {
          return { value: await countCompletedRunsWith(orgId, scope, s.counts, range), asOf: now, freshness: live(now), sourceLabel: 'completed runs', unavailableReason: null, unavailableKind: null };
        }
        if (s.rows === 'workspace-members') {
          return { value: await countWorkspaceMembers(orgId, range), asOf: now, freshness: live(now), sourceLabel: 'workspace members', unavailableReason: null, unavailableKind: null };
        }
        return unavailable('unsupported', 'The observed source names neither actions, a counts key nor rows.', 'Vocion');
      case 'human-confirmed': {
        let value = 0;
        let any = false;
        if (s.actions && s.actions.length > 0) {
          value += await countApprovedActions(orgId, scope, s.actions, range);
          any = true;
        }
        if (s.askKinds && s.askKinds.length > 0) {
          value += await countDecidedAsks(orgId, scope, s.askKinds, range);
          any = true;
        }
        return any
          ? { value, asOf: now, freshness: live(now), sourceLabel: 'review decisions', unavailableReason: null, unavailableKind: null }
          : unavailable('unsupported', 'The human-confirmed source names neither actions nor ask kinds.', 'Vocion');
      }
      case 'agent-reported':
        return { value: await sumCounts(orgId, scope, s.counts, range), asOf: now, freshness: live(now), sourceLabel: 'worker reports', unavailableReason: null, unavailableKind: null };
    }
  } catch (err) {
    // The read was attempted and did not come back. `error`, never zero: a
    // connector that is down has not told us the number is 0, and a team
    // report is read as if every figure on it were measured.
    return unavailable('error', `Could not read this measure: ${err instanceof Error ? err.message : String(err)}`, 'Vocion');
  }
}

/**
 * Read a measure in its own window and the window before, derived.
 * @param orgId - Tenant.
 * @param measure - The declared measure.
 * @param scope - The team it is read for.
 * @param now - The clock.
 */
export async function readMeasure(orgId: string, measure: TeamMeasure, scope: MeasureScope, now: Date = new Date()): Promise<MeasureReading> {
  const [current, prior] = await Promise.all([
    readRaw(orgId, measure, scope, measureRange(measure.window, now), now),
    readRaw(orgId, measure, scope, priorRange(measure.window, now), now),
  ]);
  return deriveReading({
    measure,
    value: current.value,
    previous: prior.value,
    provenance: measure.source.kind,
    sourceLabel: current.sourceLabel,
    asOf: current.asOf,
    freshness: current.freshness,
    unavailableReason: current.unavailableReason,
    unavailableKind: current.unavailableKind,
  });
}

/**
 * Every team's measures, read in parallel. Keyed `${teamSlug}/${key}`.
 * @param orgId - Tenant.
 * @param teams - Each team with its agents and declared measures.
 * @param now - The clock.
 */
export async function readTeamMeasures(orgId: string, teams: Array<MeasureScope & { measures: TeamMeasure[] }>, now: Date = new Date()): Promise<Map<string, MeasureReading>> {
  const entries = await Promise.all(teams.flatMap(t => t.measures.map(async m => [`${t.teamSlug}/${m.key}`, await readMeasure(orgId, m, t, now)] as const)));
  return new Map(entries);
}
