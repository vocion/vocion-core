import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { missionRunSchema, toolCallSchema, workerRunSchema } = await import('@/models/Schema');
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
    expect(doc.href).toBe(`/dashboard/p/runs/agent-${run!.id}`);
    expect(doc.subtitle).toBe('Stopped — Review the change: overloaded_error');
    expect(doc.steps?.map(s => [s.name, s.status])).toEqual([['Review the change · change-reviewer', 'failed']]);
    expect(doc.more?.map(m => m.title)).toEqual(['Fix it from Claude Code', 'The brief it was given']);
  });

  it('leads with how it ended and what it changed, then its steps, then the brief — in that order (Chris, 2026-09-28, run 5974)', async () => {
    const started = new Date('2026-09-20T10:00:00Z');
    const [run] = await db.insert(missionRunSchema).values({
      orgId: ORG,
      title: 'Triage the export request',
      brief: 'You are the product manager. Your charter: keep the backlog honest.',
      status: 'completed',
      createdAt: started,
      completedAt: new Date('2026-09-20T10:03:12Z'),
      team: { lead: 'product-manager', members: [] },
      plan: { tasks: [
        { id: 't1', title: 'Read the request', status: 'completed', ownerAgentSlug: 'product-manager', startedAt: '2026-09-20T10:00:00Z', endedAt: '2026-09-20T10:01:00Z' },
        { id: 't2', title: 'Write the verdict', status: 'completed', ownerAgentSlug: 'product-manager', startedAt: '2026-09-20T10:01:00Z', endedAt: '2026-09-20T10:03:00Z', output: '## Verdict\n\nFiled request #41 as in scope. It fits the twenty-percent bar.\n\nThe rest of the reasoning follows.' },
      ] },
    } as never).returning();
    const rid = run!.id;
    await db.insert(toolCallSchema).values([
      { orgId: ORG, agentSlug: 'product-manager', tool: 'read_object', input: { id: 41 }, output: '{"id":41}', missionRunId: rid, createdAt: new Date('2026-09-20T10:00:30Z') },
      { orgId: ORG, agentSlug: 'product-manager', tool: 'update_object', input: { object_type: 'request', id: 41, set: { state: 'in_scope' } }, output: 'request #41 "Export a room as a PDF" updated — state written (run #9, confidence 0.9). Done for you; the previous values are on the run and a person can undo it from Review › Decided.', missionRunId: rid, createdAt: new Date('2026-09-20T10:02:00Z') },
      { orgId: ORG, agentSlug: 'product-manager', tool: 'file_ask', input: { title: 'Which rooms first?' }, output: 'Ask #88 filed (question, run #10). A person decides it there.', missionRunId: rid, createdAt: new Date('2026-09-20T10:02:30Z') },
      { orgId: ORG, agentSlug: 'product-manager', tool: 'update_object', input: { object_type: 'request', id: 42, set: {} }, error: 'boom', output: null, missionRunId: rid, createdAt: new Date('2026-09-20T10:02:40Z') },
    ] as never);
    const doc = await resolvePreview({ type: 'mission_run', id: String(rid) }, { orgId: ORG, userId: null });

    expect(doc.href).toBe(`/dashboard/p/runs/agent-${rid}`);
    // How it ended: its final report's first lines.
    expect(doc.subtitle).toBe('Verdict Filed request #41 as in scope. It fits the twenty-percent bar.');
    expect(doc.facts?.slice(0, 3)).toEqual([{ label: 'Status', value: 'Completed' }, { label: 'Took', value: '3m 12s' }, { label: 'Cost', value: 'no cost recorded' }]);
    // What it filed or changed, each a link; a failed call is not a change, a read is not either.
    expect(doc.body).toBe([
      '**What it filed or changed**',
      '',
      '- [Updated request #41 "Export a room as a PDF"](/dashboard/objects/41)',
      '- [Filed ask #88 "Which rooms first?"](/dashboard/inbox/ask%3A88)',
    ].join('\n'));
    // Then its steps, one per task, a line per tool call — none open, nothing failed.
    expect(doc.steps?.map(s => s.name)).toEqual(['Read the request · product-manager', 'Write the verdict · product-manager']);
    expect(doc.steps?.[0]!.lines.some(l => l.text.includes('read_object'))).toBe(true);
    // The brief last, collapsed, and nothing about fixing a healthy run.
    expect(doc.more?.map(m => m.key)).toEqual(['brief']);
    expect(doc.more?.[0]!.body).toContain('Your charter: keep the backlog honest.');
  });

  it('says what it is in words when the run is not there', async () => {
    const doc = await resolvePreview({ type: 'mission_run', id: '999999' }, { orgId: ORG, userId: null });

    expect(doc.title).toBe('Agent run #999999');
    expect(doc.href).toBe('/dashboard/p/runs/agent-999999');
    expect(doc.unresolved?.retryable).toBeUndefined();
  });
});
