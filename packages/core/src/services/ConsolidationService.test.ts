/**
 * Consolidation against PGlite with the model stubbed. The properties that
 * matter: every write the job makes is a PENDING candidate (nothing in the
 * store moves until a person approves), approval of a merge retires exactly
 * the replaced keys and lands under budget, the model failing to parse
 * proposes nothing, episodes are TTL'd raw material that never mounts into a
 * turn, and mined episodes go through the same recorder human feedback does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const invokeMock = vi.fn();

vi.mock('@/libs/llm', () => ({
  buildChatModel: () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }),
}));

vi.mock('@/libs/Langfuse', () => ({
  cleanUsageDetails: (details: unknown) => details,
  traceFor: () => ({
    update: () => {},
    generation: () => ({ end: () => {} }),
  }),
}));

const trackMock = vi.fn();

vi.mock('@/services/adoption/track', () => ({ track: (...args: unknown[]) => trackMock(...args) }));
vi.mock('@/services/adoption/attribution', () => ({ agentSlugFromPrincipal: vi.fn(() => undefined) }));

const { db } = await import('@/libs/DB');
const { learningCandidateSchema, learningFeedbackOccurrenceSchema, memoryNamespaceSchema, memorySchema } = await import('@/models/Schema');
const { compactNamespace, draftAmendments, mineEpisodes, NAMESPACE_BUDGET, runConsolidation } = await import('@/services/ConsolidationService');
const { decideCandidate } = await import('@/services/LearningCandidateService');
const { assembleAgentMemory, ensureScopedNamespace, getNamespace, listEpisodes, recordEpisode } = await import('@/services/MemoryService');
const { MEMORY_STORE_NAMESPACE } = await import('@/libs/memory/store');

const ORG = 'org_consolidation';

/**
 * Seed a rule directly, bypassing the add-gate's dedup — how a namespace full
 * of related-but-differently-worded rules accumulates in real life.
 * @param path - Namespace path.
 * @param slug - Rule file slug.
 * @param text
 */
async function seedRule(path: string, slug: string, text: string): Promise<string> {
  const key = `/${path}/${slug}.md`;
  const now = new Date().toISOString();
  await db.insert(memorySchema).values({
    orgId: ORG,
    namespace: MEMORY_STORE_NAMESPACE,
    key,
    value: { content: text, mimeType: 'text/markdown', created_at: now, modified_at: now, meta: { kind: 'rule', source: null, createdBy: null, occurrenceCount: 1, adoptedAt: now } },
  });
  return key;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(learningFeedbackOccurrenceSchema);
  await db.delete(learningCandidateSchema);
  await db.delete(memorySchema);
  await db.delete(memoryNamespaceSchema);
  await db.insert(memoryNamespaceSchema).values({
    orgId: ORG,
    name: 'global',
    path: 'workspace/global',
    title: 'Global',
    description: 'Workspace-wide rules',
  });
});

const modelSays = (payload: unknown) => invokeMock.mockResolvedValue({ content: JSON.stringify(payload) });

describe('compactNamespace', () => {
  it('proposes a pending merge carrying the replaced keys, and moves NOTHING in the store', async () => {
    const a = await seedRule('workspace/global', 'r1', 'Always cite the source line for every number you state.');
    const b = await seedRule('workspace/global', 'r2', 'Always cite the source document for every number you quote.');
    modelSays({ merged: [{ text: 'Every number must cite its source inline.', replaces: [1, 2] }] });

    const queued = await compactNamespace(ORG, 'global');

    expect(queued).toBe(1);

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate).toMatchObject({ status: 'pending', stepName: 'global' });
    expect(candidate!.replacesKeys).toEqual([a, b]);
    // The gate: both originals still live until a person approves.
    expect((await getNamespace(ORG, 'global')).rules).toHaveLength(2);
  });

  it('approval writes the merge and retires exactly the replaced rules', async () => {
    await seedRule('workspace/global', 'r1', 'Always cite the source line for every number you state.');
    await seedRule('workspace/global', 'r2', 'Always cite the source document for every number you quote.');
    const keep = await seedRule('workspace/global', 'r3', 'Reply in the user language.');
    modelSays({ merged: [{ text: 'Every number must cite its source inline.', replaces: [1, 2] }] });
    await compactNamespace(ORG, 'global');
    const [candidate] = await db.select().from(learningCandidateSchema);

    const result = await decideCandidate({ orgId: ORG, id: candidate!.id, decision: 'approve', decidedBy: 'u_reviewer' });

    expect(result.ok).toBe(true);

    const after = await getNamespace(ORG, 'global');

    expect(after.rules).toHaveLength(2); // merged + kept
    expect(after.rules.map(r => r.ruleText)).toContain('Every number must cite its source inline.');
    expect(after.rules.map(r => r.key)).toContain(keep);
    expect(trackMock).toHaveBeenCalledWith(
      { orgId: ORG, userId: 'u_reviewer' },
      'learning.consolidated',
      expect.objectContaining({ meta: { replaced: 2, stepName: 'global' } }),
    );
  });

  it('compacts an over-budget namespace back under budget without losing unmerged rules', async () => {
    for (let i = 0; i < NAMESPACE_BUDGET + 2; i++) {
      await seedRule('workspace/global', `r${i}`, `Distinct standing rule number ${i} about topic ${i}.`);
    }
    // The model merges the first three into one.
    modelSays({ merged: [{ text: 'One stronger rule covering topics 0, 1 and 2 in full.', replaces: [1, 2, 3] }] });
    await compactNamespace(ORG, 'global');
    const [candidate] = await db.select().from(learningCandidateSchema);
    await decideCandidate({ orgId: ORG, id: candidate!.id, decision: 'approve', decidedBy: 'u_reviewer' });

    const after = await getNamespace(ORG, 'global');

    expect(after.rules.length).toBe(NAMESPACE_BUDGET);
    expect(after.rules.map(r => r.ruleText)).toContain('One stronger rule covering topics 0, 1 and 2 in full.');
    expect(after.rules.map(r => r.ruleText)).toContain(`Distinct standing rule number ${NAMESPACE_BUDGET + 1} about topic ${NAMESPACE_BUDGET + 1}.`);
  });

  it('proposes nothing when the model output does not parse (fail closed)', async () => {
    await seedRule('workspace/global', 'r1', 'Always cite the source line for every number you state.');
    await seedRule('workspace/global', 'r2', 'Always cite the source document for every number you quote.');
    invokeMock.mockResolvedValue({ content: 'sorry, here is prose instead of JSON' });

    expect(await compactNamespace(ORG, 'global')).toBe(0);
    expect(await db.select().from(learningCandidateSchema)).toHaveLength(0);
  });

  it('skips a namespace that already has a pending merge', async () => {
    await seedRule('workspace/global', 'r1', 'Always cite the source line for every number you state.');
    await seedRule('workspace/global', 'r2', 'Always cite the source document for every number you quote.');
    modelSays({ merged: [{ text: 'Every number must cite its source inline.', replaces: [1, 2] }] });
    await compactNamespace(ORG, 'global');

    expect(await compactNamespace(ORG, 'global')).toBe(0);
    expect(await db.select().from(learningCandidateSchema)).toHaveLength(1);
  });
});

describe('episodes', () => {
  it('are TTL stamped, listable while fresh, and never mount into a turn', async () => {
    await recordEpisode({ orgId: ORG, runKind: 'action_run', runId: 7, agentSlug: 'revenue-lead', text: 'REJECTED (confidence 0.92): crm.update — personalization was generic.' });

    const [row] = await db.select().from(memorySchema).then(rows => rows.filter(r => r.key.startsWith('/runs/')));

    expect(row!.expiresAt).not.toBeNull();

    const fresh = await listEpisodes(ORG, new Date(0));

    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.agentSlug).toBe('revenue-lead');

    // Structurally excluded from every mounted layer.
    const files = await assembleAgentMemory(ORG, { agentSlug: 'revenue-lead', workspaceSteps: ['global'], userId: 'u', missionSlug: 'm' });

    expect(Object.keys(files).some(p => p.includes('/runs/'))).toBe(false);
  });
});

describe('mineEpisodes', () => {
  it('proposes pending candidates from repeated outcomes, through the normal recorder', async () => {
    for (const id of [1, 2, 3]) {
      await recordEpisode({ orgId: ORG, runKind: 'action_run', runId: id, agentSlug: 'revenue-lead', text: 'REJECTED: outreach email was too long.' });
    }
    modelSays({ rules: [{ text: 'Keep outreach emails under 120 words.', agent_slug: 'revenue-lead', polarity: 'correct' }] });

    const result = await mineEpisodes(ORG, new Date(0));

    expect(result).toMatchObject({ mined: 3, proposed: 1 });

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate).toMatchObject({ status: 'pending', ruleText: 'Keep outreach emails under 120 words.' });
    // Nothing adopted: the gate holds for mined rules too.
    expect((await getNamespace(ORG, 'global')).rules).toHaveLength(0);
  });

  it('mines nothing from fewer than three episodes', async () => {
    await recordEpisode({ orgId: ORG, runKind: 'action_run', runId: 1, text: 'REJECTED once.' });

    const result = await mineEpisodes(ORG, new Date(0));

    expect(result.proposed).toBe(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('draftAmendments', () => {
  it('drafts one pending amendment for a mature workflow namespace', async () => {
    const ns = await ensureScopedNamespace(ORG, 'workflow', 'mql-triage');
    for (let i = 0; i < 5; i++) {
      await seedRule(ns.path, `r${i}`, `Workflow rule ${i}: check the ${i} field before enrolling.`);
    }
    modelSays({ amendment: 'Before enrolling any lead, verify fields 0 through 4 in order.' });

    expect(await draftAmendments(ORG)).toBe(1);

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate!.ruleText.startsWith('PROCEDURE AMENDMENT:')).toBe(true);
    expect(candidate!.status).toBe('pending');

    // Idempotent while the draft is pending.
    expect(await draftAmendments(ORG)).toBe(0);
  });
});

describe('runConsolidation', () => {
  it('advances the mining cursor so the same episodes are not mined twice', async () => {
    await recordEpisode({ orgId: ORG, runKind: 'action_run', runId: 1, text: 'REJECTED: too long.' });
    await recordEpisode({ orgId: ORG, runKind: 'action_run', runId: 2, text: 'REJECTED: too long.' });
    await recordEpisode({ orgId: ORG, runKind: 'action_run', runId: 3, text: 'REJECTED: too long.' });
    modelSays({ merged: [], rules: [], amendment: 'x' });

    const first = await runConsolidation(ORG);

    expect(first.mined).toBe(3);

    const second = await runConsolidation(ORG);

    expect(second.mined).toBe(0);
  });
});
