import type { AuditFinding } from './audit';
import type { RuntimeContext } from '@/services/agents/types';
/**
 * A client's strategy as a goal, end to end on PGlite: the tool drafts ONE
 * goal card with milestones linked to the audit and the prompts, writes the
 * strategy document and the Strategy row; once the person approves the card
 * the row finds the goal; and each milestone completes when its own linked
 * work does — the audit's high findings fixed, a prompt the client is named
 * for. Every client here is fictional.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
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

  expect((await installPluginBundles({ orgId: ORG, plugins: ['seo'], appliedBy: 'user:mara' })).errors).toEqual([]);

  projectId = (await createDataRoom(ORG, USER, { title: 'Tally Books', client: 'Tally Books', domains: ['tally-books.example'] })).id;
  await updateDataRoom(ORG, projectId, { seoProfile: { clientType: 'b2b_saas', goals: ['ai_answers', 'organic_leads'], offering: 'Invoicing for creative agencies' } });
  auditId = (await fileAudit(ORG, { project: { id: projectId, title: 'Tally Books' }, site: 'https://tally-books.example', checkedAt: '2026-10-29T10:00:00.000Z', findings: [finding('no_org_schema', 'high'), finding('thin', 'low')], pagesRead: 12, by: USER }))!.audit.id;
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
      { label: 'Fix the audit\'s 1 high finding', link: expect.objectContaining({ kind: 'record', id: String(auditId) }) },
      expect.objectContaining({ label: 'Named in AI answers for "best invoicing tool for agencies"', link: expect.objectContaining({ kind: 'record' }) }),
    ]) });
    expect(card.input.links).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'room', id: String(projectId) }), expect.objectContaining({ kind: 'artifact' })]));

    const row = (await getStrategy(ORG, projectId))!;

    expect(row.meta).toMatchObject({ goalStatus: 'drafted', goalTitle: 'Tally Books named in AI answers for agency invoicing in Q1 2027', documentArtifactId: expect.any(Number) });
  });

  it('finds the goal once the person approves the card, and completes each milestone when its own work does', async () => {
    const run = await goalCreateAction.execute({ orgId: ORG, invokedBy: USER, origin: { userId: USER } } as never, card!.input) as { goalId: number };
    const found = (await refreshStrategy(ORG, projectId))!;

    expect(found).toMatchObject({ goalId: run.goalId, goalStatus: 'active', progressLine: expect.stringMatching(/^0 of \d+/) });

    // The audit's one high finding fixed: the audit row reads resolved, so its milestone is done.
    await moveFindings(ORG, auditId, ['no_org_schema'], { kind: 'mark_fixed' }, { by: USER });
    // The client named in an answer for the first prompt.
    await keepPrompts(ORG, projectId, [{ prompt: 'best invoicing tool for agencies', mentioned: true, checkedAt: '2026-11-02T00:00:00.000Z', checkedWith: 'Ahrefs Brand Radar export' }], { source: 'imported', by: USER });

    const after = (await getStrategy(ORG, projectId))!.meta;
    const done = after.milestones.filter(m => m.done).map(m => m.label);

    expect(done).toEqual(['Fix the audit\'s 1 high finding', 'Named in AI answers for "best invoicing tool for agencies"']);
    expect(after.progressLine).toMatch(/^2 of \d+/);

    const goal = (await getGoal(ORG, run.goalId))!;

    expect(goal.measure.kind === 'milestones' && goal.measure.milestones.filter(m => m.done).length).toBe(2);
  });
});
