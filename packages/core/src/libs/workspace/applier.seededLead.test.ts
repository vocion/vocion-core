/**
 * The workspace lead core seeds into a new workspace, through a
 * `workspace:apply`. An apply retires every agent its YAML does not name — and
 * with no agents named at all it used to retire every one — so turning on an
 * app mid-setup (which applies the workspace) would have taken away the agent
 * the person was setting it up with. The seeded lead stays, and stays the
 * lead, until the workspace names a lead of its own.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, playbookSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { ensureWorkspaceLead } = await import('@/services/workspace/workspaceLead');
const { WORKSPACE_LEAD_SLUG } = await import('./workspaceLead');
const { eq } = await import('drizzle-orm');

const ORG = 'proj-seeded-lead-apply';
const dirs: string[] = [];

/**
 * A workspace folder for this project.
 * @param opts - What it authors.
 * @param opts.lead - `lead:` in workspace.yaml, if any.
 * @param opts.agents - The agent slugs it authors.
 */
function folder(opts: { lead?: string; agents?: string[] }): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-seeded-lead-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: Northwind Support\n${opts.lead ? `lead: ${opts.lead}\n` : ''}`);
  mkdirSync(join(dir, 'agents'));
  for (const slug of opts.agents ?? []) {
    writeFileSync(join(dir, 'agents', `${slug}.yaml`), `slug: ${slug}\nname: ${slug}\nsystemPrompt: Write the Friday report.\n`);
  }
  return dir;
}

async function activeOf(slug: string): Promise<string | null | undefined> {
  const [row] = await db.select({ active: agentSchema.active }).from(agentSchema).where(eq(agentSchema.slug, slug));
  return row?.active;
}

async function lead(): Promise<string | null> {
  const [row] = await db.select({ lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, ORG));
  return row?.lead ?? null;
}

beforeEach(async () => {
  await db.delete(agentSchema);
  await db.delete(playbookSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct-seeded-lead', name: 'Northwind', slug: 'northwind-seeded-lead' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-seeded-lead', slug: 'support', name: 'Northwind Support' });
  await ensureWorkspaceLead(ORG);
});

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the seeded workspace lead through an apply', () => {
  it('survives an apply that names no agent at all, and stays the lead', async () => {
    await applyWorkspace(loadWorkspace(folder({})), { orgId: ORG, appliedBy: 'test' });

    expect(await activeOf(WORKSPACE_LEAD_SLUG)).toBe('true');
    expect(await lead()).toBe(WORKSPACE_LEAD_SLUG);
  });

  it('survives an apply that adds agents but names no lead, and stays the lead', async () => {
    await applyWorkspace(loadWorkspace(folder({ agents: ['report-writer'] })), { orgId: ORG, appliedBy: 'test' });

    expect(await activeOf(WORKSPACE_LEAD_SLUG)).toBe('true');
    expect(await activeOf('report-writer')).toBe('true');
    expect(await lead()).toBe(WORKSPACE_LEAD_SLUG);
  });

  it('retires once the workspace names a lead of its own, like any agent its YAML no longer names', async () => {
    await applyWorkspace(loadWorkspace(folder({ lead: 'report-writer', agents: ['report-writer'] })), { orgId: ORG, appliedBy: 'test' });

    expect(await activeOf(WORKSPACE_LEAD_SLUG)).toBe('false');
    expect(await lead()).toBe('report-writer');
  });

  it('comes back, as the lead, once the workspace stops naming its own (a template undone)', async () => {
    await applyWorkspace(loadWorkspace(folder({ lead: 'report-writer', agents: ['report-writer'] })), { orgId: ORG, appliedBy: 'test' });
    await applyWorkspace(loadWorkspace(folder({})), { orgId: ORG, appliedBy: 'test' });

    expect(await activeOf(WORKSPACE_LEAD_SLUG)).toBe('true');
    expect(await activeOf('report-writer')).toBe('false');
    expect(await lead()).toBe(WORKSPACE_LEAD_SLUG);
  });

  it('stays retired when a person retired it themselves', async () => {
    await db.update(agentSchema).set({ active: 'false', pausedAt: new Date() }).where(eq(agentSchema.slug, WORKSPACE_LEAD_SLUG));
    await applyWorkspace(loadWorkspace(folder({})), { orgId: ORG, appliedBy: 'test' });

    expect(await activeOf(WORKSPACE_LEAD_SLUG)).toBe('false');
  });
});
