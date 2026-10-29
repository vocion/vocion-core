/**
 * Tool loading (ADR 0009): a workspace's `defaults.toolLoading` reaches every
 * agent that sets none of its own, an agent's own setting wins, and a
 * workspace that sets neither stores nothing, so every turn keeps the
 * `history` behaviour.
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
const { resolveToolLoading } = await import('@/services/agents/toolLoading');
const { and, eq } = await import('drizzle-orm');

const ORG = 'org_applier_tool_loading';
const dirs: string[] = [];

function writeFixture(defaults: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-applier-tools-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: applier-tools\n${defaults}`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents', 'plain.yaml'), 'slug: plain\nname: Plain\nsystemPrompt: Be helpful.\n');
  writeFileSync(join(dir, 'agents', 'own.yaml'), 'slug: own\nname: Own\nsystemPrompt: Be helpful.\nharness:\n  toolLoading: all\n');
  return dir;
}

async function harnessOf(slug: string) {
  const [row] = await db.select({ h: agentSchema.harnessConfig }).from(agentSchema).where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, slug)));
  return row?.h as { toolLoading?: string } | null | undefined;
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

describe('workspace apply: toolLoading', () => {
  it('gives the workspace default to an agent without its own, and leaves an agent\'s own alone', async () => {
    const result = await applyWorkspace(await loadWorkspace(writeFixture('defaults:\n  toolLoading: core\n')), { orgId: ORG });

    expect(result.errors).toEqual([]);
    expect((await harnessOf('plain'))?.toolLoading).toBe('core');
    expect((await harnessOf('own'))?.toolLoading).toBe('all');
  });

  it('stores nothing when the workspace sets nothing, and that runs as history', async () => {
    await applyWorkspace(await loadWorkspace(writeFixture('')), { orgId: ORG });

    const plain = await harnessOf('plain');

    expect(plain?.toolLoading).toBeUndefined();
    expect(resolveToolLoading(plain)).toBe('history');
  });

  it('refuses a mode it does not know', () => {
    expect(() => loadWorkspace(writeFixture('defaults:\n  toolLoading: some\n'))).toThrow(/toolLoading/);
  });
});
