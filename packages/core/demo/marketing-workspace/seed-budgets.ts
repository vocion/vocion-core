/**
 * Budget shell for the marketing team - agent_budget rows with hard caps
 * and pre-flight refusal (already enforced by runAgentDeep). Adjust the
 * caps in one place; re-run to update.
 *
 *   DATABASE_URL=... npx tsx demo/marketing-workspace/seed-budgets.ts --org <projectId>
 *
 * STUB: wire to the real agent_budget schema columns when enabling; caps
 * below are the proposed starting envelope (~$400/mo team total).
 */
export const PROPOSED_BUDGETS_USD_PER_MONTH = {
  marketing_lead: 150, // strategy + reports + coordination
  showcase_builder: 100, // demo builds involve real runs
  content_writer: 75,
  social_producer: 50,
  growth_analyst: 25,
} as const;

console.warn('stub: apply these caps as agent_budget rows for the target org', PROPOSED_BUDGETS_USD_PER_MONTH);
