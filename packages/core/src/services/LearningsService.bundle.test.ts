/**
 * The bundle path is what every agent turn pays for. Worth pinning: the render
 * cache serves unchanged steps without re-rendering, a rule change busts it,
 * and bundling stamps `last_used_at` (the staleness signal) WITHOUT bumping
 * `updated_at` — a stamp that churned `updated_at` would invalidate the cache
 * it rides on, every turn, forever.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { learningSchema, learningStepSchema } = await import('@/models/Schema');
const { addLearning, bundleStepMarkdown, resetLearningsRenderCache, updateLearning } = await import('@/services/LearningsService');

const ORG = 'org_bundle';

/** Stamping is fire-and-forget; give the microtask a beat to land. */
const settle = () => new Promise(resolve => setTimeout(resolve, 25));

beforeEach(async () => {
  resetLearningsRenderCache();
  await db.delete(learningSchema);
  await db.delete(learningStepSchema);
  await db.insert(learningStepSchema).values({
    orgId: ORG,
    name: 'global',
    title: 'Global',
    description: 'Workspace-wide rules',
  });
});

describe('bundleStepMarkdown', () => {
  it('serves the second turn from cache and re-renders after a rule change', async () => {
    await addLearning({ orgId: ORG, stepName: 'global', ruleText: 'Never invent numbers.' });

    const first = await bundleStepMarkdown(ORG, ['global']);

    expect(first['/learnings/global.md']).toContain('Never invent numbers.');

    // Same fingerprint → same object out of the cache.
    const second = await bundleStepMarkdown(ORG, ['global']);

    expect(second['/learnings/global.md']).toBe(first['/learnings/global.md']);

    const [rule] = await db.select().from(learningSchema);
    await updateLearning({ orgId: ORG, ruleId: rule!.id, ruleText: 'Always cite the source line.' });

    const third = await bundleStepMarkdown(ORG, ['global']);

    expect(third['/learnings/global.md']).toContain('Always cite the source line.');
    expect(third['/learnings/global.md']).not.toContain('Never invent numbers.');
  });

  it('stamps last_used_at without touching updated_at', async () => {
    await addLearning({ orgId: ORG, stepName: 'global', ruleText: 'Never invent numbers.' });
    const [before] = await db.select().from(learningSchema);

    expect(before!.lastUsedAt).toBeNull();

    await bundleStepMarkdown(ORG, ['global']);
    await settle();

    const [after] = await db.select().from(learningSchema);

    expect(after!.lastUsedAt).not.toBeNull();
    expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
  });

  it('still skips unknown steps silently', async () => {
    const out = await bundleStepMarkdown(ORG, ['not-seeded-yet', 'global']);

    expect(Object.keys(out)).toEqual(['/learnings/global.md']);
  });
});
