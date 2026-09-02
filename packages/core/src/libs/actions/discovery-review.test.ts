/**
 * discovery.review_proposal — the seam between detection (011) and the
 * follow-up mission, plus the safety invariant that no trust rule can cross
 * that seam without a human.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const startMissionMock = vi.fn(async () => ({ id: 4242, status: 'completed' }));
const getMissionMock = vi.fn(async () => ({ slug: 'discovery-followup', name: 'Discovery Follow-Up' }));
vi.mock('@/services/MissionService', () => ({
  startMission: startMissionMock,
  getMission: getMissionMock,
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, trustRuleSchema } = await import('@/models/Schema');
const { proposeAction, executeAction } = await import('@/services/ActionService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_disc_review';

/** Autonomy 1 → the proposal is gated into the review queue. */
function detector(): Principal {
  return { kind: 'agent', id: 'agent:discovery-detector', grants: ['review_proposal'], autonomy: 1, scope: { orgId: ORG } };
}

function proposalInput(over: Record<string, unknown> = {}) {
  return {
    candidateId: 7,
    meetingExternalId: 'zoom:abc',
    company: 'Acme',
    route: 'generate' as const,
    isDiscovery: true,
    proposalReady: true,
    ...over,
  };
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
  startMissionMock.mockClear();
  getMissionMock.mockClear();
  getMissionMock.mockResolvedValue({ slug: 'discovery-followup', name: 'Discovery Follow-Up' } as never);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
});

describe('discovery.review_proposal handoff', () => {
  it('starts the follow-up mission naming the skills and the gated read on approval', async () => {
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      principal: detector(),
      input: proposalInput(),
      proposal: { confidence: 0.92, rationale: 'clear discovery' },
    });

    expect(proposed.status).toBe('pending');
    expect(startMissionMock).not.toHaveBeenCalled(); // nothing runs before a human

    const executedRun = await executeAction(proposed.runId!, ORG);

    expect(executedRun.status).toBe('done');
    expect(startMissionMock).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG,
      missionSlug: 'discovery-followup',
      mode: 'check',
    }));

    const brief = (startMissionMock.mock.calls[0] as unknown as [{ brief: string }])[0].brief;

    // The brief carries the gated read + both skills by name.
    expect(brief).toContain('read_discovery_transcript');
    expect(brief).toContain('candidate_id 7');
    expect(brief).toContain('discovery-summary');
    expect(brief).toContain('draft-followup-email');

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(row?.result).toMatchObject({ handoff: 'discovery-followup', missionRunId: 4242 });
  });

  it('a dropped candidate records the correction and starts nothing', async () => {
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      principal: detector(),
      input: proposalInput({ route: 'drop', isDiscovery: false, proposalReady: false }),
      proposal: { confidence: 0.2, rationale: 'internal sync' },
    });
    await executeAction(proposed.runId!, ORG);

    expect(startMissionMock).not.toHaveBeenCalled();

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(row?.result).toMatchObject({ handoff: 'dropped' });
  });

  it('a missing mission fails the run rather than reading as a successful handoff', async () => {
    getMissionMock.mockResolvedValue(null as never);

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      principal: detector(),
      input: proposalInput(),
      proposal: { confidence: 0.9, rationale: 'clear' },
    });
    const executedRun = await executeAction(proposed.runId!, ORG);

    expect(executedRun.status).toBe('failed');
    expect(startMissionMock).not.toHaveBeenCalled();

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(row?.status).toBe('failed');
    expect(row?.error).toMatch(/discovery-followup/);
    // The human's decision is still on the row — the calibration signal survives.
    expect(row?.input).toMatchObject({ route: 'generate', isDiscovery: true });
  });

  /**
   * The invariant that used to be only a comment: approving this action now
   * starts real downstream work (a drafted email in the seller's voice), so an
   * enabled trust rule must NOT be able to release it. Supervised v1 also needs
   * the human decision as calibration data for 020.
   */
  it('is never auto-approved, even by an enabled trust rule above the threshold', async () => {
    await db.insert(trustRuleSchema).values({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      threshold: 0.5,
      enabled: 'true',
    });

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      principal: detector(),
      input: proposalInput(),
      proposal: { confidence: 0.99, rationale: 'very confident' },
    });

    expect(proposed.status).toBe('pending');
    expect(startMissionMock).not.toHaveBeenCalled();

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(row?.status).toBe('pending');
  });
});
