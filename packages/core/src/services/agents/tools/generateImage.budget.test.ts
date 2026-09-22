/**
 * What a generated image costs the workspace, and when a cap may refuse one.
 *
 * `gpt-image-1` is the priciest single call an agent can make — output tokens
 * bill at $40 per million against $5 for text input — and an agent loop can ask
 * for one picture after another. Until #279 none of it reached the budget, so a
 * workspace with a hard cap could mint images all day with the budget page
 * showing it under limit.
 *
 * This is one of only two paths a hard cap is allowed to refuse. It refuses by
 * returning a sentence the agent can act on rather than by throwing, so the
 * turn carries on without the picture instead of failing outright.
 *
 * The provider and the artifact store are mocked; the budget is real.
 */
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** One 1024x1024 image, at the token counts `gpt-image-1` reports. */
const generate = vi.fn(async (_prompt: string, _opts?: { size?: string; orgId?: string }) => ({
  png: Buffer.from('not really a png'),
  model: 'gpt-image-1',
  usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
}));

const saveArtifact = vi.fn(async (_input: unknown) => ({ url: 'https://artifacts.test/img.png', bytes: 2048 }));

vi.mock('@/libs/tools/image/registry', () => ({
  getImageProvider: () => ({ name: 'openai', requiredEnv: [], isReady: () => true, generate }),
}));

vi.mock('@/libs/tools/artifacts/store', () => ({
  saveArtifact: (input: unknown) => saveArtifact(input),
}));

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentBudgetSchema } = await import('@/models/Schema');
const { generateImageTool } = await import('./generateImage');
const { featureScopeSlug, getBudget, ORG_SCOPE_SLUG, orgUsageTotals, setLimits } = await import('@/services/BudgetService');

const ORG = 'org_image_budget_test';
const AGENT = 'campaign-lead';

const CONTEXT = { orgId: ORG, agentSlug: AGENT, connectorSources: [] } as unknown as Parameters<typeof generateImageTool>[0];

/**
 * Ask the tool for one image, the way the agent runtime does.
 * @param prompt - What to draw.
 */
async function askForAnImage(prompt: string): Promise<string> {
  const tool = generateImageTool(CONTEXT);
  return await tool.invoke({ prompt }) as string;
}

beforeEach(async () => {
  generate.mockClear();
  saveArtifact.mockClear();
  await db.delete(agentBudgetSchema);
});

afterEach(async () => {
  await db.delete(agentBudgetSchema);
});

describe('charging a generated image', () => {
  it('charges the agent, the tool.image surface and the workspace', async () => {
    await askForAnImage('a barn at dusk');

    const agent = await getBudget({ orgId: ORG, agentSlug: AGENT });
    const surface = await getBudget({ orgId: ORG, agentSlug: featureScopeSlug('tool.image') });
    const totals = await orgUsageTotals({ orgId: ORG });

    // 1M input at 500 cents/M plus 1M output at 4000 cents/M.
    expect(agent?.currentCents).toBe(4500);
    expect(surface?.currentCents).toBe(4500);
    expect(totals.spentCents).toBe(4500);
  });

  it('still returns the image URL to the agent', async () => {
    const answer = await askForAnImage('a barn at dusk');

    expect(answer).toContain('https://artifacts.test/img.png');
  });
});

describe('refusing a generated image', () => {
  it('refuses over the workspace cap without calling the provider or saving anything', async () => {
    await setLimits({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 100 });
    await askForAnImage('the first picture');
    generate.mockClear();
    saveArtifact.mockClear();

    const answer = await askForAnImage('the second picture');

    expect(generate).not.toHaveBeenCalled();
    expect(saveArtifact).not.toHaveBeenCalled();
    expect(answer).toContain('over its spend cap');
  });

  it('names the cap that refused, so the answer says what to raise', async () => {
    await setLimits({ orgId: ORG, agentSlug: AGENT, hardCentsLimit: 100 });
    await askForAnImage('the first picture');

    const answer = await askForAnImage('the second picture');

    expect(answer).toContain(AGENT);
  });

  it('generates freely for a workspace that set no cap', async () => {
    await askForAnImage('the first picture');
    await askForAnImage('the second picture');

    expect(generate).toHaveBeenCalledTimes(2);
  });
});
