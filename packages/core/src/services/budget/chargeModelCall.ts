/**
 * Charge one finished LangChain model call against the org's budget.
 *
 * Every small paid call in the product had the same three lines to write —
 * read `usage_metadata` off the response, turn a model *role* into the model
 * id* that `libs/pricing` can price, charge it — and getting any of the three
 * subtly wrong charged nothing and said nothing. That is how the product ended
 * up with a budget that only saw agent turns (#279), so the three lines live
 * here and a call site spends one.
 *
 * Two things it is strict about:
 *
 *   - **The model id, not the role.** Trace spans are opened with the role
 *     name (`classifier`, `skillTurn`) because that is what the reader wants to
 *     see. `libs/pricing` keys on the id the provider bills under, and an id it
 *     does not recognise prices at zero — so passing the role through would
 *     have every one of these calls cost nothing, silently. The id the response
 *     itself reports wins over the role's configured default, since a model can
 *     be injected for one call or pinned per org.
 *   - **An org or nothing.** A call made outside any tenant has no budget to
 *     land on, and charging a placeholder org would invent spend for a
 *     workspace that did not do it.
 *
 * It never throws. A call that already happened has already been paid for, and
 * failing the person's request because the accounting failed would be the more
 * expensive mistake — but the failure is logged, because a budget that quietly
 * stops counting is the defect this exists to fix.
 */

import type { FeatureName } from '@/libs/Langfuse/features';
import type { ModelRole } from '@/libs/llm';
import { resolvedModelId } from '@/libs/llm';
import { modelIdOf, tokenUsageOf } from '@/libs/llm/usage';

/**
 * Charge what a model response says it cost.
 * @param opts - Who spent it and what came back.
 * @param opts.orgId - Tenant. Nothing is charged when there is none.
 * @param opts.agentSlug - The agent whose turn this was, when there is one.
 * @param opts.feature - The surface this call belongs to.
 * @param opts.role - The model role the call was built with; resolved to the billed model id here.
 * @param opts.response - Whatever `model.invoke()` returned.
 */
export async function chargeModelCall(opts: {
  orgId?: string | null;
  agentSlug?: string;
  feature: FeatureName;
  role: ModelRole;
  response: unknown;
}): Promise<void> {
  if (!opts.orgId) {
    return;
  }
  const usage = tokenUsageOf(opts.response);
  if (!usage) {
    return;
  }
  try {
    // Imported here rather than at the top of the file: `BudgetService` reaches
    // the database handle, which validates the whole environment at import, and
    // this helper is reachable from classifier and tool code that unit tests
    // load with no database configured.
    const { chargeUsage } = await import('@/services/BudgetService');
    await chargeUsage({
      orgId: opts.orgId,
      agentSlug: opts.agentSlug,
      feature: opts.feature,
      model: modelIdOf(opts.response) ?? resolvedModelId(opts.role),
      usage,
    });
  } catch (error) {
    logChargeFailure({
      orgId: opts.orgId,
      feature: opts.feature,
      role: opts.role,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Log a failed charge, loading the logger only when there is something to say.
 *
 * `libs/Logger` validates the whole environment at import, and this module is
 * reachable from tool and classifier code that unit tests import with no
 * database configured. Loading it eagerly turned a logging dependency into an
 * import-time failure for those tests. Same approach, and same reason, as
 * `logWarning` in `libs/retrieval/embedder.ts`.
 * @param properties - What failed and for whom.
 */
function logChargeFailure(properties: Record<string, unknown>): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger.warn('could not charge a model call to the budget', properties))
    // Nothing useful left to do if logging itself is broken.
    .catch(() => {});
}
