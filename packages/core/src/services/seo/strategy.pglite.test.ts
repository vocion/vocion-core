import type { AuditFinding } from './audit';
import type { RuntimeContext } from '@/services/agents/types';
/**
 * A client's strategy as a goal, end to end on PGlite: the tool drafts ONE
 * goal card with milestones linked to the audit and the prompts, writes the
 * strategy document and the Strategy row; once the person approves the card
 * the row finds the goal; and each milestone completes when its own linked
 * work does — all audit findings verified fixed, a prompt the client is named
 * for. Every client here is fictional.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { installPluginBundles } = await import('@/services/plugins/installBundle');
const { createDataRoom, updateDataRoom } = await import('@/services/DataRoomService');
const { seoDraftStrategyTool } = await import('@/services/agents/tools/seoStrategy');
const { goalCreateAction } = await import('@/libs/actions/goal-create');
const { fileAudit, moveFindings } = await import('./audits');
const { keepPrompts } = await import('./prompts');
const { getStrategy, refreshStrategy } = await import('./strategy');
const { getGoal } = await import('@/services/objectives/GoalService');

const ORG = 'proj_seo_strategy_brightline';
const USER = 'usr-strategy-mara';
let projectId = 0;
let auditId = 0;

const finding = (key: string, severity: AuditFinding['severity']): AuditFinding => ({ key, check: key, category: 'ai_visibility', severity, title: key, evidence: 'read', checkedAt: '2026-10-29T10:00:00.000Z', status: 'open' });

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-strategy', name: 'Brightline Studio', slug: 'brightline-strategy' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-strategy', slug: 'brightline-strategy', name: 'Brightline Studio', timeZone: 'America/Chicago', leadAgentSlug: 'workspace-lead' });
  await db.insert(userSchema).values({ id: USER, email: 'mara@brightline.example', name: 'Mara' }).onConflictDoNothing();

  await db.insert(accountMembershipSchema).values({ accountId: 'acct-strategy', userId: USER, role: 'admin' });

  expect((await installPluginBundles({ orgId: ORG, plugins: ['seo'], appliedBy: 'user:mara' })).errors).toEqual([]);

  projectId = (await createDataRoom(ORG, USER, { title: 'Tally Books', client: 'Tally Books', domains: ['tally-books.example'] })).id;
  await updateDataRoom(ORG, projectId, { seoProfile: { clientType: 'b2b_saas', goals: ['ai_answers', 'organic_leads'], offering: 'Invoicing for creative agencies' } });
  auditId = (await fileAudit(ORG, { project: { id: projectId, title: 'Tally Books' }, site: 'https://tally-books.example', checkedAt: '2026-10-29T10:00:00.000Z', findings: [finding('no_org_schema', 'high'), finding('thin', 'low')], pagesRead: 12, coverage: { complete: true, checkedChecks: ['no_org_schema', 'thin'], checkedUrls: ['https://tally-books.example'], note: 'All planned checks completed' }, by: USER }))!.audit.id;
  await keepPrompts(ORG, projectId, [{ prompt: 'best invoicing tool for agencies', group: 'category' }, { prompt: 'Tally Books vs Ledgerly', group: 'comparison' }], { source: 'agent', by: USER });
});

type Card = { type: string; recommendation?: { actionId: string; input: Parameters<typeof goalCreateAction.execute>[1] } };

describe('a client\'s strategy goal', () => {
  let card: Card['recommendation'];

  it('is drafted as ONE goal card with milestones linked to the audit and the prompts, and a Strategy row', async () => {
    const emitted: Card[] = [];
    const ctx = { orgId: ORG, userId: USER, agentSlug: 'seo-strategist', conversationId: undefined, emit: (e: Card) => emitted.push(e) } as unknown as RuntimeContext;

    const out = String(await seoDraftStrategyTool(ctx).invoke({ project_id: projectId, horizon: '2027-Q1', topic: 'agency invoicing' }));

    expect(out).toMatch(/Put the strategy goal "Tally Books named in AI answers for agency invoicing in Q1 2027" in front of the person/);

    const cards = emitted.filter(e => e.type === 'recommended_action');

    expect(cards).toHaveLength(1);

    card = cards[0]!.recommendation!;

    expect(card.actionId).toBe('goal.create');
    expect(card.input.measure).toMatchObject({ kind: 'milestones', milestones: expect.arrayContaining([
      { label: 'Resolve the audit\'s 2 open findings', link: expect.objectContaining({ kind: 'record', id: String(auditId) }) },
      expect.objectContaining({ label: 'Named in AI answers for "best invoicing tool for agencies"', link: expect.objectContaining({ kind: 'record' }) }),
    ]) });
    expect(card.input.links).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'room', id: String(projectId) }), expect.objectContaining({ kind: 'artifact' })]));

    const row = (await getStrategy(ORG, projectId))!;

    expect(row.meta).toMatchObject({ goalStatus: 'drafted', goalTitle: 'Tally Books named in AI answers for agency invoicing in Q1 2027', documentArtifactId: expect.any(Number) });
  });

  it('waits on the person: the goal card never runs on its own, whatever the ladder would release', async () => {
    const { willExecuteOnItsOwn } = await import('@/services/ActionService');
    const onItsOwn = await willExecuteOnItsOwn({ orgId: ORG, actionId: card!.actionId, input: card!.input as never, principal: { kind: 'agent', id: 'agent:seo-strategist', scope: { orgId: ORG }, grants: ['*'], autonomy: 2 } as never, proposal: { confidence: 0.8 } });

    expect(onItsOwn).toBe(false);
    expect((await getStrategy(ORG, projectId))!.meta).toMatchObject({ goalStatus: 'drafted' });
  });

  it('finds the goal once the person approves the card, and completes each milestone when its own work does', async () => {
    const run = await goalCreateAction.execute({ orgId: ORG, invokedBy: USER, origin: { userId: USER } } as never, card!.input) as { goalId: number };
    const found = (await refreshStrategy(ORG, projectId))!;

    expect(found).toMatchObject({ goalId: run.goalId, goalStatus: 'active', progressLine: expect.stringMatching(/^0 of \d+/) });

    // Reporting a fix does not complete the milestone until a covered recheck verifies it.
    await moveFindings(ORG, auditId, ['no_org_schema'], { kind: 'mark_fixed' }, { by: USER });

    expect((await getStrategy(ORG, projectId))!.meta.milestones.find(m => m.label.includes('open findings'))?.done).toBe(false);

    await fileAudit(ORG, { project: { id: projectId, title: 'Tally Books' }, site: 'https://tally-books.example', checkedAt: '2026-11-02T00:00:00.000Z', findings: [], coverage: { complete: true, checkedChecks: ['no_org_schema', 'thin'], checkedUrls: ['https://tally-books.example'], note: 'Verified by a complete recheck' }, pagesRead: 12, by: USER });
    // The client named in an answer for the first prompt.
    await keepPrompts(ORG, projectId, [{ prompt: 'best invoicing tool for agencies', mentioned: true, checkedAt: '2026-11-02T00:00:00.000Z', checkedWith: 'Ahrefs Brand Radar export' }], { source: 'imported', by: USER });

    const after = (await getStrategy(ORG, projectId))!.meta;
    const done = after.milestones.filter(m => m.done).map(m => m.label);

    expect(done).toEqual(['Resolve the audit\'s 2 open findings', 'Named in AI answers for "best invoicing tool for agencies"']);
    expect(after.progressLine).toMatch(/^2 of \d+/);

    const goal = (await getGoal(ORG, run.goalId))!;

    expect(goal.measure.kind === 'milestones' && goal.measure.milestones.filter(m => m.done).length).toBe(2);
  });

  it('preserves approved strategy during revision and binds edited approval by ID', async () => {
    const approved = (await getStrategy(ORG, projectId))!.meta;
    const emitted: Card[] = [];
    const ctx = { orgId: ORG, userId: USER, agentSlug: 'seo-strategist', emit: (e: Card) => emitted.push(e) } as unknown as RuntimeContext;
    await seoDraftStrategyTool(ctx).invoke({ project_id: projectId, horizon: '2027-Q2', topic: 'new topic' });
    const pending = (await getStrategy(ORG, projectId))!.meta;

    expect(pending.goalId).toBe(approved.goalId);
    expect(pending.goalTitle).toBe(approved.goalTitle);
    expect(pending.documentArtifactId).toBe(approved.documentArtifactId);
    expect(pending.pendingDraft?.documentArtifactId).not.toBe(approved.documentArtifactId);

    const rejected = emitted.find(e => e.type === 'recommended_action')!.recommendation!;
    await goalCreateAction.onRejected!({ orgId: ORG, invokedBy: USER, origin: { userId: USER } } as never, rejected.input, 0);

    expect((await getGoal(ORG, approved.goalId!))!.status).toBe('active');
    expect((await getStrategy(ORG, projectId))!.meta.pendingDraft).toBeUndefined();
    expect((await getStrategy(ORG, projectId))!.meta.documentArtifactId).toBe(approved.documentArtifactId);

    emitted.length = 0;
    await seoDraftStrategyTool(ctx).invoke({ project_id: projectId, horizon: '2027-Q2', topic: 'new topic' });
    const revision = emitted.find(e => e.type === 'recommended_action')!.recommendation!;
    const input = { ...revision.input, title: 'Human edited strategy goal', horizon: '2027-09-30' };
    const result = await goalCreateAction.execute({ orgId: ORG, invokedBy: USER, origin: { userId: USER } } as never, input) as { goalId: number };

    expect((await getStrategy(ORG, projectId))!.meta).toMatchObject({ goalId: result.goalId, goalTitle: input.title });
    expect((await getStrategy(ORG, projectId))!.meta.pendingDraft).toBeUndefined();

    const previous = (await getGoal(ORG, approved.goalId!))!;

    expect(previous.status).toBe('paused');
    expect(previous.activity.filter(a => a.what === 'Paused')).toHaveLength(1);
    await expect(goalCreateAction.execute({ orgId: ORG, invokedBy: USER, origin: { userId: USER } } as never, input)).rejects.toThrow(/no longer current/);

    await goalCreateAction.undo!({ orgId: ORG, invokedBy: USER, origin: { userId: USER } } as never, input, { goalId: result.goalId, ownerUserId: USER });

    expect((await getStrategy(ORG, projectId))!.meta.goalId).toBe(approved.goalId);
    expect((await getGoal(ORG, approved.goalId!))!.status).toBe('active');
    expect(await getGoal(ORG, result.goalId)).toBeNull();
  });

  it('enforces roadmap owner, same-client execution, evidence and optimistic revision', async () => {
    const { readSeoRoadmap, updateSeoRoadmap } = await import('./roadmap');
    const first = await readSeoRoadmap(ORG, projectId, USER);

    expect(first.canEdit).toBe(true);

    const { upsertStrategy } = await import('./strategy');

    await expect(upsertStrategy(ORG, { id: projectId, title: 'Tally Books' }, { goalTitle: 'Stale draft' }, USER, null)).rejects.toThrow(/strategy changed/);
    expect((await getStrategy(ORG, projectId))!.meta.goalTitle).toBe(first.strategy!.meta.goalTitle);
    await expect(readSeoRoadmap('another-workspace', projectId, USER)).rejects.toMatchObject({ status: 404 });
    await expect(readSeoRoadmap(ORG, 999999, USER)).rejects.toMatchObject({ status: 404 });
    expect(first.availableOwners).toContainEqual({ id: USER, name: 'Mara' });

    const roadmap = { ...first.roadmap, initiatives: [{ id: 'publish', label: 'Publish pages', lane: 'now' as const, ownerUserId: USER, dependsOn: [], acceptanceCriteria: 'All approved pages live', recordIds: [], evidence: [], status: 'planned' as const }] };

    await expect(updateSeoRoadmap(ORG, projectId, 'outsider', 0, roadmap)).rejects.toThrow(/owner/);
    await expect(updateSeoRoadmap(ORG, projectId, USER, 0, { ...roadmap, initiatives: [{ ...roadmap.initiatives[0]!, recordIds: [999999] }] })).rejects.toThrow(/this client/);
    await expect(updateSeoRoadmap(ORG, projectId, USER, 0, { ...roadmap, initiatives: [{ ...roadmap.initiatives[0]!, status: 'done' }] })).rejects.toThrow(/completed linked/);

    const otherClient = await createDataRoom(ORG, USER, { title: 'Other client', client: 'Other client', domains: ['other.example'] });
    const otherAudit = (await fileAudit(ORG, { project: { id: otherClient.id, title: otherClient.title }, site: 'https://other.example', checkedAt: '2026-10-29T10:00:00.000Z', findings: [finding('missing', 'high')], pagesRead: 1, by: USER }))!.audit;

    await expect(updateSeoRoadmap(ORG, projectId, USER, 0, { ...roadmap, initiatives: [{ ...roadmap.initiatives[0]!, recordIds: [otherAudit.id] }] })).rejects.toThrow(/this client/);
    expect((await readSeoRoadmap(ORG, projectId, USER)).availableRecords.some(r => r.id === otherAudit.id)).toBe(false);

    const saved = await updateSeoRoadmap(ORG, projectId, USER, 0, roadmap);

    expect(saved.roadmap.revision).toBe(1);
    expect(saved.roadmap.outcomes).toEqual([]);
    await expect(updateSeoRoadmap(ORG, projectId, USER, 0, roadmap)).rejects.toThrow(/changed/);
  });

  it('requires publication evidence and respects transitive dependency blockers', async () => {
    const { readSeoRoadmap, updateSeoRoadmap } = await import('./roadmap');
    const { createBusinessObject } = await import('@/services/BusinessObjectService');
    const page = await createBusinessObject({ typeSlug: 'seo_page', title: 'Live page', status: 'active', metadata: { projectId, status: 'published', publishedUrl: 'https://tally-books.example/live', publishedAt: '2026-01-01T00:00:00Z' } }, ORG, USER);
    const unverified = await createBusinessObject({ typeSlug: 'seo_page', title: 'Claimed live', status: 'active', metadata: { projectId, status: 'published' } }, ORG, USER);
    if (!page || !unverified) {
      throw new Error('Page fixtures were not created');
    }
    const { mergeMeta } = await import('./records');
    await mergeMeta(ORG, page.id, () => ({ publicationVerification: { status: 'verified', url: 'https://tally-books.example/live', checkedAt: '2026-01-02T00:00:00Z', evidence: 'HTTP 200 and matching title' } }));
    const batch = await createBusinessObject({ typeSlug: 'seo_batch', title: 'Claimed complete batch', status: 'published', metadata: { projectId } }, ORG, USER);
    if (!batch) {
      throw new Error('Batch fixture was not created');
    }
    const state = await readSeoRoadmap(ORG, projectId, USER);
    const base = { label: 'Work item', lane: 'now' as const, ownerUserId: USER, acceptanceCriteria: 'Verified delivery', evidence: [], status: 'planned' as const };
    const next = { ...state.roadmap, initiatives: [
      { ...base, id: 'b', dependsOn: [], recordIds: [] },
      { ...base, id: 'a', dependsOn: ['b'], recordIds: [page.id] },
      { ...base, id: 'c', dependsOn: ['a'], recordIds: [page.id] },
      { ...base, id: 'd', dependsOn: [], recordIds: [unverified.id] },
      { ...base, id: 'e', dependsOn: [], recordIds: [page.id] },
      { ...base, id: 'f', dependsOn: [], recordIds: [batch.id] },
    ] };
    const saved = await updateSeoRoadmap(ORG, projectId, USER, state.roadmap.revision, next);

    expect(saved.roadmap.initiatives.map(i => i.status)).toEqual(['planned', 'blocked', 'blocked', 'planned', 'done', 'planned']);
    expect(saved.linkedRecords.find(r => r.id === unverified.id)?.status).toBe('publication_unverified');
    expect(saved.roadmap.outcomes).toEqual([]);
  });

  it('rejects generic finished lifecycle aliases without verified delivery', async () => {
    const { readSeoRoadmap } = await import('./roadmap');
    const { createBusinessObject } = await import('@/services/BusinessObjectService');
    const forgedAudit = await createBusinessObject({ typeSlug: 'seo_audit', title: 'Closed but unresolved', status: 'done', metadata: {} }, ORG, USER);
    const forgedPage = await createBusinessObject({ typeSlug: 'seo_page', title: 'Closed but not published', status: 'done', metadata: { projectId, status: 'closed' } }, ORG, USER);
    if (!forgedAudit || !forgedPage) {
      throw new Error('Lifecycle fixtures were not created');
    }
    const { mergeMeta } = await import('./records');
    await mergeMeta(ORG, forgedAudit.id, () => ({ projectId, coverage: { complete: true }, findings: [finding('open-medium', 'medium')] }));
    const state = await readSeoRoadmap(ORG, projectId, USER);

    expect(state.availableRecords.find(r => r.id === forgedAudit.id)?.status).toBe('verification_required');
    expect(state.availableRecords.find(r => r.id === forgedPage.id)?.status).toBe('publication_unverified');
  });
});
