import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { roadmapSchema } = await import('./roadmap');
const initiative = { id: 'a', label: 'Publish the brief', lane: 'now' as const, dependsOn: [] as string[], acceptanceCriteria: 'Page is live', recordIds: [], evidence: [], status: 'planned' as const };

describe('roadmap contracts', () => {
  it('rejects duplicate IDs, missing dependencies and cycles', () => {
    for (const initiatives of [
      [initiative, initiative],
      [{ ...initiative, dependsOn: ['missing'] }],
      [{ ...initiative, dependsOn: ['b'] }, { ...initiative, id: 'b', dependsOn: ['a'] }],
    ]) {
      expect(roadmapSchema.safeParse({ revision: 0, initiatives, outcomes: [] }).success).toBe(false);
    }
  });

  it('requires measurement provenance without pretending delivery is an outcome', () => {
    const base = { revision: 0, initiatives: [initiative], outcomes: [{ id: 'leads', label: 'Qualified leads', unit: 'leads', target: 10 }] };

    expect(roadmapSchema.safeParse(base).success).toBe(true);
    expect(roadmapSchema.safeParse({ ...base, outcomes: [{ ...base.outcomes[0], current: 7 }] }).success).toBe(false);
    expect(roadmapSchema.safeParse({ ...base, outcomes: [{ ...base.outcomes[0], current: 7, source: 'CRM report', observedAt: '2026-10-30T00:00:00Z', windowStart: '2026-10-01', windowEnd: '2026-10-29' }] }).success).toBe(true);
  });

  it('rejects executable URLs and invalid dates', () => {
    expect(roadmapSchema.safeParse({ revision: 0, initiatives: [{ ...initiative, evidence: [{ label: 'Unsafe', url: 'javascript:alert(1)' }] }], outcomes: [] }).success).toBe(false);
    expect(roadmapSchema.safeParse({ revision: 0, initiatives: [{ ...initiative, due: '2026-02-30' }], outcomes: [] }).success).toBe(false);
  });
});
