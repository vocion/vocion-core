/**
 * The one helper every small paid model call goes through.
 *
 * Nine call sites used to each read `usage_metadata` off the response and open
 * a trace span named after the model ROLE. Charging off that role would have
 * priced every one of them as whatever the role's default happens to be — and
 * `libs/pricing` returns 0 for an id it does not know, so a mistake here costs
 * nothing and says nothing. These tests pin the three decisions the helper
 * makes so that no call site has to make them again.
 *
 * The budget runs against PGlite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentBudgetSchema } = await import('@/models/Schema');
const { chargeModelCall } = await import('./chargeModelCall');
const { featureScopeSlug, getBudget, orgUsageTotals } = await import('@/services/BudgetService');

const ORG = 'org_charge_model_call_test';

/**
 * A model response shaped the way LangChain normalises one.
 * @param modelName - What the provider said it ran, or nothing when it did not say.
 */
function responseFrom(modelName?: string) {
  return {
    content: 'ok',
    usage_metadata: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    ...(modelName ? { response_metadata: { model_name: modelName } } : {}),
  };
}

beforeEach(async () => {
  await db.delete(agentBudgetSchema);
});

afterEach(async () => {
  await db.delete(agentBudgetSchema);
});

describe('which model it prices the call as', () => {
  it('uses the id the response reports, not the role the span was named after', async () => {
    await chargeModelCall({
      orgId: ORG,
      feature: 'feedback.classify',
      role: 'classifier',
      response: responseFrom('claude-sonnet-5'),
    });

    // Sonnet 5: 200 cents in, 1000 out. Haiku — the classifier role's default —
    // would have been 600, and the role name itself would have been 0.
    expect((await orgUsageTotals({ orgId: ORG })).spentCents).toBe(1200);
  });

  it('falls back to the role\'s configured model when the response names none', async () => {
    await chargeModelCall({
      orgId: ORG,
      feature: 'feedback.classify',
      role: 'classifier',
      response: responseFrom(),
    });

    expect((await orgUsageTotals({ orgId: ORG })).spentCents).toBeGreaterThan(0);
  });
});

describe('what it refuses to charge', () => {
  it('charges nothing when there is no org to charge', async () => {
    await chargeModelCall({
      orgId: undefined,
      feature: 'feedback.classify',
      role: 'classifier',
      response: responseFrom('claude-sonnet-5'),
    });

    expect(await db.select().from(agentBudgetSchema)).toHaveLength(0);
  });

  it('charges nothing when the provider reported no usage at all', async () => {
    // "The provider told us nothing" and "the call cost nothing" are different
    // facts; only the second should ever write a zero and mean it.
    await chargeModelCall({
      orgId: ORG,
      feature: 'feedback.classify',
      role: 'classifier',
      response: { content: 'ok' },
    });

    expect(await db.select().from(agentBudgetSchema)).toHaveLength(0);
  });
});

describe('where it lands', () => {
  it('charges the agent as well as the surface when the call belongs to one', async () => {
    await chargeModelCall({
      orgId: ORG,
      agentSlug: 'deal-lead',
      feature: 'chat.chip-synthesis',
      role: 'classifier',
      response: responseFrom('claude-sonnet-5'),
    });

    expect((await getBudget({ orgId: ORG, agentSlug: 'deal-lead' }))?.currentCents).toBe(1200);
    expect((await getBudget({ orgId: ORG, agentSlug: featureScopeSlug('chat.chip-synthesis') }))?.currentCents).toBe(1200);
  });
});
