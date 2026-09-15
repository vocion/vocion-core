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
    expect(inbox.items.find(i => i.title === 'Weekly brief')).toMatchObject({ kind: 'run', agentSlug: 'revenue-lead', detail: 'needs a source', href: expect.stringMatching(/\/dashboard\/missions\/runs\/\d+/) });
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
