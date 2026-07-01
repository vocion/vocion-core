/**
 * Trigger runner against PGlite. Seeds workflows with event triggers, mocks
 * startWorkflow, and verifies dispatch + filter + dedupe + no-match.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 111 })),
}));

const { db } = await import('@/libs/DB');
const { workflowSchema, eventLogSchema } = await import('@/models/Schema');
const { startWorkflow } = await import('@/services/WorkflowService');
const { emitEvent } = await import('@/services/EventService');

const mockStart = vi.mocked(startWorkflow);
const ORG = 'org_evt';

async function seedWorkflow(slug: string, trigger: Record<string, unknown>, status = 'active') {
  await db.insert(workflowSchema).values({ orgId: ORG, slug, name: slug, trigger, steps: [], status });
}

beforeEach(async () => {
  await db.delete(eventLogSchema);
  await db.delete(workflowSchema);
  vi.clearAllMocks();
});

afterAll(async () => {
  await db.delete(eventLogSchema);
  await db.delete(workflowSchema);
});

describe('EventService.emitEvent', () => {
  it('starts a subscribed workflow with the payload', async () => {
    await seedWorkflow('followup', { type: 'event', event: 'prospect.reply' });
    const out = await emitEvent({ orgId: ORG, type: 'prospect.reply', payload: { dealId: 7 } });

    expect(out.triggered).toEqual([{ slug: 'followup', runId: 111 }]);
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, slug: 'followup', input: { dealId: 7 } }));
    expect(out.deduped).toBe(false);
  });

  it('does not start workflows whose filter does not match', async () => {
    await seedWorkflow('proposal-nudge', { type: 'event', event: 'deal.changed', filter: { stage: 'proposal' } });

    expect((await emitEvent({ orgId: ORG, type: 'deal.changed', payload: { stage: 'lead' } })).triggered).toHaveLength(0);
    expect((await emitEvent({ orgId: ORG, type: 'deal.changed', payload: { stage: 'proposal' } })).triggered).toHaveLength(1);
  });

  it('dedupes a redelivered event by key (fires once)', async () => {
    await seedWorkflow('followup', { type: 'event', event: 'prospect.reply' });
    const first = await emitEvent({ orgId: ORG, type: 'prospect.reply', dedupeKey: 'msg-1' });
    const second = await emitEvent({ orgId: ORG, type: 'prospect.reply', dedupeKey: 'msg-1' });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('ignores non-matching types and inactive workflows but still logs', async () => {
    await seedWorkflow('followup', { type: 'event', event: 'prospect.reply' });
    await seedWorkflow('disabled-one', { type: 'event', event: 'prospect.reply' }, 'disabled');

    const out = await emitEvent({ orgId: ORG, type: 'nothing.here' });

    expect(out.triggered).toHaveLength(0);
    expect(mockStart).not.toHaveBeenCalled();

    // inactive workflow not fired even on a matching type
    const out2 = await emitEvent({ orgId: ORG, type: 'prospect.reply' });

    expect(out2.triggered.map(t => t.slug)).toEqual(['followup']);

    const logged = await db.select().from(eventLogSchema);

    expect(logged.length).toBeGreaterThanOrEqual(2);
  });
});
