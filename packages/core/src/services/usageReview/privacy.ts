/**
 * What the daily usage review may read, per Org.
 *
 * Two modes, decided here and nowhere else:
 *
 *   content   the review reads chat threads — the person's words and the
 *             agent's replies — and a model judges whether each one got the
 *             person where they wanted. Its findings may reach the operator's
 *             daily roll-up.
 *   metadata  the review reads no content and no model reads anything: counts,
 *             timings, spend, effort levels, failures and tool errors, with
 *             outcomes inferred from the thread's structure and re-asks found
 *             by comparing a person's own messages in code. Nothing about the
 *             Org's threads leaves its own report but numbers.
 *
 * Which applies, strongest first:
 *
 *   1. the operator's override, `VOCION_USAGE_REVIEW_CONTENT_ORGS` (Org ids or
 *      slugs): those Orgs are read with content — the operator's own Orgs;
 *   2. the Org's own setting, "Help improve Vocion" (`tenant_account.
 *      usage_review_content`), when an admin chose;
 *   3. the deployment's default, `VOCION_USAGE_REVIEW_DEFAULT`: `on` on Vocion
 *      Cloud (its app env sets it), off when unset — so a self-hosted install
 *      starts with it off and its review never sends anything outside it.
 *
 * Every report states the mode it was read in, and why.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { tenantAccountSchema } from '@/models/Schema';

export type ReadMode = 'content' | 'metadata';

/** Why a mode applies: the override, the Org's own choice, or the deployment's default. */
export type ReadModeWhy = 'operator_override' | 'org_setting' | 'deployment_default';

export type ReadModeDecision = { mode: ReadMode; why: ReadModeWhy };

/** Who reads each mode's results, in the words the report and the setting use. */
export const READ_MODE_LABEL: Readonly<Record<ReadMode, string>> = {
  content: 'Chat content and metadata',
  metadata: 'Metadata only',
};

export const READ_MODE_WHY_LABEL: Readonly<Record<ReadModeWhy, string>> = {
  operator_override: 'the operator reads this Org with content',
  org_setting: 'the Org\'s "Help improve Vocion" setting',
  deployment_default: 'this deployment\'s default',
};

/**
 * Whether an Org that never chose lets the review read content, on this deployment.
 * @param raw - `VOCION_USAGE_REVIEW_DEFAULT`; unset is off.
 */
export function deploymentDefault(raw: string | undefined = process.env.VOCION_USAGE_REVIEW_DEFAULT): boolean {
  return raw?.trim().toLowerCase() === 'on';
}

/**
 * The Orgs the operator reads with content whatever their setting.
 * @param raw - `VOCION_USAGE_REVIEW_CONTENT_ORGS`, a comma list of Org ids or slugs.
 */
export function overrideOrgs(raw: string | undefined = process.env.VOCION_USAGE_REVIEW_CONTENT_ORGS): Set<string> {
  return new Set((raw ?? '').split(',').map(s => s.trim()).filter(Boolean));
}

/**
 * The mode one Org is read in. Pure.
 * @param org - The Org.
 * @param org.id - `tenant_account.id`.
 * @param org.slug - Its slug.
 * @param org.setting - Its "Help improve Vocion" choice; null when it never chose.
 * @param env - The deployment's settings; the process env by default.
 * @param env.defaultOn - `VOCION_USAGE_REVIEW_DEFAULT`.
 * @param env.override - `VOCION_USAGE_REVIEW_CONTENT_ORGS`.
 */
export function decideReadMode(
  org: { id: string; slug: string | null; setting: boolean | null },
  env: { defaultOn?: string; override?: string } = { defaultOn: process.env.VOCION_USAGE_REVIEW_DEFAULT, override: process.env.VOCION_USAGE_REVIEW_CONTENT_ORGS },
): ReadModeDecision {
  const listed = overrideOrgs(env.override);
  if (listed.has(org.id) || (org.slug && listed.has(org.slug))) {
    return { mode: 'content', why: 'operator_override' };
  }
  if (org.setting !== null) {
    return { mode: org.setting ? 'content' : 'metadata', why: 'org_setting' };
  }
  return { mode: deploymentDefault(env.defaultOn) ? 'content' : 'metadata', why: 'deployment_default' };
}

/**
 * The mode one Org is read in, from its row. An Org that cannot be read is
 * read as metadata: content is never the fallback.
 * @param accountId - `tenant_account.id`.
 */
export async function readModeForAccount(accountId: string | null): Promise<ReadModeDecision> {
  if (!accountId) {
    return { mode: 'metadata', why: 'deployment_default' };
  }
  const [row] = await db
    .select({ id: tenantAccountSchema.id, slug: tenantAccountSchema.slug, setting: tenantAccountSchema.usageReviewContent })
    .from(tenantAccountSchema)
    .where(eq(tenantAccountSchema.id, accountId))
    .limit(1);
  if (!row) {
    return { mode: 'metadata', why: 'deployment_default' };
  }
  return decideReadMode({ id: row.id, slug: row.slug, setting: row.setting ?? null });
}

/** What the Org settings page shows and changes. */
export type UsageReviewSetting = {
  /** Whether the review reads content now, whatever decided it. */
  on: boolean;
  /** The admin's own choice, or null while the deployment's default applies. */
  chosen: boolean | null;
  /** Whether this deployment starts Orgs with it on (Vocion Cloud). */
  defaultOn: boolean;
  /** The operator reads this Org with content whatever it says. */
  overridden: boolean;
};

/**
 * The Org's "Help improve Vocion" setting as the settings page reads it.
 * @param accountId - The Org.
 */
export async function usageReviewSetting(accountId: string): Promise<UsageReviewSetting> {
  const [row] = await db
    .select({ id: tenantAccountSchema.id, slug: tenantAccountSchema.slug, setting: tenantAccountSchema.usageReviewContent })
    .from(tenantAccountSchema)
    .where(eq(tenantAccountSchema.id, accountId))
    .limit(1);
  const chosen = row?.setting ?? null;
  const decision = decideReadMode({ id: accountId, slug: row?.slug ?? null, setting: chosen });
  return { on: decision.mode === 'content', chosen, defaultOn: deploymentDefault(), overridden: decision.why === 'operator_override' };
}

/**
 * An admin's choice. Stored as given, so a later change to the deployment's
 * default never overrides what an admin chose.
 * @param accountId - The Org.
 * @param on - Whether the review may read chat content.
 */
export async function setUsageReviewContent(accountId: string, on: boolean): Promise<void> {
  await db.update(tenantAccountSchema).set({ usageReviewContent: on }).where(eq(tenantAccountSchema.id, accountId));
}
