/**
 * Picking our own container must not leave AWS's harness running.
 *
 * The applier provisioned a managed harness for an agent on
 * `aws-managed-harness` and did nothing in the other direction, so an agent
 * moved to `agentcore-container` left its harness `READY` — AWS's harness
 * image, still chargeable, still reachable by anyone holding its ARN — while
 * every actual turn went to our container. Nothing in the app showed it;
 * `Veerio-Life/veerio-vocion` had one sitting live for days, found only by
 * reading the AgentCore console.
 *
 * These tests pin both directions, and pin that an agent which never asked for
 * a harness causes no AgentCore call at all.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const HARNESS_ARN = 'arn:aws:bedrock-agentcore:us-west-2:1234:harness/vocion_probe_agent-AAA';
const syncAgentCoreHarness = vi.fn(async () => HARNESS_ARN);
const deleteAgentCoreHarness = vi.fn(async () => ({ deleted: true, harnessId: 'vocion_probe_agent-AAA' }));

vi.mock('@/services/agents/providers/agentcore', () => ({
  syncAgentCoreHarness: (...args: unknown[]) => syncAgentCoreHarness(...args as []),
  deleteAgentCoreHarness: (...args: unknown[]) => deleteAgentCoreHarness(...args as []),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { and, eq } = await import('drizzle-orm');

const ORG = 'proj_harness_reconcile';
const SLUG = 'probe-agent';

const dirs: string[] = [];

/**
 * A one-agent workspace whose harness block is whatever is passed.
 * @param harnessBlock - YAML lines for the `harness:` block, or '' for none.
 */
function writeFixture(harnessBlock: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-harness-reconcile-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: harness-reconcile\n`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(
    join(dir, 'agents', `${SLUG}.yaml`),
    `slug: ${SLUG}\nname: Probe Agent\nsystemPrompt: Be helpful.\n${harnessBlock}`,
  );
  return dir;
}

/**
 * Apply the workspace whose only agent carries `harnessBlock`.
 * @param harnessBlock
 */
async function apply(harnessBlock: string) {
  const loaded = await loadWorkspace(writeFixture(harnessBlock));
  return applyWorkspace(loaded, { orgId: ORG });
}

/** The stored harness ARN for the probe agent, or undefined if no row. */
async function storedHarnessArn(): Promise<string | null | undefined> {
  const [row] = await db
    .select({ harnessArn: agentSchema.harnessArn })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, SLUG)));
  return row?.harnessArn;
}

afterAll(async () => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
  await db.delete(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, ORG));
});

describe('managed harness reconciliation on apply', () => {
  beforeEach(() => {
    syncAgentCoreHarness.mockClear();
    deleteAgentCoreHarness.mockClear();
  });

  it('touches AgentCore not at all for an agent that never asked for a harness', async () => {
    const result = await apply('harness:\n  runsOn: agentcore-container\n');

    expect(result.errors).toEqual([]);
    expect(syncAgentCoreHarness).not.toHaveBeenCalled();
    expect(deleteAgentCoreHarness).not.toHaveBeenCalled();
    expect(await storedHarnessArn()).toBeFalsy();
  });

  it('provisions and records the ARN when the agent asks for the managed harness', async () => {
    await apply('harness:\n  runsOn: aws-managed-harness\n');

    expect(syncAgentCoreHarness).toHaveBeenCalledWith(ORG, SLUG);
    expect(await storedHarnessArn()).toBe(HARNESS_ARN);
  });

  it('deletes the harness and clears the ARN when the agent moves to our container', async () => {
    await apply('harness:\n  runsOn: aws-managed-harness\n');

    expect(await storedHarnessArn()).toBeTruthy();

    // That first apply legitimately provisioned. Clear here so the assertion
    // below is about the move, not about the setup.
    syncAgentCoreHarness.mockClear();

    const result = await apply('harness:\n  runsOn: agentcore-container\n');

    expect(result.errors).toEqual([]);
    // Addressed by the stored ARN, not by the agent slug, so it can only reach
    // the harness this org's own row points at.
    expect(deleteAgentCoreHarness).toHaveBeenCalledWith(HARNESS_ARN);
    expect(syncAgentCoreHarness).not.toHaveBeenCalled();
    expect(await storedHarnessArn()).toBeNull();
  });

  it('keeps the ARN and records an error when the delete fails, so the next apply retries', async () => {
    await apply('harness:\n  runsOn: aws-managed-harness\n');
    deleteAgentCoreHarness.mockRejectedValueOnce(new Error('AccessDenied on DeleteHarness'));

    const result = await apply('harness:\n  runsOn: in-process\n');

    expect(result.errors).toEqual([
      expect.objectContaining({
        resource: 'agent',
        slug: SLUG,
        message: expect.stringContaining('AccessDenied on DeleteHarness'),
      }),
    ]);
    expect(await storedHarnessArn()).toBe(HARNESS_ARN);
  });
});
