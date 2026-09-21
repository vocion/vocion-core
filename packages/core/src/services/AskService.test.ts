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

describe('fileAsk — one decision, one durable object', () => {
  const contract = {
    decision: 'Decide whether to ship the board with four requests unanswered.',
    recommendation: 'Hold the release until the four are answered.',
    impactOfDelay: 'Four requests stay blocked and their askers hear nothing.',
    options: [{ id: 'hold', label: 'Hold the release', recommended: true }, { id: 'ship', label: 'Ship anyway' }],
  };

  it('files one ask, then escalates the same group key instead of filing a sibling', async () => {
    const first = await svc.fileAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'CHECK 7: the board cannot be made true', groupKey: 'board:appcurious', agentSlug: 'task-planner', ...contract } });

    expect(first).toMatchObject({ created: true, escalated: false });

    const second = await svc.fileAsk({
      orgId: ORG,
      ask: { kind: 'ruling', title: 'CHECK 10: the board still cannot be made true', groupKey: 'board:appcurious', agentSlug: 'task-planner', ...contract },
      recheck: { note: 'three requests blocked' },
    });

    expect(second).toMatchObject({ created: false, escalated: true });
    expect(second.ask.id).toBe(first.ask.id);

    const all = await svc.listAsks(ORG, { status: 'all' });

    expect(all.total).toBe(1);
    expect(all.items[0]!.history.map(h => h.note)).toEqual(['three requests blocked']);
  });

  it('raises the urgency one step per re-check and never past high', async () => {
    const { ask } = await svc.fileAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'q', groupKey: 'g', ...contract } });

    expect(ask.urgency).toBeNull();

    const notes = ['first request blocked', 'three blocked', 'four blocked', 'five blocked'];
    let urgency: string | null = null;
    for (const note of notes) {
      const again = await svc.fileAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'q', groupKey: 'g', ...contract }, recheck: { note } });
      urgency = again.ask.urgency;
    }

    expect(urgency).toBe('high');

    const [row] = (await svc.listAsks(ORG, { status: 'all' })).items;

    expect(row!.history.map(h => h.note)).toEqual(notes);
  });

  it('does not append the same finding twice — a scheduler running twice is not an escalation', async () => {
    await svc.fileAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'q', groupKey: 'g', ...contract } });
    await svc.fileAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'q', groupKey: 'g', ...contract }, recheck: { note: 'four blocked' } });
    await svc.fileAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'q', groupKey: 'g', ...contract }, recheck: { note: 'four blocked' } });

    const [row] = (await svc.listAsks(ORG, { status: 'all' })).items;

    expect(row!.history).toHaveLength(1);
  });

  it('files a fresh ask once the decision has been answered — a closed decision is not escalated', async () => {
    const { ask } = await svc.fileAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'q', groupKey: 'g', ...contract } });
    await svc.decideAsk({ orgId: ORG, id: ask.id, decision: 'approve', decidedBy: 'u' });

    const again = await svc.fileAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'q', groupKey: 'g', ...contract } });

    expect(again.created).toBe(true);
    expect(again.ask.id).not.toBe(ask.id);
  });

  it('keeps two orgs apart on the same group key', async () => {
    await svc.fileAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'q', groupKey: 'g', ...contract } });
    const other = await svc.fileAsk({ orgId: OTHER_ORG, ask: { kind: 'ruling', title: 'q', groupKey: 'g', ...contract } });

    expect(other.created).toBe(true);
  });
});

describe('fileAsk — the decision contract is a condition of filing', () => {
  it('refuses an ask that does not say what must be decided', async () => {
    await expect(svc.fileAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Have a look at this' } }))
      .rejects.toThrow(/No decision .* investigate until you can present a decision/is);
  });

  it('refuses an ask with no labelled choices', async () => {
    await expect(svc.fileAsk({
      orgId: ORG,
      ask: { kind: 'ruling', title: 'q', decision: 'Decide whether to raise the cap.', recommendation: 'Raise it.', impactOfDelay: 'The task cannot finish.' },
    })).rejects.toThrow(/not a decision, it is a notification/i);
  });

  it('refuses an ask with no recommendation and no reason for having none', async () => {
    await expect(svc.fileAsk({
      orgId: ORG,
      ask: { kind: 'ruling', title: 'q', decision: 'Decide whether to raise the cap.', impactOfDelay: 'x', options: svc.normaliseOptions(['Raise it', 'Leave it']) },
    })).rejects.toThrow(/say what you think should happen, or say why you cannot form a view/i);
  });

  it('files, and reads the contract back off the row', async () => {
    const { ask } = await svc.fileAsk({
      orgId: ORG,
      ask: {
        kind: 'ruling',
        title: 'Raise the cap on the migration task?',
        decision: 'Decide whether to raise the cap on the migration task.',
        recommendation: 'Raise it to $8 and retry.',
        why: ['It failed at the cap three times.'],
        impactOfDelay: 'The migration stays unfinished.',
        options: svc.normaliseOptions([{ label: 'Raise the cap', recommended: true }, 'Leave it and close the task']),
      },
    });

    expect(svc.contractFromAsk(ask)).toMatchObject({
      decision: 'Decide whether to raise the cap on the migration task.',
      recommendation: 'Raise it to $8 and retry.',
      why: ['It failed at the cap three times.'],
      impactOfDelay: 'The migration stays unfinished.',
    });
    expect(svc.contractFromAsk(ask)!.actions.map(a => a.id)).toEqual(['raise-the-cap', 'leave-it-and-close-the-task']);
  });

  it('reads no contract off an ask filed before there was one', async () => {
    const { ask } = await svc.upsertAsk({ orgId: ORG, ask: { kind: 'input', title: 'old row' } });

    expect(svc.contractFromAsk(ask)).toBeNull();
  });
});
