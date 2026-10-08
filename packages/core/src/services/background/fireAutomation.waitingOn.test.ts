/**
 * A schedule tick of an automation parked on its questions spends nothing:
 * it is written down as a `waiting_on_ask` skip and never fires. A replay or
 * a resume's own fire is not a tick, and is never held here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({
  fireAutomation: vi.fn(async () => ({ kind: 'mission_check', runId: 7, automationRunId: 70 })),
  recordSkippedFire: vi.fn(async () => 81),
  scheduleFireInFlight: vi.fn(async () => null),
}));
vi.mock('@/services/AutomationService', () => svc);

const hold = vi.hoisted(() => ({ gate: null as null | { id: number; gateAskId: number | null; waitingOn: number[] } }));
vi.mock('@/services/needsYou/ResumeGateService', () => ({ automationHold: vi.fn(async () => hold.gate) }));

const { fireAutomationActivity } = await import('./fireAutomation');

beforeEach(() => {
  vi.clearAllMocks();
  hold.gate = null;
});

describe('fireAutomationActivity — parked on its questions', () => {
  it('skips the tick, says why in the run log, and fires nothing', async () => {
    hold.gate = { id: 3, gateAskId: 44, waitingOn: [12, 13] };

    const out = await fireAutomationActivity({ orgId: 'org_a', slug: 'pipeline-check' });

    expect(out).toEqual({ kind: 'skipped', runId: 81 });
    expect(svc.fireAutomation).not.toHaveBeenCalled();
    expect(svc.recordSkippedFire).toHaveBeenCalledWith('org_a', 'pipeline-check', expect.objectContaining({
      invokedBy: 'automation:pipeline-check',
      result: expect.objectContaining({ kind: 'skipped', reason: 'waiting_on_ask', detail: expect.stringMatching(/waiting on 2 questions on Needs you \(ask #44\)/) }),
    }));
  });

  it('fires as usual when nothing holds it', async () => {
    await fireAutomationActivity({ orgId: 'org_a', slug: 'pipeline-check' });

    expect(svc.fireAutomation).toHaveBeenCalledWith('org_a', 'pipeline-check', { invokedBy: 'automation:pipeline-check' });
    expect(svc.recordSkippedFire).not.toHaveBeenCalled();
  });

  it('never holds a resume\'s own fire', async () => {
    hold.gate = { id: 3, gateAskId: 44, waitingOn: [12] };

    await fireAutomationActivity({ orgId: 'org_a', slug: 'pipeline-check', invokedBy: 'resume-gate:3' });

    expect(svc.fireAutomation).toHaveBeenCalledWith('org_a', 'pipeline-check', { invokedBy: 'resume-gate:3', input: undefined });
  });
});
