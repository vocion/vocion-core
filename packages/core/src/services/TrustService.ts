/**
 * TrustService — the EXECUTION side of the trust ladder.
 *
 * The capture side already exists: every approve/reject on a proposed
 * action becomes a learning rule. This is the payoff: once an operator
 * trusts an action class, an ENABLED rule `{actionId, threshold}` lets
 * proposals whose confidence clears the threshold execute without waiting
 * in the review queue — fully audited (`proposal.autoApproved`), visible in
 * Review's "Executed automatically" section, and reversible by disabling
 * the rule.
 *
 * Authored in `workspace/<org>/trust.yaml`. No rules (the default) means
 * every external action rides the review queue.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { trustRuleSchema } from '@/models/Schema';

export type TrustDecision
  = | { auto: false; reason: 'no-rule' | 'disabled' | 'below-threshold' | 'no-confidence' }
    | { auto: true; threshold: number };

/**
 * Should this proposal execute without human review?
 * @param orgId
 * @param actionId
 * @param confidence
 */
export async function trustDecision(
  orgId: string,
  actionId: string,
  confidence: number | undefined,
): Promise<TrustDecision> {
  if (typeof confidence !== 'number') {
    return { auto: false, reason: 'no-confidence' };
  }
  const [rule] = await db
    .select()
    .from(trustRuleSchema)
    .where(and(eq(trustRuleSchema.orgId, orgId), eq(trustRuleSchema.actionId, actionId)))
    .limit(1);
  if (!rule) {
    return { auto: false, reason: 'no-rule' };
  }
  if (rule.enabled !== 'true') {
    return { auto: false, reason: 'disabled' };
  }
  if (confidence < rule.threshold) {
    return { auto: false, reason: 'below-threshold' };
  }
  return { auto: true, threshold: rule.threshold };
}

export function listTrustRules(orgId: string) {
  return db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, orgId));
}
