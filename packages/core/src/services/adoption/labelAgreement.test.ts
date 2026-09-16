/**
 * Label agreement: what the reviewer did to the labels the agent wrote.
 *
 * The question neither of the other two rates asks. `approvalRate` says
 * whether the output survived untouched, `agreement` whether the call was
 * right; an extractor can be right about every card it proposes and wrong
 * about which series half of them belong to, and only this reads that.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { userActivityEventSchema } = await import('@/models/Schema');
const { getAgentLabelAgreement } = await import('./AdoptionService');

const ORG = 'org_label_agreement';
const EXTRACTOR = 'event-ingestion-lead';

/**
 * One recorded decision, with whatever its `labels` map held.
 * @param opts - What this decision recorded.
 * @param opts.labels - The per-field verdicts, omitted for a decision that declared none.
 * @param opts.agentSlug - The agent the decision is attributed to.
 */
async function record(opts: { labels?: unknown; agentSlug?: string | null }) {
  await db.insert(userActivityEventSchema).values({
    orgId: ORG,
    userId: 'usr-reviewer',
    agentSlug: opts.agentSlug === undefined ? EXTRACTOR : opts.agentSlug,
    eventType: 'review.decided',
    resourceType: 'action_run',
    metadata: {
      kind: 'action',
      decision: 'edited',
      ...(opts.labels === undefined ? {} : { labels: opts.labels }),
    },
  });
}

beforeEach(async () => {
  await db.delete(userActivityEventSchema);
});

afterAll(async () => {
  await db.delete(userActivityEventSchema);
});

describe('getAgentLabelAgreement', () => {
  it('counts verdicts per field per agent', async () => {
    await record({ labels: { seriesMatch: 'kept', seriesKey: 'kept' } });
    await record({ labels: { seriesMatch: 'changed', seriesKey: 'changed' } });
    await record({ labels: { seriesMatch: 'cleared', seriesKey: 'cleared' } });
    await record({ labels: { seriesMatch: 'kept', seriesKey: 'kept' } });
    await record({ labels: { seriesMatch: 'kept' }, agentSlug: 'other-agent' });

    const byAgent = await getAgentLabelAgreement(ORG, 30);
    const mine = byAgent.get(EXTRACTOR)!;

    expect(mine.judged).toBe(8);
    expect(mine.kept).toBe(4);
    expect(mine.keptRate).toBeCloseTo(0.5);
    expect(mine.fields).toEqual([
      { field: 'seriesKey', kept: 2, changed: 1, cleared: 1, added: 0, judged: 4 },
      { field: 'seriesMatch', kept: 2, changed: 1, cleared: 1, added: 0, judged: 4 },
    ]);
    // Each agent keeps to its own runs.
    expect(byAgent.get('other-agent')!.kept).toBe(1);
  });

  it('ignores events with no labels key', async () => {
    // Every decision made before this existed, and every agent that judges
    // nothing. Counting them would invent a perfect score out of silence.
    await record({});
    await record({});

    expect((await getAgentLabelAgreement(ORG, 30)).size).toBe(0);
  });

  it('ignores a labels value that is not a map of verdicts', async () => {
    // jsonb accepts anything an earlier writer left behind, and one bad row
    // must not cost the whole panel its numbers.
    await record({ labels: 'part of series 41' });
    await record({ labels: { seriesMatch: 'obliterated' } });
    await record({ labels: { seriesMatch: 'kept' } });

    const mine = (await getAgentLabelAgreement(ORG, 30)).get(EXTRACTOR)!;

    expect(mine.judged).toBe(1);
    expect(mine.fields).toEqual([{ field: 'seriesMatch', kept: 1, changed: 0, cleared: 0, added: 0, judged: 1 }]);
  });

  it('returns nothing for an agent that never declared a label', async () => {
    await record({ labels: { seriesMatch: 'kept' } });

    expect((await getAgentLabelAgreement(ORG, 30)).get('applicant-screener')).toBeUndefined();
  });

  it('keeps an added label out of the rate it cannot speak to', async () => {
    // The reviewer supplied a label the agent left empty. There was no
    // judgement of the agent's to agree or disagree with, so it is counted and
    // reported without moving the rate.
    await record({ labels: { seriesMatch: 'added' } });
    await record({ labels: { seriesMatch: 'kept' } });

    const mine = (await getAgentLabelAgreement(ORG, 30)).get(EXTRACTOR)!;

    expect(mine.judged).toBe(1);
    expect(mine.keptRate).toBe(1);
    expect(mine.fields[0]?.added).toBe(1);
  });

  it('does not reach into another org', async () => {
    await db.insert(userActivityEventSchema).values({
      orgId: 'org_someone_else',
      userId: 'usr-reviewer',
      agentSlug: EXTRACTOR,
      eventType: 'review.decided',
      resourceType: 'action_run',
      metadata: { kind: 'action', decision: 'edited', labels: { seriesMatch: 'changed' } },
    });

    expect((await getAgentLabelAgreement(ORG, 30)).size).toBe(0);
  });
});
