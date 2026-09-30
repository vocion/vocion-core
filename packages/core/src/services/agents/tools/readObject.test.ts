import { describe, expect, it, vi } from 'vitest';

const getBusinessObject = vi.fn();

vi.mock('@/services/BusinessObjectService', () => ({ getBusinessObject: (...a: unknown[]) => getBusinessObject(...a) }));

const loadRecordStatus = vi.fn(async () => ({ ok: false, reason: 'no_report' }) as unknown);

vi.mock('@/services/objects/recordStatus', () => ({ loadRecordStatus: (...a: unknown[]) => (loadRecordStatus as (...x: unknown[]) => unknown)(...a) }));

const { readObjectTool, readObjectTools } = await import('./readObject');

const ctx = (slugs: string[]) => ({ orgId: 'org-1', objectTypeSlugs: slugs }) as never;

describe('read_object', () => {
  it('is absent for an agent with no object types to work with', () => {
    expect(readObjectTools(ctx([]))).toHaveLength(0);
    expect(readObjectTools(ctx(['request']))).toHaveLength(1);
  });

  it('refuses a type the agent was not given', async () => {
    const out = await readObjectTool(ctx(['request'])).invoke({ object_type: 'product', id: 3 });

    expect(out).toContain('does not work with "product"');
  });

  it('returns the record whole — the point of the tool', async () => {
    // lookup_objects caps every value at 120 characters, which is why a lead
    // asked to move six acceptance criteria could see the work and not read it.
    const body = `Acceptance criteria: ${'a fairly long criterion sentence. '.repeat(10)}`;
    getBusinessObject.mockResolvedValue({ id: 3, title: 'Rename', status: 'active', metadata: { body, state: 'building' } });

    const out = await readObjectTool(ctx(['request'])).invoke({ object_type: 'request', id: 3 });
    const parsed = JSON.parse(out as string);

    expect(parsed.body).toBe(body);
    expect(parsed.body.length).toBeGreaterThan(300);
    expect(parsed.state).toBe('building');
    expect(parsed.id).toBe(3);
  });

  it('puts the record\'s history up front, counted and dated, so a cut replay still carries it', async () => {
    // Conversation 364 (2026-09-29): the plan gate fired twice on request
    // #224; the replay cut the read at 1,200 characters, before `recovery`,
    // and the next turn called the true count an invention.
    const line = 'the allowed paths span 3 packages (apps/relay-api, apps/relay-web, apps/relay-site), so an architectural boundary is being crossed';
    const recovery = {
      stage: 'planning',
      line: `Planning — ${line}`,
      limit: 3,
      since: null,
      log: [
        { at: '2026-01-05T03:22:35.309Z', text: 'Filed; the Build card is waiting on a person (action #15).', runId: null },
        { at: '2026-01-05T03:22:41.872Z', text: `Planning first: ${line}.`, runId: null },
        { at: '2026-01-05T03:23:09.195Z', text: `Planning first: ${line}.`, runId: null },
      ],
      attempts: [
        { n: 1, at: '2026-01-05T03:22:41.872Z', kind: 'plan', trigger: 'request', runId: null, taskId: null, line, failure: null },
        { n: 2, at: '2026-01-05T03:23:09.195Z', kind: 'plan', trigger: 'request', runId: null, taskId: null, line, failure: null },
      ],
    };
    getBusinessObject.mockResolvedValue({ id: 24, title: 'Copy link on each row', status: 'approved', metadata: { body: 'b'.repeat(1200), recovery } });

    const out = await readObjectTool(ctx(['request'])).invoke({ object_type: 'request', id: 24 }) as string;
    const parsed = JSON.parse(out);

    expect(parsed.recoverySummary).toMatchObject({ automaticAttempts: 2, byKind: { plan: 2 }, logEntries: 3, stage: 'planning', limit: 3 });
    expect(parsed.recoverySummary.attemptsAt).toEqual(['plan #1 at 2026-01-05T03:22:41.872Z', 'plan #2 at 2026-01-05T03:23:09.195Z']);
    // Before the fields, inside what a 1,200-character replay keeps.
    expect(out.indexOf('"automaticAttempts":2')).toBeGreaterThan(0);
    expect(out.indexOf('plan #2 at')).toBeLessThan(1200);
    // The record itself is still whole.
    expect(parsed.recovery.log).toHaveLength(3);
  });

  it('adds no summary to a record the factory never carried', async () => {
    getBusinessObject.mockResolvedValue({ id: 5, title: 'Plain', status: 'active', metadata: { body: 'x' } });

    expect(JSON.parse(await readObjectTool(ctx(['request'])).invoke({ object_type: 'request', id: 5 }) as string).recoverySummary).toBeUndefined();
  });

  it('says so when the id is not a record here', async () => {
    getBusinessObject.mockResolvedValue(null);

    expect(await readObjectTool(ctx(['request'])).invoke({ object_type: 'request', id: 99 })).toContain('No record #99');
  });

  it('will not read a record as the wrong type', async () => {
    getBusinessObject.mockResolvedValue({ id: 4, title: 'Send', status: 'active', metadata: {}, type: { slug: 'product' } });

    expect(await readObjectTool(ctx(['request', 'product'])).invoke({ object_type: 'request', id: 4 })).toContain('is a "product"');
  });

  it('carries where the record is now — You, Now, Next — when its type has a report page (parity with the page)', async () => {
    getBusinessObject.mockResolvedValue({ id: 265, title: 'Fix header overflow', status: 'active', metadata: { state: 'building' } });
    loadRecordStatus.mockResolvedValueOnce({
      ok: true,
      status: {
        record: { id: 265, objectType: 'request', title: 'Fix header overflow', href: '/dashboard/p/feature/265' },
        stage: { key: 'planning', label: 'Planning', tone: 'info' },
        you: { needsYou: false, line: 'Nothing needs you', why: null, move: null },
        live: { kind: 'planning', label: 'Writing the plan', step: null, runRef: { type: 'mission_run', id: '6414' }, runHref: '/dashboard/p/runs/agent-6414', runLabel: 'Agent run #6414', startedAt: '2026-09-30T10:00:00.000Z', since: 'started' },
        next: 'The build starts when the plan is approved.',
        readAt: '2026-09-30T10:01:30.000Z',
      },
    });

    const parsed = JSON.parse(await readObjectTool(ctx(['request'])).invoke({ object_type: 'request', id: 265 }) as string);

    expect(parsed.liveStatus).toEqual({
      stage: 'Planning',
      you: 'Nothing needs you',
      now: 'Writing the plan · 1 min',
      run: { label: 'Agent run #6414', href: '/dashboard/p/runs/agent-6414', since: '2026-09-30T10:00:00.000Z' },
      next: 'The build starts when the plan is approved.',
    });
  });

  it('carries the delivery facts on their own fields, so a finished run is never read as shipped (backlog 044)', async () => {
    getBusinessObject.mockResolvedValue({ id: 248, title: 'Theme toggle', status: 'active', metadata: { state: 'building' } });
    loadRecordStatus.mockResolvedValueOnce({
      ok: true,
      status: {
        record: { id: 248, objectType: 'request', title: 'Theme toggle', href: '/dashboard/p/feature/248' },
        stage: { key: 'changes', label: 'Changes requested', tone: 'warn' },
        you: { needsYou: true, line: 'Needs you: Review requested changes', why: 'QA proved 5 of 6', move: null },
        live: null,
        next: 'Build again starts the next attempt with what QA found.',
        facts: {
          request: { id: 248, stage: 'changes_asked', recordState: 'building', line: 'Changes asked.' },
          taskId: 301,
          verdict: { value: 'changes', proven: 5, total: 6, commit: 'abc1234', at: null, line: 'QA sent it back: 5 of 6 proven' },
          pullRequest: { url: 'https://github.com/northwind/portal/pull/128', label: 'PR #128', merge: 'not_merged', mergedAt: null, line: 'PR #128 is not merged (nothing records a merge)' },
          ci: { state: 'passed', failedChecks: null, commit: 'abc1234', at: null, line: 'CI passed on PR #128' },
          mergeRule: { runsItself: true, riskClass: 'ui', line: 'This merge (ui) runs itself on its trust rule once QA approves; no card, nobody presses merge' },
          shipped: false,
          next: 'The next attempt builds with what QA found',
        },
        readAt: '2026-09-30T18:00:00.000Z',
      },
    });

    const out = await readObjectTool(ctx(['request'])).invoke({ object_type: 'request', id: 248 }) as string;
    const { facts } = JSON.parse(out).liveStatus;

    expect(facts).toMatchObject({
      request: { id: 248, stage: 'changes_asked', recordState: 'building' },
      attempt: { taskId: 301 },
      verdict: { value: 'changes', proven: 5, total: 6 },
      pullRequest: { merge: 'not_merged' },
      ci: { state: 'passed' },
      mergeRule: { runsItself: true, riskClass: 'ui' },
      shipped: false,
      next: 'The next attempt builds with what QA found',
    });
    // Inside what a cut replay keeps, before the record's own fields.
    expect(out.indexOf('"merge":"not_merged"')).toBeLessThan(1200);
  });
});
