import type { CheckOutcome, CheckResult } from '@/libs/automations/checkResult';
import type { PageBlock } from '@/libs/workspace/pageFields';
import { and, count, desc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { checkLine, readCheckResult } from '@/libs/automations/checkResult';
import { db } from '@/libs/DB';
import { pausedSince } from '@/libs/factory/delivery';
import { listPluginSlugs, loadPlugin, pluginContents } from '@/libs/workspace/plugins';
import { automationRunSchema, automationSchema } from '@/models/Schema';
import { CONTROL_RUN_KIND, pausesFor, SKIPPED_RUN_KIND } from '@/services/AutomationService';

/**
 * WHAT IS WATCHED, AND WHAT EACH CHECK SAW — the reads behind a page's
 * `monitors` and `checkLog` blocks (`libs/workspace/pageFields.ts`).
 *
 * A monitor is a scheduled automation; what it checked and saw is the typed
 * `check` its run wrote (`libs/automations/checkResult.ts`). Both are read
 * from rows core already owns — `automation` and `automation_run` — so
 * nothing here names a monitor, a job or a target.
 */

/** A run that read: not a skipped fire, not a person's pause. */
const READ_KINDS_EXCLUDED = [SKIPPED_RUN_KIND, CONTROL_RUN_KIND];

export type MonitorRow = {
  slug: string;
  name: string;
  /** "Every 10 minutes (UTC)", or null when it is not on a schedule. */
  every: string | null;
  state: 'active' | 'paused' | 'off';
  pause: { byName: string; when: string; note: string | null } | null;
  /** What its last check checked, by label. Empty before it has checked. */
  targets: string[];
  /** What it reads ("Sentry issues"), from its last check. */
  kind: string | null;
  lastCheck: { at: Date; outcome: CheckOutcome | null; line: string; failed: boolean } | null;
  /** Its checks, and those that opened an incident, over the last day. */
  day: { checks: number; opened: number };
};

export type CheckLogRow = {
  id: number;
  slug: string;
  monitor: string;
  at: Date;
  finishedAt: Date | null;
  /** `ok`, `error`, or `running` while it reads. */
  status: string;
  check: CheckResult | null;
  outcome: CheckOutcome | null;
  line: string;
  error: string | null;
};

/**
 * Which automations a block is about: those it names, or the page's plugin's
 * scheduled ones.
 * @param orgId - The workspace.
 * @param block - The block.
 * @param plugin - The plugin that shipped the page, when one did.
 */
export async function monitorSlugs(orgId: string, block: Pick<PageBlock, 'automations'>, plugin: string | null): Promise<string[]> {
  if (block.automations?.length) {
    return block.automations;
  }
  if (!plugin || !listPluginSlugs().includes(plugin)) {
    return [];
  }
  const slugs = pluginContents(loadPlugin(plugin)).automations;
  if (slugs.length === 0) {
    return [];
  }
  const rows = await db.select({ slug: automationSchema.slug, when: automationSchema.whenConfig })
    .from(automationSchema)
    .where(and(eq(automationSchema.orgId, orgId), inArray(automationSchema.slug, slugs)));
  return slugs.filter(s => rows.some(r => r.slug === s && typeof (r.when as { schedule?: unknown } | null)?.schedule === 'string'));
}

/**
 * A run as the log reads it. Pure.
 * @param run - The `automation_run` row: its id, slug, status, result, error and times.
 * @param run.id
 * @param run.slug
 * @param run.status
 * @param run.result
 * @param run.error
 * @param run.startedAt
 * @param run.finishedAt
 * @param monitor - The automation's name.
 */
export function checkLogRow(run: { id: number; slug: string; status: string; result: unknown; error: string | null; startedAt: Date; finishedAt: Date | null }, monitor: string): CheckLogRow {
  const check = run.status === 'error' ? null : readCheckResult(run.result);
  const line = run.status === 'error'
    ? `Failed: ${(run.error ?? 'it failed without a message').slice(0, 200)}`
    : run.status === 'running'
      ? 'Checking…'
      : check
        ? checkLine(check)
        : 'Ran; this run did not record what it saw';
  return {
    id: run.id,
    slug: run.slug,
    monitor,
    at: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    check,
    outcome: run.status === 'error' ? 'unchecked' : check?.outcome ?? null,
    line,
    error: run.error,
  };
}

/**
 * The monitors a block lists, in the order it names them; one this workspace
 * does not have is left out.
 * @param orgId - The workspace.
 * @param slugs - The automations.
 * @param now - The clock.
 */
export async function loadMonitors(orgId: string, slugs: string[], now: Date = new Date()): Promise<MonitorRow[]> {
  if (slugs.length === 0) {
    return [];
  }
  const rows = await db.select().from(automationSchema).where(and(eq(automationSchema.orgId, orgId), inArray(automationSchema.slug, slugs)));
  if (rows.length === 0) {
    return [];
  }
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const reads = and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.dryRun, false), notInArray(automationRunSchema.kind, READ_KINDS_EXCLUDED));
  const [latest, day, pauses] = await Promise.all([
    Promise.all(rows.map(async r => [r.slug, (await db.select().from(automationRunSchema).where(and(reads, eq(automationRunSchema.slug, r.slug))).orderBy(desc(automationRunSchema.startedAt)).limit(1))[0] ?? null] as const)),
    db.select({
      slug: automationRunSchema.slug,
      checks: count(),
      opened: sql<number>`count(*) filter (where ${automationRunSchema.result}->'check'->>'outcome' = 'opened')`,
    })
      .from(automationRunSchema)
      .where(and(reads, inArray(automationRunSchema.slug, rows.map(r => r.slug)), gte(automationRunSchema.startedAt, since)))
      .groupBy(automationRunSchema.slug),
    pausesFor(rows, orgId),
  ]);
  const last = new Map(latest);
  return slugs.flatMap((slug): MonitorRow[] => {
    const r = rows.find(x => x.slug === slug);
    if (!r) {
      return [];
    }
    const run = last.get(slug) ?? null;
    const logged = run ? checkLogRow(run, r.name) : null;
    const schedule = (r.whenConfig as { schedule?: unknown } | null)?.schedule;
    const pause = pauses.get(slug);
    const counts = day.find(d => d.slug === slug);
    return [{
      slug,
      name: r.name,
      every: typeof schedule === 'string' ? cronToText(schedule) : null,
      state: r.pausedAt ? 'paused' : r.status === 'disabled' ? 'off' : 'active',
      pause: r.pausedAt ? { byName: pause?.by.name ?? r.pausedBy ?? 'someone', when: pausedSince(r.pausedAt.toISOString()), note: r.pausedNote } : null,
      targets: logged?.check?.targets.map(t => t.label) ?? [],
      kind: logged?.check?.kind ?? null,
      lastCheck: logged ? { at: logged.at, outcome: logged.outcome, line: logged.line, failed: logged.status === 'error' } : null,
      day: { checks: Number(counts?.checks ?? 0), opened: Number(counts?.opened ?? 0) },
    }];
  });
}

/**
 * The recent runs of these automations, newest first.
 * @param orgId - The workspace.
 * @param slugs - The automations.
 * @param limit - How many.
 */
export async function loadCheckLog(orgId: string, slugs: string[], limit: number): Promise<CheckLogRow[]> {
  if (slugs.length === 0) {
    return [];
  }
  const [names, runs] = await Promise.all([
    db.select({ slug: automationSchema.slug, name: automationSchema.name }).from(automationSchema).where(and(eq(automationSchema.orgId, orgId), inArray(automationSchema.slug, slugs))),
    db.select({
      id: automationRunSchema.id,
      slug: automationRunSchema.slug,
      status: automationRunSchema.status,
      result: automationRunSchema.result,
      error: automationRunSchema.error,
      startedAt: automationRunSchema.startedAt,
      finishedAt: automationRunSchema.finishedAt,
    })
      .from(automationRunSchema)
      .where(and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.dryRun, false), notInArray(automationRunSchema.kind, READ_KINDS_EXCLUDED), inArray(automationRunSchema.slug, slugs)))
      .orderBy(desc(automationRunSchema.startedAt))
      .limit(limit),
  ]);
  const name = new Map(names.map(n => [n.slug, n.name]));
  return runs.map(r => checkLogRow(r, name.get(r.slug) ?? r.slug));
}
