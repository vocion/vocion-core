/**
 * Who gets a brief, and whether the Org can afford it
 * (docs/guides/morning-brief.md § Limits).
 *
 * Daily briefs are on by default for every person on every install, so they
 * spend model money nobody asked for unless something limits them:
 *
 *   - **The Org's switch.** `tenant_account.daily_briefs`; off, nobody in the
 *     Org gets one.
 *   - **Only people who are here.** Someone who has not signed in or used the
 *     app in seven days gets none (`account_membership.last_active_at` /
 *     `last_login_at`, stamped by the adoption heartbeat).
 *   - **The budget.** A brief charges through the ordinary spend path
 *     (`chargeModelCall` → `chargeUsage`), so it counts against the person's
 *     Personal workspace's budget rows, and a hard cap there refuses it
 *     (`preflightCheck`). Across the Org, what every brief spent today is
 *     summed and held to the Org's daily brief cap (`brief_daily_cents`, else
 *     `VOCION_BRIEF_DAILY_CENTS`). Over it, deliveries stop for the day and
 *     the Org's admins get one quiet notice.
 */

import process from 'node:process';
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, agentBudgetSchema, projectSchema, tenantAccountSchema } from '@/models/Schema';

/** How recently a person must have been here to get a brief. */
export const ACTIVE_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

/** The budget scope every brief charges (`featureScopeSlug('personal.brief')`). */
const BRIEF_SCOPE = 'platform:personal.brief';

/**
 * The people of a set who are still in the Org, briefs on, and were here in
 * the last seven days. One query for the whole sweep.
 * @param pairs - (person, Org) pairs.
 * @param now - The clock.
 */
export async function eligibleForBriefs(pairs: Array<{ userId: string; accountId: string }>, now: Date): Promise<Set<string>> {
  if (pairs.length === 0) {
    return new Set();
  }
  const since = new Date(now.getTime() - ACTIVE_WITHIN_MS);
  const rows = await db
    .select({ userId: accountMembershipSchema.userId, accountId: accountMembershipSchema.accountId })
    .from(accountMembershipSchema)
    .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, accountMembershipSchema.accountId))
    .where(and(
      inArray(accountMembershipSchema.userId, [...new Set(pairs.map(p => p.userId))]),
      eq(tenantAccountSchema.dailyBriefs, true),
      or(gte(accountMembershipSchema.lastActiveAt, since), gte(accountMembershipSchema.lastLoginAt, since)),
    ));
  return new Set(rows.map(r => `${r.userId}:${r.accountId}`));
}

/**
 * The Org's daily brief cap in cents, or null for none.
 * @param accountId - The Org.
 */
async function dailyCapCents(accountId: string): Promise<number | null> {
  const [row] = await db.select({ cap: tenantAccountSchema.briefDailyCents }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, accountId)).limit(1);
  if (row?.cap !== null && row?.cap !== undefined) {
    return row.cap;
  }
  const fallback = Number.parseInt(process.env.VOCION_BRIEF_DAILY_CENTS ?? '', 10);
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : null;
}

/**
 * What every brief in the Org has spent today (UTC day, the daily budget
 * period), in cents.
 * @param accountId - The Org.
 * @param now - The clock.
 */
export async function briefSpendTodayCents(accountId: string, now: Date): Promise<number> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [row] = await db
    .select({ micro: sql<string>`coalesce(sum(${agentBudgetSchema.currentMicroCents}), 0)` })
    .from(agentBudgetSchema)
    .innerJoin(projectSchema, eq(projectSchema.id, agentBudgetSchema.orgId))
    .where(and(
      eq(projectSchema.accountId, accountId),
      eq(agentBudgetSchema.agentSlug, BRIEF_SCOPE),
      eq(agentBudgetSchema.period, 'daily'),
      gte(agentBudgetSchema.periodStartedAt, dayStart),
    ));
  return Number(row?.micro ?? 0) / 1_000_000;
}

/** Whether a brief may spend now, and if not, why. */
export type BriefBudget = { ok: true } | { ok: false; why: string };

/**
 * May one more brief spend on the model now? The workspace's own hard caps
 * first (the existing preflight), then the Org's daily brief cap.
 * @param input - Whose brief.
 * @param input.accountId - The Org.
 * @param input.personalOrgId - The Personal workspace it charges.
 * @param input.now - The clock.
 */
export async function briefBudget(input: { accountId: string; personalOrgId: string; now: Date }): Promise<BriefBudget> {
  const { preflightCheck } = await import('@/services/BudgetService');
  const check = await preflightCheck({ orgId: input.personalOrgId, feature: 'personal.brief' });
  if (!check.ok) {
    return { ok: false, why: 'the Personal workspace is at its budget cap' };
  }
  const cap = await dailyCapCents(input.accountId);
  if (cap !== null && await briefSpendTodayCents(input.accountId, input.now) >= cap) {
    return { ok: false, why: `the Org's daily brief budget (${(cap / 100).toFixed(2)} USD) is spent` };
  }
  return { ok: true };
}

/**
 * Tell the Org's admins, once a day, in the app only, that briefs stopped.
 * @param accountId - The Org.
 * @param day - The day (once-only key).
 * @param why - Why.
 */
export async function noticeBriefsStopped(accountId: string, day: string, why: string): Promise<void> {
  const admins = await db
    .select({ userId: accountMembershipSchema.userId })
    .from(accountMembershipSchema)
    .where(and(eq(accountMembershipSchema.accountId, accountId), eq(accountMembershipSchema.role, 'admin')));
  const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
  const { notify } = await import('@/services/notifications/notify');
  for (const { userId } of admins) {
    const home = await ensurePersonalProject(userId, accountId);
    await notify({
      orgId: home.id,
      kind: 'briefs-paused',
      userIds: [userId],
      title: 'Daily briefs paused for today',
      body: `No more morning briefs or evening wraps go out today: ${why}. They resume tomorrow, or raise the cap under Notification settings → Your day.`,
      link: '/dashboard/notifications/settings',
      dedupeKey: `briefs-paused:${accountId}:${day}`,
    }, { deliver: 'none' });
  }
}

/**
 * The Org's brief settings, as an admin sees them.
 * @param accountId
 */
export async function orgBriefSettings(accountId: string): Promise<{ dailyBriefs: boolean; briefDailyCents: number | null; defaultCents: number | null }> {
  const [row] = await db.select({ dailyBriefs: tenantAccountSchema.dailyBriefs, cap: tenantAccountSchema.briefDailyCents }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, accountId)).limit(1);
  const fallback = Number.parseInt(process.env.VOCION_BRIEF_DAILY_CENTS ?? '', 10);
  return { dailyBriefs: row?.dailyBriefs ?? true, briefDailyCents: row?.cap ?? null, defaultCents: Number.isFinite(fallback) ? fallback : null };
}

/**
 * Change the Org's brief settings. The caller checks the person is an admin.
 * @param accountId - The Org.
 * @param change - What changed.
 * @param change.dailyBriefs - On or off.
 * @param change.briefDailyCents - The daily cap, or null for the default.
 */
export async function setOrgBriefSettings(accountId: string, change: { dailyBriefs?: boolean; briefDailyCents?: number | null }): Promise<void> {
  const set: Partial<typeof tenantAccountSchema.$inferInsert> = {};
  if (change.dailyBriefs !== undefined) {
    set.dailyBriefs = change.dailyBriefs;
  }
  if (change.briefDailyCents !== undefined) {
    set.briefDailyCents = change.briefDailyCents;
  }
  if (Object.keys(set).length > 0) {
    await db.update(tenantAccountSchema).set(set).where(eq(tenantAccountSchema.id, accountId));
  }
}
