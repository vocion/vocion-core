import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { workerRunSchema } = await import('@/models/Schema');
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
