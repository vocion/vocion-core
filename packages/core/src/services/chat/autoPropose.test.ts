import { describe, expect, it, vi } from 'vitest';

const proposeAction = vi.fn();
vi.mock('@/services/ActionService', () => ({ proposeAction: (...args: unknown[]) => proposeAction(...args) }));

const { autoProposeRecommendation, deriveRecommendationDedupKey, readAutonomy } = await import('./autoPropose');
const { cardDedupKey } = await import('@/libs/actions/cardDedupKey');

describe('readAutonomy', () => {
  it('is done-for-you when nothing was said, and asks on a value it does not know', () => {
    expect(readAutonomy(undefined)).toBe('act-within-bounds');
    expect(readAutonomy('yolo')).toBe('ask-before-acting');
    expect(readAutonomy('act-within-bounds')).toBe('act-within-bounds');
  });
});

describe('deriveRecommendationDedupKey', () => {
  it('matches the review router: gmail by recipient, others by object id', () => {
    expect(deriveRecommendationDedupKey('gmail.send', { to: ' Nadia@Example.com ' })).toBe('gmail.send:nadia@example.com');
    expect(deriveRecommendationDedupKey('hubspot.update', { objectId: '611' })).toBe('hubspot.update:611');
    expect(deriveRecommendationDedupKey('hubspot.update', {})).toBeUndefined();
  });
});

describe('autoProposeRecommendation', () => {
  it('files on the agent principal and returns the run id', async () => {
    proposeAction.mockResolvedValueOnce({ runId: 42, status: 'pending' });
    const runId = await autoProposeRecommendation({
      orgId: 'org_1',
      userId: 'usr_1',
      rec: { actionId: 'hubspot.update', input: { objectId: '611', stage: 'closedlost' }, label: 'Close Northwind as Lost', agentSlug: 'revenue-director', confidence: 0.9 },
    });

    expect(runId).toBe(42);

    const call = proposeAction.mock.calls[0]![0] as Record<string, unknown>;

    expect(call.principal).toMatchObject({ kind: 'agent', id: 'agent:revenue-director', autonomy: 2 });
    expect(call.invokedBy).toBe('usr_1');
    expect(call.dedupKey).toBe('hubspot.update:611');
  });

  it('files a card that names no record under the card key a tap would use, so it is one run (walk 20)', async () => {
    proposeAction.mockResolvedValueOnce({ runId: 43, status: 'done' });
    const rec = { actionId: 'ask.file', input: { title: 'Ship the Kestrel upload fix?' }, label: 'Approve the Kestrel upload fix', agentSlug: 'product-manager' };
    await autoProposeRecommendation({ orgId: 'org_1', rec });

    const call = proposeAction.mock.calls.at(-1)![0] as Record<string, unknown>;

    expect(call.dedupKey).toBe(cardDedupKey(rec));
  });

  it('returns null instead of throwing when the proposal fails, so the card falls back to the tap', async () => {
    proposeAction.mockRejectedValueOnce(new Error('no such action'));

    await expect(autoProposeRecommendation({ orgId: 'org_1', rec: { actionId: 'nope', input: {}, label: 'x' } })).resolves.toBeNull();
  });
});
