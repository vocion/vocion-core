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
 * Only agent turns get a default. The workspace-wide and per-feature rows stay
 * opt-in, because refusing a search or an ingest over a cap nobody chose would
 * break the product for pennies — see "What a cap may refuse" above.
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
 */

import type { FeatureName } from '@/libs/Langfuse/features';
import type { TokenUsage } from '@/libs/pricing';
import { and, eq, inArray, notLike, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { tokenCostMicroCents, totalTokens } from '@/libs/pricing';
import { agentBudgetSchema, agentSchema } from '@/models/Schema';

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
    .set({ currentTokens: 0, currentMicroCents: 0, periodStartedAt: now })
    .where(eq(agentBudgetSchema.id, row.id))
    .returning();
  return updated!;
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
  return withSpentCents(await maybeResetPeriod(row));
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
  const rows = await db
    .select()
    .from(agentBudgetSchema)
    .where(and(
      eq(agentBudgetSchema.orgId, opts.orgId),
      inArray(agentBudgetSchema.agentSlug, slugs),
      eq(agentBudgetSchema.period, period),
    ));
  const workspaceAgentDefault = rows.find(candidate => candidate.agentSlug === AGENT_DEFAULT_SCOPE_SLUG);

  // Reported in scope order — agent, then feature, then workspace — so the
  // message names the most specific cap that refused.
  for (const target of scopes) {
    const row = rows.find(candidate => candidate.agentSlug === target.slug);
    if (target.scope === 'agent') {
      const { capped, sources } = withAgentDefaultCaps({
        agentRow: row ? await maybeResetPeriod(row) : emptyAgentCounter(target.slug),
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
    const breach = breachOf(await maybeResetPeriod(row), target.scope);
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
 * Lands on up to three rows in one statement: the agent's, the feature's, and
 * always the org-wide one. The rows are created if they do not exist, so usage
 * is recorded whether or not anyone set a cap. Period rollover is decided in
 * the same statement, so a charge that crosses midnight starts the new period
 * rather than adding to the old one.
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

  await writeChargeWithRetry(rows, period, tokens, microCents);
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
 * @param rows - The scope rows this charge lands on.
 * @param period - Which period is being charged.
 * @param tokens - Tokens to add.
 * @param microCents - Money to add, in micro-cents.
 */
async function writeChargeWithRetry(
  rows: Array<typeof agentBudgetSchema.$inferInsert>,
  period: BudgetPeriod,
  tokens: number,
  microCents: number,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CHARGE_ATTEMPTS; attempt++) {
    try {
      await writeCharge(rows, period, tokens, microCents);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < CHARGE_ATTEMPTS) {
        await pause(CHARGE_RETRY_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }
  logUnrecordedSpend({
    orgId: rows[0]?.orgId,
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
 * The charge itself: one statement, so the rows move together and a concurrent
 * charge cannot interleave a read with a write.
 *
 * `stale` is the period rollover — when the row's period began before the
 * current one, the incoming numbers replace the counters instead of adding to
 * them, and the period restarts.
 * @param rows - The scope rows this charge lands on.
 * @param period - Which period is being charged.
 * @param tokens - Tokens to add.
 * @param microCents - Money to add, in micro-cents.
 */
async function writeCharge(
  rows: Array<typeof agentBudgetSchema.$inferInsert>,
  period: BudgetPeriod,
  tokens: number,
  microCents: number,
): Promise<void> {
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
  const current = await Promise.all(rows.map(r => maybeResetPeriod(r)));
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

  const statuses: AgentBudgetStatus[] = [];
  for (const agent of agents) {
    const stored = bySlug.get(agent.slug);
    const counter = stored ? await maybeResetPeriod(stored) : emptyAgentCounter(agent.slug);
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
