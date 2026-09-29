/**
 * The page's read of what each answer starts, against PGlite: only active,
 * unpaused automations on `ask.decided` count, and an ask filed by a person in
 * chat (no asking agent) matches nothing, so its Approve says nothing runs.
 * Names are fictional.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { automationSchema } = await import('@/models/Schema');
const { loadAnswerListeners } = await import('./answerListeners');

const ORG = 'org_answer_listeners';

const base = { orgId: ORG, doConfig: { checkMission: 'close-the-gap' } };

beforeEach(async () => {
  await db.delete(automationSchema);
  await db.insert(automationSchema).values([
    { ...base, slug: 'decision-landed', name: 'A build decision landed', status: 'active', whenConfig: { event: 'ask.decided', filter: { agentSlug: 'product-manager', kind: 'recommendation' } } },
    { ...base, slug: 'decision-old', name: 'A recommendation was decided', status: 'disabled', whenConfig: { event: 'ask.decided', filter: { agentSlug: 'product-manager', kind: 'recommendation' } } },
    { ...base, slug: 'decision-paused', name: 'Paused listener', status: 'active', pausedAt: new Date(), whenConfig: { event: 'ask.decided' } },
    { ...base, slug: 'stop-answered', name: 'A stop was answered', status: 'active', whenConfig: { event: 'ask.decided', filter: { sourceRefPrefix: 'factory-recovery:' } } },
    { ...base, orgId: 'org_someone_else', slug: 'other-org', name: 'Another workspace', status: 'active', whenConfig: { event: 'ask.decided' } },
  ]);
});

afterAll(async () => {
  await db.delete(automationSchema);
});

const ask = (id: number, more: Record<string, unknown> = {}) => ({
  id,
  kind: 'ruling',
  agentSlug: null,
  teamSlug: null,
  groupKey: null,
  sourceRef: 'action_run:9001',
  objectRefs: [],
  options: [],
  ...more,
});

describe('loadAnswerListeners', () => {
  it('finds nothing for a ruling a person filed in chat, so Approve can say nothing runs', async () => {
    const got = await loadAnswerListeners(ORG, [ask(1)]);

    expect(got.get(1)).toEqual({ approve: [], reject: [], done: [], other: [] });
  });

  it('names the active automation a PM recommendation starts, and every named option', async () => {
    const got = await loadAnswerListeners(ORG, [ask(2, { kind: 'recommendation', agentSlug: 'product-manager', options: [{ id: 'approve-build' }] })]);

    expect(got.get(2)).toEqual({
      'approve': ['A build decision landed'],
      'reject': ['A build decision landed'],
      'done': ['A build decision landed'],
      'other': ['A build decision landed'],
      'approve-build': ['A build decision landed'],
    });
  });

  it('matches a stop by its source prefix', async () => {
    const got = await loadAnswerListeners(ORG, [ask(3, { kind: 'approval', sourceRef: 'factory-recovery:7' })]);

    expect(got.get(3)!.approve).toEqual(['A stop was answered']);
  });
});
