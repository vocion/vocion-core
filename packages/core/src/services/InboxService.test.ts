/**
 * InboxService against PGlite: one list, every kind tagged, the kind chips
 * filter it, sheets collapse per group / per record, the decided tab holds
 * every kind that can be decided, and the proposal queue walks the list's
 * order under the list's filters.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema, learningCandidateSchema, missionRunSchema, workerRunSchema, workflowRunSchema, workflowSchema } = await import('@/models/Schema');
const { upsertAsk, decideAsk, normaliseOptions } = await import('@/services/AskService');
const { autonomyOffers, INBOX_KINDS, listInbox, listProposalQueue, needsYou, needsYouCount } = await import('@/services/InboxService');

const ORG = 'org_inbox_test';
const day = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await db.delete(askSchema);
  await db.delete(actionRunSchema);
  await db.delete(missionRunSchema);
  await db.delete(workerRunSchema);
  await db.delete(workflowRunSchema);
  await db.delete(workflowSchema);
  await db.delete(learningCandidateSchema);
});

async function seedActions() {
  const now = Date.now();
  await db.insert(actionRunSchema).values([
    // Three proposals about one deal → one sheet row, oldest age wins.
    { orgId: ORG, actionId: 'hubspot.update', status: 'pending', invokedBy: 'agent:deal-desk', createdAt: new Date(now - 4 * day), input: { objectType: 'deals', objectId: '7781', properties: { dealname: 'Northwind renewal', dealstage: 'contractsent', amount: '48000' } }, proposal: { confidence: 0.82, agentSlug: 'deal-desk' } },
    { orgId: ORG, actionId: 'hubspot.update', status: 'pending', invokedBy: 'agent:deal-desk', createdAt: new Date(now - 2 * day), input: { objectType: 'deals', objectId: '7781', properties: { dealname: 'Northwind renewal', hs_next_step: 'Send MSA' } }, proposal: { confidence: 0.6, agentSlug: 'deal-desk' } },
    { orgId: ORG, actionId: 'gmail.send', status: 'pending', invokedBy: 'agent:follow-up-coordinator', createdAt: new Date(now - 1 * day), input: { to: 'ops@northwind.example', subject: 'MSA attached', body: 'x' }, proposal: { confidence: 0.9, agentSlug: 'follow-up-coordinator' } },
    // One enrollment on its own.
    { orgId: ORG, actionId: 'personalization.enroll', status: 'pending', invokedBy: 'agent:personalization', createdAt: new Date(now - 3 * day), input: { contactRef: 'contacts:1', contactName: 'Jamie Smith', companyName: 'Contoso Supply', sequenceName: 'MSP nurture' }, proposal: { confidence: 0.88, agentSlug: 'personalization' } },
    // Decided, another org, expired: none of these are open rows.
    { orgId: ORG, actionId: 'gmail.send', status: 'done', invokedBy: 'agent:follow-up-coordinator', createdAt: new Date(now - 5 * day), executedAt: new Date(now - 1000), decidedAt: new Date(now - 1000), decidedBy: 'user_chris', input: { to: 'a@b.c', subject: 'Done', body: 'x' }, proposal: {} },
    { orgId: 'other_org', actionId: 'gmail.send', status: 'pending', input: { to: 'x@y.z', body: 'x' }, proposal: {} },
    { orgId: ORG, actionId: 'gmail.send', status: 'pending', expiresAt: new Date(now - 1000), input: { to: 'stale@y.z', body: 'x' }, proposal: {} },
  ] as never);
}

describe('InboxService — one list, every kind tagged', () => {
  it('tags asks by their kind, collapses a multi-ask group into one sheet row, and skips decided asks', async () => {
    await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Slack granularity?', risk: 'medium' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'Merge #33', groupKey: 'close-out', groupTitle: 'Close-out decisions' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'Merge #35', groupKey: 'close-out', groupTitle: 'Close-out decisions', risk: 'high' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'credential', title: 'Paste the ElevenLabs key', groupKey: 'solo' } });
    const decided = await upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'Post to HN' } });
    await decideAsk({ orgId: ORG, id: decided.ask.id, decision: 'approve', decidedBy: 'u' });
    await upsertAsk({ orgId: 'other_org', ask: { kind: 'ruling', title: 'not mine' } });

    const inbox = await needsYou(ORG);

    expect(inbox.total).toBe(3);
    expect(inbox.counts).toMatchObject({ ruling: 1, merge: 1, credential: 1, approval: 0, proposal: 0 });

    for (const item of inbox.items) {
      expect(INBOX_KINDS).toContain(item.kind);
    }

    const sheet = inbox.items.find(i => i.shape === 'sheet');

    expect(sheet).toMatchObject({ kind: 'merge', title: 'Close-out decisions', count: 2, risk: 'high', href: '/dashboard/inbox/g/close-out' });
    expect(sheet!.ref).toBeUndefined();

    // A group with one open ask is just an ask, at its own address.
    const solo = inbox.items.find(i => i.title === 'Paste the ElevenLabs key')!;

    expect(solo).toMatchObject({ kind: 'credential', shape: 'single', ref: { kind: 'ask', id: solo.askId } });
    expect(solo.href).toBe(`/dashboard/inbox/${solo.askId}`);
    expect(inbox.items.map(i => i.title)).not.toContain('Post to HN');
    expect(inbox.items.map(i => i.title)).not.toContain('not mine');
  });

  it('folds paused missions and workflows, waiting worker runs and pending rule candidates into run + learning rows with kind-prefixed refs', async () => {
    await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Weekly brief', brief: 'b', status: 'paused', pauseReason: 'needs a source', team: { lead: 'revenue-lead', members: [] } });
    await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Review me', brief: 'b', status: 'awaiting_review', team: { lead: 'revenue-lead', members: [] } });
    await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Done brief', brief: 'b', status: 'completed', team: { lead: 'revenue-lead', members: [] } });
    const [wf] = await db.insert(workflowSchema).values({ orgId: ORG, slug: 'weekly-digest', name: 'Weekly digest', trigger: { type: 'manual' }, steps: [] }).returning({ id: workflowSchema.id });
    await db.insert(workflowRunSchema).values({ orgId: ORG, workflowId: wf!.id, status: 'paused', pauseReason: 'approve step 2' });
    await db.insert(workflowRunSchema).values({ orgId: ORG, workflowId: wf!.id, status: 'completed' });
    await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'ceo', status: 'awaiting_review' });
    await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'ceo', status: 'completed' });
    await db.insert(learningCandidateSchema).values({ orgId: ORG, stepName: 'editorial', ruleText: 'Cite the file', status: 'pending' });
    await db.insert(learningCandidateSchema).values({ orgId: ORG, stepName: 'editorial', ruleText: 'Old', status: 'rejected' });

    const inbox = await needsYou(ORG);

    expect(inbox.counts.run).toBe(4);
    expect(inbox.counts.learning).toBe(1);
    expect(inbox.items.find(i => i.title === 'Weekly brief')).toMatchObject({ kind: 'run', agentSlug: 'revenue-lead', subline: 'needs a source', href: expect.stringMatching(/^\/dashboard\/inbox\/mission-\d+$/) });
    expect(inbox.items.find(i => i.title === 'Review me')).toMatchObject({ kind: 'run', status: 'awaiting_review' });
    expect(inbox.items.find(i => i.title.startsWith('Weekly digest'))).toMatchObject({ kind: 'run', subline: 'approve step 2', href: expect.stringMatching(/^\/dashboard\/inbox\/workflow-\d+$/) });
    expect(inbox.items.find(i => i.kind === 'run' && i.agentSlug === 'ceo')!.href).toMatch(/^\/dashboard\/inbox\/worker-\d+$/);
    expect(inbox.items.find(i => i.kind === 'learning')).toMatchObject({ title: 'Cite the file', href: expect.stringMatching(/^\/dashboard\/inbox\/learning-\d+$/) });
    expect(await needsYouCount(ORG)).toBe(inbox.total);
  });

  it('does not list a plain failed or lost run, a failure is a log line, not a decision', async () => {
    await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'writer', status: 'failed', error: 'worker timed out after 300s', input: { taskId: 'T-1' } });
    await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'writer', status: 'lost', input: { taskId: 'T-2' } });

    const inbox = await needsYou(ORG);

    expect(inbox.total).toBe(0);
    expect(inbox.counts.exception).toBe(0);
    expect(await needsYouCount(ORG)).toBe(0);
  });

  it('surfaces a third failure of one task as an exception carrying a recommendation', async () => {
    for (const id of [1, 2, 3]) {
      await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'writer', status: 'failed', error: `attempt ${id}: worker timed out after 300s`, input: { taskId: 'T-1' } });
    }

    const inbox = await needsYou(ORG);
    const exception = inbox.items.find(i => i.kind === 'exception');

    expect(inbox.items).toHaveLength(1);
    expect(exception).toMatchObject({ agentSlug: 'writer', risk: 'high', href: expect.stringMatching(/^\/dashboard\/inbox\/worker-\d+$/) });
    expect(exception!.contract!.recommendation).toBeTruthy();
    expect(exception!.contract!.impactOfDelay).toBeTruthy();
    expect(exception!.contract!.actions.length).toBeGreaterThan(1);
    expect(await needsYouCount(ORG)).toBe(1);
  });

  it('escalates a failure class nothing retries on its first occurrence', async () => {
    await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'writer', status: 'failed', error: 'the worker refused the contract', input: { taskId: 'T-9' } });

    const inbox = await needsYou(ORG);

    expect(inbox.items.filter(i => i.kind === 'exception')).toHaveLength(1);
  });

  it('counts a decision sheet once on the badge, like the page does', async () => {
    await upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'a', groupKey: 'g', options: normaliseOptions(['Yes']) } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'b', groupKey: 'g' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'c' } });

    expect(await needsYouCount(ORG)).toBe(2);
    expect((await needsYou(ORG)).total).toBe(2);
    expect(await needsYouCount('empty_org')).toBe(0);
  });
});

describe('InboxService — proposals', () => {
  it('describes proposals for a person, uses the real created_at, groups per record, and opens single proposals at their own address', async () => {
    await seedActions();
    const inbox = await listInbox(ORG);

    // Three rows: the deal's sheet, the enrollment, and the email (an address is its own record).
    // The decided count is the fixture's one decided row, reported from the
    // OPEN tab — a tab's count says what is behind it, not what the tab you
    // are standing on happened to load (it read 0 here until 2026-09-15).
    expect(inbox.tabs).toEqual({ open: 3, snoozed: 0, decided: 1 });
    expect(inbox.counts.proposal).toBe(3);

    const [first, second] = inbox.items; // oldest first

    // The record's NAME is the title, the count is a tag beside it, and the
    // subline says what the recommendations would DO — never the name a second time.
    // The href is escaped so the proxy cannot drop it (services/inbox/recordKey).
    expect(first).toMatchObject({ kind: 'proposal', shape: 'sheet', title: 'Northwind renewal', titleHint: 'Deal 7781', count: 2, amount: 48000, confidence: 0.6, href: '/dashboard/inbox/r/hubspot~3Adeals~3A7781' });
    expect(first!.subline).toBe('1 field update · 1 next step › recommended by deal-desk');
    expect(Date.now() - first!.at.getTime()).toBeGreaterThan(3.9 * day);
    expect(second).toMatchObject({ kind: 'proposal', shape: 'single', title: 'Enroll Jamie Smith (Contoso Supply) in MSP nurture', actionId: 'personalization.enroll', confidence: 0.88 });
    expect(second!.href).toBe(`/dashboard/inbox/proposal-${second!.reviewId}`);
    expect(second!.ref).toEqual({ kind: 'proposal', id: second!.reviewId });
    expect(inbox.items.map(i => i.title)).not.toContain(expect.stringContaining('stale@'));
    expect(inbox.items[2]).toMatchObject({ kind: 'proposal', actionId: 'gmail.send' });
    expect(inbox.facets.actionKinds.map(k => k.id).sort()).toEqual(['gmail.send', 'hubspot.update', 'personalization.enroll']);
    expect(inbox.facets.agents.map(a => a.slug)).toContain('deal-desk');
  });

  it('filters by kind (counting every kind before the kind filter), action kind and agent; searches; sorts', async () => {
    await seedActions();
    await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Slack granularity?' } });
    await db.insert(learningCandidateSchema).values({ orgId: ORG, stepName: 'editorial', ruleText: 'Cite the file', status: 'pending' });

    const all = await listInbox(ORG);

    expect(all.total).toBe(5);
    expect(all.counts).toMatchObject({ proposal: 3, ruling: 1, learning: 1 });

    const proposals = await listInbox(ORG, { kinds: ['proposal'] });

    expect(proposals.items.every(i => i.kind === 'proposal')).toBe(true);
    expect(proposals.total).toBe(3);
    // The chips keep the other kinds' counts while one is active, so a person can see what else waits.
    expect(proposals.counts).toMatchObject({ proposal: 3, ruling: 1, learning: 1 });

    const two = await listInbox(ORG, { kinds: ['ruling', 'learning'] });

    expect(two.items.map(i => i.kind).sort()).toEqual(['learning', 'ruling']);

    expect((await listInbox(ORG, { q: 'jamie' })).items.map(i => i.actionId)).toEqual(['personalization.enroll']);
    expect((await listInbox(ORG, { actionKinds: ['gmail.send'] })).items).toHaveLength(1);
    expect((await listInbox(ORG, { agents: ['deal-desk'] })).items.map(i => i.shape)).toEqual(['sheet']);
    expect((await listInbox(ORG, { sort: 'value' })).items[0]!.amount).toBe(48000);
    expect((await listInbox(ORG, { sort: 'confidence' })).items[0]!.confidence).toBe(0.9);
    expect((await listInbox(ORG, { sort: 'newest' })).items[0]!.kind).not.toBe('proposal');
  });

  it('walks the proposal queue in list order under the list filters, flattening sheets', async () => {
    await seedActions();

    const queue = await listProposalQueue(ORG);

    // Sheet first (oldest), its two rows oldest-first, then the enrollment, then the email.
    expect(queue.map(q => q.actionId)).toEqual(['hubspot.update', 'hubspot.update', 'personalization.enroll', 'gmail.send']);
    expect(queue[0]!.typeLabel).toBe('HubSpot update');

    expect((await listProposalQueue(ORG, { agents: ['deal-desk'] })).map(q => q.actionId)).toEqual(['hubspot.update', 'hubspot.update']);
    expect((await listProposalQueue(ORG, { sort: 'confidence' }))[0]!.actionId).toBe('gmail.send');
  });

  it('lists decided proposals, asks and rules on the decided tab with who decided and the note', async () => {
    await seedActions();
    const ask = await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Slack granularity?' } });
    await decideAsk({ orgId: ORG, id: ask.ask.id, decision: 'approve', note: 'one app per workspace', decidedBy: 'user_chris' });
    await db.insert(learningCandidateSchema).values({ orgId: ORG, stepName: 'editorial', ruleText: 'Old', status: 'rejected', rejectedReason: 'too vague', decidedBy: 'user_chris', decidedAt: new Date(Date.now() - 60_000) });

    const decided = await listInbox(ORG, { tab: 'decided' });

    expect(decided.items.map(i => i.title)).toEqual(['Slack granularity?', 'Email a@b.c — Done', 'Old']);
    expect(decided.items[0]).toMatchObject({ kind: 'ruling', decision: 'approve', decidedBy: 'user_chris', note: 'one app per workspace' });
    expect(decided.items[1]).toMatchObject({ kind: 'proposal', decision: 'approved', decidedBy: 'user_chris', href: expect.stringMatching(/^\/dashboard\/inbox\/proposal-\d+$/) });
    expect(decided.items[2]).toMatchObject({ kind: 'learning', decision: 'rejected', note: 'too vague' });
    expect(decided.counts).toMatchObject({ ruling: 1, proposal: 1, learning: 1 });
    expect((await listInbox(ORG, { tab: 'decided', kinds: ['learning'] })).items).toHaveLength(1);
    expect(await needsYouCount(ORG)).toBe((await listInbox(ORG)).total);
  });
});

describe('InboxService \u2014 the admission bar', () => {
  it('keeps the decisions and sends the bookkeeping to the policy that covers it', async () => {
    await upsertAsk({ orgId: ORG, ask: { kind: 'recommendation', title: 'Build a two-pane admin panel for Send?' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Admin panel vs. Stamp rename: which goes next?' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'Own the release notes for the observability releases?' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'CRITICAL (check 10): 4 askers waiting 13+ hrs on notes ownership' } });
    await db.insert(actionRunSchema).values([
      { orgId: ORG, actionId: 'objects.update_meta', status: 'pending', invokedBy: 'agent:ranker', input: { objectType: 'request', objectId: '38', properties: { priority: '62' } }, proposal: {} },
    ] as never);

    const inbox = await needsYou(ORG);

    expect(inbox.total).toBe(1);
    expect(inbox.items[0]!.title).toBe('Build a two-pane admin panel for Send?');
    expect(await needsYouCount(ORG)).toBe(1);
  });

  it('folds the related question into the decision and says so on the row', async () => {
    await upsertAsk({ orgId: ORG, ask: { kind: 'recommendation', title: 'Build a two-pane admin panel for Send?' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Admin panel vs. Stamp rename: which goes next?' } });

    const inbox = await needsYou(ORG);

    expect(inbox.total).toBe(1);
    expect(inbox.items[0]!.count).toBe(2);
    expect(inbox.items[0]!.detail).toBe('1 related question folded in');
  });

  it('accounts for everything it did not show, with the policy it ran under', async () => {
    await upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'Own the release notes for the observability releases?' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'CRITICAL (check 10): 4 askers waiting 13+ hrs on the release notes' } });

    const inbox = await needsYou(ORG);

    expect(inbox.items).toEqual([]);
    expect(inbox.reclassified).toHaveLength(2);
    expect(inbox.policyGaps).toEqual([expect.objectContaining({ policy: 'release-notes-have-a-standing-owner', count: 2, chases: 1 })]);
  });

  it('never folds enroll cards into one row: every lead is its own decision, however alike the titles', async () => {
    const now = Date.now();
    await db.insert(actionRunSchema).values([1, 2, 3].map(n => ({
      orgId: ORG,
      actionId: 'personalization.enroll',
      status: 'pending',
      invokedBy: 'agent:personalization',
      createdAt: new Date(now - n * 60_000),
      input: { contactRef: `contacts:${n}`, contactName: `Lead ${n}`, companyName: `Company ${n}`, sequenceName: 'MSP nurture' },
      proposal: { confidence: 0.8, agentSlug: 'personalization' },
    })) as never);
    await upsertAsk({ orgId: ORG, ask: { kind: 'recommendation', title: 'Build a two-pane admin panel for Send?' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Admin panel vs. Stamp rename: which goes next?' } });

    const inbox = await needsYou(ORG);

    expect(inbox.items.filter(i => i.actionId === 'personalization.enroll')).toHaveLength(3);
    expect(inbox.items.filter(i => i.actionId === 'personalization.enroll').every(i => i.count === undefined)).toBe(true);

    // The factory's own fold still holds beside them.
    const asks = inbox.items.filter(i => i.kind !== 'proposal');

    expect(asks).toHaveLength(1);
    expect(asks[0]!.count).toBe(2);
    expect(inbox.total).toBe(4);
    expect(await needsYouCount(ORG)).toBe(4);
  });

  it('reports no reclassification on a tab that is not the open one', async () => {
    await upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'Own the release notes for the observability releases?' } });

    expect((await listInbox(ORG, { tab: 'decided' })).reclassified).toEqual([]);
  });
});

describe('InboxService \u2014 earning autonomy', () => {
  it('offers to stop asking after three routine approvals accepted unchanged', async () => {
    const now = Date.now();
    await db.insert(actionRunSchema).values([0, 1, 2].map(i => ({
      orgId: ORG,
      actionId: 'notify.requester',
      status: 'done',
      invokedBy: 'agent:comms',
      createdAt: new Date(now - (5 - i) * day),
      decidedAt: new Date(now - (4 - i) * day),
      decidedBy: 'user_chris',
      executedAt: new Date(now - (4 - i) * day),
      input: { to: 'asker@example.com', subject: 'Your gap is closed', body: 'x' },
      proposal: {},
    })) as never);

    const { proposals } = await autonomyOffers(ORG);

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.count).toBe(3);
    expect(proposals[0]!.choices.map(c => c.id)).toEqual(['allow-automatically', 'keep-asking']);
  });

  it('keeps asking when a person overruled the class, however many times they approved before', async () => {
    const now = Date.now();
    await db.insert(actionRunSchema).values([
      ...[0, 1, 2].map(i => ({
        orgId: ORG,
        actionId: 'notify.requester',
        status: 'done',
        invokedBy: 'agent:comms',
        createdAt: new Date(now - (6 - i) * day),
        decidedAt: new Date(now - (5 - i) * day),
        decidedBy: 'user_chris',
        executedAt: new Date(now - (5 - i) * day),
        input: { to: 'asker@example.com', subject: 'Your gap is closed', body: 'x' },
        proposal: {},
      })),
      {
        orgId: ORG,
        actionId: 'notify.requester',
        status: 'rejected',
        invokedBy: 'agent:comms',
        createdAt: new Date(now - 2 * day),
        decidedAt: new Date(now - 1 * day),
        decidedBy: 'user_chris',
        input: { to: 'asker@example.com', subject: 'Not this one', body: 'x' },
        proposal: {},
      },
    ] as never);

    const { proposals, holds } = await autonomyOffers(ORG);

    expect(proposals).toEqual([]);
    expect(holds[0]!.reason).toBe('1 of 3 identical decisions so far.');
  });
});
