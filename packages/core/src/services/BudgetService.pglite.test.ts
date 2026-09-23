/**
 * BudgetService against a real database.
 *
 * The rules under test are the ones #279 turned into a spend control rather
 * than a per-agent allowance: where a non-agent call's spend lands, that the
 * workspace-wide cap can refuse work the agent's own cap would have allowed,
 * that fractions of a cent accumulate instead of rounding up per call, and that
 * usage is recorded for an org that set no cap at all.
 *
 * On PGlite rather than a stub, because the charge is one `INSERT … ON CONFLICT
 * DO UPDATE` whose period rollover is decided by `date_trunc` inside the
 * statement. A hand-written mock would assert the shape of the query we wrote
 * and prove nothing about what it does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentBudgetSchema } = await import('@/models/Schema');
const { agentSchema } = await import('@/models/Schema');
const {
  AGENT_DEFAULT_SCOPE_SLUG,
  agentBudgetStatuses,
  chargeUsage,
  featureScopeSlug,
  getBudget,
  listAgentBudgets,
  listPlatformBudgets,
  ORG_SCOPE_SLUG,
  orgUsageTotals,
  preflightCheck,
  setLimits,
} = await import('@/services/BudgetService');

const ORG = 'org_budget_test';
const AGENT = 'deal-lead';

/** `text-embedding-3-small` at 2 cents per million input tokens. */
const EMBEDDING_MODEL = 'text-embedding-3-small';

/** `claude-haiku-4-5-20251001` at 100 / 500 cents per million. */
const CHAT_MODEL = 'claude-haiku-4-5-20251001';

const savedDefaultCents = process.env.VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS;

beforeEach(async () => {
  await db.delete(agentBudgetSchema);
  await db.delete(agentSchema);
  delete process.env.VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS;
});

afterEach(async () => {
  await db.delete(agentBudgetSchema);
  await db.delete(agentSchema);
  if (savedDefaultCents === undefined) {
    delete process.env.VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS;
  } else {
    process.env.VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS = savedDefaultCents;
  }
});

/**
 * Spend `dollars` on the test agent's chat model: the Haiku price is one
 * dollar per million input tokens, so a million tokens per dollar.
 * @param dollars - How much to charge.
 * @param agentSlug - Whose turn it was.
 */
async function spendOnAgent(dollars: number, agentSlug: string = AGENT): Promise<void> {
  await chargeUsage({ orgId: ORG, agentSlug, model: CHAT_MODEL, usage: { inputTokens: dollars * 1_000_000 } });
}

describe('where a charge lands', () => {
  it('records an agent turn on the agent and on the workspace, and nowhere else', async () => {
    await chargeUsage({
      orgId: ORG,
      agentSlug: AGENT,
      model: CHAT_MODEL,
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });

    const agentRow = await getBudget({ orgId: ORG, agentSlug: AGENT });
    const orgRow = await getBudget({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG });

    expect(agentRow?.currentCents).toBe(100);
    expect(orgRow?.currentCents).toBe(100);
    expect(await listPlatformBudgets(ORG)).toHaveLength(1);
  });

  it('gives a call that belongs to no agent a row of its own, plus the workspace total', async () => {
    await chargeUsage({
      orgId: ORG,
      feature: 'retrieval.embed',
      model: EMBEDDING_MODEL,
      usage: { inputTokens: 50_000_000 },
    });

    const featureRow = await getBudget({ orgId: ORG, agentSlug: featureScopeSlug('retrieval.embed') });
    const orgRow = await getBudget({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG });

    // 50M tokens at 2 cents per million.
    expect(featureRow?.currentCents).toBe(100);
    expect(featureRow?.feature).toBe('retrieval.embed');
    expect(orgRow?.currentCents).toBe(100);
    // The whole point: it is not attributed to any agent.
    expect(await listAgentBudgets(ORG)).toHaveLength(0);
  });

  it('counts a charge once in the workspace total even when it also belongs to an agent', async () => {
    await chargeUsage({
      orgId: ORG,
      agentSlug: AGENT,
      feature: 'tool.image',
      model: 'gpt-image-1',
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });

    const totals = await orgUsageTotals({ orgId: ORG });

    // 500 cents of input + 4000 of output, on the org row exactly once.
    expect(totals.spentCents).toBe(4500);
    expect(totals.tokens).toBe(2_000_000);
  });

  it('records usage for an org that set no cap at all', async () => {
    await chargeUsage({
      orgId: ORG,
      feature: 'retrieval.rerank',
      model: CHAT_MODEL,
      usage: { inputTokens: 1_000_000, outputTokens: 200_000 },
    });

    // No `setLimits` call anywhere above — before #279 this charge was a no-op
    // and the budget page could not say what the workspace had spent.
    const totals = await orgUsageTotals({ orgId: ORG });

    expect(totals.spentCents).toBe(200);
    expect(totals.hardCentsLimit).toBeNull();
  });
});

describe('fractions of a cent', () => {
  it('accumulates small charges instead of rounding each one up to a whole cent', async () => {
    // 50,000 tokens of `text-embedding-3-small` is a tenth of a cent — the size
    // of one embedding batch during a sync. Ten of them is one cent, and the
    // bug this guards against billed it as ten.
    for (let batch = 0; batch < 10; batch++) {
      await chargeUsage({
        orgId: ORG,
        feature: 'retrieval.embed',
        model: EMBEDDING_MODEL,
        usage: { inputTokens: 50_000 },
      });
    }

    const totals = await orgUsageTotals({ orgId: ORG });

    expect(totals.spentCents).toBe(1);
    expect(totals.tokens).toBe(500_000);
  });

  it('reports a spend below a cent as the fraction it is, not as zero', async () => {
    await chargeUsage({
      orgId: ORG,
      feature: 'retrieval.embed',
      model: EMBEDDING_MODEL,
      usage: { inputTokens: 1000 },
    });

    const totals = await orgUsageTotals({ orgId: ORG });

    // A fifth of a hundredth of a cent, reported as itself rather than rounded
    // away to nothing.
    expect(totals.spentCents).toBe(0.002);
    expect(totals.tokens).toBe(1000);
  });
});

describe('what a cap refuses', () => {
  it('refuses a call the agent could afford when the workspace cap is spent', async () => {
    await setLimits({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 50 });
    await chargeUsage({
      orgId: ORG,
      feature: 'retrieval.embed',
      model: EMBEDDING_MODEL,
      usage: { inputTokens: 30_000_000 },
    });

    // The agent has spent nothing and has no cap of its own; the workspace has
    // spent 60 cents of its 50.
    const check = await preflightCheck({ orgId: ORG, agentSlug: AGENT });

    expect(check.ok).toBe(false);

    if (check.ok) {
      throw new Error('expected the workspace cap to refuse');
    }

    expect(check.scope).toBe('org');
    expect(check.agentSlug).toBe(ORG_SCOPE_SLUG);
    expect(check.reason).toBe('hard_cents_exceeded');
  });

  it('refuses one surface without touching the others', async () => {
    await setLimits({ orgId: ORG, agentSlug: featureScopeSlug('retrieval.embed'), hardCentsLimit: 10 });
    await chargeUsage({
      orgId: ORG,
      feature: 'retrieval.embed',
      model: EMBEDDING_MODEL,
      usage: { inputTokens: 10_000_000 },
    });

    const embedding = await preflightCheck({ orgId: ORG, feature: 'retrieval.embed' });
    const rerank = await preflightCheck({ orgId: ORG, feature: 'retrieval.rerank' });

    expect(embedding.ok).toBe(false);
    expect(rerank.ok).toBe(true);
  });

  it('allows the call that lands exactly on the cap and refuses the next one', async () => {
    await setLimits({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 100 });

    expect((await preflightCheck({ orgId: ORG })).ok).toBe(true);

    await chargeUsage({
      orgId: ORG,
      feature: 'retrieval.embed',
      model: EMBEDDING_MODEL,
      usage: { inputTokens: 50_000_000 },
    });

    expect((await preflightCheck({ orgId: ORG })).ok).toBe(false);
  });

  it('names the most specific cap that refused, not just the workspace one', async () => {
    await setLimits({ orgId: ORG, agentSlug: AGENT, hardCentsLimit: 10 });
    await setLimits({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 10 });
    await chargeUsage({ orgId: ORG, agentSlug: AGENT, model: CHAT_MODEL, usage: { inputTokens: 1_000_000 } });

    // Both caps are spent. The answer has to send someone to the agent's cap,
    // which is the one they can raise to let this particular agent run again.
    const check = await preflightCheck({ orgId: ORG, agentSlug: AGENT });

    expect(check.ok).toBe(false);

    if (check.ok) {
      throw new Error('expected a refusal');
    }

    expect(check.scope).toBe('agent');
    expect(check.agentSlug).toBe(AGENT);
  });

  it('refuses once fifty tenth-of-a-cent batches have used the whole five-cent cap', async () => {
    await setLimits({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 5 });
    // 50 batches at a tenth of a cent each: exactly 5 cents, which is the cap.
    for (let batch = 0; batch < 50; batch++) {
      await chargeUsage({
        orgId: ORG,
        feature: 'retrieval.embed',
        model: EMBEDDING_MODEL,
        usage: { inputTokens: 50_000 },
      });
    }

    expect((await preflightCheck({ orgId: ORG })).ok).toBe(false);
  });

  it('lets a workspace a tenth of a cent short of its cap keep going', async () => {
    await setLimits({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 5 });
    // One batch short of the cap — 4.9 cents.
    for (let batch = 0; batch < 49; batch++) {
      await chargeUsage({
        orgId: ORG,
        feature: 'retrieval.embed',
        model: EMBEDDING_MODEL,
        usage: { inputTokens: 50_000 },
      });
    }

    expect((await preflightCheck({ orgId: ORG })).ok).toBe(true);
    // And the displayed number keeps the fraction, so a workspace a tenth of a
    // cent short of its cap reads as that rather than as a whole cent short.
    expect((await orgUsageTotals({ orgId: ORG })).spentCents).toBe(4.9);
  });

  it('lets a workspace with no workspace-wide cap spend however much it likes on non-agent work', async () => {
    await chargeUsage({
      orgId: ORG,
      feature: 'retrieval.embed',
      model: EMBEDDING_MODEL,
      usage: { inputTokens: 50_000_000_000 },
    });

    // $10,000 of embedding, and no default applies to anything but an agent turn.
    expect((await preflightCheck({ orgId: ORG, feature: 'retrieval.embed' })).ok).toBe(true);
  });

  it('keeps one org\'s spend out of another org\'s cap', async () => {
    await setLimits({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 10 });
    await chargeUsage({
      orgId: 'org_somebody_else',
      feature: 'retrieval.embed',
      model: EMBEDDING_MODEL,
      usage: { inputTokens: 50_000_000 },
    });

    expect((await preflightCheck({ orgId: ORG })).ok).toBe(true);
  });
});

describe('period rollover', () => {
  it('starts the new period from the charge that crosses it, not from zero plus the old total', async () => {
    await chargeUsage({
      orgId: ORG,
      feature: 'retrieval.embed',
      model: EMBEDDING_MODEL,
      usage: { inputTokens: 50_000_000 },
    });
    // Back-date the row into yesterday, which is what a daily period looks like
    // the morning after.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.update(agentBudgetSchema).set({ periodStartedAt: yesterday });

    await chargeUsage({
      orgId: ORG,
      feature: 'retrieval.embed',
      model: EMBEDDING_MODEL,
      usage: { inputTokens: 10_000_000 },
    });

    const totals = await orgUsageTotals({ orgId: ORG });

    // 20 cents for today's charge alone — yesterday's 100 is gone, not added to.
    expect(totals.spentCents).toBe(20);
    expect(totals.tokens).toBe(10_000_000);
  });
});

describe('what the dashboard reads', () => {
  it('labels a surface row even when the cap was set before the first charge', async () => {
    // `setLimits` knows the scope but not the feature, so the row it creates
    // starts unlabelled. The first charge fills it in; without that, the
    // breakdown on /dashboard/observability would have a blank name against a
    // real number.
    await setLimits({ orgId: ORG, agentSlug: featureScopeSlug('retrieval.embed'), hardCentsLimit: 5000 });
    await chargeUsage({ orgId: ORG, feature: 'retrieval.embed', model: EMBEDDING_MODEL, usage: { inputTokens: 1_000_000 } });

    const surface = await getBudget({ orgId: ORG, agentSlug: featureScopeSlug('retrieval.embed') });

    expect(surface?.feature).toBe('retrieval.embed');
    expect(surface?.hardCentsLimit).toBe(5000);
  });

  it('never shows a platform scope as one of the workspace\'s agents', async () => {
    await chargeUsage({ orgId: ORG, agentSlug: AGENT, model: CHAT_MODEL, usage: { inputTokens: 1_000_000 } });
    await chargeUsage({ orgId: ORG, feature: 'retrieval.embed', model: EMBEDDING_MODEL, usage: { inputTokens: 1_000_000 } });

    const agents = await listAgentBudgets(ORG);
    const platform = await listPlatformBudgets(ORG);

    expect(agents.map(r => r.agentSlug)).toEqual([AGENT]);
    expect(platform.map(r => r.agentSlug).sort()).toEqual([ORG_SCOPE_SLUG, featureScopeSlug('retrieval.embed')].sort());
  });
});

describe('a charge that hits database trouble', () => {
  it('retries a failed write and records the spend exactly once', async () => {
    const realInsert = db.insert.bind(db);
    let attempts = 0;
    const insert = vi.spyOn(db, 'insert').mockImplementation((table: Parameters<typeof realInsert>[0]) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('connection terminated unexpectedly');
      }
      return realInsert(table);
    });

    await chargeUsage({
      orgId: ORG,
      agentSlug: AGENT,
      model: CHAT_MODEL,
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    insert.mockRestore();

    expect(attempts).toBe(2);

    // One charge's worth, not two: the attempt that threw wrote nothing, so the
    // retry started from the same counters.
    const orgRow = await getBudget({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG });

    expect(orgRow?.currentMicroCents).toBe(100_000_000);
    expect(orgRow?.currentCents).toBe(100);
  });

  it('gives up after a bounded number of attempts and leaves the counters alone', async () => {
    const insert = vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('connection terminated unexpectedly');
    });

    await expect(chargeUsage({
      orgId: ORG,
      agentSlug: AGENT,
      model: CHAT_MODEL,
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    })).rejects.toThrow('connection terminated unexpectedly');

    expect(insert).toHaveBeenCalledTimes(3);

    insert.mockRestore();

    // No row at all: every attempt rolled back, so nothing was half-written.
    const orgRow = await getBudget({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG });

    expect(orgRow).toBeNull();
  });
});

describe('the rows add up', () => {
  it('sums the agent rows to exactly what the workspace row holds', async () => {
    // Three charges that each cost a fraction of a cent. Stored as floored
    // whole cents these all read as 0, and the workspace row disagreed with
    // the sum of the others by the whole amount.
    for (const agentSlug of ['deal-lead', 'scheduler', 'researcher']) {
      await chargeUsage({
        orgId: ORG,
        agentSlug,
        model: EMBEDDING_MODEL,
        usage: { inputTokens: 12_345 },
      });
    }

    const agents = await listAgentBudgets(ORG);
    const workspace = await getBudget({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG });

    expect(agents).toHaveLength(3);
    expect(agents.reduce((total, row) => total + row.currentMicroCents, 0)).toBe(workspace!.currentMicroCents);
    // 12,345 tokens x 2 micro-cents each x 3 agents.
    expect(workspace!.currentMicroCents).toBe(74_070);
    expect(workspace!.currentCents).toBe(0.07407);
  });
});

describe('an agent nobody gave a cap (#272)', () => {
  it('is held to the built-in $100 a day, and the refusal says the default is why', async () => {
    await spendOnAgent(101);

    const check = await preflightCheck({ orgId: ORG, agentSlug: AGENT });

    expect(check).toMatchObject({ ok: false, scope: 'agent', agentSlug: AGENT, limit: 10_000, limitFrom: 'built_in_agent_default' });
  });

  it('runs freely under the built-in default', async () => {
    await spendOnAgent(99);

    expect((await preflightCheck({ orgId: ORG, agentSlug: AGENT })).ok).toBe(true);
  });

  it('takes the workspace default over the built-in one when an admin set it', async () => {
    await setLimits({ orgId: ORG, agentSlug: AGENT_DEFAULT_SCOPE_SLUG, hardCentsLimit: 500 });
    await spendOnAgent(6);

    const check = await preflightCheck({ orgId: ORG, agentSlug: AGENT });

    expect(check).toMatchObject({ ok: false, limit: 500, limitFrom: 'workspace_agent_default' });
  });

  it('runs unlimited when the workspace chose no default', async () => {
    await setLimits({ orgId: ORG, agentSlug: AGENT_DEFAULT_SCOPE_SLUG, hardCentsLimit: null });
    await spendOnAgent(500);

    expect((await preflightCheck({ orgId: ORG, agentSlug: AGENT })).ok).toBe(true);
  });

  it('keeps an agent\'s own cap even when it is higher than the default', async () => {
    await setLimits({ orgId: ORG, agentSlug: AGENT, hardCentsLimit: 20_000 });
    await spendOnAgent(150);

    expect((await preflightCheck({ orgId: ORG, agentSlug: AGENT })).ok).toBe(true);
  });

  it('names the agent\'s own cap as the source when that is what refused', async () => {
    await setLimits({ orgId: ORG, agentSlug: AGENT, hardCentsLimit: 100 });
    await spendOnAgent(2);

    expect(await preflightCheck({ orgId: ORG, agentSlug: AGENT })).toMatchObject({ ok: false, limit: 100, limitFrom: 'own' });
  });

  it('follows the deployment\'s built-in figure, and switches off on `off`', async () => {
    process.env.VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS = '300';
    await spendOnAgent(4);

    expect(await preflightCheck({ orgId: ORG, agentSlug: AGENT })).toMatchObject({ ok: false, limit: 300 });

    process.env.VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS = 'off';

    expect((await preflightCheck({ orgId: ORG, agentSlug: AGENT })).ok).toBe(true);
  });

  it('keeps the built-in figure when the deployment\'s value is a typo, rather than dropping the cap', async () => {
    process.env.VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS = '100 dollars';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await spendOnAgent(101);

    expect(await preflightCheck({ orgId: ORG, agentSlug: AGENT })).toMatchObject({ ok: false, limit: 10_000 });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('puts no built-in default on the monthly period', async () => {
    await chargeUsage({ orgId: ORG, agentSlug: AGENT, model: CHAT_MODEL, usage: { inputTokens: 500_000_000 }, period: 'monthly' });

    expect((await preflightCheck({ orgId: ORG, agentSlug: AGENT, period: 'monthly' })).ok).toBe(true);
  });
});

describe('what GET /api/v1/budgets/agents reads (#272)', () => {
  async function seedAgents(slugs: string[]): Promise<void> {
    await db.insert(agentSchema).values(slugs.map(slug => ({ orgId: ORG, slug, name: `Agent ${slug}`, systemPrompt: 'x' })) as never);
  }

  it('lists an agent that has never spent, with the default cap it is held to', async () => {
    await seedAgents(['fresh-agent']);

    const { agents } = await agentBudgetStatuses(ORG);

    expect(agents).toEqual([expect.objectContaining({
      agentSlug: 'fresh-agent',
      spentCents: 0,
      hardCentsLimit: 10_000,
      hardCentsLimitFrom: 'built_in_agent_default',
      remainingCents: 10_000,
      blocked: false,
    })]);
  });

  it('marks exactly the agents whose next turn would be refused, with the same breach', async () => {
    await seedAgents(['over', 'under']);
    await spendOnAgent(101, 'over');
    await spendOnAgent(5, 'under');

    const { agents } = await agentBudgetStatuses(ORG);
    const over = agents.find(agent => agent.agentSlug === 'over')!;
    const under = agents.find(agent => agent.agentSlug === 'under')!;

    expect(over).toMatchObject({ blocked: true, remainingCents: 0 });
    expect(over.breach).toEqual(await preflightCheck({ orgId: ORG, agentSlug: 'over' }));
    expect(under).toMatchObject({ blocked: false, spentCents: 500, remainingCents: 9_500 });
  });

  it('reports the period ending at the next UTC midnight', async () => {
    await seedAgents(['fresh-agent']);

    const { agents } = await agentBudgetStatuses(ORG);
    const resets = new Date(agents[0]!.periodResetsAt);

    expect(resets.getUTCHours()).toBe(0);
    expect(resets.getTime() - Date.now()).toBeGreaterThan(0);
    expect(resets.getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('tells "no workspace default set" apart from "the workspace chose none"', async () => {
    await seedAgents(['fresh-agent']);

    expect((await agentBudgetStatuses(ORG)).workspaceAgentDefaultCents).toBeUndefined();

    await setLimits({ orgId: ORG, agentSlug: AGENT_DEFAULT_SCOPE_SLUG, hardCentsLimit: null });
    const status = await agentBudgetStatuses(ORG);

    expect(status.workspaceAgentDefaultCents).toBeNull();
    expect(status.agents[0]).toMatchObject({ hardCentsLimit: null, remainingCents: null, blocked: false });
  });
});
