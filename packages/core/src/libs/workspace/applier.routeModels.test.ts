/**
 * Model candidates for dynamic routing (ADR 0006, phase 2): a workspace's
 * `defaults.routeModels` reaches every agent that names none of its own, an
 * agent's own list wins, and a workspace that names none applies exactly as
 * before. Entries must name an engine or a model.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { RouteModelsSchema } = await import('./schemas');
const { and, eq } = await import('drizzle-orm');

const ORG = 'org_applier_route_models';
const dirs: string[] = [];

const DEFAULTS = 'defaults:\n  routeModels:\n    - model: claude-haiku-4-5-20251001\n      cost: low\n      about: Lookups.\n    - model: claude-sonnet-5-5\n      cost: medium\n';

function writeFixture(defaults: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-applier-route-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: applier-route\n${defaults}`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents', 'plain.yaml'), 'slug: plain\nname: Plain\nsystemPrompt: Be helpful.\n');
  writeFileSync(join(dir, 'agents', 'own.yaml'), 'slug: own\nname: Own\nsystemPrompt: Be helpful.\nharness:\n  routeModels:\n    - model: claude-opus-5-5\n      cost: high\n');
  return dir;
}

async function harnessOf(slug: string) {
  const [row] = await db.select({ h: agentSchema.harnessConfig }).from(agentSchema).where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, slug)));
  return row?.h as { routeModels?: unknown } | null | undefined;
}

afterEach(async () => {
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
  await db.delete(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, ORG));
});

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('workspace apply — routeModels', () => {
  it('gives the workspace list to an agent without one, and leaves an agent\'s own list alone', async () => {
    const result = await applyWorkspace(await loadWorkspace(writeFixture(DEFAULTS)), { orgId: ORG });

    expect(result.errors).toEqual([]);
    expect((await harnessOf('plain'))?.routeModels).toEqual([{ model: 'claude-haiku-4-5-20251001', cost: 'low', about: 'Lookups.' }, { model: 'claude-sonnet-5-5', cost: 'medium' }]);
    expect((await harnessOf('own'))?.routeModels).toEqual([{ model: 'claude-opus-5-5', cost: 'high' }]);
  });

  it('writes no list at all when the workspace names none', async () => {
    await applyWorkspace(await loadWorkspace(writeFixture('')), { orgId: ORG });

    expect((await harnessOf('plain'))?.routeModels).toBeUndefined();
  });

  it('takes an engine or a model, and refuses an entry with neither', () => {
    expect(RouteModelsSchema.safeParse([{ engine: 'openhands' }, { model: 'gpt-5.4-mini', provider: 'openai' }]).success).toBe(true);
    expect(RouteModelsSchema.safeParse([{ cost: 'low' }]).success).toBe(false);
    expect(RouteModelsSchema.safeParse([{ model: 'x', provider: 'vertex' }]).success).toBe(false);
  });
});
