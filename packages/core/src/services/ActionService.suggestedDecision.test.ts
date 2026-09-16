/**
 * The trust ladder and the agent's recommendation, together.
 *
 * Confidence and recommendation answer different questions. An agent can be
 * highly confident that the right call is to turn something down, and a rule
 * keyed on confidence alone would read that as "very sure, go ahead" and run
 * the work the agent just advised against. These tests pin the guard that
 * stops it.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, trustRuleSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { proposeAction } = await import('@/services/ActionService');

const ORG = 'org_suggested_gate';
const ACTION_ID = 'test.suggested-decision-write';

let executed = 0;
registerAction({
  id: ACTION_ID,
  name: 'Test write for the recommendation gate',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  execute: async () => {
    executed += 1;
    return { ok: true };
  },
});

/** Working autonomy: external writes gate to a human unless a trust rule releases them. */
const agent: Principal = { kind: 'agent', id: 'agent:screener', grants: ['test_write'], autonomy: 2, scope: { orgId: ORG } };

/** A rule that would release anything at or above 0.5 confidence. */
async function enableTrustRule() {
  await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: ACTION_ID, threshold: 0.5, enabled: 'true' });
}

beforeEach(async () => {
  executed = 0;
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
});

describe('proposeAction with a recommendation against acting', () => {
  it('keeps a high-confidence reject recommendation in the queue for a person', async () => {
    await enableTrustRule();

    const res = await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.99, suggestedDecision: 'reject' },
    });

    expect(res.status).toBe('pending');
    expect(executed).toBe(0);
  });

  it('keeps a high-confidence snooze recommendation in the queue too', async () => {
    await enableTrustRule();

    const res = await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.99, suggestedDecision: 'snooze' },
    });

    expect(res.status).toBe('pending');
    expect(executed).toBe(0);
  });

  it('still auto-executes when the agent recommends approving', async () => {
    // The guard must narrow the ladder, not disable it — otherwise every
    // recommendation would quietly become a reason to stop automating.
    await enableTrustRule();

    const res = await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.99, suggestedDecision: 'approve' },
    });

    expect(res.status).toBe('done');
    expect(executed).toBe(1);
  });

  it('still auto-executes when the agent gave no recommendation at all', async () => {
    // Everything proposed before this field existed behaves exactly as before.
    await enableTrustRule();

    const res = await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.99 },
    });

    expect(res.status).toBe('done');
    expect(executed).toBe(1);
  });

  it('a re-proposal that changes its mind replaces the recommendation', async () => {
    // The refresh path writes the whole envelope, so an agent that looks again
    // and reaches a different conclusion moves the item into the other lane.
    // That is what should happen — the queue shows the agent's current read,
    // not its first one — but it means a reviewer part-way through an item can
    // see the badge change, which is worth knowing about.
    const first = await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.4, suggestedDecision: 'approve' },
      dedupKey: 'same-record',
    });
    const second = await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.4, suggestedDecision: 'reject' },
      dedupKey: 'same-record',
    });

    const rows = await db.select().from(actionRunSchema);

    expect(second.runId).toBe(first.runId);
    expect(second.outcome).toBe('refreshed');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.proposal).toMatchObject({ suggestedDecision: 'reject' });
  });

  it('a re-proposal replaces the reason along with the recommendation it explained', async () => {
    // The envelope is replaced, not merged, so a stale reason must not outlive
    // the verdict it was written for — a card reading "approve" under "the
    // date has already passed" is worse than one with no reason at all.
    await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.4, suggestedDecision: 'reject', suggestedDecisionReason: 'The date has already passed.' },
      dedupKey: 'same-record',
    });
    await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.8, suggestedDecision: 'approve', suggestedDecisionReason: 'The venue re-listed it for next month.' },
      dedupKey: 'same-record',
    });

    const [row] = await db.select().from(actionRunSchema);

    expect(row!.proposal).toMatchObject({
      suggestedDecision: 'approve',
      suggestedDecisionReason: 'The venue re-listed it for next month.',
    });
  });

  it('a refresh that arrives with a reason and no recommendation keeps neither', async () => {
    // The orphan rule holds on the refresh path too, which writes through a
    // different statement from the create path.
    await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.4, suggestedDecision: 'reject', suggestedDecisionReason: 'The date has already passed.' },
      dedupKey: 'same-record',
    });
    await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.8, suggestedDecisionReason: 'Still thinking about it.' },
      dedupKey: 'same-record',
    });

    const [row] = await db.select().from(actionRunSchema);

    expect(row!.proposal).not.toHaveProperty('suggestedDecision');
    expect(row!.proposal).not.toHaveProperty('suggestedDecisionReason');
  });

  it('a re-proposal with no envelope clears the recommendation rather than keeping the old one', async () => {
    // Same rule confidence has always followed: the envelope is replaced, not
    // merged. Pinned here because the failure is silent — the item would drop
    // out of every recommendation lane with nothing to show why.
    await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.4, suggestedDecision: 'reject' },
      dedupKey: 'same-record',
    });
    await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      dedupKey: 'same-record',
    });

    const [row] = await db.select().from(actionRunSchema);

    expect(row!.proposal).toBeNull();
  });

  it('drops a reason that came with no recommendation', async () => {
    // A sentence arguing for an outcome, on a card that recommends none,
    // cannot be read by anyone — the card, the metric or a person months
    // later. Nothing is inferred from it, so nothing is kept.
    await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: { confidence: 0.4, suggestedDecisionReason: 'The date has already passed.' },
    });

    const [row] = await db.select().from(actionRunSchema);

    expect(row!.proposal).not.toHaveProperty('suggestedDecisionReason');
    expect(row!.proposal).toMatchObject({ confidence: 0.4 });
  });

  it('stores the recommendation on the run so the queue can read it back', async () => {
    const res = await proposeAction({
      orgId: ORG,
      actionId: ACTION_ID,
      input: { value: 'x' },
      principal: agent,
      proposal: {
        confidence: 0.4,
        suggestedDecision: 'reject',
        suggestedDecisionReason: 'Third listing of this same show this week.',
        suggestedSnoozeUntil: '2026-10-01T00:00:00.000Z',
      },
    });

    const [row] = await db.select().from(actionRunSchema);

    expect(row!.id).toBe(res.runId);
    expect(row!.proposal).toMatchObject({
      suggestedDecision: 'reject',
      suggestedDecisionReason: 'Third listing of this same show this week.',
      suggestedSnoozeUntil: '2026-10-01T00:00:00.000Z',
    });
  });
});
