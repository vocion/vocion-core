import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));

const { db } = await import('@/libs/DB');
const { askSchema, learningCandidateSchema, missionRunSchema, workerRunSchema } = await import('@/models/Schema');
const { upsertAsk, decideAsk, normaliseOptions } = await import('@/services/AskService');
const { needsYou, needsYouCount } = await import('@/services/InboxService');

const ORG = 'org_inbox_test';

beforeEach(async () => {
  await db.delete(askSchema);
  await db.delete(missionRunSchema);
  await db.delete(workerRunSchema);
  await db.delete(learningCandidateSchema);
});

describe('InboxService.needsYou', () => {
  it('lists open asks under their group, collapses a multi-ask group into one sheet row, and skips decided asks', async () => {
    await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Slack granularity?', risk: 'medium' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'Merge #33', groupKey: 'close-out', groupTitle: 'Close-out decisions' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'Merge #35', groupKey: 'close-out', groupTitle: 'Close-out decisions', risk: 'high' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'credential', title: 'Paste the ElevenLabs key', groupKey: 'solo' } });
    const decided = await upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'Post to HN' } });
    await decideAsk({ orgId: ORG, id: decided.ask.id, decision: 'approve', decidedBy: 'u' });
    await upsertAsk({ orgId: 'other_org', ask: { kind: 'ruling', title: 'not mine' } });

    const inbox = await needsYou(ORG);

    expect(inbox.total).toBe(3);
    expect(inbox.counts).toMatchObject({ rulings: 1, merges: 1, inputs: 1, approvals: 0 });

    const sheet = inbox.items.find(i => i.kind === 'sheet');

    expect(sheet).toMatchObject({ title: 'Close-out decisions', count: 2, risk: 'high', href: '/dashboard/inbox/g/close-out', group: 'merges' });

    // A group with one open ask is just an ask.
    expect(inbox.items.find(i => i.title === 'Paste the ElevenLabs key')).toMatchObject({ kind: 'credential', group: 'inputs' });
    expect(inbox.items.map(i => i.title)).not.toContain('Post to HN');
    expect(inbox.items.map(i => i.title)).not.toContain('not mine');
  });

  it('folds paused missions, waiting/failed worker runs and pending rule candidates into runs + learnings', async () => {
    await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Weekly brief', brief: 'b', status: 'paused', pauseReason: 'needs a source', team: { lead: 'revenue-lead', members: [] } });
    await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Done brief', brief: 'b', status: 'completed', team: { lead: 'revenue-lead', members: [] } });
    await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'ceo', status: 'awaiting_review' });
    await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'writer', status: 'failed', error: 'budget' });
    await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'writer', status: 'lost', updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });
    await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'ceo', status: 'completed' });
    await db.insert(learningCandidateSchema).values({ orgId: ORG, stepName: 'editorial', ruleText: 'Cite the file', status: 'pending' });
    await db.insert(learningCandidateSchema).values({ orgId: ORG, stepName: 'editorial', ruleText: 'Old', status: 'rejected' });

    const inbox = await needsYou(ORG);

    expect(inbox.counts.runs).toBe(3);
    expect(inbox.counts.learnings).toBe(1);
    expect(inbox.items.find(i => i.title === 'Weekly brief')).toMatchObject({ kind: 'run', agentSlug: 'revenue-lead', subline: 'needs a source', href: expect.stringMatching(/\/dashboard\/missions\/runs\/\d+/) });
    expect(inbox.items.filter(i => i.kind === 'run' && i.agentSlug === 'writer')).toHaveLength(1); // the 3-day-old lost run is outside the window
    expect(inbox.items.find(i => i.kind === 'learning')).toMatchObject({ title: 'Cite the file', href: '/dashboard/learnings/editorial' });
    expect(await needsYouCount(ORG)).toBe(inbox.total);
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

const { actionRunSchema } = await import('@/models/Schema');
const { listInbox, lastChange } = await import('@/services/InboxService');

describe('InboxService — proposed actions', () => {
  beforeEach(async () => {
    await db.delete(actionRunSchema);
  });

  const day = 24 * 60 * 60 * 1000;

  async function seedActions() {
    const now = Date.now();
    await db.insert(actionRunSchema).values([
      // Three proposals about one deal → one sheet row, oldest age wins.
      { orgId: ORG, actionId: 'hubspot.update', status: 'pending', invokedBy: 'agent:deal-desk', createdAt: new Date(now - 4 * day), input: { objectType: 'deals', objectId: '7781', properties: { dealname: 'Spinutech', dealstage: 'contractsent', amount: '48000' } }, proposal: { confidence: 0.82, agentSlug: 'deal-desk' } },
      { orgId: ORG, actionId: 'hubspot.update', status: 'pending', invokedBy: 'agent:deal-desk', createdAt: new Date(now - 2 * day), input: { objectType: 'deals', objectId: '7781', properties: { dealname: 'Spinutech', hs_next_step: 'Send MSA' } }, proposal: { confidence: 0.6, agentSlug: 'deal-desk' } },
      { orgId: ORG, actionId: 'gmail.send', status: 'pending', invokedBy: 'agent:follow-up-coordinator', createdAt: new Date(now - 1 * day), input: { to: 'ops@spinutech.com', subject: 'MSA attached', body: 'x' }, proposal: { confidence: 0.9, agentSlug: 'follow-up-coordinator' } },
      // One enrollment on its own.
      { orgId: ORG, actionId: 'personalization.enroll', status: 'pending', invokedBy: 'agent:personalization', createdAt: new Date(now - 3 * day), input: { contactRef: 'contacts:1', contactName: 'Jamie Smith', companyName: 'Redpoint IT', sequenceName: 'MSP nurture' }, proposal: { confidence: 0.88, agentSlug: 'personalization' } },
      // Decided, another org, expired: none of these are open rows.
      { orgId: ORG, actionId: 'gmail.send', status: 'done', invokedBy: 'agent:follow-up-coordinator', createdAt: new Date(now - 5 * day), executedAt: new Date(now - 1000), decidedAt: new Date(now - 1000), decidedBy: 'user_chris', input: { to: 'a@b.c', subject: 'Done', body: 'x' }, proposal: {} },
      { orgId: 'other_org', actionId: 'gmail.send', status: 'pending', input: { to: 'x@y.z', body: 'x' }, proposal: {} },
      { orgId: ORG, actionId: 'gmail.send', status: 'pending', expiresAt: new Date(now - 1000), input: { to: 'stale@y.z', body: 'x' }, proposal: {} },
    ] as never);
  }

  it('describes proposals for a person, uses the real created_at, and groups per record', async () => {
    await seedActions();
    const inbox = await listInbox(ORG);

    // Three rows: the deal's sheet, the enrollment, and the email (an address is its own record).
    expect(inbox.tabs).toEqual({ open: 3, snoozed: 0, decided: 0 });

    const [first, second] = inbox.items; // oldest first

    expect(first).toMatchObject({ kind: 'review-sheet', title: 'Spinutech — 2 proposals', count: 2, amount: 48000, confidence: 0.6, href: '/dashboard/inbox/r/hubspot%3Adeals%3A7781' });
    expect(first!.subline).toBe('Spinutech › CRM update › proposed by deal-desk');
    expect(Date.now() - first!.at.getTime()).toBeGreaterThan(3.9 * day);
    expect(second).toMatchObject({ kind: 'review', title: 'Enroll Jamie Smith (Redpoint IT) in MSP nurture', actionId: 'personalization.enroll', confidence: 0.88 });
    expect(inbox.items.map(i => i.title)).not.toContain(expect.stringContaining('stale@'));
    // The email to the deal's address is its own record (an address, not the deal), sorted third.
    expect(inbox.items[2]).toMatchObject({ kind: 'review', actionId: 'gmail.send' });
    expect(inbox.facets.actionKinds.map(k => k.id).sort()).toEqual(['gmail.send', 'hubspot.update', 'personalization.enroll']);
    expect(inbox.facets.agents.map(a => a.slug)).toContain('deal-desk');
  });

  it('searches, filters by kind and agent, and sorts by value / confidence / newest', async () => {
    await seedActions();

    expect((await listInbox(ORG, { q: 'jamie' })).items.map(i => i.actionId)).toEqual(['personalization.enroll']);
    expect((await listInbox(ORG, { kinds: ['gmail.send'] })).items).toHaveLength(1);
    expect((await listInbox(ORG, { agents: ['deal-desk'] })).items.map(i => i.kind)).toEqual(['review-sheet']);
    expect((await listInbox(ORG, { sort: 'value' })).items[0]!.amount).toBe(48000);
    expect((await listInbox(ORG, { sort: 'confidence' })).items[0]!.confidence).toBe(0.9);
    expect((await listInbox(ORG, { sort: 'newest' })).items[0]!.actionId).toBe('gmail.send');
  });

  it('lists decided proposals and asks on the decided tab, and names the last decision in "what changed"', async () => {
    await seedActions();
    const ask = await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Slack granularity?' } });
    await decideAsk({ orgId: ORG, id: ask.ask.id, decision: 'approve', decidedBy: 'user_chris' });

    const decided = await listInbox(ORG, { tab: 'decided' });

    expect(decided.items.map(i => i.title)).toEqual(['Slack granularity?', 'Email a@b.c — Done']);
    expect(decided.items[1]).toMatchObject({ decision: 'approved', decidedBy: 'user_chris' });

    const change = await lastChange(ORG);

    expect(change).toMatchObject({ verb: 'approved', title: 'Slack granularity?', href: `/dashboard/inbox/${ask.ask.id}` });
    expect(await needsYouCount(ORG)).toBe((await listInbox(ORG)).total);
  });
});
