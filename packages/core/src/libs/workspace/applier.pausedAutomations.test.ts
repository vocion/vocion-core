/**
 * A person's pause survives `workspace:apply`.
 *
 * `status` is what the YAML says and the applier replaces it every time; the
 * pause lives beside it, and an apply that touched those columns would
 * silently resume something a person stopped. The summary names the hold
 * instead, so an operator reading "applied" knows why the schedule is quiet.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/temporal/client', () => ({
  getTemporalClient: vi.fn(async () => {
    throw new Error('temporal unavailable in tests');
  }),
  automationScheduleIdFor: (orgId: string, slug: string) => `automation-${orgId}-${slug}`,
  AUTOMATION_FIRE_WORKFLOW: 'automationFire',
  VOCION_WORKFLOWS_TASK_QUEUE: 'vocion-workflows',
}));

const { db } = await import('@/libs/DB');
const { agentSchema, automationRunSchema, automationSchema, userSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { pauseAutomation } = await import('@/services/AutomationService');
const { eq } = await import('drizzle-orm');

const ORG = 'proj_paused_apply';

function writeFixture(status: 'active' | 'disabled' = 'active'): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-paused-apply-'));
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: paused\n`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents', 'ops.yaml'), 'slug: ops\nname: Ops\nsystemPrompt: You run ops.\n');
  mkdirSync(join(dir, 'automations'));
  writeFileSync(
    join(dir, 'automations', 'hourly-sweep.yaml'),
    `slug: hourly-sweep\nname: Hourly sweep\nagent: ops\nstatus: ${status}\nwhen:\n  schedule: "0 * * * *"\ndo:\n  job: stub-job\n`,
  );
  writeFileSync(
    join(dir, 'automations', 'on-reply.yaml'),
    'slug: on-reply\nname: On reply\nagent: ops\nwhen:\n  event: prospect.reply\ndo:\n  job: stub-job\n',
  );
  return dir;
}

const dirs: string[] = [];

beforeEach(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(userSchema);
});

afterAll(async () => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(agentSchema);
  await db.delete(userSchema);
  await db.delete(workspaceVersionSchema);
});

describe('apply and a paused automation', () => {
  it('leaves the pause in place and names it in the summary', async () => {
    await db.insert(userSchema).values({ id: 'usr-chris', name: 'Chris', email: 'chris@example.com' });
    const dir = writeFixture();
    dirs.push(dir);
    const first = await applyWorkspace(loadWorkspace(dir), { orgId: ORG, appliedBy: 'vitest' });

    expect(first.errors).toEqual([]);
    expect(first.warnings).toEqual([]);

    const pausedAt = new Date('2026-09-20T15:00:00Z');
    await pauseAutomation(ORG, 'hourly-sweep', { by: { id: 'usr-chris', name: 'Chris' }, note: 'CRM sync is down', now: pausedAt });
    await pauseAutomation(ORG, 'on-reply', { by: { id: 'usr-chris', name: 'Chris' }, now: pausedAt });

    const again = await applyWorkspace(loadWorkspace(dir), { orgId: ORG, appliedBy: 'vitest' });

    expect(again.errors).toEqual([]);
    // The rows were not touched, so they are "unchanged" — and still paused.
    expect(again.counts.automations).toEqual({ created: 0, updated: 0, unchanged: 2 });

    const [sweep] = await db.select().from(automationSchema).where(eq(automationSchema.slug, 'hourly-sweep'));

    expect(sweep).toMatchObject({ status: 'active', pausedAt, pausedBy: 'usr-chris', pausedNote: 'CRM sync is down' });

    const [reply] = await db.select().from(automationSchema).where(eq(automationSchema.slug, 'on-reply'));

    expect(reply).toMatchObject({ pausedAt, pausedBy: 'usr-chris', pausedNote: null });

    expect(again.warnings).toEqual([
      { resource: 'automation', slug: 'hourly-sweep', message: 'paused by Chris at 2026-09-20 15:00 UTC — CRM sync is down; left paused. Resume it from /dashboard/automation/hourly-sweep.' },
      { resource: 'automation', slug: 'on-reply', message: 'paused by Chris at 2026-09-20 15:00 UTC; left paused. Resume it from /dashboard/automation/on-reply.' },
    ]);
  });

  it('keeps the pause when the YAML itself changes — an edit is not a resume', async () => {
    const dir = writeFixture();
    dirs.push(dir);
    await applyWorkspace(loadWorkspace(dir), { orgId: ORG, appliedBy: 'vitest' });
    await pauseAutomation(ORG, 'hourly-sweep', { by: { id: 'usr-chris', name: 'Chris' } });

    const edited = writeFixture('disabled');
    dirs.push(edited);
    const result = await applyWorkspace(loadWorkspace(edited), { orgId: ORG, appliedBy: 'vitest' });

    expect(result.counts.automations.updated).toBe(1);

    const [sweep] = await db.select().from(automationSchema).where(eq(automationSchema.slug, 'hourly-sweep'));

    expect(sweep!.status).toBe('disabled');
    expect(sweep!.pausedBy).toBe('usr-chris');
  });
});
