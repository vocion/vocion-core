/**
 * The preference fast lane — the gate's one light-touch exception. Worth
 * pinning: an explicit "remember this" applies immediately but ONLY at user
 * scope for the speaking user, it always leaves an approved candidate on the
 * queue (the notify half, revocable), it refuses turns with no user, and the
 * dedup guard still applies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));
vi.mock('@/services/adoption/attribution', () => ({ agentSlugFromPrincipal: vi.fn(() => undefined) }));

const { db } = await import('@/libs/DB');
const { learningCandidateSchema, learningFeedbackOccurrenceSchema, memoryNamespaceSchema, memorySchema } = await import('@/models/Schema');
const { recordFastLanePreference } = await import('@/services/LearningCandidateService');
const { assembleAgentMemory } = await import('@/services/MemoryService');

const ORG = 'org_fastlane';

beforeEach(async () => {
  await db.delete(learningFeedbackOccurrenceSchema);
  await db.delete(learningCandidateSchema);
  await db.delete(memorySchema);
  await db.delete(memoryNamespaceSchema);
});

describe('recordFastLanePreference', () => {
  it('applies immediately at user scope and leaves an approved, revocable candidate', async () => {
    const result = await recordFastLanePreference({
      orgId: ORG,
      userId: 'user_jamie',
      text: 'Address me as "Boss".',
      agentSlug: 'revenue-lead',
    });

    expect(result.ok).toBe(true);

    // Applied: the rule is live in the user's own namespace…
    const files = await assembleAgentMemory(ORG, { agentSlug: 'revenue-lead', workspaceSteps: [], userId: 'user_jamie' });

    expect(Object.values(files).join('\n')).toContain('Address me as "Boss".');

    // …and only theirs.
    const other = await assembleAgentMemory(ORG, { agentSlug: 'revenue-lead', workspaceSteps: [], userId: 'user_chris' });

    expect(Object.values(other).join('\n')).not.toContain('Boss');

    // Notified: an approved candidate with the back-link, so a reviewer can revoke.
    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate).toMatchObject({
      status: 'approved',
      memoryType: 'preference',
      scopeKind: 'user',
      scopeRef: 'user_jamie',
      decidedBy: 'fast-lane:user_jamie',
    });
    expect(candidate!.createdMemoryKey).toBe(result.ok ? result.ruleKey : null);

    const [occurrence] = await db.select().from(learningFeedbackOccurrenceSchema);

    expect(occurrence).toMatchObject({ candidateId: candidate!.id, submittedBy: 'user_jamie' });
  });

  it('refuses a turn with no user — the lane cannot write anything broader', async () => {
    expect(await recordFastLanePreference({ orgId: ORG, text: 'Always do X.' })).toEqual({ ok: false, error: 'no_user' });
    expect(await db.select().from(memorySchema)).toHaveLength(0);
  });

  it('still runs the dedup guard', async () => {
    await recordFastLanePreference({ orgId: ORG, userId: 'user_jamie', text: 'Address me as "Boss".' });

    const second = await recordFastLanePreference({ orgId: ORG, userId: 'user_jamie', text: 'Address me as "Boss"!' });

    expect(second).toMatchObject({ ok: false, error: 'near_duplicate' });
    expect(await db.select().from(memorySchema)).toHaveLength(1);
  });
});
