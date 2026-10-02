/**
 * The daily cap on what the tracker-intake automation files from a tracker,
 * enforced where the filing happens. A person's "one a day, highest priority
 * first" is a requirement, and a prompt that was asked to count could count
 * wrong, so the filing tool stamps what the intake files and refuses once the
 * day's number is reached.
 *
 * Only a run whose automation declares `role: tracker-intake` is capped or
 * stamped. A request someone files from chat, or that another automation
 * files (a CI failure, a deploy), is never capped and never counted: the cap
 * is about how fast the factory pulls work off the roadmap on its own.
 */
import type { RuntimeContext } from '../types';
import type { FamilySource } from '@/libs/connectors/families';
import { and, eq, gte, sql } from 'drizzle-orm';
import { familySourcesForOrg } from '@/libs/connectors/families';
import { db } from '@/libs/DB';
import { workspaceTimeZone } from '@/libs/time/workspaceTimeZone';
import { dayKey } from '@/libs/time/zone';
import { automationSchema, businessObjectSchema, missionRunSchema } from '@/models/Schema';

/** The role an automation declares when it is the tracker intake pass. */
const TRACKER_INTAKE_ROLE = 'tracker-intake';

/** How far back the count looks: a day in any time zone fits well inside it. */
const COUNT_WINDOW_MS = 48 * 60 * 60 * 1000;

/** What an intake filing is stamped with, and what the count reads back. */
export type IntakeStamp = { source: string; day: string };

/**
 * The slug of the automation that started this run, or undefined for a run
 * no automation started (a chat turn, a person's own mission).
 * @param ctx - The turn.
 */
export async function automationSlugOfRun(ctx: RuntimeContext): Promise<string | undefined> {
  if (!ctx.missionRunId) {
    return undefined;
  }
  const [run] = await db.select({ causedBy: missionRunSchema.causedBy }).from(missionRunSchema).where(and(eq(missionRunSchema.orgId, ctx.orgId), eq(missionRunSchema.id, ctx.missionRunId))).limit(1);
  return (run?.causedBy as Array<{ automationSlug?: string }> | null | undefined)?.[0]?.automationSlug;
}

/**
 * Whether the run's own automation (the one that fired it, not one further up
 * the chain) declares the tracker-intake role.
 * @param ctx - The turn.
 */
async function isTrackerIntakeRun(ctx: RuntimeContext): Promise<boolean> {
  const slug = await automationSlugOfRun(ctx);
  if (!slug) {
    return false;
  }
  const [auto] = await db.select({ doConfig: automationSchema.doConfig }).from(automationSchema).where(and(eq(automationSchema.orgId, ctx.orgId), eq(automationSchema.slug, slug))).limit(1);
  return auto?.doConfig?.role === TRACKER_INTAKE_ROLE;
}

/**
 * The first evidence link of a filing's fields, when it has one.
 * @param fields - The fields as they will be filed.
 */
function firstEvidenceUrl(fields: Record<string, unknown>): string | undefined {
  const urls = (fields.evidence as { urls?: unknown } | undefined)?.urls;
  const first = urls !== undefined && Array.isArray(urls) ? urls[0] : undefined;
  return typeof first === 'string' && first !== '' ? first : undefined;
}

/**
 * The address every issue of a tracker source starts with, or undefined when
 * the source has no site.
 * @param source - A tracker source.
 */
function browsePrefix(source: FamilySource): string | undefined {
  const base = typeof source.config.baseUrl === 'string' ? source.config.baseUrl.replace(/\/$/, '') : '';
  return base === '' ? undefined : `${base}/browse/`;
}

/**
 * Whether a tracker source is the one this issue link belongs to.
 * @param url - The issue's link.
 * @param source - A tracker source.
 */
function ownsIssue(url: string, source: FamilySource): boolean {
  const prefix = browsePrefix(source);
  return prefix !== undefined && url.startsWith(prefix);
}

/**
 * How many filings this source's intake has made on a day, read off the stamp
 * the intake leaves on what it files. A bounded query: this org, the last 48
 * hours, the stamped source and day.
 * @param orgId - The workspace.
 * @param stamp - The source and the workspace-time-zone day.
 * @param now - The moment the window is measured back from.
 */
async function filedOnDay(orgId: string, stamp: IntakeStamp, now: Date): Promise<number> {
  const [row] = await db
    .select({ filed: sql<number>`count(*)::int` })
    .from(businessObjectSchema)
    .where(and(
      eq(businessObjectSchema.orgId, orgId),
      gte(businessObjectSchema.createdAt, new Date(now.getTime() - COUNT_WINDOW_MS)),
      sql`${businessObjectSchema.metadata}->'intake'->>'source' = ${stamp.source}`,
      sql`${businessObjectSchema.metadata}->'intake'->>'day' = ${stamp.day}`,
    ));
  return row?.filed ?? 0;
}

/**
 * What the filing tool must do with this filing: refuse it because the day's
 * cap is reached, or stamp it so tomorrow's count can find it. Neither, when
 * the run is not the tracker intake's or the link is not one of a tracker
 * source's issues.
 * @param ctx - The turn.
 * @param fields - The fields as they will be filed.
 * @param now - The moment to count the day from.
 * @returns A refusal sentence, or the stamp to write on the record, or nothing.
 */
export async function intakeFiling(ctx: RuntimeContext, fields: Record<string, unknown>, now: Date = new Date()): Promise<{ refusal?: string; stamp?: IntakeStamp }> {
  const url = firstEvidenceUrl(fields);
  if (!url || !(await isTrackerIntakeRun(ctx))) {
    return {};
  }
  const source = (await familySourcesForOrg(ctx.orgId, 'tracker')).find(candidate => ownsIssue(url, candidate));
  if (!source) {
    return {};
  }
  const today = dayKey(now, await workspaceTimeZone(ctx.orgId));
  const stamp = { source: source.slug, day: today };
  const cap = source.config.intakePerDay;
  if (typeof cap !== 'number') {
    return { stamp };
  }
  const filed = await filedOnDay(ctx.orgId, stamp, now);
  if (filed >= cap) {
    return { refusal: `The factory already picked up ${filed} of ${cap} tickets from ${source.slug} today (${today}). The rest wait for tomorrow.` };
  }
  return { stamp };
}
