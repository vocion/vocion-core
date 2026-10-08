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
 * A charge creates the row it lands on, so usage is recorded whether or not
 * anyone set a limit — "what did we spend" is the question the budget page
 * exists to answer and a no-op charge could never answer it.
 *
 * Period boundaries roll inside the charge statement itself rather than on a
 * cron tick, so two concurrent charges across a rollover cannot both reset.
 *
 * ## Every agent has a cap, even one nobody set (#272)
 *
 * An agent turn is never unlimited. When the agent's own row sets no hard
 * cents cap — including when it has no row at all, which is every agent the
 * moment it is created — the workspace's default agent cap applies instead:
 *
 *   1. The workspace's `platform:agent-default` row, when an admin set one
 *      (through the same `setLimits` / budgets API as any other row). A row
 *      whose hard cents cap is null means "this workspace chose no default",
 *      and agents without a cap of their own run unlimited.
 *   2. Otherwise the built-in default, {@link DEFAULT_AGENT_DAILY_HARD_CENTS}
 *      a day, which a deployment can change with
 *      `VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS` (a whole number of cents, or
 *      `off` for none).
 *
 * Only an agent's own scope gets a default. It covers everything billed to that
 * agent — its chat turns, and also its worker runs and the source-sync
 * extraction charged to it — since a runaway loop in any of them is the spend
 * #272 is about; those paths refuse at the same cap. The workspace-wide and
 * per-feature rows stay opt-in, because refusing a search or an ingest over a
 * cap nobody chose would break the product for pennies — see "What a cap may
 * refuse" above.
 *
 * ## Which column is the money
 *
 * `currentMicroCents` is, and it is the only one. A charge accumulates it and
 * a cap is compared against it, because an embedding batch costs a fraction of
 * a cent and a counter kept in whole cents is always up to one behind the
 * truth.
 *
 * Cents are divided out of it when a row is read, never stored. There was a
 * `currentCents` column doing that, and it was removed: a second copy of the
 * same money can disagree with the first, and because it was floored per row,
 * the agents' cents did not add up to the workspace's. The database column is
 * dropped a release later than this code, per `migrations/CONVENTIONS.md`.
 *
 * ## The account cap (one deployment, several client accounts)
 *
 * Everything above stops at the workspace. On a deployment hosting several
 * client companies — one `tenant_account` each, several workspaces each — the
 * question an operator answers to a client is the account's, so a cap can
 * also sit on the ACCOUNT:
 *
 *   - It is an ordinary budget row under the reserved scope
 *     {@link ACCOUNT_SCOPE_SLUG}, whose `org_id` holds the `tenant_account.id`
 *     rather than a workspace id, and whose period is monthly
 *     ({@link ACCOUNT_CAP_PERIOD}) because a client is billed by the month.
 *     Same counter, same rollover, same refusal rule as every other row — no
 *     second shape for money.
 *   - Every charge rolls up onto it: `chargeUsage` looks up the workspace's
 *     account inside the charge's transaction and adds the account row to the
 *     same statement, so it can never disagree with the workspace's own rows.
 *   - It refuses exactly where a hard cap already refuses. `preflightCheck`
 *     reads it alongside the agent, feature and workspace rows, so the sites
 *     that stop over a cap (ingest embedding, image generation, an agent
 *     turn's next model call) stop over this one, and everything that only
 *     records keeps recording.
 *   - Only an operator sets it. `setLimits` and `setCentsLimits` — the paths
 *     behind the budgets API, workspace YAML and the hire flow — refuse the
 *     scope outright; {@link setAccountCap} is the one writer, and its only
 *     caller is the operator console's router.
 *
 * ## The daily ledger
 *
 * A period counter is zeroed when its period rolls, so "what did this account
 * spend in the last 30 days" cannot be read from `agent_budget`. Each charge
 * therefore also adds to the workspace's row for today in `spend_day`, in the
 * same transaction; {@link spendSince} reads it.
 */

import type { SQL } from 'drizzle-orm';
import type { FeatureName } from '@/libs/Langfuse/features';
import type { TokenUsage } from '@/libs/pricing';
import { and, eq, gte, inArray, min, notLike, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { tokenCostMicroCents, totalTokens } from '@/libs/pricing';
import { agentBudgetSchema, agentSchema, projectSchema, spendDaySchema } from '@/models/Schema';
import { budgetRefusalMessage } from '@/services/budget/refusalMessage';
import { noteRunCost } from '@/services/budget/runCost';

export type BudgetPeriod = 'daily' | 'monthly';

/** Which budget row refused the call: an agent's, one feature's, the workspace's, or its account's. */
export type BudgetScope = 'agent' | 'feature' | 'org' | 'account';

export type BudgetCheck
  = | { ok: true }
    | {
      ok: false;
      reason: 'hard_tokens_exceeded' | 'hard_cents_exceeded';
      /** Which budget row refused — an agent's, one feature's, or the org's. */
      scope: BudgetScope;
      /** The slug of the row that refused, as stored. */
      agentSlug: string;
      /** The cap, as it was set: whole cents, or tokens. */
      limit: number;
      /** Exact spend against that cap, in the same unit. Cents carry a fraction. */
      current: number;
      /**
       * Where the cap came from: the refusing row itself, or — for an agent
       * that set no cap of its own — the workspace's default agent cap or the
       * built-in one. Tells the person which setting to change.
       */
      limitFrom: BudgetLimitSource;
    };

/** Whose setting a refusing cap is. See the module docstring, #272. */
export type BudgetLimitSource = 'own' | 'workspace_agent_default' | 'built_in_agent_default';

/**
 * The scope that holds an org's whole spend for a period. Every charge lands
 * here as well as on whatever else it belongs to, so one read answers "what has
 * this workspace spent" and one cap covers everything.
 */
export const ORG_SCOPE_SLUG = 'platform:all';

/**
 * The scope whose caps are the default for every agent in the workspace that
 * set none of its own. Nothing is ever charged to it; it holds limits only.
 */
export const AGENT_DEFAULT_SCOPE_SLUG = 'platform:agent-default';

/**
 * The scope an account-wide cap lives on. On this scope alone, `org_id` holds
 * the `tenant_account.id`, not a workspace's. Only an operator writes its caps
 * ({@link setAccountCap}); every charge in any of the account's workspaces adds
 * to it. See "The account cap" in the module docstring.
 */
export const ACCOUNT_SCOPE_SLUG = 'platform:account';

/** The account cap's period. A client account is billed by the calendar month. */
export const ACCOUNT_CAP_PERIOD: BudgetPeriod = 'monthly';

/**
 * The daily hard cap, in cents, on an agent nobody gave a cap — $100 a day.
 *
 * Deliberately generous: it is a backstop against a runaway loop, not a
 * spending plan, and a default that trips on a busy ordinary day would teach
 * people to switch it off. An agent that should spend less gets a cap of its
 * own; `GET /api/v1/budgets/agents` shows every agent's cap and where it came
 * from. Daily only: a monthly check on an
 * agent with no row falls through to no cap, as it always did.
 */
export const DEFAULT_AGENT_DAILY_HARD_CENTS = 10_000;

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
 * The largest account cap, in cents, that stays exact once compared in
 * micro-cents: a cap is multiplied by {@link MICRO_CENTS_PER_CENT} for the
 * check, and past 2^53 that product stops being an integer JavaScript can
 * hold. About $90 million a month — a ceiling no real cap reaches.
 */
export const MAX_ACCOUNT_CAP_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / MICRO_CENTS_PER_CENT);

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
 * Carries the refusing row so a caller can say which cap it hit, and says it
 * in the words every budget refusal uses (`budget/refusalMessage.ts`) — an
 * ingest run stopped by the account cap names the operator, not an admin.
 * Only the refusable sites throw it — see the module docstring for which
 * those are and why the rest proceed.
 */
export class BudgetExceededError extends Error {
  readonly check: Extract<BudgetCheck, { ok: false }>;

  constructor(check: Extract<BudgetCheck, { ok: false }>) {
    super(budgetRefusalMessage(check));
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
 * Used when a read rolls a row, so a rollover is decided by the database at
 * the moment of the write (the charge statement decides it per row, with
 * `rowPeriodStart`). `period` is a closed union, never caller text, so
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

/**
 * Roll a row read from the database into the current period when its period
 * has passed, and return the row as it now stands.
 *
 * The reset is conditional on the row STILL being in the old period, decided
 * by the database in the same statement — exactly the rule `writeCharge`
 * rolls by. Resetting by id alone lost money at every midnight (#272): a read
 * picked up yesterday's row, a model call from a turn already running charged
 * (rolling the row itself and recording today's first spend), and the read
 * then zeroed the row from its stale copy, wiping that charge. Now the second
 * roll matches nothing, and the row is read again instead.
 *
 * The new period starts at the database's midnight rather than at the moment
 * of the read, so a row rolled by a read and one rolled by a charge carry the
 * same start.
 *
 * Exported for the test that replays that race; callers go through the
 * reading functions below.
 * @param row - A budget row as it was read.
 * @returns The row in the active period.
 */
export async function rollPeriodIfStale(row: typeof agentBudgetSchema.$inferSelect) {
  if (!shouldReset(row.period as BudgetPeriod, row.periodStartedAt, new Date())) {
    return row;
  }
  const periodStart = periodStartExpression(row.period as BudgetPeriod);
  const [rolled] = await db
    .update(agentBudgetSchema)
    .set({ currentTokens: 0, currentMicroCents: 0, periodStartedAt: periodStart })
    .where(and(eq(agentBudgetSchema.id, row.id), sql`${agentBudgetSchema.periodStartedAt} < ${periodStart}`))
    .returning();
  if (rolled) {
    return rolled;
  }
  // Already in the current period: a charge rolled it first (and what it
  // recorded is on the row now), or the database's clock has not reached the
  // boundary this process's clock has. Either way the stored row is the truth.
  const [current] = await db.select().from(agentBudgetSchema).where(eq(agentBudgetSchema.id, row.id));
  return current ?? row;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * A budget row as callers read it: the stored row, plus its spend in cents.
 *
 * `currentCents` is worked out here rather than stored, so there is exactly one
 * number holding the money and nothing to keep in step with it. It carries a
 * fraction — a rerank that cost a fifth of a cent reads as 0.2, not 0.
 */
export type BudgetRow = typeof agentBudgetSchema.$inferSelect & { currentCents: number };

/**
 * Spend in cents, from the micro-cents that hold it.
 * @param row - A stored budget row.
 * @param row.currentMicroCents
 */
function spentCents(row: { currentMicroCents: number }): number {
  return row.currentMicroCents / MICRO_CENTS_PER_CENT;
}

/**
 * Attach the cents a caller reads to a stored row.
 * @param row - A stored budget row.
 */
function withSpentCents(row: typeof agentBudgetSchema.$inferSelect): BudgetRow {
  return { ...row, currentCents: spentCents(row) };
}

async function readScope(
  orgId: string,
  agentSlug: string,
  period: BudgetPeriod,
): Promise<BudgetRow | null> {
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
  return withSpentCents(await rollPeriodIfStale(row));
}

/**
 * The part of a budget row a cap is decided on.
 *
 * Narrower than the stored row so a brand-new agent — which has no row yet —
 * can be checked against its default cap exactly as a real row would be.
 */
type CappedCounter = Pick<
  typeof agentBudgetSchema.$inferSelect,
  'agentSlug' | 'currentTokens' | 'currentMicroCents' | 'hardTokenLimit' | 'hardCentsLimit'
>;

/**
 * Whose setting each of a counter's two caps is.
 *
 * Kept per cap because an agent can set a token cap of its own and still take
 * its cents cap from the workspace default, and a refusal has to name the one
 * that actually tripped.
 */
type CapSources = { tokens: BudgetLimitSource; cents: BudgetLimitSource };

/** Both caps are the row's own — every scope but a defaulted agent. */
const OWN_CAPS: CapSources = { tokens: 'own', cents: 'own' };

/**
 * The breach one row reports, or null when it is under its caps (or has none).
 * @param row - A budget row, already rolled to the active period.
 * @param scope - Which kind of row this is, for the caller's message.
 * @param sources - Whose setting each cap is; the row's own unless they were
 *   filled in from a default (see {@link withAgentDefaultCaps}).
 */
function breachOf(
  row: CappedCounter,
  scope: BudgetScope,
  sources: CapSources = OWN_CAPS,
): Extract<BudgetCheck, { ok: false }> | null {
  if (row.hardTokenLimit !== null && row.currentTokens >= row.hardTokenLimit) {
    return {
      ok: false,
      reason: 'hard_tokens_exceeded',
      scope,
      agentSlug: row.agentSlug,
      limit: row.hardTokenLimit,
      current: row.currentTokens,
      limitFrom: sources.tokens,
    };
  }
  // Compared in micro-cents, which is where the money is. A limit is whole
  // cents, so multiplying it up is exact and the comparison never touches a
  // fraction.
  //
  // `current` is reported in cents — the unit the person set the cap in — so a
  // refusal reads in the same unit as the limit beside it. It is exact, and it
  // carries a fraction: a caller putting it in front of somebody formats it
  // there, rather than this rounding the amount on their behalf.
  if (row.hardCentsLimit !== null && row.currentMicroCents >= row.hardCentsLimit * MICRO_CENTS_PER_CENT) {
    return {
      ok: false,
      reason: 'hard_cents_exceeded',
      scope,
      agentSlug: row.agentSlug,
      limit: row.hardCentsLimit,
      current: spentCents(row),
      limitFrom: sources.cents,
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

  // One query for every scope rather than one per scope — the workspace's
  // default agent cap rides along when this is an agent turn. This runs before
  // every search's rerank and after every model call of an agent turn, so the
  // saved round trips are on a hot path; the unique index covers the lookup.
  const slugs = scopes.map(target => target.slug);
  if (opts.agentSlug) {
    slugs.push(AGENT_DEFAULT_SCOPE_SLUG);
  }
  // The account's row rides in the same query: the workspace's account is a
  // primary-key lookup inside it, so the account cap costs no extra round trip
  // on this hot path.
  const rows = await db
    .select()
    .from(agentBudgetSchema)
    .where(or(
      and(
        eq(agentBudgetSchema.orgId, opts.orgId),
        inArray(agentBudgetSchema.agentSlug, slugs),
        eq(agentBudgetSchema.period, period),
      ),
      and(
        eq(agentBudgetSchema.agentSlug, ACCOUNT_SCOPE_SLUG),
        eq(agentBudgetSchema.period, ACCOUNT_CAP_PERIOD),
        sql`${agentBudgetSchema.orgId} = (select ${projectSchema.accountId} from ${projectSchema} where ${projectSchema.id} = ${opts.orgId})`,
      ),
    ));
  const workspaceAgentDefault = rows.find(candidate => candidate.agentSlug === AGENT_DEFAULT_SCOPE_SLUG);

  // Reported in scope order — agent, then feature, then workspace — so the
  // message names the most specific cap that refused.
  for (const target of scopes) {
    const row = rows.find(candidate => candidate.agentSlug === target.slug);
    if (target.scope === 'agent') {
      const { capped, sources } = withAgentDefaultCaps({
        agentRow: row ? await rollPeriodIfStale(row) : emptyAgentCounter(target.slug),
        workspaceAgentDefault,
        period,
      });
      const breach = breachOf(capped, target.scope, sources);
      if (breach) {
        return breach;
      }
      continue;
    }
    if (!row) {
      continue;
    }
    const breach = breachOf(await rollPeriodIfStale(row), target.scope);
    if (breach) {
      return breach;
    }
  }
  // The account's cap last: it is the least specific, and the one nobody in
  // the workspace can change, so a narrower cap that also refused is the more
  // useful thing to name.
  const accountRow = rows.find(candidate => candidate.agentSlug === ACCOUNT_SCOPE_SLUG);
  if (accountRow) {
    const breach = breachOf(await rollPeriodIfStale(accountRow), 'account');
    if (breach) {
      return breach;
    }
  }
  return { ok: true };
}

/**
 * An agent's counter before its first charge: nothing spent, no caps.
 * @param agentSlug - The agent.
 */
function emptyAgentCounter(agentSlug: string): CappedCounter {
  return { agentSlug, currentTokens: 0, currentMicroCents: 0, hardTokenLimit: null, hardCentsLimit: null };
}

/**
 * The built-in daily default cap for an agent, after the deployment's say.
 *
 * `VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS` may be a whole number of cents, or
 * `off` for no built-in default. Anything else is a typo in somebody's
 * environment, and falling back to the built-in number is the safe direction
 * to be wrong in: an agent with a cap it was not meant to have is refused and
 * says why; one with no cap it was meant to have spends silently.
 * @returns The cap in cents, or null for none.
 */
export function builtInAgentDailyHardCents(): number | null {
  const configured = process.env.VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS?.trim();
  if (!configured) {
    return DEFAULT_AGENT_DAILY_HARD_CENTS;
  }
  if (configured.toLowerCase() === 'off') {
    return null;
  }
  if (/^\d+$/.test(configured)) {
    return Number(configured);
  }
  console.warn('VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS is neither a whole number of cents nor "off"; using the built-in default', { configured, fallbackCents: DEFAULT_AGENT_DAILY_HARD_CENTS });
  return DEFAULT_AGENT_DAILY_HARD_CENTS;
}

/**
 * An agent's row with the workspace's default caps filled into whatever it
 * left unset — the rule in the module docstring, #272.
 *
 * Only a cap the agent left null is filled; a cap it set, even one higher than
 * the default, is its own. The token cap follows the workspace default row
 * when there is one; there is no built-in token default, because money is
 * what a runaway turn costs.
 * @param opts - The pieces.
 * @param opts.agentRow - The agent's row, rolled to the active period.
 * @param opts.workspaceAgentDefault - The workspace's `platform:agent-default` row, if it has one.
 * @param opts.period - The period being checked; the built-in default is daily only.
 * @returns The row to check, and whose setting its cents cap is.
 */
function withAgentDefaultCaps(opts: {
  agentRow: CappedCounter;
  workspaceAgentDefault: CappedCounter | undefined;
  period: BudgetPeriod;
}): { capped: CappedCounter; sources: CapSources } {
  const { agentRow, workspaceAgentDefault, period } = opts;
  const defaultSource: BudgetLimitSource = workspaceAgentDefault ? 'workspace_agent_default' : 'built_in_agent_default';
  const defaultCents = workspaceAgentDefault
    ? workspaceAgentDefault.hardCentsLimit
    : (period === 'daily' ? builtInAgentDailyHardCents() : null);
  const defaultTokens = workspaceAgentDefault?.hardTokenLimit ?? null;
  const ownCents = agentRow.hardCentsLimit !== null;
  const ownTokens = agentRow.hardTokenLimit !== null;
  return {
    capped: {
      ...agentRow,
      hardCentsLimit: ownCents ? agentRow.hardCentsLimit : defaultCents,
      hardTokenLimit: ownTokens ? agentRow.hardTokenLimit : defaultTokens,
    },
    sources: {
      cents: ownCents ? 'own' : defaultSource,
      tokens: ownTokens ? 'own' : defaultSource,
    },
  };
}

/**
 * Charge usage after a paid model call completes.
 *
 * Lands on up to four rows in one statement: the agent's, the feature's,
 * always the org-wide one, and the workspace's account's monthly row when the
 * workspace belongs to an account. The rows are created if they do not exist,
 * so usage is recorded whether or not anyone set a cap. Period rollover is
 * decided in the same statement, so a charge that crosses midnight starts the
 * new period rather than adding to the old one. Today's row of the workspace's
 * daily ledger (`spend_day`) is added to in the same transaction.
 *
 * Idempotent only by caller discipline — call it once per completed call.
 *
 * A failed write is retried a bounded number of times before it gives up; see
 * {@link writeChargeWithRetry} for why that cannot double-charge and what
 * happens when every attempt fails.
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
  // Micro-cents straight from the price table, not cents multiplied back up:
  // `tokenCostMicroCents` is whole-number arithmetic end to end, so a charge
  // carries no floating-point residue into a counter that adds one of these per
  // embedding batch all period.
  const microCents = tokenCostMicroCents(opts.model, opts.usage);
  const tokens = totalTokens(opts.usage);
  if (microCents === 0 && tokens === 0) {
    return;
  }

  const rows: Array<typeof agentBudgetSchema.$inferInsert> = [];
  if (opts.agentSlug) {
    rows.push({ orgId: opts.orgId, agentSlug: opts.agentSlug, period, currentTokens: tokens, currentMicroCents: microCents });
  }
  if (opts.feature) {
    rows.push({ orgId: opts.orgId, agentSlug: featureScopeSlug(opts.feature), feature: opts.feature, period, currentTokens: tokens, currentMicroCents: microCents });
  }
  rows.push({ orgId: opts.orgId, agentSlug: ORG_SCOPE_SLUG, period, currentTokens: tokens, currentMicroCents: microCents });

  // The run this call belongs to counts it too, whether or not the budget
  // write lands: a run's cost is what it spent, not what the counters saw
  // (`services/budget/runCost.ts`).
  await noteRunCost(tokens, microCents);
  await writeChargeWithRetry(opts.orgId, rows, period, tokens, microCents);
}

/** Attempts a charge gets before the spend is given up on. */
const CHARGE_ATTEMPTS = 3;

/** First backoff step between charge attempts; doubles each time. */
const CHARGE_RETRY_DELAY_MS = 100;

/**
 * Wait, so a retry does not land on the same bad moment as the attempt before.
 * @param milliseconds - How long to wait.
 */
async function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Write one charge, retrying a failed attempt a bounded number of times.
 *
 * The model call already happened and the provider will already bill us for
 * it, so a charge that fails is money the product spent and can no longer see.
 * A single failed attempt is usually a moment of database trouble rather than
 * anything wrong with the charge, and giving up on the first one was the
 * difference between a budget that is a spend control and one that is a
 * decent guess.
 *
 * **Why retrying cannot double-charge.** The write is one
 * `INSERT … ON CONFLICT DO UPDATE`, and Postgres commits a single statement
 * whole or not at all. An attempt that raises added nothing, so the next
 * attempt starts from the same counters.
 *
 * The exception is a lost acknowledgement — the statement committed but the
 * connection died before we heard so — where a retry charges twice. We take
 * that trade deliberately: for a spend control, counting one call twice is the
 * safe direction to be wrong in, and losing it is not. Making it exact would
 * need a recorded id per call to write against, which is a ledger table and a
 * larger change than this one.
 *
 * When every attempt fails it logs the whole charge at error level before
 * rethrowing, so the spend can be reconstructed by hand from the log line —
 * callers mostly swallow what comes out of here, on purpose, because failing
 * somebody's request over the accounting would be the more expensive mistake.
 * @param orgId - The workspace the call was made in.
 * @param rows - The scope rows this charge lands on.
 * @param period - Which period is being charged.
 * @param tokens - Tokens to add.
 * @param microCents - Money to add, in micro-cents.
 */
async function writeChargeWithRetry(
  orgId: string,
  rows: Array<typeof agentBudgetSchema.$inferInsert>,
  period: BudgetPeriod,
  tokens: number,
  microCents: number,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CHARGE_ATTEMPTS; attempt++) {
    try {
      await writeCharge(orgId, rows, tokens, microCents);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < CHARGE_ATTEMPTS) {
        await pause(CHARGE_RETRY_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }
  logUnrecordedSpend({
    orgId,
    scopes: rows.map(row => row.agentSlug),
    period,
    tokens,
    microCents,
    attempts: CHARGE_ATTEMPTS,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw lastError;
}

/**
 * Log spend that could not be recorded, loading the logger only when there is
 * something to say.
 *
 * `libs/Logger` validates the whole environment at import, and this module is
 * loaded by tests that run against a database fixture with nothing else
 * configured. Same approach, and same reason, as `logWarning` in
 * `libs/retrieval/embedder.ts`.
 * @param properties - The charge that was lost, in enough detail to replay it.
 */
function logUnrecordedSpend(properties: Record<string, unknown>): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger.error('budget charge failed and the spend is unrecorded', properties))
    // The logger itself is unavailable — in a test harness, or because its own
    // environment is unset. Fall back to the console rather than swallowing it:
    // this line is the only remaining record of money the product spent.
    .catch(loggerError => console.error('budget charge failed and the spend is unrecorded, and the logger was unavailable', { ...properties, loggerError }));
}

/**
 * The instant the current period began for the row a charge statement is
 * writing, decided per row: a charge lands on daily rows and on the account's
 * monthly row in the same statement. Inside `ON CONFLICT DO UPDATE` the bare
 * column is the stored row, whose period is part of the conflict key and so
 * the incoming row's too.
 *
 * A function rather than a module constant, so importing this module never
 * reads the schema — a test that mocks `@/models/Schema` without this table
 * can still import a module that imports this one.
 */
function rowPeriodStart(): SQL {
  return sql`date_trunc(CASE WHEN ${agentBudgetSchema.period} = 'monthly' THEN 'month' ELSE 'day' END, now() AT TIME ZONE 'utc')`;
}

/**
 * The charge itself: ONE statement, so the rows move together, a concurrent
 * charge cannot interleave a read with a write, and it costs one round trip.
 *
 * Three inserts, run as data-modifying CTEs of a single statement:
 *
 *   - the scope rows (agent, feature, workspace), upserted;
 *   - the workspace's account's monthly row, upserted from
 *     `select account_id from project where id = <workspace>` — a workspace
 *     with no project row (a fixture, a script) selects nothing, so it simply
 *     has no account to roll up to;
 *   - today's row of the workspace's daily ledger (`spend_day`).
 *
 * `stale` is the period rollover — when a row's period began before the
 * current one, the incoming numbers replace the counters instead of adding to
 * them, and the period restarts. A statement outside any transaction commits
 * as it ends, so the account row — which every charge in every workspace of
 * the account writes — is locked only for the length of this one statement,
 * never across round trips. A retried charge retries all three together.
 * @param orgId - The workspace the call was made in.
 * @param rows - The scope rows this charge lands on.
 * @param tokens - Tokens to add.
 * @param microCents - Money to add, in micro-cents.
 */
async function writeCharge(
  orgId: string,
  rows: Array<typeof agentBudgetSchema.$inferInsert>,
  tokens: number,
  microCents: number,
): Promise<void> {
  const periodStart = rowPeriodStart();
  const stale = sql`${agentBudgetSchema.periodStartedAt} < ${periodStart}`;
  const nextTokens = sql`CASE WHEN ${stale} THEN ${tokens} ELSE ${agentBudgetSchema.currentTokens} + ${tokens} END`;
  const nextMicroCents = sql`CASE WHEN ${stale} THEN ${microCents} ELSE ${agentBudgetSchema.currentMicroCents} + ${microCents} END`;
  const nextPeriodStart = sql`CASE WHEN ${stale} THEN ${periodStart} ELSE ${agentBudgetSchema.periodStartedAt} END`;

  const scopes = db
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
        currentTokens: nextTokens,
        currentMicroCents: nextMicroCents,
        periodStartedAt: nextPeriodStart,
        updatedAt: new Date(),
      },
    });
  // Written by hand: drizzle's insert-from-select wants every column of the
  // table selected, and this row needs five. Same counters, same rollover.
  const account = sql`
    insert into ${agentBudgetSchema} (org_id, agent_slug, period, current_tokens, current_micro_cents)
    select ${projectSchema.accountId}, ${ACCOUNT_SCOPE_SLUG}, ${ACCOUNT_CAP_PERIOD}, ${tokens}, ${microCents}
    from ${projectSchema} where ${projectSchema.id} = ${orgId}
    on conflict (org_id, agent_slug, period) do update set
      current_tokens = ${nextTokens},
      current_micro_cents = ${nextMicroCents},
      period_started_at = ${nextPeriodStart},
      updated_at = now()
  `;
  const ledger = db
    .insert(spendDaySchema)
    .values({ orgId, day: sql`(now() AT TIME ZONE 'utc')::date`, tokens, microCents })
    .onConflictDoUpdate({
      target: [spendDaySchema.orgId, spendDaySchema.day],
      set: {
        tokens: sql`${spendDaySchema.tokens} + ${tokens}`,
        microCents: sql`${spendDaySchema.microCents} + ${microCents}`,
        updatedAt: new Date(),
      },
    });
  await db.execute(sql`with scopes as (${scopes.getSQL()}), account as (${account}) ${ledger.getSQL()}`);
}

/**
 * Raised when a workspace-level writer names the account scope. The account
 * cap is an operator's, and {@link setAccountCap} is its only writer.
 */
export class AccountCapNotWritableError extends Error {
  constructor() {
    super(`"${ACCOUNT_SCOPE_SLUG}" is the account-wide cap, which only a Vocion operator sets.`);
    this.name = 'AccountCapNotWritableError';
  }
}

/**
 * Refuse the account scope on a workspace-level writer — structural, so a new
 * caller of `setLimits` cannot become a way round the operator.
 * @param agentSlug - The scope the caller asked to write.
 */
function refuseAccountScope(agentSlug: string): void {
  if (agentSlug === ACCOUNT_SCOPE_SLUG) {
    throw new AccountCapNotWritableError();
  }
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
  refuseAccountScope(opts.agentSlug);
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
 * Set only the money caps on one budget row, leaving its token caps as they
 * are. Workspace apply writes a YAML `budget:` block through this: the YAML
 * owns the dollar caps, and a token cap an admin set elsewhere must survive
 * every apply, where {@link setLimits} would write it back to null.
 * @param opts
 * @param opts.orgId - The workspace.
 * @param opts.agentSlug - The agent, or a reserved platform scope.
 * @param opts.period - `daily` or `monthly`.
 * @param opts.softCentsLimit - The soft cap in cents, or null for none.
 * @param opts.hardCentsLimit - The hard cap in cents, or null for none.
 */
export async function setCentsLimits(opts: {
  orgId: string;
  agentSlug: string;
  period: BudgetPeriod;
  softCentsLimit: number | null;
  hardCentsLimit: number | null;
}) {
  refuseAccountScope(opts.agentSlug);
  const row = await getOrCreateBudget(opts.orgId, opts.agentSlug, opts.period);
  const [updated] = await db
    .update(agentBudgetSchema)
    .set({ softCentsLimit: opts.softCentsLimit, hardCentsLimit: opts.hardCentsLimit })
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
  const current = await Promise.all(rows.map(r => rollPeriodIfStale(r)));
  return current.map(r => withSpentCents(r));
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

/* ------------------------------------------------------------------ */
/* The account cap — set by an operator, charged by every workspace    */
/* ------------------------------------------------------------------ */

/** An account's month as the spend page and the operator console read it. */
export type AccountCapStatus = {
  accountId: string;
  /** Spend this calendar month (UTC) across every workspace in the account, in cents; carries a fraction. */
  spentCents: number;
  tokens: number;
  /** The hard cap in cents an operator set, or null when there is none. */
  hardCentsLimit: number | null;
  /** True when the cap is reached: refusable work in every workspace of the account stops. */
  blocked: boolean;
  /** When this month's counter started, ISO-8601 UTC; null before the first charge. */
  periodStartedAt: string | null;
  /** When the counter goes back to zero, ISO-8601 UTC. */
  periodResetsAt: string;
};

/**
 * The account's month: what it has spent across its workspaces, and the cap.
 * Zeroes and no cap for an account that has spent nothing and has no cap.
 * @param accountId - `tenant_account.id`.
 */
export async function accountCapStatus(accountId: string): Promise<AccountCapStatus> {
  const row = await readScope(accountId, ACCOUNT_SCOPE_SLUG, ACCOUNT_CAP_PERIOD);
  const periodResetsAt = periodEndsAt(ACCOUNT_CAP_PERIOD, new Date()).toISOString();
  if (!row) {
    return { accountId, spentCents: 0, tokens: 0, hardCentsLimit: null, blocked: false, periodStartedAt: null, periodResetsAt };
  }
  return {
    accountId,
    spentCents: row.currentCents,
    tokens: row.currentTokens,
    hardCentsLimit: row.hardCentsLimit,
    blocked: breachOf(row, 'account') !== null,
    periodStartedAt: row.periodStartedAt.toISOString(),
    periodResetsAt,
  };
}

/**
 * Set, raise, lower or clear an account's monthly cap. The only writer of the
 * account scope: callers must have established that the person is an operator
 * (`routers/Operator.ts`), because nothing below the router can.
 *
 * Only the hard cents cap: the account cap is a spend control, and a soft cap
 * or a token cap at this level would be a second number for an operator to
 * reason about with nothing reading it.
 * @param opts - Which account, and the cap.
 * @param opts.accountId - `tenant_account.id`.
 * @param opts.hardCentsLimit - Whole cents per calendar month, or null for no cap.
 */
export async function setAccountCap(opts: { accountId: string; hardCentsLimit: number | null }): Promise<AccountCapStatus> {
  const row = await getOrCreateBudget(opts.accountId, ACCOUNT_SCOPE_SLUG, ACCOUNT_CAP_PERIOD);
  await db
    .update(agentBudgetSchema)
    .set({ hardCentsLimit: opts.hardCentsLimit })
    .where(eq(agentBudgetSchema.id, row.id));
  return accountCapStatus(opts.accountId);
}

/* ------------------------------------------------------------------ */
/* The daily ledger                                                    */
/* ------------------------------------------------------------------ */

/**
 * Spend per workspace over the last `days` UTC days, today included, read off
 * the daily ledger. Workspaces with nothing recorded are absent from the map.
 * @param orgIds - The workspaces.
 * @param days - How many days back, today counting as one.
 */
export async function spendSince(orgIds: readonly string[], days: number): Promise<Map<string, { spentCents: number; tokens: number }>> {
  const out = new Map<string, { spentCents: number; tokens: number }>();
  if (orgIds.length === 0) {
    return out;
  }
  const rows = await db
    .select({
      orgId: spendDaySchema.orgId,
      microCents: sql<string>`sum(${spendDaySchema.microCents})`,
      tokens: sql<string>`sum(${spendDaySchema.tokens})`,
    })
    .from(spendDaySchema)
    .where(and(
      inArray(spendDaySchema.orgId, [...orgIds]),
      gte(spendDaySchema.day, sql`(now() AT TIME ZONE 'utc')::date - ${Math.max(0, Math.floor(days) - 1)}::int`),
    ))
    .groupBy(spendDaySchema.orgId);
  for (const row of rows) {
    out.set(row.orgId, { spentCents: Number(row.microCents) / MICRO_CENTS_PER_CENT, tokens: Number(row.tokens) });
  }
  return out;
}

/**
 * The first day the ledger holds anything, `YYYY-MM-DD`, or null when it is
 * empty. Spend before migration 0179 was never written to it, so a window that
 * reaches further back than this is a partial total, and says so.
 */
export async function spendLedgerStartedOn(): Promise<string | null> {
  const [row] = await db.select({ first: min(spendDaySchema.day) }).from(spendDaySchema);
  return row?.first ?? null;
}

/* ------------------------------------------------------------------ */
/* Headroom — what the workspace has left to spend this period         */
/* ------------------------------------------------------------------ */

/**
 * What every agent budget in this workspace adds up to, in one reading.
 *
 * Budgets are per agent (`agent_budget`), which answers "may this agent take
 * another turn". It does not answer the question adding a teammate asks:
 * whether the workspace can afford another mouth at all. That is the sum, and
 * this is the one place it is taken, so the hire gate and any page reporting
 * it read the same figures rather than each summing the table its own way.
 *
 * Only rows that declare a cents limit are counted. A workspace that has set
 * no limits has no committed allowance and `committedCents` is 0 — budgets are
 * opt-in, and this reports that honestly rather than inventing a ceiling.
 * @param orgId - The workspace.
 * @param period - `daily` (default) or `monthly`.
 */
export async function workspaceHeadroom(orgId: string, period: BudgetPeriod = 'daily'): Promise<{
  period: BudgetPeriod;
  /** Agents with a budget row in this period. */
  agents: number;
  /** Sum of `softCentsLimit` over the rows that declare one. */
  committedCents: number;
  /** Sum of spend over those same rows. Exact, and carries a fraction. */
  spentCents: number;
  /** `committedCents − spentCents`, floored at nothing — may be negative. */
  headroomCents: number;
  /** True when a soft allowance exists and the period's spend has reached it. */
  overSoft: boolean;
  /** Agent slugs already at or past a HARD cents cap — those cannot run at all. */
  hardStopped: string[];
}> {
  const rows = (await listAgentBudgets(orgId)).filter(r => r.period === period);
  const withSoft = rows.filter(r => r.softCentsLimit !== null);
  const committedCents = withSoft.reduce((sum, r) => sum + (r.softCentsLimit ?? 0), 0);
  const spentCents = withSoft.reduce((sum, r) => sum + r.currentCents, 0);
  const hardStopped = rows
    // Compared in micro-cents, the same way `breachOf` decides a refusal, so
    // this list cannot disagree with what actually gets refused.
    .filter(r => r.hardCentsLimit !== null && r.currentMicroCents >= r.hardCentsLimit * MICRO_CENTS_PER_CENT)
    .map(r => r.agentSlug)
    .sort();
  return {
    period,
    agents: rows.length,
    committedCents,
    spentCents,
    headroomCents: committedCents - spentCents,
    overSoft: committedCents > 0 && spentCents >= committedCents,
    hardStopped,
  };
}

/**
 * Delete an agent's budget row for a period. Used by the undo of a hire — the
 * allowance was created with the teammate and goes back with them, so an
 * undone hire leaves no row behind to be re-used by a later agent of the same
 * slug.
 * @param opts - The row to remove.
 * @param opts.orgId - The workspace.
 * @param opts.agentSlug - The agent whose allowance goes back.
 * @param opts.period - `daily` (default) or `monthly`.
 */
export async function removeBudget(opts: { orgId: string; agentSlug: string; period?: BudgetPeriod }): Promise<void> {
  const period: BudgetPeriod = opts.period ?? 'daily';
  await db
    .delete(agentBudgetSchema)
    .where(and(
      eq(agentBudgetSchema.orgId, opts.orgId),
      eq(agentBudgetSchema.agentSlug, opts.agentSlug),
      eq(agentBudgetSchema.period, period),
    ));
}

/* ------------------------------------------------------------------ */
/* Agent caps as they apply — what the API and the shell banner read    */
/* ------------------------------------------------------------------ */

/**
 * One agent's budget as it actually applies right now: the cap it is held to
 * (its own or a default), what it has spent against it, and whether its next
 * turn would be refused.
 */
export type AgentBudgetStatus = {
  agentSlug: string;
  agentName: string;
  period: BudgetPeriod;
  /** Spend this period, in cents; carries a fraction. */
  spentCents: number;
  tokens: number;
  /** The hard cents cap in force, or null when there is none at all. */
  hardCentsLimit: number | null;
  /** The hard token cap in force, or null. */
  hardTokenLimit: number | null;
  /** Whose setting the cents cap is. */
  hardCentsLimitFrom: BudgetLimitSource;
  /** `hardCentsLimit − spentCents`, never below zero; null with no cap. */
  remainingCents: number | null;
  /** True when the agent's next turn would be refused by one of its own caps. */
  blocked: boolean;
  /** The refusal the next turn would get, when blocked. */
  breach: Extract<BudgetCheck, { ok: false }> | null;
  /** When this period's counters go back to zero, ISO-8601 UTC. */
  periodResetsAt: string;
};

/**
 * The instant the period that contains `now` ends, in UTC.
 * @param period - daily or monthly.
 * @param now - The moment to measure from.
 */
export function periodEndsAt(period: BudgetPeriod, now: Date): Date {
  if (period === 'daily') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * An agent's counter for a status read: its stored row, rolled into the
 * current period if that ended, or an empty counter when it has none yet.
 * @param stored - The agent's budget row, if it has one.
 * @param agentSlug - The agent.
 */
async function rollStoredOrEmpty(stored: typeof agentBudgetSchema.$inferSelect | undefined, agentSlug: string) {
  return stored ? rollPeriodIfStale(stored) : emptyAgentCounter(agentSlug);
}

/**
 * Every agent in the workspace with the budget it is actually held to.
 *
 * Covers agents that have never been charged and so have no budget row — the
 * very agents a default cap exists for, and the ones a row listing cannot
 * show. Built from {@link withAgentDefaultCaps} and {@link breachOf}, the
 * same two pieces `preflightCheck` refuses with, so what this reports as
 * blocked is exactly what gets refused (by the agent's own scope — the
 * workspace-wide cap is reported by {@link orgUsageTotals}).
 * @param orgId - The workspace.
 * @param period - `daily` (default) or `monthly`.
 */
export async function agentBudgetStatuses(orgId: string, period: BudgetPeriod = 'daily'): Promise<{
  period: BudgetPeriod;
  /** The workspace's default agent cap in cents, when an admin set one (null there means "no default"). */
  workspaceAgentDefaultCents: number | null | undefined;
  /** The deployment's built-in daily default in cents, or null when switched off. */
  builtInAgentDailyCents: number | null;
  agents: AgentBudgetStatus[];
}> {
  const [agents, rows] = await Promise.all([
    db.select({ slug: agentSchema.slug, name: agentSchema.name }).from(agentSchema).where(eq(agentSchema.orgId, orgId)),
    db.select().from(agentBudgetSchema).where(and(eq(agentBudgetSchema.orgId, orgId), eq(agentBudgetSchema.period, period))),
  ]);
  const workspaceAgentDefault = rows.find(row => row.agentSlug === AGENT_DEFAULT_SCOPE_SLUG);
  const bySlug = new Map(rows.map(row => [row.agentSlug, row]));
  const resetsAt = periodEndsAt(period, new Date()).toISOString();

  // Only a row whose period has ended costs a round trip here; they are rolled
  // together rather than one after another.
  const counters = await Promise.all(agents.map(agent => rollStoredOrEmpty(bySlug.get(agent.slug), agent.slug)));
  const statuses: AgentBudgetStatus[] = [];
  for (const [index, agent] of agents.entries()) {
    const counter = counters[index]!;
    const { capped, sources } = withAgentDefaultCaps({ agentRow: counter, workspaceAgentDefault, period });
    const breach = breachOf(capped, 'agent', sources);
    const spent = spentCents(capped);
    statuses.push({
      agentSlug: agent.slug,
      agentName: agent.name,
      period,
      spentCents: spent,
      tokens: capped.currentTokens,
      hardCentsLimit: capped.hardCentsLimit,
      hardTokenLimit: capped.hardTokenLimit,
      hardCentsLimitFrom: sources.cents,
      remainingCents: capped.hardCentsLimit === null ? null : Math.max(0, capped.hardCentsLimit - spent),
      blocked: breach !== null,
      breach,
      periodResetsAt: resetsAt,
    });
  }
  statuses.sort((a, b) => a.agentSlug.localeCompare(b.agentSlug));
  return {
    period,
    workspaceAgentDefaultCents: workspaceAgentDefault ? workspaceAgentDefault.hardCentsLimit : undefined,
    builtInAgentDailyCents: builtInAgentDailyHardCents(),
    agents: statuses,
  };
}
