/**
 * The daily cap on what an intake automation files from a tracker, enforced
 * where the filing happens. A person's "one a day, highest priority first" is
 * a requirement, and a prompt that was asked to count could count wrong, so
 * the filing tool refuses once the day's number is reached.
 *
 * Only an automation's run is capped. A request someone files from chat, or
 * points the factory at by hand, never is: the cap is about how fast the
 * factory pulls work off the roadmap on its own.
 */
import type { RuntimeContext } from '../types';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { familySourcesForOrg } from '@/libs/connectors/families';
import { db } from '@/libs/DB';
import { workspaceTimeZone } from '@/libs/time/workspaceTimeZone';
import { dayKey, dayPlus, startOfDay } from '@/libs/time/zone';
import { businessObjectSchema, missionRunSchema } from '@/models/Schema';

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
 * The first evidence link of a filing's fields, when it has one.
 * @param fields - The fields as they will be filed.
 */
function firstEvidenceUrl(fields: Record<string, unknown>): string | undefined {
  const urls = (fields.evidence as { urls?: unknown } | undefined)?.urls;
  const first = Array.isArray(urls) ? urls[0] : undefined;
  return typeof first === 'string' && first !== '' ? first : undefined;
}

/**
 * The refusal when this filing would pass the day's cap, or undefined to file.
 * It applies when the run is an automation's, the first evidence link is an
 * issue on a tracker source that has `intakePerDay`, and that source already
 * has that many filings today (counted by the tracker link first in
 * `evidence.urls`, today being the workspace's time-zone date).
 * @param ctx - The turn.
 * @param fields - The fields as they will be filed.
 * @param now - The moment to count the day from.
 */
export async function intakeCapRefusal(ctx: RuntimeContext, fields: Record<string, unknown>, now: Date = new Date()): Promise<string | undefined> {
  const url = firstEvidenceUrl(fields);
  if (!url || !(await automationSlugOfRun(ctx))) {
    return undefined;
  }
  const sources = await familySourcesForOrg(ctx.orgId, 'tracker');
  const source = sources.find((s) => {
    const base = typeof s.config.baseUrl === 'string' ? s.config.baseUrl.replace(/\/$/, '') : '';
    return typeof s.config.intakePerDay === 'number' && base !== '' && url.startsWith(`${base}/browse/`);
  });
  if (!source) {
    return undefined;
  }
  const cap = source.config.intakePerDay as number;
  const browse = `${String(source.config.baseUrl).replace(/\/$/, '')}/browse/`;
  const zone = await workspaceTimeZone(ctx.orgId);
  const today = dayKey(now, zone);
  const [row] = await db
    .select({ filed: sql<number>`count(*)::int` })
    .from(businessObjectSchema)
    .where(and(
      eq(businessObjectSchema.orgId, ctx.orgId),
      gte(businessObjectSchema.createdAt, startOfDay(today, zone)),
      lt(businessObjectSchema.createdAt, startOfDay(dayPlus(today, 1), zone)),
      sql`starts_with(${businessObjectSchema.metadata}->'evidence'->'urls'->>0, ${browse})`,
    ));
  const filed = row?.filed ?? 0;
  if (filed < cap) {
    return undefined;
  }
  return `The factory already picked up ${filed} of ${cap} tickets from ${source.slug} today (${today}). The rest wait for tomorrow.`;
}
