/**
 * What a mission-check fire actually did, computed from the tables.
 *
 * A `checkMission` automation used to leave `automation_run.result` null: the
 * dispatch returned `{kind, runId}` and dropped the run summary on the floor,
 * so a card had one timestamp to render and a test run had three integers to
 * show. The counts existed only inside the agent's prose report.
 *
 * Nothing here parses that prose. The queue counts are a before/after snapshot
 * of `lead_brief`, and the window and the contacts found are read off the tool
 * calls the fire made — the same structural rule the personalization tools
 * follow, where the agent supplies WHICH leads and never what is recorded
 * about them.
 */

import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { leadBriefSchema, toolCallSchema } from '@/models/Schema';

/** The four numbers a card or a test run answers "did it identify anyone" with. */
export type AutomationCheckCounts = {
  /**
   * `total` from the in-window `hubspot_count_contacts` call at the stage
   * filter — how many contacts were in scope at all. Null when the fire made
   * no such call (nothing to count, or it failed before part one).
   */
  contactsInWindow: number | null;
  /** `lead_brief` rows the fire added. */
  queued: number;
  /** Rows that gained a written brief during the fire. */
  briefed: number;
  /** Rows that gained a drafted sequence during the fire. */
  drafted: number;
  /** Rows on the queue when the fire finished, across every lane. */
  queueTotal: number;
};

/** The typed result a mission-check dispatch records on its `automation_run` row. */
export type AutomationCheckResult = {
  kind: 'mission_check';
  missionRunId: number;
  /** The mission run's OWN status, not "the dispatch returned". */
  missionRunStatus: string;
  /** Per-task outcome, so a run that completed with a failed task is not read as clean. */
  tasks: { ok: number; failed: number; total: number };
  durationMs: number;
  /**
   * The window the fire's tools applied. `since` is the bound the server
   * resolved (`created_after_applied` / `window.since`), never a date the model
   * worked out; `until` is the fire itself, which is when that bound resolved.
   */
  window: { since: string | null; until: string } | null;
  counts: AutomationCheckCounts;
  /**
   * The connector mirror this fire actually read, and how fresh it was at the
   * time. `sources` is what makes the card able to name the mirror's freshness
   * NOW: it is evidence of what the work reads, not a guess from the agent's
   * source list.
   */
  mirror: { asOf: string | null; stale: boolean; note: string | null; sources: string[] } | null;
};

/** The four `lead_brief` numbers a fire is measured against. */
export type QueueSnapshot = {
  total: number;
  withBrief: number;
  withDraft: number;
};

const HAS_BRIEF = sql`jsonb_array_length(${leadBriefSchema.sections}) > 0`;
const HAS_DRAFT = sql`jsonb_array_length(${leadBriefSchema.draftSequence}) > 0`;

/**
 * Count the queue as it stands. Taken either side of a fire, the difference is
 * what the fire did — no cooperation from the agent required.
 * @param orgId - Tenant.
 */
export async function queueSnapshot(orgId: string): Promise<QueueSnapshot> {
  const [row] = await db
    .select({
      total: count(),
      withBrief: sql<number>`count(*) filter (where ${HAS_BRIEF})::int`,
      withDraft: sql<number>`count(*) filter (where ${HAS_DRAFT})::int`,
    })
    .from(leadBriefSchema)
    .where(eq(leadBriefSchema.orgId, orgId));
  return {
    total: Number(row?.total ?? 0),
    withBrief: Number(row?.withBrief ?? 0),
    withDraft: Number(row?.withDraft ?? 0),
  };
}

/** Scalar fields lifted out of a tool payload that may have been truncated at storage. */
type CountPayload = {
  total: number | null;
  createdAfterApplied: string | null;
  asOf: string | null;
  mirrorStale: boolean;
  mirrorStaleness: string | null;
  sourcesRead: string[];
};

/**
 * Read the leading scalars out of a `hubspot_count_*` payload.
 *
 * `tool_call.output` is capped at 10k characters and the payload ends with the
 * record page, so a full `JSON.parse` fails on exactly the calls worth reading.
 * The counts lead the payload, so they survive the cap — lift them by pattern
 * when the parse cannot run.
 * @param output - The stored tool output, possibly truncated mid-JSON.
 */
export function readCountPayload(output: string | null): CountPayload {
  const empty: CountPayload = { total: null, createdAfterApplied: null, asOf: null, mirrorStale: false, mirrorStaleness: null, sourcesRead: [] };
  if (!output) {
    return empty;
  }
  const num = (key: string): number | null => {
    const m = new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`).exec(output);
    return m ? Number(m[1]) : null;
  };
  const str = (key: string): string | null => {
    const m = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(output);
    return m ? m[1]! : null;
  };
  return {
    total: num('total'),
    // `window.since` is reconcile_mql_window's spelling of the same bound.
    createdAfterApplied: str('created_after_applied') ?? str('since'),
    asOf: str('as_of') ?? str('asOf'),
    mirrorStale: /"mirror_stale"\s*:\s*true/.test(output),
    mirrorStaleness: str('mirror_staleness') ?? str('mirrorStaleness'),
    sourcesRead: readSlugArray(output, 'sources_read') ?? readSlugArray(output, 'sourcesRead') ?? [],
  };
}

/**
 * A `["a","b"]` array field, lifted by pattern for the same truncation reason.
 * @param output - The stored tool output.
 * @param key - The field name.
 */
function readSlugArray(output: string, key: string): string[] | null {
  const m = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`).exec(output);
  if (!m) {
    return null;
  }
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map(x => x[1]!);
}

/** Tools whose payload carries the window and the in-scope contact count. */
const WINDOW_TOOLS = ['hubspot_count_contacts', 'reconcile_mql_window'];

/**
 * The window and contact count the fire's own tool calls applied.
 *
 * Prefers a stage-filtered call: `hubspot_count_contacts` is called once
 * without a lifecycle filter to discover the exact stage strings, and that
 * call's `total` is every contact in the CRM rather than the MQLs in scope.
 * @param orgId - Tenant.
 * @param missionRunId - The mission run the fire started.
 */
async function windowFromToolCalls(orgId: string, missionRunId: number) {
  const rows = await db
    .select({ tool: toolCallSchema.tool, input: toolCallSchema.input, output: toolCallSchema.output })
    .from(toolCallSchema)
    .where(and(
      eq(toolCallSchema.orgId, orgId),
      eq(toolCallSchema.missionRunId, missionRunId),
      inArray(toolCallSchema.tool, WINDOW_TOOLS),
    ))
    .orderBy(desc(toolCallSchema.id));

  const filtered = rows.filter((r) => {
    const stages = (r.input as { lifecycle_stages?: unknown } | null)?.lifecycle_stages;
    return Array.isArray(stages) && stages.length > 0;
  });
  for (const row of filtered.length > 0 ? filtered : rows) {
    const payload = readCountPayload(row.output);
    if (payload.total !== null || payload.createdAfterApplied !== null) {
      return payload;
    }
  }
  return null;
}

/**
 * Build the typed result for one mission-check fire.
 * @param opts - The fire, the run it started, and the queue either side of it.
 * @param opts.orgId
 * @param opts.run - The mission run row (status + plan tasks).
 * @param opts.run.id
 * @param opts.run.status
 * @param opts.run.plan
 * @param opts.before - Queue snapshot taken before dispatch.
 * @param opts.startedAt - When the fire began.
 * @param opts.now - Completion time (injectable for tests).
 */
export async function summarizeMissionCheck(opts: {
  orgId: string;
  run: { id: number; status: string; plan?: { tasks?: Array<{ status?: string }> } | null };
  before: QueueSnapshot;
  startedAt: Date;
  now?: Date;
}): Promise<AutomationCheckResult> {
  const after = await queueSnapshot(opts.orgId);
  const tasks = opts.run.plan?.tasks ?? [];
  const payload = await windowFromToolCalls(opts.orgId, opts.run.id);
  const finishedAt = opts.now ?? new Date();

  return {
    kind: 'mission_check',
    missionRunId: opts.run.id,
    missionRunStatus: opts.run.status,
    tasks: {
      ok: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      total: tasks.length,
    },
    durationMs: finishedAt.getTime() - opts.startedAt.getTime(),
    window: payload?.createdAfterApplied
      ? { since: payload.createdAfterApplied, until: finishedAt.toISOString() }
      : null,
    counts: {
      contactsInWindow: payload?.total ?? null,
      // Deltas, not the agent's report. A re-fire that queues nothing and
      // re-briefs nobody reads as zeros, which is the correct outcome.
      queued: Math.max(after.total - opts.before.total, 0),
      briefed: Math.max(after.withBrief - opts.before.withBrief, 0),
      drafted: Math.max(after.withDraft - opts.before.withDraft, 0),
      queueTotal: after.total,
    },
    mirror: payload
      ? { asOf: payload.asOf, stale: payload.mirrorStale, note: payload.mirrorStaleness, sources: payload.sourcesRead }
      : null,
  };
}
