import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [] })) }));

const { db } = await import('@/libs/DB');
const { askSchema } = await import('@/models/Schema');
const svc = await import('@/services/AskService');
const { track } = await import('@/services/adoption/track');
const { enqueue } = await import('@/services/FeedbackWorkerService');
const { emitEvent } = await import('@/services/EventService');

const ORG = 'org_ask_test';
const OTHER_ORG = 'org_ask_other';

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(askSchema);
});

describe('normaliseOptions', () => {
  it('turns bare strings into { id, label } with a slug id, and keeps objects', () => {
    expect(svc.normaliseOptions(['Merge as-is', { id: 'wait', label: 'Wait for CI', description: 'd', recommended: true }])).toEqual([
      { id: 'merge-as-is', label: 'Merge as-is' },
      { id: 'wait', label: 'Wait for CI', description: 'd', recommended: true },
    ]);
    expect(svc.normaliseOptions(undefined)).toEqual([]);
  });

  it('accepts a confidence between 0 and 1 on an option, and refuses anything else', () => {
    expect(svc.normaliseOptions([{ id: 'a', label: 'A', recommended: true, confidence: 0.72 }])).toEqual([
      { id: 'a', label: 'A', recommended: true, confidence: 0.72 },
    ]);
    expect(svc.normaliseOptions([{ id: 'a', label: 'A', confidence: null }])).toEqual([{ id: 'a', label: 'A' }]);
    expect(() => svc.normaliseOptions([{ id: 'a', label: 'A', confidence: 1.2 }])).toThrow(/confidence must be a number between 0 and 1/);
    expect(() => svc.normaliseOptions([{ id: 'a', label: 'A', confidence: '0.9' }])).toThrow(/confidence must be a number/);
  });

  it('refuses two recommended options, duplicate ids, and non-option shapes', () => {
    expect(() => svc.normaliseOptions([{ label: 'a', recommended: true }, { label: 'b', recommended: true }])).toThrow(/at most one/);
    expect(() => svc.normaliseOptions(['Yes', 'yes'])).toThrow(/duplicate option id/);
    expect(() => svc.normaliseOptions([42])).toThrow(/options must be/);
    expect(() => svc.normaliseOptions('nope')).toThrow(/options must be/);
  });
});

describe('upsertAsk', () => {
  it('creates, then updates in place on the same sourceRef without touching status', async () => {
    const first = await svc.upsertAsk({ orgId: ORG, createdBy: 'token:t1', ask: { kind: 'merge', title: 'Merge #33', sourceRef: 'workforce:pr/33', risk: 'low' } });

    expect(first.created).toBe(true);
    expect(first.ask.status).toBe('open');

    await svc.decideAsk({ orgId: ORG, id: first.ask.id, decision: 'approve', decidedBy: 'user_chris' });

    const again = await svc.upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'Merge #33 (rebased)', sourceRef: 'workforce:pr/33', risk: 'medium' } });

    expect(again.created).toBe(false);
    expect(again.ask.id).toBe(first.ask.id);
    expect(again.ask.title).toBe('Merge #33 (rebased)');
    expect(again.ask.risk).toBe('medium');
    // A re-file never reopens a decided ask.
    expect(again.ask.status).toBe('approved');
    expect(again.ask.decision).toBe('approve');
  });

  it('scopes sourceRef uniqueness to the org', async () => {
    const a = await svc.upsertAsk({ orgId: ORG, ask: { kind: 'input', title: 'x', sourceRef: 'shared:1' } });
    const b = await svc.upsertAsk({ orgId: OTHER_ORG, ask: { kind: 'input', title: 'x', sourceRef: 'shared:1' } });

    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.ask.id).not.toBe(b.ask.id);
    expect(await svc.getAsk(ORG, b.ask.id)).toBeNull();
  });
});

describe('upsertAsk — verbosity hint', () => {
  it('warns (never throws) when a title or body is longer than reads well on a phone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await svc.upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Short title', body: 'Short body.' } });

    expect(warn).not.toHaveBeenCalled();

    const { ask } = await svc.upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'T'.repeat(90), body: 'B'.repeat(450), sourceRef: 'workforce:approvals/999' } });

    expect(ask.title).toHaveLength(90);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/verbose ask .*workforce:approvals\/999.*title is 90 chars.*body is 450 chars/);

    warn.mockRestore();
  });
});

describe('listAsks', () => {
  it('defaults to open, filters by decided/exact status, source prefix, kind and group', async () => {
    const open = await svc.upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'r1', sourceRef: 'workforce:a', groupKey: 'g1' } });
    const done = await svc.upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'a1', sourceRef: 'workforce:b' } });
    await svc.upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'a2', sourceRef: 'other:c' } });
    await svc.decideAsk({ orgId: ORG, id: done.ask.id, decision: 'reject', decidedBy: 'u' });

    expect((await svc.listAsks(ORG)).total).toBe(2);
    expect((await svc.listAsks(ORG, { status: 'decided' })).items.map(a => a.id)).toEqual([done.ask.id]);
    expect((await svc.listAsks(ORG, { status: 'rejected' })).total).toBe(1);
    expect((await svc.listAsks(ORG, { status: 'all' })).total).toBe(3);
    expect((await svc.listAsks(ORG, { status: 'all', source: 'workforce:' })).total).toBe(2);
    expect((await svc.listAsks(ORG, { kind: 'ruling' })).items.map(a => a.id)).toEqual([open.ask.id]);
    expect((await svc.listAsks(ORG, { groupKey: 'g1' })).total).toBe(1);
    expect((await svc.listAsks(OTHER_ORG, { status: 'all' })).total).toBe(0);
  });

  it('matches a source prefix literally — % and _ are not wildcards', async () => {
    await svc.upsertAsk({ orgId: ORG, ask: { kind: 'input', title: 'x', sourceRef: 'a_b:1' } });
    await svc.upsertAsk({ orgId: ORG, ask: { kind: 'input', title: 'y', sourceRef: 'aXb:1' } });

    expect((await svc.listAsks(ORG, { source: 'a_b' })).total).toBe(1);
  });
});

describe('decideAsk', () => {
  it('announces the decision as an `ask.decided` event an automation can subscribe to — scalars to filter on, and the records it was about', async () => {
    const { ask } = await svc.upsertAsk({
      orgId: ORG,
      ask: { kind: 'recommendation', title: 'Build #41?', agentSlug: 'product-manager', teamSlug: 'software-factory', groupKey: 'software-factory:batch/2026-09-21', sourceRef: 'software-factory:recommendation/41', objectRefs: svc.normaliseObjectRefs([{ type: 'request', id: 41 }]), options: svc.normaliseOptions([{ id: 'build', label: 'Build it', recommended: true }, 'Decline']) },
    });

    const decided = await svc.decideAsk({ orgId: ORG, id: ask.id, decision: 'build', decidedBy: 'user_chris' });

    // Fire-and-forget: the decision is written and returned first, the event follows.
    await vi.waitFor(() => expect(emitEvent).toHaveBeenCalledTimes(1));

    expect(emitEvent).toHaveBeenCalledWith({
      orgId: ORG,
      type: 'ask.decided',
      payload: {
        askId: ask.id,
        kind: 'recommendation',
        status: 'done',
        decision: 'build',
        followUp: false,
        agentSlug: 'product-manager',
        teamSlug: 'software-factory',
        groupKey: 'software-factory:batch/2026-09-21',
        sourceRef: 'software-factory:recommendation/41',
        // The one non-scalar: what the answer is about, for the subscriber
        // that writes it back onto the request.
        objectRefs: [{ type: 'request', id: '41' }],
        decidedBy: 'user_chris',
        decidedAt: decided.decidedAt!.toISOString(),
      },
      dedupeKey: `ask.decided:${ask.id}`,
      invokedBy: 'user_chris',
    });
  });

  it('maps approve / reject / done, an option id, and other onto status + decision', async () => {
    const mk = async (options: string[] = []) => (await svc.upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'q', options: svc.normaliseOptions(options) } })).ask.id;

    const approved = await svc.decideAsk({ orgId: ORG, id: await mk(), decision: 'approve', decidedBy: 'u' });

    expect(approved).toMatchObject({ status: 'approved', decision: 'approve', decidedBy: 'u', followUp: false });
    expect(approved.decidedAt).toBeInstanceOf(Date);

    expect(await svc.decideAsk({ orgId: ORG, id: await mk(), decision: 'reject', note: 'no', decidedBy: 'u' })).toMatchObject({ status: 'rejected', decisionNote: 'no' });
    expect(await svc.decideAsk({ orgId: ORG, id: await mk(), decision: 'done', decidedBy: 'u' })).toMatchObject({ status: 'done', decision: 'done' });
    expect(await svc.decideAsk({ orgId: ORG, id: await mk(['Wait for CI']), decision: 'wait-for-ci', decidedBy: 'u' })).toMatchObject({ status: 'done', decision: 'wait-for-ci', followUp: false });
  });

  it('accepts "other" only with a note, and flags follow-up on ruling/approval/recommendation', async () => {
    const ruling = (await svc.upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'q' } })).ask.id;
    const merge = (await svc.upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'q' } })).ask.id;

    await expect(svc.decideAsk({ orgId: ORG, id: ruling, decision: 'other', decidedBy: 'u' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });

    expect(await svc.decideAsk({ orgId: ORG, id: ruling, decision: 'other', note: 'Do both, staged.', decidedBy: 'u' })).toMatchObject({ status: 'done', decision: 'other', decisionNote: 'Do both, staged.', followUp: true });
    expect(await svc.decideAsk({ orgId: ORG, id: merge, decision: 'other', note: 'merged by hand', decidedBy: 'u' })).toMatchObject({ decision: 'other', followUp: false });
  });

  it('files the same open question once, refreshed rather than doubled', async () => {
    const first = await svc.upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'Approve build: e2e runner', body: 'v1' } });
    const again = await svc.upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: ' approve build: E2E runner ', body: 'v2' } });

    expect(again.created).toBe(false);
    expect(again.ask.id).toBe(first.ask.id);
    expect(again.ask.body).toBe('v2');
  });

  it('refuses an unknown decision, a second decision, and another org', async () => {
    const id = (await svc.upsertAsk({ orgId: ORG, ask: { kind: 'gate', title: 'q', options: svc.normaliseOptions(['Resume']) } })).ask.id;

    await expect(svc.decideAsk({ orgId: ORG, id, decision: 'maybe', decidedBy: 'u' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    await expect(svc.decideAsk({ orgId: OTHER_ORG, id, decision: 'approve', decidedBy: 'u' })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await svc.decideAsk({ orgId: ORG, id, decision: 'resume', decidedBy: 'u' });

    await expect(svc.decideAsk({ orgId: ORG, id, decision: 'approve', decidedBy: 'u' })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('lands on the adoption stream, and queues a correction with a note for learning', async () => {
    const id = (await svc.upsertAsk({ orgId: ORG, ask: { kind: 'recommendation', title: 'Add a red-team role', agentSlug: 'ceo' } })).ask.id;
    await svc.decideAsk({ orgId: ORG, id, decision: 'reject', note: 'We already grade cross-vendor.', decidedBy: 'user_chris' });

    expect(vi.mocked(track)).toHaveBeenCalledWith(
      { orgId: ORG, userId: 'user_chris' },
      'ask.decided',
      expect.objectContaining({ agentSlug: 'ceo', resource: ['ask', id], meta: { kind: 'recommendation', status: 'rejected', objectRefs: [] } }),
    );
    expect(vi.mocked(enqueue)).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG,
      source: 'ask',
      externalId: `ask:${id}:decision`,
      payload: expect.objectContaining({ agentSlug: 'ceo', polarityHint: 'correct', text: expect.stringContaining('We already grade cross-vendor.') }),
    }));

    // An approve, or a reject with no note, proposes nothing.
    vi.mocked(enqueue).mockClear();
    const plain = (await svc.upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'x' } })).ask.id;
    await svc.decideAsk({ orgId: ORG, id: plain, decision: 'reject', decidedBy: 'u' });

    expect(vi.mocked(enqueue)).not.toHaveBeenCalled();
  });
});

describe('supersedeAsk and notifications', () => {
  it('supersedes an open ask, leaves a decided one alone', async () => {
    const id = (await svc.upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'q' } })).ask.id;

    expect((await svc.supersedeAsk(ORG, id, 'merged on its own')).status).toBe('superseded');

    const decided = (await svc.upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'q2' } })).ask.id;
    await svc.decideAsk({ orgId: ORG, id: decided, decision: 'approve', decidedBy: 'u' });

    expect((await svc.supersedeAsk(ORG, decided)).status).toBe('approved');
  });

  it('lists open, un-notified asks whose notifyAt has passed, and marks them', async () => {
    const now = new Date('2026-09-15T12:00:00Z');
    const due = (await svc.upsertAsk({ orgId: ORG, ask: { kind: 'input', title: 'due' } })).ask.id;
    const later = (await svc.upsertAsk({ orgId: ORG, ask: { kind: 'input', title: 'later', notifyAt: new Date('2026-09-16T00:00:00Z') } })).ask.id;
    const decided = (await svc.upsertAsk({ orgId: ORG, ask: { kind: 'input', title: 'decided' } })).ask.id;
    await svc.decideAsk({ orgId: ORG, id: decided, decision: 'done', decidedBy: 'u' });

    expect((await svc.pendingNotifications({ orgId: ORG, now })).map(a => a.id)).toEqual([due]);

    await svc.markNotified(ORG, [due]);

    expect(await svc.pendingNotifications({ orgId: ORG, now })).toEqual([]);
    expect((await svc.pendingNotifications({ orgId: ORG, now: new Date('2026-09-17T00:00:00Z') })).map(a => a.id)).toEqual([later]);
  });
});
