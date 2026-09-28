import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { missionRunSchema, workerRunSchema } = await import('@/models/Schema');
await import('./descriptors');
const { resolvePreview } = await import('./registry');

const ORG = 'org_run_preview';

describe('an engineering run\'s preview', () => {
  it('says where a failed run stopped and why, links its page, and hands over a Claude Code block (Chris, 2026-09-28)', async () => {
    const [run] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'send-engineer', status: 'failed', error: 'verification failed: Claude produced no changes in the working tree', progress: { phase: 'verify', log: ['cloning', 'claude done', 'no diff'] }, input: { task: { task_id: 'send-t194', repo: 'https://github.com/acme/app.git' } }, result: { pr_url: 'https://github.com/acme/app/pull/9' } } as never).returning();
    const doc = await resolvePreview({ type: 'worker_run', id: String(run!.id) }, { orgId: ORG, userId: null });

    expect(doc.href).toBe(`/dashboard/p/runs/${run!.id}`);
    expect(doc.facts).toEqual(expect.arrayContaining([{ label: 'Run', value: `#${run!.id}` }, { label: 'Stopped at', value: 'verify' }]));
    expect(doc.body).toMatch(/^\*\*Stopped at verify\*\* — verification failed: Claude produced no changes/);
    expect(doc.body).toContain('**Fix it from Claude Code**');
    expect(doc.body).toMatch(new RegExp(`Vocion software factory run #${run!.id} failed \\(send-t194\\)`));
    expect(doc.body).toMatch(/Run: \S*\/dashboard\/p\/runs\/\d+/);
    expect(doc.body).toContain('Pull request: https://github.com/acme/app/pull/9');
  });

  it('carries no Claude Code block while a run is healthy', async () => {
    const [run] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'send-engineer', status: 'running', progress: { phase: 'claude' }, input: { task: { task_id: 'send-t200' } } } as never).returning();
    const doc = await resolvePreview({ type: 'worker_run', id: String(run!.id) }, { orgId: ORG, userId: null });

    expect(doc.body ?? '').not.toContain('Fix it from Claude Code');
    expect(doc.facts).toEqual(expect.arrayContaining([{ label: 'Stage', value: 'claude' }]));
  });
});

describe('an agent run\'s preview', () => {
  it('reads as what the run did, never "nothing reads this kind of reference" (Chris, 2026-09-28, run 5507)', async () => {
    const [run] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'contract-red-team-evidence: Every criterion is proven', brief: 'Review PR #71 against its contract.', status: 'failed', error: 'one or more tasks failed', team: { lead: 'change-reviewer', members: [] }, plan: { tasks: [{ title: 'Review the change', status: 'failed', ownerAgentSlug: 'change-reviewer', error: 'overloaded_error' }] } } as never).returning();
    const doc = await resolvePreview({ type: 'mission_run', id: String(run!.id) }, { orgId: ORG, userId: null });

    expect(doc.unresolved).toBeUndefined();
    expect(doc.title).toBe('contract-red-team-evidence: Every criterion is proven');
    expect(doc.href).toBe(`/dashboard/missions/runs/${run!.id}`);
    expect(doc.body).toContain('**1. Review the change** — failed · change-reviewer');
    expect(doc.body).toContain('**Fix it from Claude Code**');
  });
});
