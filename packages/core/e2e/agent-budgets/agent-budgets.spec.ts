import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';

/**
 * #272 — every agent's cap and spend, end to end over real HTTP.
 *
 * Unit tests cover how the cap in force is decided. This covers what they
 * cannot: that `GET /api/v1/budgets/agents`, called with a real tenant token
 * against the real route and database, lists an agent with no budget at all —
 * the agent a default cap exists for — with the default it runs on, and
 * reports blocked exactly the agents whose next turn would be refused.
 *
 * `request` fixture only; every assertion is on a JSON body.
 *
 * Run with: npx playwright test --project=agent-budgets
 */

type SeedFixtures = { orgId: string; token: string };

const SEED_SCRIPT = 'e2e/agent-budgets/support/seed-agent-budget-fixtures.ts';

type AgentStatus = {
  agentSlug: string;
  spentCents: number;
  hardCentsLimit: number | null;
  hardCentsLimitFrom: string;
  remainingCents: number | null;
  blocked: boolean;
  breach: { reason: string; limit: number; limitFrom: string } | null;
  periodResetsAt: string;
};

function seedFixtures(): SeedFixtures {
  try {
    const output = execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(output.trim().split('\n').at(-1) ?? '') as SeedFixtures;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    if (stderr) {
      process.stderr.write(stderr);
    }
    const reason = stderr.trim().split('\n').at(-1) || (error instanceof Error ? error.message : String(error));
    throw new Error(`${SEED_SCRIPT} failed: ${reason}`);
  }
}

let fixtures: SeedFixtures;

test.beforeAll(() => {
  fixtures = seedFixtures();
});

test('lists every agent with the cap it is held to, and blocks exactly the ones over it', async ({ request }) => {
  const res = await request.get('/api/v1/budgets/agents', { headers: { authorization: `Bearer ${fixtures.token}` } });

  expect(res.status(), await res.text()).toBe(200);

  const body = await res.json() as { period: string; builtInAgentDailyCents: number; agents: AgentStatus[] };
  const bySlug = new Map(body.agents.map(agent => [agent.agentSlug, agent]));

  expect(body.period).toBe('daily');
  expect(body.agents.map(agent => agent.agentSlug)).toEqual(['capped', 'runaway', 'steady']);
  expect(bySlug.get('runaway')).toMatchObject({
    spentCents: 10_100,
    hardCentsLimit: body.builtInAgentDailyCents,
    hardCentsLimitFrom: 'built_in_agent_default',
    remainingCents: 0,
    blocked: true,
    breach: { reason: 'hard_cents_exceeded', limitFrom: 'built_in_agent_default' },
  });
  expect(bySlug.get('steady')).toMatchObject({ spentCents: 500, hardCentsLimitFrom: 'built_in_agent_default', blocked: false, breach: null });
  expect(bySlug.get('capped')).toMatchObject({ hardCentsLimit: 200, hardCentsLimitFrom: 'own', blocked: true, breach: { limit: 200, limitFrom: 'own' } });
  expect(new Date(bySlug.get('steady')!.periodResetsAt).getUTCHours()).toBe(0);
});

test('refuses a caller with no token', async ({ request }) => {
  const res = await request.get('/api/v1/budgets/agents');

  expect(res.status()).toBe(401);
});
