/**
 * The scorecard's two promises to a client: an agent's confidence average
 * covers exactly the recommendations its agreement rate scores, and an agent
 * with nothing to score shows as "not enough data" — never as 0%, and never
 * by vanishing from the table. PGlite.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, decisionAlignmentSchema } = await import('@/models/Schema');
const { buildScorecardRows, getAgentAlignmentSummaries, getScorecard, noAlignmentYet } = await import('@/services/scorecard/ScorecardService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_scorecard_test';
const OTHER_ORG = 'org_scorecard_other';
const NOW = new Date('2026-09-20T12:00:00Z');
const DAY = 86_400_000;

let nextSubjectId = 1;

async function seedDecision(values: { agentSlug: string | null; recommended: string | null; decision: string; confidence?: number | null; implicit?: boolean; decidedAt?: Date; orgId?: string }) {
  const agreed = values.recommended === null ? null : values.recommended === values.decision;
  await db.insert(decisionAlignmentSchema).values({
    orgId: values.orgId ?? ORG,
    subjectKind: 'action',
    subjectKey: 'test.scorecard',
    subjectId: nextSubjectId++,
    agentSlug: values.agentSlug,
    decision: values.decision,
    recommended: values.recommended,
    implicit: values.implicit ?? false,
    agreed,
    confidence: values.confidence ?? null,
    decidedAt: values.decidedAt ?? new Date(NOW.getTime() - DAY),
  });
}

async function seedAgent(slug: string, name: string, active: 'true' | 'false' = 'true') {
  await db.insert(agentSchema).values({ orgId: ORG, slug, name, systemPrompt: 'test', active });
}

async function wipe() {
  await db.delete(decisionAlignmentSchema).where(eq(decisionAlignmentSchema.orgId, ORG));
  await db.delete(decisionAlignmentSchema).where(eq(decisionAlignmentSchema.orgId, OTHER_ORG));
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
}

beforeEach(wipe);

afterAll(wipe);

describe('average confidence and agreement per agent', () => {
  it('averages confidence over the same decided recommendations the agreement rate scores', async () => {
    await seedDecision({ agentSlug: 'closer', recommended: 'approved', decision: 'approved', confidence: 0.9 });
    await seedDecision({ agentSlug: 'closer', recommended: 'approved', decision: 'rejected', confidence: 0.5 });
    // A decision with no recommendation is not scored, so its confidence must not move the average.
    await seedDecision({ agentSlug: 'closer', recommended: null, decision: 'approved', confidence: 0.1 });
    // An implicit row carries an `approve` nobody said — excluded from both numbers.
    await seedDecision({ agentSlug: 'closer', recommended: 'approved', decision: 'approved', confidence: 0.2, implicit: true });

    const summary = (await getAgentAlignmentSummaries(ORG, 30, NOW)).get('closer');

    expect(summary).toMatchObject({ recommendationsDecided: 2, recommendationsAgreed: 1, agreementRate: 0.5, recommendationsWithConfidence: 2 });
    expect(summary?.averageConfidence).toBeCloseTo(0.7, 5);
  });

  it('skips recommendations made without a confidence instead of counting them as zero', async () => {
    await seedDecision({ agentSlug: 'closer', recommended: 'approved', decision: 'approved', confidence: 0.8 });
    await seedDecision({ agentSlug: 'closer', recommended: 'approved', decision: 'approved', confidence: null });

    const summary = (await getAgentAlignmentSummaries(ORG, 30, NOW)).get('closer');

    expect(summary?.averageConfidence).toBeCloseTo(0.8, 5);
    expect(summary?.recommendationsWithConfidence).toBe(1);
    expect(summary?.recommendationsDecided).toBe(2);
  });

  it('gives a null average, not zero, when every recommendation carried a null confidence', async () => {
    await seedDecision({ agentSlug: 'closer', recommended: 'approved', decision: 'approved', confidence: null });
    await seedDecision({ agentSlug: 'closer', recommended: 'approved', decision: 'rejected', confidence: null });

    const summary = (await getAgentAlignmentSummaries(ORG, 30, NOW)).get('closer');

    expect(summary?.averageConfidence).toBeNull();
    expect(summary?.agreementRate).toBe(0.5);
  });

  it('gives null agreement and null confidence when the agent has decisions but no scored recommendations', async () => {
    await seedDecision({ agentSlug: 'closer', recommended: null, decision: 'approved', confidence: 0.9 });

    const summary = (await getAgentAlignmentSummaries(ORG, 30, NOW)).get('closer');

    expect(summary).toMatchObject({ agreementRate: null, averageConfidence: null, recommendationsDecided: 0 });
  });

  it('reports a real 0% when every scored recommendation was overruled', async () => {
    await seedDecision({ agentSlug: 'closer', recommended: 'approved', decision: 'rejected', confidence: 0.6 });

    const summary = (await getAgentAlignmentSummaries(ORG, 30, NOW)).get('closer');

    expect(summary?.agreementRate).toBe(0);
  });

  it('counts only decisions inside the window and only for this organization', async () => {
    await seedDecision({ agentSlug: 'closer', recommended: 'approved', decision: 'approved', confidence: 0.9, decidedAt: new Date(NOW.getTime() - 2 * DAY) });
    await seedDecision({ agentSlug: 'closer', recommended: 'approved', decision: 'rejected', confidence: 0.1, decidedAt: new Date(NOW.getTime() - 10 * DAY) });
    await seedDecision({ agentSlug: 'closer', recommended: 'approved', decision: 'rejected', confidence: 0.1, orgId: OTHER_ORG });

    const lastWeek = (await getAgentAlignmentSummaries(ORG, 7, NOW)).get('closer');
    const lastMonth = (await getAgentAlignmentSummaries(ORG, 30, NOW)).get('closer');

    expect(lastWeek).toMatchObject({ recommendationsDecided: 1, agreementRate: 1 });
    expect(lastMonth).toMatchObject({ recommendationsDecided: 2, agreementRate: 0.5 });
  });
});

describe('who gets a scorecard row', () => {
  it('gives an active agent with no activity at all a row with empty rates rather than dropping it', async () => {
    await seedAgent('screener', 'Applicant Screener');
    await seedAgent('router', 'Store Router');
    await seedDecision({ agentSlug: 'screener', recommended: 'approved', decision: 'approved', confidence: 0.9 });

    const { rows } = await getScorecard(ORG, 30, NOW);
    const router = rows.find(row => row.agentSlug === 'router');

    expect(rows.map(row => row.agentSlug)).toEqual(['screener', 'router']);
    expect(router).toMatchObject({ agentName: 'Store Router', agreementRate: null, averageConfidence: null, acceptedAsIsRate: null, peopleReached: 0 });
  });

  it('hides an inactive agent with no numbers, but keeps one that has decisions', () => {
    const agents = [
      { slug: 'teaser', name: 'Teaser', displayName: null, active: 'false' },
      { slug: 'retired', name: 'Retired', displayName: null, active: 'false' },
    ];
    const alignment = new Map([['retired', { ...noAlignmentYet(), recommendationsDecided: 3, recommendationsAgreed: 3, agreementRate: 1 }]]);

    const rows = buildScorecardRows(agents, alignment, new Map());

    expect(rows.map(row => row.agentSlug)).toEqual(['retired']);
  });

  it('keeps an agent that has decisions but was deleted, labelled by its slug', () => {
    const alignment = new Map([['gone', { ...noAlignmentYet(), recommendationsDecided: 1, recommendationsAgreed: 0, agreementRate: 0 }]]);

    const [row] = buildScorecardRows([], alignment, new Map());

    expect(row).toMatchObject({ agentSlug: 'gone', agentName: 'gone', agreementRate: 0 });
  });

  it('prefers the persona display name and totals every kind of review decision', () => {
    const agents = [{ slug: 'closer', name: 'closer-v2', displayName: 'Closer', active: 'true' }];
    const usage = new Map([['closer', { reach: 4, conversations: 9, approvals: 5, rejections: 2, revisions: 3, approvalRate: 0.5 }]]);

    const [row] = buildScorecardRows(agents, new Map(), usage);

    expect(row).toMatchObject({ agentName: 'Closer', peopleReached: 4, conversations: 9, reviewDecisions: 10, acceptedAsIsRate: 0.5, agreementRate: null });
  });
});
