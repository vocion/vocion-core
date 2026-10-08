/**
 * A person's hold on an agent survives `workspace:apply`, and the workspace's
 * org review settings land on the project.
 *
 * Retiring an agent from the org review sets `active = false` and records the
 * hold (`agent.paused_*`). The YAML still says `active: true`, and an apply
 * that wrote it back would undo a person's decision on the next deploy — so
 * apply keeps a held agent inactive and names the hold in its summary, the way
 * it does for a paused automation.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, tenantAccountSchema, userSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { and, eq } = await import('drizzle-orm');

const ORG = 'proj_agent_hold';
const OTHER = 'proj_agent_hold_other';

function writeFixture(orgReview = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-agent-hold-'));
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: hold\n${orgReview}`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents', 'ops.yaml'), 'slug: ops\nname: Ops\nsystemPrompt: You run ops.\n');
  writeFileSync(join(dir, 'agents', 'scout.yaml'), 'slug: scout\nname: Kestrel Scout\nsystemPrompt: You scout accounts.\n');
  return dir;
}

const dirs: string[] = [];

beforeEach(async () => {
  await db.delete(agentSchema);
  await db.delete(userSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct_hold', name: 'Northwind', slug: 'northwind-hold' });
  await db.insert(projectSchema).values([
    { id: ORG, accountId: 'acct_hold', slug: 'hold', name: 'Northwind' },
    { id: OTHER, accountId: 'acct_hold', slug: 'hold-other', name: 'Contoso' },
  ]);
});

afterAll(async () => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
  await db.delete(agentSchema);
  await db.delete(userSchema);
  await db.delete(workspaceVersionSchema);
});

describe('apply and a held agent', () => {
  it('keeps a held agent inactive and names the hold, and leaves the rest alone', async () => {
    await db.insert(userSchema).values({ id: 'usr-lili', name: 'Lili', email: 'lili@example.com' });
    const dir = writeFixture();
    dirs.push(dir);
    await applyWorkspace(loadWorkspace(dir), { orgId: ORG, appliedBy: 'vitest' });

    const pausedAt = new Date('2026-10-05T14:00:00Z');
    await db.update(agentSchema)
      .set({ active: 'false', pausedAt, pausedBy: 'usr-lili', pausedNote: 'Retire Kestrel Scout — no runs in 41 days' })
      .where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, 'scout')));

    const again = await applyWorkspace(loadWorkspace(dir), { orgId: ORG, appliedBy: 'vitest' });

    expect(again.errors).toEqual([]);

    const rows = await db.select().from(agentSchema).where(eq(agentSchema.orgId, ORG));
    const scout = rows.find(r => r.slug === 'scout');
    const ops = rows.find(r => r.slug === 'ops');

    expect(scout).toMatchObject({ active: 'false', pausedAt, pausedBy: 'usr-lili' });
    expect(ops).toMatchObject({ active: 'true', pausedAt: null });
    expect(again.warnings).toContainEqual({
      resource: 'agent',
      slug: 'scout',
      message: 'held by Lili at 2026-10-05 14:00 UTC — Retire Kestrel Scout — no runs in 41 days; left inactive. Undo the run that retired it to bring it back.',
    });
  });

  it('brings the agent back on the next apply once the hold is lifted', async () => {
    const dir = writeFixture();
    dirs.push(dir);
    await applyWorkspace(loadWorkspace(dir), { orgId: ORG, appliedBy: 'vitest' });
    await db.update(agentSchema).set({ active: 'false', pausedAt: new Date(), pausedBy: 'usr-x' }).where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, 'scout')));
    await db.update(agentSchema).set({ pausedAt: null, pausedBy: null, pausedNote: null }).where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, 'scout')));

    await applyWorkspace(loadWorkspace(dir), { orgId: ORG, appliedBy: 'vitest' });

    const [scout] = await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, 'scout')));

    expect(scout!.active).toBe('true');
  });
});

describe('defaults.orgReview', () => {
  it('lands on this workspace\'s project, and an omitted block clears it', async () => {
    const authored = writeFixture('defaults:\n  orgReview:\n    schedule: "0 9 * * 2"\n    idleDays: 21\n    maxProposals: 3\n');
    dirs.push(authored);
    await applyWorkspace(loadWorkspace(authored), { orgId: ORG, appliedBy: 'vitest' });

    const [mine] = await db.select({ orgReview: projectSchema.orgReview }).from(projectSchema).where(eq(projectSchema.id, ORG));
    const [theirs] = await db.select({ orgReview: projectSchema.orgReview }).from(projectSchema).where(eq(projectSchema.id, OTHER));

    expect(mine!.orgReview).toEqual({ schedule: '0 9 * * 2', idleDays: 21, maxProposals: 3 });
    expect(theirs!.orgReview).toBeNull();

    const plain = writeFixture();
    dirs.push(plain);
    await applyWorkspace(loadWorkspace(plain), { orgId: ORG, appliedBy: 'vitest' });

    const [cleared] = await db.select({ orgReview: projectSchema.orgReview }).from(projectSchema).where(eq(projectSchema.id, ORG));

    expect(cleared!.orgReview).toBeNull();
  });

  it('refuses a block it does not understand at load', () => {
    const dir = writeFixture('defaults:\n  orgReview:\n    schedule: weekly\n');
    dirs.push(dir);

    expect(() => loadWorkspace(dir)).toThrow(/schedule must be a 5-field cron/);
  });
});
