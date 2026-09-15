import type { ThreadContext } from './pageContext';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { askSchema, learningCandidateSchema, projectSchema, teamSchema, tenantAccountSchema } = await import('@/models/Schema');
const { fileFeedback, findBuildTeam, looksLikeBuildTeam, threadTranscript, titleFromFeedback } = await import('./feedbackToWork');

const ORG = 'org_feedback';
const ACCOUNT = 'acct_feedback';

const FEEDBACK = 'you should have had context of the channel, thread, posters and your posted from workspace here.';

const thread: ThreadContext = {
  surface: 'slack',
  channelId: 'GPRIVATE1',
  channelName: 'releases',
  workspaceName: 'Workforce',
  workspaceSlug: 'workforce',
  parentIsOurs: true,
  parent: { author: 'Vocion', text: 'Release 2.80.1 is out.', ours: true },
  announced: { label: 'Release 2.80.1', url: 'https://example.test/releases/2-80-1' },
};

beforeEach(async () => {
  await db.delete(askSchema);
  await db.delete(learningCandidateSchema);
  await db.delete(teamSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Acct', slug: 'acct-feedback' });
  await db.insert(projectSchema).values({ id: ORG, accountId: ACCOUNT, slug: 'workforce', name: 'Workforce' });
});

describe('looksLikeBuildTeam', () => {
  it('reads a team\'s own words rather than needing a flag nobody sets', () => {
    expect(looksLikeBuildTeam({ slug: 'engineering', name: 'Engineering' })).toBe(true);
    expect(looksLikeBuildTeam({ slug: 'core', name: 'Core', goal: 'Ship the product every week' })).toBe(true);
    expect(looksLikeBuildTeam({ slug: 'revenue', name: 'Revenue', goal: 'Close more deals' })).toBe(false);
  });
});

describe('titleFromFeedback', () => {
  it('titles from the person\'s own first sentence, clipped', () => {
    expect(titleFromFeedback(FEEDBACK)).toBe('you should have had context of the channel, thread, posters and your posted fro…');
    expect(titleFromFeedback('  ')).toBe('Feedback from a chat thread');
    expect(titleFromFeedback('x'.repeat(300))).toHaveLength(80);
  });
});

describe('threadTranscript', () => {
  it('carries the thread verbatim, including what the post was announcing', () => {
    const md = threadTranscript(thread, FEEDBACK, 'A Teammate');

    expect(md).toContain('#releases');
    expect(md).toContain('Release 2.80.1 is out.');
    expect(md).toContain('https://example.test/releases/2-80-1');
    expect(md).toContain(FEEDBACK);
  });
});

describe('fileFeedback', () => {
  it('records exactly one candidate and one recommendation, with the three named options', async () => {
    await db.insert(teamSchema).values({ orgId: ORG, projectId: ORG, slug: 'engineering', name: 'Engineering', goal: 'Build the product' });

    const filed = await fileFeedback({
      orgId: ORG,
      feedback: FEEDBACK,
      author: 'A Teammate',
      thread,
      permalink: 'https://example.test/archives/X/p1',
      agentSlug: 'release-lead',
    });

    const candidates = await db.select().from(learningCandidateSchema);
    const asks = await db.select().from(askSchema);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.polarity).toBe('correct');
    // The person's words, not a paraphrase, and the link back to where they said them.
    expect(candidates[0]!.ruleText).toBe(FEEDBACK);
    expect(candidates[0]!.sourceRef).toBe('https://example.test/archives/X/p1');
    expect(candidates[0]!.projectId).toBe(ORG);

    expect(asks).toHaveLength(1);
    expect(asks[0]!.kind).toBe('recommendation');
    expect(asks[0]!.teamSlug).toBe('engineering');
    expect(asks[0]!.title).toBe(titleFromFeedback(FEEDBACK));
    expect(asks[0]!.options.map(o => o.id)).toEqual(['plan-and-start', 'add-to-backlog', 'decline']);
    expect(asks[0]!.options.filter(o => o.recommended).map(o => o.id)).toEqual(['plan-and-start']);
    expect(asks[0]!.contextMd).toContain('Release 2.80.1 is out.');
    expect(asks[0]!.body).toContain('Plan and start');

    // The link a reply pastes: workspace-scoped, never a hard-coded host.
    expect(filed.inboxUrl).toContain(`/w/workforce/dashboard/inbox/${asks[0]!.id}`);
    expect(filed.team).toEqual({ slug: 'engineering', name: 'Engineering' });
    expect(filed.candidateId).toBe(candidates[0]!.id);
  });

  it('files the same message twice as one ask, not two', async () => {
    await db.insert(teamSchema).values({ orgId: ORG, projectId: ORG, slug: 'engineering', name: 'Engineering' });
    const input = { orgId: ORG, feedback: FEEDBACK, author: 'A Teammate', thread, permalink: 'https://example.test/archives/X/p1' };

    await fileFeedback(input);
    await fileFeedback(input);

    expect(await db.select().from(askSchema)).toHaveLength(1);
  });

  it('still records the rule when the workspace has nobody to build it, and says so by returning no ask', async () => {
    await db.insert(teamSchema).values({ orgId: ORG, projectId: ORG, slug: 'revenue', name: 'Revenue', goal: 'Close more deals' });

    const filed = await fileFeedback({ orgId: ORG, feedback: FEEDBACK, author: 'A Teammate', thread });

    expect(await findBuildTeam(ORG)).toBeNull();
    expect(filed.ask).toBeNull();
    expect(filed.inboxUrl).toBeNull();
    expect(await db.select().from(learningCandidateSchema)).toHaveLength(1);
  });
});
