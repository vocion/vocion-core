/**
 * A cancel that changed nothing records no rejection (vocion-core#123).
 *
 * Cancelling a run that already finished leaves it as it was. The Review
 * queue still recorded a `rejected` decision for it, so reviewer-override and
 * rejection-rate reports counted decisions nobody made. The run services are
 * mocked to return the run as the cancel left it; the adoption recorder is
 * mocked so the test reads what it was asked to record.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ resumeMission: vi.fn(), cancelMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ resumeWorkflow: vi.fn(), cancelWorkflow: vi.fn() }));
vi.mock('@/services/adoption/attribution', () => ({ trackReviewDecision: vi.fn() }));

const { cancelMission } = await import('@/services/MissionService');
const { cancelWorkflow } = await import('@/services/WorkflowService');
const { trackReviewDecision } = await import('@/services/adoption/attribution');
const { decide } = await import('@/services/ReviewService');

const ORG = 'org_cancel_noop';
const mockTrack = vi.mocked(trackReviewDecision);

/**
 * The ids of the runs a decision was recorded for, in order.
 */
function recordedRunIds(): number[] {
  return mockTrack.mock.calls.map(([, item]) => item.id);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('decide(reject) on a run that already finished', () => {
  it('records no rejection for a mission run that completed before the cancel reached it', async () => {
    vi.mocked(cancelMission).mockResolvedValueOnce({ id: 1, status: 'completed' } as never);
    vi.mocked(cancelMission).mockResolvedValueOnce({ id: 2, status: 'cancelled' } as never);

    await decide({ kind: 'mission', id: 1 }, 'reject', ORG);
    await decide({ kind: 'mission', id: 2 }, 'reject', ORG);

    await vi.waitFor(() => expect(recordedRunIds()).toContain(2));

    expect(recordedRunIds()).toEqual([2]);
  });

  it('records no rejection for a workflow run that completed before the cancel reached it', async () => {
    vi.mocked(cancelWorkflow).mockResolvedValueOnce({ id: 3, status: 'completed' } as never);
    vi.mocked(cancelWorkflow).mockResolvedValueOnce({ id: 4, status: 'cancelled' } as never);

    await decide({ kind: 'workflow', id: 3 }, 'reject', ORG);
    await decide({ kind: 'workflow', id: 4 }, 'reject', ORG);

    await vi.waitFor(() => expect(recordedRunIds()).toContain(4));

    expect(recordedRunIds()).toEqual([4]);
  });
});
