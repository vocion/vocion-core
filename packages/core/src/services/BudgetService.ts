/**
 * BudgetService — per-period token and dollar caps for everything an org spends
 * on a model.
 *
 * ## What a budget row is
 *
 * One row of `agent_budget` is one counter plus its caps, for one org, one
 * scope and one period. A scope is either an agent's slug — the original
 * meaning — or one of two reserved platform scopes:
 *
 *   - `platform:all` — everything this org spent, agent turns included. This is
 *     the row an admin sets an org-wide cap on, and the one the observability
 *     page reads for "spend this period".
 *   - `platform:<feature>` — one non-agent surface, named by the Langfuse
 *     feature dimension: `platform:retrieval.embed`, `platform:tool.image`.
 *
 * The scope lives in the `agent_slug` column rather than in a column of its own
 * because the unique index across (org, slug, period) is what makes a charge a
 * single atomic statement, and widening a unique index on a populated table is
 * an expand-and-contract migration across three releases
 * (`migrations/CONVENTIONS.md` §2). The `feature` column carries the same
 * information as a typed label, so a report can group by it without parsing a
 * slug.
 *
 * ## Why every paid call charges now
 *
 * Before #279 only three call sites charged, all of them an agent turn. Every
 * other paid model call in the product — embeddings, rerank, the rewrite
 * button, transcript classification, chip synthesis, feedback classification,
 * duplicate detection, image generation — spent without the budget seeing it,
 * so an org could hold a $50 monthly cap and still run up a four-figure
 * embedding bill with the budget page showing it under limit. `agent_budget`
 * read as a spend control and was not one. Every one of those sites now calls
 * `chargeUsage`.
 *
 * ## What a cap may refuse
 *
 * Recording is universal; refusing is not, and the difference is deliberate.
 * Refusing a call costs a person something, so a hard cap only refuses work
 * that is large, batched and restartable:
 *
 *   - **Refused**: embedding during an ingest (a sync is restartable, and it is
 *     the largest spender), and image generation (the most expensive single
 *     call an agent can make). Both check `preflightCheck` first and stop
 *     cleanly.
 *   - **Charged, never refused**: query-time embedding and rerank — refusing
 *     those breaks search for pennies, and rerank degrades to the unranked
 *     candidates instead. Likewise the small classifier calls behind a person's
 *     click or a background sweep.
 *
 * ## Recording without a cap
 *
 * A charge creates the row it lands on. Budgets stay opt-in in the sense that
 * matters — an org that set no limit is refused nothing — but its usage is
 * recorded either way, because "what did we spend" is the question the budget
 * page exists to answer and a no-op charge could never answer it.
 *
 * Period boundaries roll inside the charge statement itself rather than on a
 * cron tick, so two concurrent charges across a rollover cannot both reset.
 */

import type { FeatureName } from '@/libs/Langfuse/features';
import type { TokenUsage } from '@/libs/pricing';
import { and, eq, inArray, notLike, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { tokenCostCents, totalTokens } from '@/libs/pricing';
import { agentBudgetSchema } from '@/models/Schema';

export type BudgetPeriod = 'daily' | 'monthly';

/** Which of an org's budget rows refused the call. */
export type BudgetScope = 'agent' | 'feature' | 'org';

export type BudgetCheck
  = | { ok: true }
    | {
      ok: false;
      reason: 'hard_tokens_exceeded' | 'hard_cents_exceeded';
      /** Which budget row refused — an agent's, one feature's, or the org's. */
      scope: BudgetScope;
      /** The slug of the row that refused, as stored. */
      agentSlug: string;
      limit: number;
      current: number;
    };

/**
 * The scope that holds an org's whole spend for a period. Every charge lands
 * here as well as on whatever else it belongs to, so one read answers "what has
 * this workspace spent" and one cap covers everything.
 */
export const ORG_SCOPE_SLUG = 'platform:all';

/**
 * How a reserved scope is spelled. No agent slug can collide: agent slugs are
 * kebab-case identifiers and carry no colon.
 */
const PLATFORM_SCOPE_PREFIX = 'platform:';

/**
 * A millionth of a cent, which is the unit spend is accumulated in. An
 * embedding batch costs a fraction of a cent, and rounding each one up to a
 * whole cent billed a $1 sync as $10.
 */
const MICRO_CENTS_PER_CENT = 1_000_000;

/**
 * The budget scope for one non-agent surface.
 * @param feature - The Langfuse feature dimension the spend was traced under.
 */
export function featureScopeSlug(feature: FeatureName): string {
  return `${PLATFORM_SCOPE_PREFIX}${feature}`;
}

/**
 * Whether a stored scope is one of the reserved platform ones rather than an
 * agent's slug. Callers that list agents filter on this so a platform row never
 * shows up as an agent nobody created.
 * @param agentSlug - The scope as stored on the row.
 */
export function isPlatformScope(agentSlug: string): boolean {
  return agentSlug.startsWith(PLATFORM_SCOPE_PREFIX);
}

/**
 * A `where` condition that keeps only the agent rows.
 *
 * For the callers that read `agent_budget` directly instead of going through
 * this service — the team reports, which join budgets onto agents by slug. A
 * platform row joins onto no agent, so it would surface as a nameless row or
 * quietly inflate a total.
 */
export function agentScopedOnly() {
  return notLike(agentBudgetSchema.agentSlug, `${PLATFORM_SCOPE_PREFIX}%`);
}

/**
 * Raised when a hard cap refuses work that is allowed to stop.
 *
 * Carries the refusing row so a caller can say which cap it hit. Only the
 * refusable sites throw it — see the module docstring for which those are and
 * why the rest proceed.
 */
export class BudgetExceededError extends Error {
  readonly check: Extract<BudgetCheck, { ok: false }>;

  constructor(check: Extract<BudgetCheck, { ok: false }>) {
    super(
      `Budget exceeded for "${check.agentSlug}" (${check.reason}: ${check.current}/${check.limit})`,
    );
    this.name = 'BudgetExceededError';
    this.check = check;
  }
}

/* ------------------------------------------------------------------ */
/* Period rollover                                                     */
/* ------------------------------------------------------------------ */

function shouldReset(period: BudgetPeriod, periodStartedAt: Date, now: Date): boolean {
  if (period === 'daily') {
    return now.getUTCFullYear() !== periodStartedAt.getUTCFullYear()
      || now.getUTCMonth() !== periodStartedAt.getUTCMonth()
      || now.getUTCDate() !== periodStartedAt.getUTCDate();
  }
  // monthly
  return now.getUTCFullYear() !== periodStartedAt.getUTCFullYear()
    || now.getUTCMonth() !== periodStartedAt.getUTCMonth();
}

/**
 * The SQL expression for the instant the current period began, in UTC.
 *
 * Used inside the charge statement so a rollover is decided by the database at
 * the moment of the write. `period` is a closed union, never caller text, so
 * interpolating it into the fragment is safe.
 * @param period - daily or monthly.
 */
function periodStartExpression(period: BudgetPeriod) {
  const unit = period === 'daily' ? 'day' : 'month';
  return sql.raw(`date_trunc('${unit}', now() AT TIME ZONE 'utc')`);
}

async function getOrCreateBudget(orgId: string, agentSlug: string, period: BudgetPeriod) {
  const [existing] = await db
    .select()
    .from(agentBudgetSchema)
    .where(and(
      eq(agentBudgetSchema.orgId, orgId),
      eq(agentBudgetSchema.agentSlug, agentSlug),
      eq(agentBudgetSchema.period, period),
    ));
  if (existing) {
    return existing;
  }
  const [created] = await db
    .insert(agentBudgetSchema)
    .values({ orgId, agentSlug, period })
    .returning();
  return created!;
}

async function maybeResetPeriod(row: typeof agentBudgetSchema.$inferSelect) {
  const now = new Date();
  if (!shouldReset(row.period as BudgetPeriod, row.periodStartedAt, now)) {
    return row;
  }
  const [updated] = await db
    .update(agentBudgetSchema)
    .set({ currentTokens: 0, currentCents: 0, currentMicroCents: 0, periodStartedAt: now })
    .where(eq(agentBudgetSchema.id, row.id))
    .returning();
  return updated!;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

async function readScope(
  orgId: string,
  agentSlug: string,
  period: BudgetPeriod,
): Promise<typeof agentBudgetSchema.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(agentBudgetSchema)
    .where(and(
      eq(agentBudgetSchema.orgId, orgId),
      eq(agentBudgetSchema.agentSlug, agentSlug),
      eq(agentBudgetSchema.period, period),
    ));
  if (!row) {
    return null;
  }
  return maybeResetPeriod(row);
}

/**
 * The breach one row reports, or null when it is under its caps (or has none).
 * @param row - A budget row, already rolled to the active period.
 * @param scope - Which kind of row this is, for the caller's message.
 */
function breachOf(
  row: typeof agentBudgetSchema.$inferSelect,
  scope: BudgetScope,
): Extract<BudgetCheck, { ok: false }> | null {
  if (row.hardTokenLimit !== null && row.currentTokens >= row.hardTokenLimit) {
    return {
      ok: false,
      reason: 'hard_tokens_exceeded',
      scope,
      agentSlug: row.agentSlug,
      limit: row.hardTokenLimit,
      current: row.currentTokens,
    };
  }
  if (row.hardCentsLimit !== null && row.currentCents >= row.hardCentsLimit) {
    return {
      ok: false,
      reason: 'hard_cents_exceeded',
      scope,
      agentSlug: row.agentSlug,
      limit: row.hardCentsLimit,
      current: row.currentCents,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

/**
 * Pre-flight check. Call before work a hard cap is allowed to refuse.
 *
 * Checks every scope the call belongs to — the agent's row, the feature's row,
 * and the org-wide row — and reports the first breach. Returns `{ ok: true }`
 * when none of them has a hard cap, none exists yet, or all are under.
 * @param opts - Who is about to spend.
 * @param opts.orgId - Tenant.
 * @param opts.agentSlug - The agent whose turn this is, when there is one.
 * @param opts.feature - The surface this call belongs to, when it is not an agent turn.
 * @param opts.period - Which period's counters to read (default daily).
 */
export async function preflightCheck(opts: {
  orgId: string;
  agentSlug?: string;
  feature?: FeatureName;
  period?: BudgetPeriod;
}): Promise<BudgetCheck> {
  const period: BudgetPeriod = opts.period ?? 'daily';
  const scopes: Array<{ slug: string; scope: BudgetScope }> = [];
  if (opts.agentSlug) {
    scopes.push({ slug: opts.agentSlug, scope: 'agent' });
  }
  if (opts.feature) {
    scopes.push({ slug: featureScopeSlug(opts.feature), scope: 'feature' });
  }
  scopes.push({ slug: ORG_SCOPE_SLUG, scope: 'org' });

  // One query for all three scopes rather than one per scope. This runs before
  // every search's rerank and every agent turn, so the difference is two saved
  // round trips on a hot path; the unique index covers the lookup either way.
  const rows = await db
    .select()
    .from(agentBudgetSchema)
    .where(and(
      eq(agentBudgetSchema.orgId, opts.orgId),
      inArray(agentBudgetSchema.agentSlug, scopes.map(target => target.slug)),
      eq(agentBudgetSchema.period, period),
    ));

  // Reported in scope order — agent, then feature, then workspace — so the
  // message names the most specific cap that refused.
  for (const target of scopes) {
    const row = rows.find(candidate => candidate.agentSlug === target.slug);
    if (!row) {
      continue;
    }
    const breach = breachOf(await maybeResetPeriod(row), target.scope);
    if (breach) {
      return breach;
    }
  }
  return { ok: true };
}

/**
 * Charge usage after a paid model call completes.
 *
 * Lands on up to three rows in one statement: the agent's, the feature's, and
 * always the org-wide one. The rows are created if they do not exist, so usage
 * is recorded whether or not anyone set a cap. Period rollover is decided in
 * the same statement, so a charge that crosses midnight starts the new period
 * rather than adding to the old one.
 *
 * Idempotent only by caller discipline — call it once per completed call.
 *
 * A call with neither `agentSlug` nor `feature` still charges the org row; it
 * is the caller saying "this was ours and we could not attribute it further",
 * which is better than losing it.
 * @param opts - What was spent.
 * @param opts.orgId - Tenant.
 * @param opts.agentSlug - The agent whose turn this was, when there is one.
 * @param opts.feature - The surface this call belongs to, when it is not an agent turn.
 * @param opts.model - Resolved model id, as `libs/pricing` keys them.
 * @param opts.usage - Tokens the provider reported.
 * @param opts.period - Which period to charge (default daily).
 */
export async function chargeUsage(opts: {
  orgId: string;
  agentSlug?: string;
  feature?: FeatureName;
  model: string;
  usage: TokenUsage;
  period?: BudgetPeriod;
}): Promise<void> {
  const period: BudgetPeriod = opts.period ?? 'daily';
  const microCents = Math.round(tokenCostCents(opts.model, opts.usage) * MICRO_CENTS_PER_CENT);
  const tokens = totalTokens(opts.usage);
  if (microCents === 0 && tokens === 0) {
    return;
  }

  const rows: Array<typeof agentBudgetSchema.$inferInsert> = [];
  if (opts.agentSlug) {
    rows.push({ orgId: opts.orgId, agentSlug: opts.agentSlug, period, currentTokens: tokens, currentMicroCents: microCents, currentCents: Math.floor(microCents / MICRO_CENTS_PER_CENT) });
  }
  if (opts.feature) {
    rows.push({ orgId: opts.orgId, agentSlug: featureScopeSlug(opts.feature), feature: opts.feature, period, currentTokens: tokens, currentMicroCents: microCents, currentCents: Math.floor(microCents / MICRO_CENTS_PER_CENT) });
  }
  rows.push({ orgId: opts.orgId, agentSlug: ORG_SCOPE_SLUG, period, currentTokens: tokens, currentMicroCents: microCents, currentCents: Math.floor(microCents / MICRO_CENTS_PER_CENT) });

  // One statement, so the three rows move together and a concurrent charge
  // cannot interleave a read with a write. `stale` is the period rollover: when
  // the row's period began before the current one, the incoming numbers replace
  // the counters instead of adding to them, and the period restarts.
  const periodStart = periodStartExpression(period);
  const stale = sql`${agentBudgetSchema.periodStartedAt} < ${periodStart}`;
  const nextMicroCents = sql`CASE WHEN ${stale} THEN ${microCents} ELSE ${agentBudgetSchema.currentMicroCents} + ${microCents} END`;
  await db
    .insert(agentBudgetSchema)
    .values(rows)
    .onConflictDoUpdate({
      target: [agentBudgetSchema.orgId, agentBudgetSchema.agentSlug, agentBudgetSchema.period],
      set: {
        // Per row, because `excluded` is the row being inserted: a feature row
        // learns its label, an agent row and the workspace row keep their null.
        // `coalesce` rather than a plain assignment so a row provisioned by
        // `setLimits` — which knows the scope but not the feature — is filled in
        // by the first charge and never overwritten afterwards.
        feature: sql`coalesce(${agentBudgetSchema.feature}, excluded.feature)`,
        currentTokens: sql`CASE WHEN ${stale} THEN ${tokens} ELSE ${agentBudgetSchema.currentTokens} + ${tokens} END`,
        currentMicroCents: nextMicroCents,
        currentCents: sql`floor((${nextMicroCents}) / ${MICRO_CENTS_PER_CENT})`,
        periodStartedAt: sql`CASE WHEN ${stale} THEN ${periodStart} ELSE ${agentBudgetSchema.periodStartedAt} END`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Provision (or update) a budget row. Use from the budgets UI / CLI
 * to set limits. Caps may be null to disable that dimension.
 *
 * `agentSlug` may be an agent's slug or a reserved scope — pass
 * {@link ORG_SCOPE_SLUG} for an org-wide cap, or {@link featureScopeSlug} for
 * one surface.
 * @param opts
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.period
 * @param opts.softTokenLimit
 * @param opts.hardTokenLimit
 * @param opts.softCentsLimit
 * @param opts.hardCentsLimit
 */
export async function setLimits(opts: {
  orgId: string;
  agentSlug: string;
  period?: BudgetPeriod;
  softTokenLimit?: number | null;
  hardTokenLimit?: number | null;
  softCentsLimit?: number | null;
  hardCentsLimit?: number | null;
}) {
  const period: BudgetPeriod = opts.period ?? 'daily';
  const row = await getOrCreateBudget(opts.orgId, opts.agentSlug, period);
  const [updated] = await db
    .update(agentBudgetSchema)
    .set({
      softTokenLimit: opts.softTokenLimit ?? null,
      hardTokenLimit: opts.hardTokenLimit ?? null,
      softCentsLimit: opts.softCentsLimit ?? null,
      hardCentsLimit: opts.hardCentsLimit ?? null,
    })
    .where(eq(agentBudgetSchema.id, row.id))
    .returning();
  return updated!;
}

/**
 * Every budget row this org has, platform scopes included.
 *
 * Rolls each period boundary before returning, so the caller sees the active
 * period's counters and not the stale one from the last run.
 * @param orgId - Tenant.
 */
export async function listAllBudgets(orgId: string) {
  const rows = await db
    .select()
    .from(agentBudgetSchema)
    .where(eq(agentBudgetSchema.orgId, orgId));
  return Promise.all(rows.map(r => maybeResetPeriod(r)));
}

/**
 * The org's agent rows only — what "spend per agent" means.
 *
 * Platform scopes are filtered out here rather than at each call site: they are
 * not agents, and a caller that listed them would show `platform:all` in an
 * agent table and double-count every cent in a sum.
 * @param orgId - Tenant.
 */
export async function listAgentBudgets(orgId: string) {
  const rows = await listAllBudgets(orgId);
  return rows.filter(r => !isPlatformScope(r.agentSlug));
}

/**
 * The org's non-agent rows — the org-wide total and one row per surface.
 * @param orgId - Tenant.
 */
export async function listPlatformBudgets(orgId: string) {
  const rows = await listAllBudgets(orgId);
  return rows.filter(r => isPlatformScope(r.agentSlug));
}

/**
 * What this org has spent in the period, across everything.
 *
 * Read off the `platform:all` row rather than summed over the others, so agent
 * spend is not counted twice — every charge lands on that row as well as on its
 * own scope. Returns zeroes when the org has never spent anything.
 * @param opts - Tenant and period.
 * @param opts.orgId
 * @param opts.period
 */
export async function orgUsageTotals(opts: { orgId: string; period?: BudgetPeriod }): Promise<{
  spentCents: number;
  tokens: number;
  hardCentsLimit: number | null;
  hardTokenLimit: number | null;
}> {
  const row = await readScope(opts.orgId, ORG_SCOPE_SLUG, opts.period ?? 'daily');
  if (!row) {
    return { spentCents: 0, tokens: 0, hardCentsLimit: null, hardTokenLimit: null };
  }
  return {
    spentCents: row.currentCents,
    tokens: row.currentTokens,
    hardCentsLimit: row.hardCentsLimit,
    hardTokenLimit: row.hardTokenLimit,
  };
}

export async function getBudget(opts: { orgId: string; agentSlug: string; period?: BudgetPeriod }) {
  return readScope(opts.orgId, opts.agentSlug, opts.period ?? 'daily');
}
