/**
 * How emitEvent runs a subscribed automation's work.
 *
 * `inline` (the default) awaits the whole fire — right for the worker, where
 * nobody is holding a connection. `background` records the fire, answers with
 * its automationRunId, and completes the pass after the response, because a
 * mission check is an entire agent pass (minutes at the August peak) and the
 * regenerate routes emit this event from inside a click a reviewer is waiting
 * on. A regression here re-opens the held-connection bug the
 * begin/complete split was built to close.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 111 })),
}));

const PENDING = { orgId: 'org_evt_dispatch', slug: 'regen', kind: 'mission_check', automationRunId: 501, doCfg: {}, input: {}, invokedBy: 'x' };

vi.mock('@/services/AutomationService', () => ({
  fireAutomation: vi.fn(async () => ({ kind: 'mission_check', runId: 900, automationRunId: 501 })),
  beginAutomationFire: vi.fn(async () => PENDING),
  completeAutomationFire: vi.fn(async () => ({ kind: 'mission_check', runId: 900, automationRunId: 501 })),
}));

// `after` is Next's keep-alive past the response; captured so the test can run
// the deferred work itself and prove where the completion happens.
const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock('next/server', () => ({
  after: vi.fn((cb: () => Promise<void>) => afterCallbacks.push(cb)),
}));

const { db } = await import('@/libs/DB');
const { automationSchema, eventLogSchema } = await import('@/models/Schema');
const { beginAutomationFire, completeAutomationFire, fireAutomation } = await import('@/services/AutomationService');
const { emitEvent } = await import('@/services/EventService');

const ORG = 'org_evt_dispatch';

async function seedAutomation() {
  await db.insert(automationSchema).values({
    orgId: ORG,
    slug: 'regen',
    name: 'Regenerate on request',
    status: 'active',
    whenConfig: { event: 'personalization.brief_regenerate_requested' },
    doConfig: { checkMission: 'increase-discovery-calls' },
  });
}

beforeEach(async () => {
  await db.delete(eventLogSchema);
  await db.delete(automationSchema);
  afterCallbacks.length = 0;
  vi.clearAllMocks();
});

afterAll(async () => {
  await db.delete(eventLogSchema);
  await db.delete(automationSchema);
});

describe('emitEvent dispatchMode', () => {
  it('inline (the default) awaits the whole fire', async () => {
    await seedAutomation();

    const out = await emitEvent({ orgId: ORG, type: 'personalization.brief_regenerate_requested', payload: { briefId: 9 } });

    expect(fireAutomation).toHaveBeenCalledTimes(1);
    expect(beginAutomationFire).not.toHaveBeenCalled();
    expect(out.triggered).toEqual([{ slug: 'automation:regen', runId: 900 }]);
  });

  it('background records the fire and completes the pass after the response', async () => {
    await seedAutomation();

    const out = await emitEvent({
      orgId: ORG,
      type: 'personalization.brief_regenerate_requested',
      payload: { briefId: 9 },
      dispatchMode: 'background',
    });

    // Answered from the recorded fire, without waiting on the pass.
    expect(beginAutomationFire).toHaveBeenCalledTimes(1);
    expect(completeAutomationFire).not.toHaveBeenCalled();
    expect(out.triggered).toEqual([{ slug: 'automation:regen', runId: PENDING.automationRunId }]);

    // The pass itself was handed to `after`, and runs on the recorded fire.
    expect(afterCallbacks).toHaveLength(1);

    await afterCallbacks[0]!();

    expect(completeAutomationFire).toHaveBeenCalledWith(PENDING);
  });
});
