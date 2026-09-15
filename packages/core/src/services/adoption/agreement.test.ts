/**
 * Agreement — what the agent recommended against what the person decided.
 *
 * The bug this exists to prevent is the one the old approval rate had: a
 * reviewer rejecting an item the agent also wanted rejected was counted as a
 * disagreement, because the recommendation was assumed to always be "approve".
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { userActivityEventSchema } = await import('@/models/Schema');
const { getAgentAgreement } = await import('./AdoptionService');

const ORG = 'org_agreement';
const SCREENER = 'applicant-screener';

/**
 * One recorded decision. `suggested` is what the agent advised at the time,
 * `decision` what the person did — omit `decision` for a snooze, which is its
 * own event type.
 * @param opts
 * @param opts.suggested
 * @param opts.decision
 * @param opts.eventType
 * @param opts.agentSlug
 */
async function record(opts: {
  suggested?: string;
  decision?: string;
  eventType?: 'review.decided' | 'review.snoozed';
  agentSlug?: string | null;
}) {
  await db.insert(userActivityEventSchema).values({
    orgId: ORG,
    userId: 'usr-reviewer',
    agentSlug: opts.agentSlug === undefined ? SCREENER : opts.agentSlug,
    eventType: opts.eventType ?? 'review.decided',
    resourceType: 'action_run',
    metadata: {
      kind: 'action',
      ...(opts.decision ? { decision: opts.decision } : {}),
      ...(opts.suggested ? { suggestedDecision: opts.suggested } : {}),
      ...(opts.eventType === 'review.snoozed' ? { deferredFor: 'up_to_1d' } : {}),
    },
  });
}

beforeEach(async () => {
  await db.delete(userActivityEventSchema);
});

afterAll(async () => {
  await db.delete(userActivityEventSchema);
});

describe('getAgentAgreement', () => {
  it('counts a rejection the agent also recommended as agreement', async () => {
    // The headline fix. Under approvalRate this reads as a disagreement.
    await record({ suggested: 'reject', decision: 'rejected' });

    const agreement = (await getAgentAgreement(ORG, 30)).get(SCREENER)!;

    expect(agreement.decided).toBe(1);
    expect(agreement.agreed).toBe(1);
    expect(agreement.agreementRate).toBe(1);
  });

  it('counts a rejection the agent wanted approved as disagreement', async () => {
    await record({ suggested: 'approve', decision: 'rejected' });

    const agreement = (await getAgentAgreement(ORG, 30)).get(SCREENER)!;

    expect(agreement.decided).toBe(1);
    expect(agreement.agreed).toBe(0);
    expect(agreement.agreementRate).toBe(0);
  });

  it('counts a snooze the agent recommended as agreement', async () => {
    // A deferral stays out of the approval rate because nobody has judged the
    // work. "Come back to this later" being exactly what the agent advised is
    // still a real meeting of minds.
    await record({ suggested: 'snooze', eventType: 'review.snoozed' });

    const agreement = (await getAgentAgreement(ORG, 30)).get(SCREENER)!;

    expect(agreement.agreed).toBe(1);
    expect(agreement.matrix).toEqual([{ suggested: 'snooze', actual: 'snooze', count: 1 }]);
  });

  it('counts an approval the reviewer reworded as agreeing on the decision', async () => {
    // They approved; they changed the wording. Whether the payload survived
    // untouched is what approvalRate measures, and counting it twice would
    // make the two metrics say the same thing.
    await record({ suggested: 'approve', decision: 'edited' });
    await record({ suggested: 'approve', decision: 'rewritten' });

    const agreement = (await getAgentAgreement(ORG, 30)).get(SCREENER)!;

    expect(agreement.decided).toBe(2);
    expect(agreement.agreed).toBe(2);
  });

  it('leaves out signals that decided nothing', async () => {
    // Skipped and saved leave the item pending. Judging an agent on work
    // nobody has finished judging is the mistake this avoids.
    await record({ suggested: 'approve', decision: 'skipped' });
    await record({ suggested: 'approve', decision: 'saved' });
    await record({ suggested: 'approve', decision: 'regenerated' });

    expect((await getAgentAgreement(ORG, 30)).get(SCREENER)).toBeUndefined();
  });

  it('leaves out decisions on items the agent had no view on', async () => {
    // Everything proposed before recommendations existed. Counting these as
    // "recommended approve" would invent agreement nobody expressed.
    await record({ decision: 'approved' });
    await record({ decision: 'rejected' });

    expect((await getAgentAgreement(ORG, 30)).get(SCREENER)).toBeUndefined();
  });

  it('separates being right about approvals from being right about declines', async () => {
    // The reason this is a matrix and not a rate: an agent that advances well
    // and declines badly is the exact failure a single number hides.
    await record({ suggested: 'approve', decision: 'approved' });
    await record({ suggested: 'approve', decision: 'approved' });
    await record({ suggested: 'approve', decision: 'approved' });
    await record({ suggested: 'reject', decision: 'approved' });
    await record({ suggested: 'reject', decision: 'approved' });

    const agreement = (await getAgentAgreement(ORG, 30)).get(SCREENER)!;

    expect(agreement.agreementRate).toBeCloseTo(0.6);
    expect(agreement.matrix).toEqual([
      { suggested: 'approve', actual: 'approve', count: 3 },
      { suggested: 'reject', actual: 'approve', count: 2 },
    ]);
  });

  it('keeps each agent to its own runs', async () => {
    await record({ suggested: 'reject', decision: 'rejected' });
    await record({ suggested: 'reject', decision: 'approved', agentSlug: 'other-agent' });

    const byAgent = await getAgentAgreement(ORG, 30);

    expect(byAgent.get(SCREENER)!.agreementRate).toBe(1);
    expect(byAgent.get('other-agent')!.agreementRate).toBe(0);
  });

  it('ignores events that cannot be attributed to any agent', async () => {
    await record({ suggested: 'reject', decision: 'rejected', agentSlug: null });

    expect((await getAgentAgreement(ORG, 30)).size).toBe(0);
  });

  it('does not reach into another org', async () => {
    await db.insert(userActivityEventSchema).values({
      orgId: 'org_someone_else',
      userId: 'usr-reviewer',
      agentSlug: SCREENER,
      eventType: 'review.decided',
      resourceType: 'action_run',
      metadata: { kind: 'action', decision: 'rejected', suggestedDecision: 'reject' },
    });

    expect((await getAgentAgreement(ORG, 30)).size).toBe(0);
  });

  it('ignores decisions older than the window', async () => {
    await db.insert(userActivityEventSchema).values({
      orgId: ORG,
      userId: 'usr-reviewer',
      agentSlug: SCREENER,
      eventType: 'review.decided',
      resourceType: 'action_run',
      metadata: { kind: 'action', decision: 'rejected', suggestedDecision: 'reject' },
      createdAt: new Date(Date.now() - 40 * 86_400_000),
    });

    expect((await getAgentAgreement(ORG, 7)).size).toBe(0);
    expect((await getAgentAgreement(ORG, 90)).get(SCREENER)!.decided).toBe(1);
  });
});
