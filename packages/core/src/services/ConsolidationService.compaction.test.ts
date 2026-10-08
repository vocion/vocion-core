/**
 * Learning compaction against PGlite with the model stubbed — what changed
 * when compaction learned to retire as well as merge:
 *
 *   - a merge keeps what its originals earned (summed occurrence counts, each
 *     original as provenance) and retires them without deleting them, so Undo
 *     brings them back word for word;
 *   - a contradicting pair proposes retiring the OLDER rule, read off the
 *     record, never off the model's ordering;
 *   - rules nobody read or restated for the window are proposed for
 *     retirement in one batch per namespace, by code, from dated fields;
 *   - a "keep" stands for the window, a pending proposal is never doubled,
 *     authored rules and a person's own preferences are left alone;
 *   - and none of it crosses a workspace.
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

vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));
vi.mock('@/services/adoption/attribution', () => ({ agentSlugFromPrincipal: vi.fn(() => undefined) }));

const { db } = await import('@/libs/DB');
const { and, eq } = await import('drizzle-orm');
const { learningCandidateSchema, learningFeedbackOccurrenceSchema, memoryNamespaceSchema, memorySchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { compactionBatches, compactNamespace, COMPACT_BATCH_RULES, keysUnderReview, proposeStaleRetirements, relatedGroups, runConsolidation, staleRules } = await import('@/services/ConsolidationService');
const { decideCandidate, unadoptCandidate } = await import('@/services/LearningCandidateService');
const { getNamespace, retireRules, ruleSnapshots } = await import('@/services/MemoryService');
const { MEMORY_STORE_NAMESPACE } = await import('@/libs/memory/store');

const ORG = 'org_compaction';
const OTHER = 'org_compaction_other';
const DAY = 86_400_000;
const NOW = new Date('2026-10-08T12:00:00Z');

/**
 * Seed a rule as the store holds one, bypassing the add-gate's dedup.
 * @param opts - Where and what.
 * @param opts.org - The workspace.
 * @param opts.path - Namespace path.
 * @param opts.slug - Rule file slug.
 * @param opts.text - Rule text.
 * @param opts.count - Occurrence count.
 * @param opts.source - Provenance.
 * @param opts.createdAt - When it was adopted.
 * @param opts.lastUsedAt - When an agent last mounted it.
 */
async function seedRule(opts: { org?: string; path?: string; slug: string; text: string; count?: number; source?: string | null; createdAt?: Date; lastUsedAt?: Date | null }): Promise<string> {
  const key = `/${opts.path ?? 'workspace/global'}/${opts.slug}.md`;
  const at = (opts.createdAt ?? NOW).toISOString();
  await db.insert(memorySchema).values({
    orgId: opts.org ?? ORG,
    namespace: MEMORY_STORE_NAMESPACE,
    key,
    value: { content: opts.text, mimeType: 'text/markdown', created_at: at, modified_at: at, meta: { kind: 'rule', source: opts.source ?? null, createdBy: null, occurrenceCount: opts.count ?? 1, adoptedAt: at } },
    createdAt: opts.createdAt ?? NOW,
    lastUsedAt: opts.lastUsedAt ?? null,
  });
  return key;
}

async function namespace(org: string, name: string, path: string, scopeKind = 'workspace'): Promise<void> {
  await db.insert(memoryNamespaceSchema).values({ orgId: org, name, path, scopeKind, title: name, description: `${name} rules` });
}

const modelSays = (payload: unknown) => invokeMock.mockResolvedValue({ content: JSON.stringify(payload) });

async function storedRow(key: string, org = ORG) {
  const [row] = await db.select().from(memorySchema).where(and(eq(memorySchema.orgId, org), eq(memorySchema.key, key)));
  return row;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(learningFeedbackOccurrenceSchema);
  await db.delete(learningCandidateSchema);
  await db.delete(memorySchema);
  await db.delete(memoryNamespaceSchema);
  await namespace(ORG, 'global', 'workspace/global');
  await namespace(OTHER, 'global', 'workspace/global');
});

describe('a merge keeps what its originals earned', () => {
  it('sums occurrence counts, keeps each original as provenance, and retires rather than deletes', async () => {
    const a = await seedRule({ slug: 'r1', text: 'Always cite the source line for every number you state.', count: 4, source: 'feedback:11' });
    const b = await seedRule({ slug: 'r2', text: 'Always cite the source document for every number you quote.', count: 3, source: 'feedback:12' });
    modelSays({ merged: [{ text: 'Every number must cite its source inline.', replaces: [1, 2] }] });

    expect(await compactNamespace(ORG, 'global', { now: NOW })).toBe(1);

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate).toMatchObject({ changeKind: 'merge', replacesKeys: [a, b] });
    expect(candidate!.evidence).toMatchObject({ reason: 'merged', rules: [{ key: a, occurrenceCount: 4 }, { key: b, occurrenceCount: 3 }] });

    const decided = await decideCandidate({ orgId: ORG, id: candidate!.id, decision: 'approve', decidedBy: 'u_reviewer' });

    expect(decided.ok).toBe(true);

    const live = (await getNamespace(ORG, 'global')).rules;

    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ ruleText: 'Every number must cite its source inline.', occurrenceCount: 7 });

    const merged = await storedRow(live[0]!.key);
    const meta = (merged!.value as { meta: { mergedFrom: Array<{ key: string; occurrenceCount: number; source: string }> } }).meta;

    expect(meta.mergedFrom.map(m => [m.key, m.occurrenceCount, m.source])).toEqual([[a, 4, 'feedback:11'], [b, 3, 'feedback:12']]);

    // The originals are still there, expired, with the decision on them.
    const original = await storedRow(a);

    expect(original!.expiresAt).not.toBeNull();
    expect((original!.value as { meta: { retired: Record<string, unknown> } }).meta.retired).toMatchObject({ reason: 'merged', by: 'u_reviewer', into: live[0]!.key, candidateId: candidate!.id });
  });

  it('Undo brings the originals back word for word and takes the merged rule away', async () => {
    const a = await seedRule({ slug: 'r1', text: 'Always cite the source line for every number you state.', count: 2 });
    const b = await seedRule({ slug: 'r2', text: 'Always cite the source document for every number you quote.' });
    modelSays({ merged: [{ text: 'Every number must cite its source inline.', replaces: [1, 2] }] });
    await compactNamespace(ORG, 'global', { now: NOW });
    const [candidate] = await db.select().from(learningCandidateSchema);
    await decideCandidate({ orgId: ORG, id: candidate!.id, decision: 'approve', decidedBy: 'u_reviewer' });

    const undone = await unadoptCandidate({ orgId: ORG, id: candidate!.id, undoneBy: 'u_reviewer', reason: 'They said different things.' });

    expect(undone.undone).toBe(true);

    const live = (await getNamespace(ORG, 'global')).rules;

    expect(live.map(r => r.key).sort()).toEqual([a, b].sort());
    expect(live.find(r => r.key === a)).toMatchObject({ ruleText: 'Always cite the source line for every number you state.', occurrenceCount: 2 });
    expect((await storedRow(a))!.value).not.toHaveProperty('meta.retired');
  });

  it('a merge that collides with a rule it does not replace leaves every original live', async () => {
    await seedRule({ slug: 'r1', text: 'Always cite the source line for every number you state.' });
    await seedRule({ slug: 'r2', text: 'Always cite the source document for every number you quote.' });
    // A third rule the merged text near-duplicates, not part of the merge.
    await seedRule({ slug: 'r3', text: 'Every number must cite its source inline, always.' });
    modelSays({ merged: [{ text: 'Every number must cite its source inline.', replaces: [1, 2] }] });
    await compactNamespace(ORG, 'global', { now: NOW });
    const [candidate] = await db.select().from(learningCandidateSchema);

    const decided = await decideCandidate({ orgId: ORG, id: candidate!.id, decision: 'approve', decidedBy: 'u_reviewer' });

    expect(decided).toMatchObject({ ok: false, error: 'near_duplicate' });
    expect((await getNamespace(ORG, 'global')).rules).toHaveLength(3);
  });
});

describe('contradictions', () => {
  it('proposes retiring the older rule of a pair, whatever order the model named them in', async () => {
    const older = await seedRule({ slug: 'old', text: 'Always open outreach emails with a compliment about the company.', createdAt: new Date(NOW.getTime() - 40 * DAY) });
    const newer = await seedRule({ slug: 'new', text: 'Never open outreach emails with a compliment about the company.', createdAt: new Date(NOW.getTime() - 2 * DAY) });
    // The model names the NEWER rule first; code decides which is older.
    modelSays({ merged: [], contradicted: [{ a: 2, b: 1, why: 'One says always, the other never.' }] });

    expect(await compactNamespace(ORG, 'global', { now: NOW })).toBe(1);

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate).toMatchObject({ changeKind: 'expire', replacesKeys: [older] });
    expect(candidate!.evidence).toMatchObject({ reason: 'contradicted', supersededBy: { key: newer }, why: 'One says always, the other never.' });

    await decideCandidate({ orgId: ORG, id: candidate!.id, decision: 'approve', decidedBy: 'u_reviewer' });

    expect((await getNamespace(ORG, 'global')).rules.map(r => r.key)).toEqual([newer]);

    await unadoptCandidate({ orgId: ORG, id: candidate!.id, undoneBy: 'u_reviewer' });

    expect((await getNamespace(ORG, 'global')).rules.map(r => r.key).sort()).toEqual([newer, older].sort());
  });

  it('keeping a rule needs no reason, and keeps it out of the next pass for the window', async () => {
    const older = await seedRule({ slug: 'old', text: 'Always open outreach emails with a compliment about the company.', createdAt: new Date(NOW.getTime() - 40 * DAY) });
    await seedRule({ slug: 'new', text: 'Never open outreach emails with a compliment about the company.' });
    modelSays({ merged: [], contradicted: [{ a: 1, b: 2 }] });
    await compactNamespace(ORG, 'global', { now: NOW });
    const [candidate] = await db.select().from(learningCandidateSchema);

    const kept = await decideCandidate({ orgId: ORG, id: candidate!.id, decision: 'reject', decidedBy: 'u_reviewer' });

    expect(kept.ok).toBe(true);
    expect((await keysUnderReview(ORG, 60, NOW)).has(older)).toBe(true);

    invokeMock.mockClear();
    modelSays({ merged: [], contradicted: [{ a: 1, b: 2 }] });

    // Only one rule is open now, so there is nothing to compare.
    expect(await compactNamespace(ORG, 'global', { now: NOW })).toBe(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('stale retirements', () => {
  const old = new Date(NOW.getTime() - 90 * DAY);

  it('names the rules nobody read or restated for the window, in one batch, and nothing else', async () => {
    const quiet = await seedRule({ slug: 'quiet', text: 'Mention the spring promotion in every reply.', createdAt: old });
    const read = await seedRule({ slug: 'read', text: 'Sign off with the account owner name.', createdAt: old, lastUsedAt: new Date(NOW.getTime() - 3 * DAY) });
    const restated = await seedRule({ slug: 'restated', text: 'Quote prices in the customer currency.', createdAt: old });
    await seedRule({ slug: 'fresh', text: 'Answer in the language the customer wrote in.', createdAt: new Date(NOW.getTime() - 5 * DAY) });
    await seedRule({ slug: 'ws-7', text: 'Authored in the workspace repository, quiet as well.', createdAt: old, source: 'workspace:7' });
    await db.insert(learningFeedbackOccurrenceSchema).values({ orgId: ORG, memoryKey: restated, polarity: 'reinforce', note: 'yes, still true', createdAt: new Date(NOW.getTime() - 10 * DAY) });

    expect(await proposeStaleRetirements(ORG, 'global', { staleDays: 60, now: NOW })).toBe(1);

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate).toMatchObject({ changeKind: 'expire', replacesKeys: [quiet], status: 'pending' });
    expect(candidate!.evidence).toMatchObject({ reason: 'stale', staleDays: 60, rules: [{ key: quiet, lastUsedAt: null, lastReinforcedAt: null }] });
    expect(candidate!.ruleText).toContain('no agent has read and nobody has restated in 60 days');
    expect([read, restated].some(k => candidate!.replacesKeys!.includes(k))).toBe(false);
    // No model was asked: staleness is read off dated fields.
    expect(invokeMock).not.toHaveBeenCalled();

    // One pending retirement per namespace at a time.
    expect(await proposeStaleRetirements(ORG, 'global', { staleDays: 60, now: NOW })).toBe(0);

    await decideCandidate({ orgId: ORG, id: candidate!.id, decision: 'approve', decidedBy: 'u_reviewer' });

    expect((await getNamespace(ORG, 'global')).rules.map(r => r.key)).not.toContain(quiet);
    expect((await storedRow(quiet))!.expiresAt).not.toBeNull();
  });

  it('never retires a person\'s own preferences for being quiet', async () => {
    await namespace(ORG, 'users-u1-preferences', 'users/u1/preferences', 'user');
    await seedRule({ path: 'users/u1/preferences', slug: 'p1', text: 'Write to me in bullet points.', createdAt: old });

    expect(await proposeStaleRetirements(ORG, 'users-u1-preferences', { staleDays: 60, now: NOW })).toBe(0);
  });

  it('runs inside the consolidation pass on the workspace\'s own window', async () => {
    await db.insert(tenantAccountSchema).values({ id: 'acct_compaction', name: 'Northwind', slug: 'northwind-compaction' }).onConflictDoNothing();
    await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_compaction', slug: 'compaction', name: 'Northwind', orgReview: { staleRuleDays: 120 } }).onConflictDoNothing();
    await seedRule({ slug: 'quiet', text: 'Mention the spring promotion in every reply.', createdAt: old });
    modelSays({ merged: [], rules: [] });

    // 90 days quiet is under this workspace's 120-day window.
    const result = await runConsolidation(ORG, { now: NOW });

    expect(result.retirements).toBe(0);

    await db.delete(projectSchema).where(eq(projectSchema.id, ORG));
  });
});

describe('batches and groups', () => {
  it('groups related rules and never splits a group that fits a batch', () => {
    const rules = [
      { key: 'a', ruleText: 'Always cite the source line for every number you state.' },
      { key: 'b', ruleText: 'Reply in the language the customer wrote in.' },
      { key: 'c', ruleText: 'Always cite the source document for every number you quote.' },
    ];

    expect(relatedGroups(rules).map(g => g.map(r => r.key))).toEqual([['a', 'c']]);
    expect(compactionBatches(rules, false).map(b => b.map(r => r.key))).toEqual([['a', 'c']]);
    expect(compactionBatches(rules, true).map(b => b.map(r => r.key))).toEqual([['a', 'c', 'b']]);
  });

  it('cuts a large bucket into batches the model can be held to', () => {
    const rules = Array.from({ length: 150 }, (_, i) => ({ key: `k${i}`, ruleText: `Distinct standing rule number ${i} about topic ${i}.` }));
    const batches = compactionBatches(rules, true);

    expect(batches.every(b => b.length <= COMPACT_BATCH_RULES)).toBe(true);
    expect(batches.flat()).toHaveLength(150);
  });

  it('reads staleness as the latest sign of life — adopted, mounted or restated', () => {
    const rules = [
      { key: 'a', createdAt: new Date(NOW.getTime() - 100 * DAY), lastUsedAt: null },
      { key: 'b', createdAt: new Date(NOW.getTime() - 100 * DAY), lastUsedAt: new Date(NOW.getTime() - DAY) },
      { key: 'c', createdAt: new Date(NOW.getTime() - 100 * DAY), lastUsedAt: null },
      { key: 'd', createdAt: new Date(NOW.getTime() - 200 * DAY), lastUsedAt: null },
    ];
    const reinforced = new Map([['c', new Date(NOW.getTime() - 2 * DAY)]]);

    expect(staleRules(rules, reinforced, 60, NOW).map(r => r.key)).toEqual(['d', 'a']);
  });
});

describe('workspace scoping', () => {
  it('compacts, snapshots and retires only the workspace it was asked about', async () => {
    const mine = await seedRule({ slug: 'r1', text: 'Always cite the source line for every number you state.' });
    await seedRule({ slug: 'r2', text: 'Always cite the source document for every number you quote.' });
    const theirs = await seedRule({ org: OTHER, slug: 'r1', text: 'Always cite the source line for every number you state.' });
    modelSays({ merged: [{ text: 'Every number must cite its source inline.', replaces: [1, 2] }] });
    await compactNamespace(ORG, 'global', { now: NOW });

    // The same key in another workspace is not this workspace's rule.
    expect(await ruleSnapshots(OTHER, [mine])).toHaveLength(1);
    expect(await retireRules({ orgId: ORG, keys: [theirs], reason: 'stale', by: 'x' })).toHaveLength(1);
    expect((await storedRow(theirs, OTHER))!.expiresAt).toBeNull();

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate!.orgId).toBe(ORG);
    expect(await keysUnderReview(OTHER, 60, NOW)).toEqual(new Set());
    expect(await decideCandidate({ orgId: OTHER, id: candidate!.id, decision: 'approve', decidedBy: 'u_other' })).toMatchObject({ ok: false, error: 'not_found' });
    expect((await getNamespace(OTHER, 'global')).rules).toHaveLength(1);
  });
});
