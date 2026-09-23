/**
 * Workspace apply writes the spend caps the YAML declares (#272): an agent's
 * `budget:` block and the workspace's `defaults.agentBudget`.
 *
 * The rule under test is the one that is easy to get wrong in either
 * direction: a written block owns its caps and puts them back on every apply,
 * and a missing block leaves the stored caps alone — so an apply never widens
 * a cap somebody set when they hired the agent.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentBudgetSchema, agentSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { AGENT_DEFAULT_SCOPE_SLUG, getBudget, preflightCheck, setLimits } = await import('@/services/BudgetService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_applier_budgets';
const SLUG = 'probe-agent';

const dirs: string[] = [];

/**
 * A one-agent workspace with optional budget YAML.
 * @param opts - The YAML to add.
 * @param opts.agentBudget - Lines under the agent's `budget:`, or omitted for no block.
 * @param opts.workspaceDefault - The `defaults.agentBudget.dailyCents` value, or omitted for no block.
 */
function writeFixture(opts: { agentBudget?: string; workspaceDefault?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-applier-budgets-'));
  dirs.push(dir);
  const defaults = opts.workspaceDefault === undefined ? '' : `defaults:\n  agentBudget:\n    dailyCents: ${opts.workspaceDefault}\n`;
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: applier-budgets\n${defaults}`);
  mkdirSync(join(dir, 'agents'));
  const budget = opts.agentBudget === undefined ? '' : `budget:\n${opts.agentBudget}`;
  writeFileSync(join(dir, 'agents', `${SLUG}.yaml`), `slug: ${SLUG}\nname: Probe Agent\nsystemPrompt: Be helpful.\n${budget}`);
  return dir;
}

async function apply(opts: { agentBudget?: string; workspaceDefault?: string } = {}) {
  return applyWorkspace(await loadWorkspace(writeFixture(opts)), { orgId: ORG });
}

afterEach(async () => {
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
  await db.delete(agentBudgetSchema).where(eq(agentBudgetSchema.orgId, ORG));
  await db.delete(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, ORG));
});

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('workspace apply — budgets', () => {
  it('writes an agent\'s daily and monthly caps from its YAML', async () => {
    const result = await apply({ agentBudget: '  dailyCents: 5000\n  monthlyCents: 60000\n' });

    expect(result.errors).toEqual([]);
    expect(await getBudget({ orgId: ORG, agentSlug: SLUG, period: 'daily' })).toMatchObject({ hardCentsLimit: 5000, softCentsLimit: 5000 });
    expect(await getBudget({ orgId: ORG, agentSlug: SLUG, period: 'monthly' })).toMatchObject({ hardCentsLimit: 60000 });
  });

  it('puts a written cap back on the next apply after someone changed it by hand', async () => {
    await apply({ agentBudget: '  dailyCents: 5000\n' });
    await setLimits({ orgId: ORG, agentSlug: SLUG, hardCentsLimit: 999_999 });

    await apply({ agentBudget: '  dailyCents: 5000\n' });

    expect((await getBudget({ orgId: ORG, agentSlug: SLUG }))?.hardCentsLimit).toBe(5000);
  });

  it('leaves a cap set at hire alone when the agent\'s YAML has no budget block', async () => {
    await setLimits({ orgId: ORG, agentSlug: SLUG, softCentsLimit: 300, hardCentsLimit: 300 });

    await apply();

    expect((await getBudget({ orgId: ORG, agentSlug: SLUG }))?.hardCentsLimit).toBe(300);
  });

  it('keeps a token cap an admin set when the YAML writes the dollar caps', async () => {
    await setLimits({ orgId: ORG, agentSlug: SLUG, softTokenLimit: 40_000, hardTokenLimit: 50_000 });

    await apply({ agentBudget: '  dailyCents: 5000\n' });

    expect(await getBudget({ orgId: ORG, agentSlug: SLUG })).toMatchObject({ hardCentsLimit: 5000, softTokenLimit: 40_000, hardTokenLimit: 50_000 });
  });

  it('writes the workspace default, which then holds an agent that set no budget of its own', async () => {
    await apply({ workspaceDefault: '500' });

    expect((await getBudget({ orgId: ORG, agentSlug: AGENT_DEFAULT_SCOPE_SLUG }))?.hardCentsLimit).toBe(500);

    await setLimits({ orgId: ORG, agentSlug: SLUG, hardCentsLimit: null });
    await db.update(agentBudgetSchema).set({ currentMicroCents: 600 * 1_000_000 }).where(eq(agentBudgetSchema.agentSlug, SLUG));

    expect(await preflightCheck({ orgId: ORG, agentSlug: SLUG })).toMatchObject({ ok: false, limit: 500, limitFrom: 'workspace_agent_default' });
  });

  it('stores "no default" for `dailyCents: null`, so agents without a budget run unlimited', async () => {
    await apply({ workspaceDefault: 'null' });

    const row = await getBudget({ orgId: ORG, agentSlug: AGENT_DEFAULT_SCOPE_SLUG });

    expect(row).not.toBeNull();
    expect(row?.hardCentsLimit).toBeNull();
  });

  it('writes nothing on a dry run', async () => {
    await applyWorkspace(await loadWorkspace(writeFixture({ agentBudget: '  dailyCents: 5000\n', workspaceDefault: '500' })), { orgId: ORG, dryRun: true });

    expect(await getBudget({ orgId: ORG, agentSlug: SLUG })).toBeNull();
    expect(await getBudget({ orgId: ORG, agentSlug: AGENT_DEFAULT_SCOPE_SLUG })).toBeNull();
  });

  it('refuses a negative cap at load, before anything is written', async () => {
    await expect(async () => loadWorkspace(writeFixture({ agentBudget: '  dailyCents: -1\n' }))).rejects.toThrow(/budget/);
  });
});
