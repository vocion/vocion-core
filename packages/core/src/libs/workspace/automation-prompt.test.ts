/**
 * Acceptance (discovery-to-proposal plan, phase 3): applying a workspace where
 * ONLY `do.prompt` changed must update the existing automation row. The
 * applier's unchanged-comparison canonicalizes the whole doConfig, so the
 * prompt participates — this test is the tripwire against a field-by-field
 * rewrite that silently drops it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/temporal/client', () => ({
  getTemporalClient: vi.fn(async () => {
    throw new Error('temporal unavailable in tests');
  }),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, automationSchema, missionSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { eq } = await import('drizzle-orm');

const ORG = 'proj_autoprompt';

function writeFixture(prompt: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-auto-prompt-'));
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: autoprompt\n`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents', 'revenue-lead.yaml'), 'slug: revenue-lead\nname: Revenue Lead\nsystemPrompt: You lead revenue ops.\n');
  mkdirSync(join(dir, 'missions'));
  writeFileSync(
    join(dir, 'missions', 'discovery-to-proposal.yaml'),
    'slug: discovery-to-proposal\nname: Discovery to Proposal\ngoal: no discovery call goes unnoticed\nagent: revenue-lead\nautonomyPolicy:\n  level: 2\n',
  );
  mkdirSync(join(dir, 'automations'));
  writeFileSync(
    join(dir, 'automations', 'discovery-sweep.yaml'),
    `slug: discovery-sweep\nname: Discovery-call detection\nagent: revenue-lead\nwhen:\n  schedule: "0 * * * *"\ndo:\n  checkMission: discovery-to-proposal\n  prompt: "${prompt}"\n`,
  );
  return dir;
}

const dirs: string[] = [];

afterAll(async () => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
  await db.delete(automationSchema);
  await db.delete(missionSchema);
  await db.delete(agentSchema);
  await db.delete(workspaceVersionSchema);
});

describe('automation do.prompt through the applier', () => {
  it('creates, no-ops on re-apply, and UPDATES when only the prompt changed', async () => {
    const v1 = writeFixture('Run a detection pass over the last 3 days.');
    dirs.push(v1);

    const first = await applyWorkspace(loadWorkspace(v1), { orgId: ORG, appliedBy: 'vitest' });

    expect(first.errors).toEqual([]);
    expect(first.counts.automations).toEqual({ created: 1, updated: 0, unchanged: 0 });

    const again = await applyWorkspace(loadWorkspace(v1), { orgId: ORG, appliedBy: 'vitest' });

    expect(again.counts.automations).toEqual({ created: 0, updated: 0, unchanged: 1 });

    const v2 = writeFixture('Run a detection pass over the last 7 days.');
    dirs.push(v2);

    const edited = await applyWorkspace(loadWorkspace(v2), { orgId: ORG, appliedBy: 'vitest' });

    expect(edited.counts.automations).toEqual({ created: 0, updated: 1, unchanged: 0 });

    const [row] = await db.select().from(automationSchema).where(eq(automationSchema.slug, 'discovery-sweep'));

    expect((row!.doConfig as { prompt?: string }).prompt).toBe('Run a detection pass over the last 7 days.');
  });
});
