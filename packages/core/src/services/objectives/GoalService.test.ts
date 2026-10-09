/**
 * Goals against PGlite: drafted by the agent as a Decision and made only on
 * approval; a view measure counted live from the view (never ticked), its
 * move noticed and dated; milestones completed by their linked work; every
 * read and write held to the home workspace and the owner; "Your goals" in
 * Personal across the person's workspaces, an Org that keeps its items out
 * of Personal reaching it only as a count; and the conversation that set the
 * goal working on it. The index itself is the state module's business (and
 * tests): here a view is an input. Fixtures are fictional (Northwind Expo).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/plugins/setupState', () => ({ setupStateForOrg: vi.fn(async () => []) }));

// A view and what it holds now: rows in it, and rows that match the done facets.
let viewRows = { total: 40, done: 12 };
const VIEW = { id: 1, scope: 'person', slug: 'northwind-expo-contacts', name: 'Northwind Expo contacts', description: 'People met at the Northwind Expo.', query: { sets: ['mail.thread'], filter: { label: 'northwind-expo' } }, inBrief: false };
vi.mock('@/services/state/state', () => ({
  viewBySlug: vi.fn(async (slug: string) => (slug === VIEW.slug ? VIEW : undefined)),
  viewsFor: vi.fn(async () => [VIEW]),
  checkQuery: vi.fn(() => []),
  runStateQuery: vi.fn(async (q: { filter?: Record<string, unknown> }) => ({ rows: [], total: q.filter && 'reply_state' in q.filter ? viewRows.done : viewRows.total, sources: [], missing: [] })),
}));

// Personal's reach (`services/personal/reach.ts`): home Org in full, a client Org that keeps its items out.
vi.mock('@/services/personal/reach', () => ({
  personalReach: vi.fn(async () => [
    { accountId: 'acct-goal-northwind', name: 'Northwind', slug: 'northwind', mode: 'full', home: true },
    { accountId: 'acct-goal-kestrel', name: 'Kestrel Capital', slug: 'kestrel', mode: 'counts', home: false },
  ]),
}));
vi.mock('@/services/personal/acrossOrgs', () => ({
  reachedWorkspaces: vi.fn(async () => [
    { id: 'proj-goal-gtm', slug: 'gtm', name: 'GTM', accountId: 'acct-goal-northwind', accountName: 'Northwind', accountSlug: 'northwind', mode: 'full' },
    { id: 'proj-goal-kestrel', slug: 'kestrel-deal', name: 'Deal desk', accountId: 'acct-goal-kestrel', accountName: 'Kestrel Capital', accountSlug: 'kestrel', mode: 'counts' },
  ]),
}));
vi.mock('@/services/workspace/personalProject', () => ({
  findPersonalProject: vi.fn(async () => ({ id: 'proj-goal-personal', accountId: 'acct-goal-northwind', slug: 'personal-dana' })),
}));

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema, conversationSchema, goalSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { goalCreateAction } = await import('@/libs/actions/goal-create');
const svc = await import('./GoalService');
const { currentObjective } = await import('./ObjectiveService');
const { goalTools: rawGoalTools } = await import('@/services/agents/tools/goals');
/**
 * The tools, as a turn calls them.
 * @param ctx
 */
const goalTools = (ctx: unknown) => rawGoalTools(ctx as never) as unknown as Array<{ invoke: (args: unknown) => Promise<string> }>;
const { and, eq } = await import('drizzle-orm');

const GTM = 'proj-goal-gtm';
const OTHER = 'proj-goal-other';
const DANA = 'usr-goal-dana';
const PAT = 'usr-goal-pat';
const NOW = new Date('2026-10-09T15:00:00Z');

async function conversation(orgId: string, createdBy: string): Promise<number> {
  const [row] = await db.insert(conversationSchema).values({ orgId, projectId: orgId, agentSlug: 'lead', title: 'expo follow-ups', createdBy }).returning({ id: conversationSchema.id });
  return row!.id;
}

/**
 * A goal made the only way one is made: the card's Approve runs goal.create.
 * @param input
 * @param opts
 * @param opts.orgId
 * @param opts.userId
 * @param opts.conversationId
 */
async function approved(input: Record<string, unknown>, opts: { orgId?: string; userId?: string; conversationId?: number } = {}) {
  const orgId = opts.orgId ?? GTM;
  const userId = opts.userId ?? DANA;
  const parsed = goalCreateAction.inputSchema.parse(input);
  const ctx = { orgId, invokedBy: userId, proposedBy: 'agent:lead', origin: { userId, conversationId: opts.conversationId ?? null } };

  expect(await goalCreateAction.precheck!(ctx, parsed)).toBeUndefined();

  const result = await goalCreateAction.execute(ctx, parsed);
  return (await svc.getGoal(orgId, result.goalId as number))!;
}

const EXPO = { title: 'Follow up with Northwind Expo contacts', horizon: '2026-11-30', measure: { kind: 'view', view: 'northwind-expo-contacts', done: { reply_state: 'replied' }, unit: 'contacted' } };

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([{ id: 'acct-goal-northwind', name: 'Northwind', slug: 'northwind-goal' }, { id: 'acct-goal-kestrel', name: 'Kestrel Capital', slug: 'kestrel-goal' }]);
  await db.insert(projectSchema).values([
    { id: GTM, accountId: 'acct-goal-northwind', slug: 'gtm', name: 'GTM' },
    { id: OTHER, accountId: 'acct-goal-northwind', slug: 'ops', name: 'Ops' },
    { id: 'proj-goal-personal', accountId: 'acct-goal-northwind', slug: 'personal-dana', name: 'Personal', kind: 'personal' },
    { id: 'proj-goal-kestrel', accountId: 'acct-goal-kestrel', slug: 'kestrel-deal', name: 'Deal desk' },
  ]);
  await db.insert(userSchema).values([{ id: DANA, email: 'dana@northwind.example', name: 'Dana Reyes' }, { id: PAT, email: 'pat@northwind.example', name: 'Pat Lund' }]);
});

beforeEach(() => {
  viewRows = { total: 40, done: 12 };
});

describe('creating a goal', () => {
  it('is drafted by the agent as a Decision card, and nothing is stored until it is approved', async () => {
    const emitted: Array<{ type: string; recommendation?: { actionId: string; input: Record<string, unknown> } }> = [];
    const [create] = goalTools({ orgId: GTM, userId: DANA, agentSlug: 'lead', emit: (e: never) => emitted.push(e) });
    const before = await db.select().from(goalSchema);

    const said = await create!.invoke({ ...EXPO, reason: 'Dana said: make this a goal.' });

    expect(said).toMatch(/as a decision/);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: 'recommended_action', recommendation: { actionId: 'goal.create', input: { title: EXPO.title } } });
    expect(await db.select().from(goalSchema)).toHaveLength(before.length);

    // The card the person sees, editable in place, then Approve.
    const card = await goalCreateAction.reviewCard!({ orgId: GTM } as never, goalCreateAction.inputSchema.parse(emitted[0]!.recommendation!.input));

    expect(card.title).toBe(`Set a goal: ${EXPO.title}`);
    expect(card.content?.[0]).toMatchObject({ kind: 'message', id: 'goal' });

    const edited = goalCreateAction.applyContentEdits!(goalCreateAction.inputSchema.parse(emitted[0]!.recommendation!.input), [{ id: 'goal', body: (card.content![0] as { body: string }).body.replace('2026-11-30', '2026-12-15') }]);
    const conversationId = await conversation(GTM, DANA);
    const goal = await approved(edited, { conversationId });

    expect(goal).toMatchObject({ title: EXPO.title, ownerUserId: DANA, orgId: GTM, accountId: 'acct-goal-northwind', status: 'active', horizon: { kind: 'date', due: '2026-12-15' } });

    // The conversation it was set in now works on it: the strip says so.
    const strip = await currentObjective(GTM, conversationId);

    expect(strip).toMatchObject({ kind: 'goal', goalId: goal.id, name: EXPO.title, progress: '12 of 40 contacted' });
  });

  it('refuses a draft whose view is not there, and names the views that are', async () => {
    const emitted: unknown[] = [];
    const [create] = goalTools({ orgId: GTM, userId: DANA, agentSlug: 'lead', emit: (e: never) => emitted.push(e) });

    const said = await create!.invoke({ ...EXPO, measure: { kind: 'view', view: 'partners-gone-quiet', target: 10 } });

    expect(said).toMatch(/no saved view "partners-gone-quiet"[\s\S]*northwind-expo-contacts/);
    expect(emitted).toHaveLength(0);
  });

  it('has no tools at all without a person in the turn', () => {
    expect(goalTools({ orgId: GTM, emit: () => {} } as never)).toEqual([]);
  });
});

describe('a view-measured goal', () => {
  it('is counted live from its view, and a move is dated with one line of what moved', async () => {
    const goal = await approved(EXPO);
    const first = await svc.measureGoal(goal, { now: NOW });

    expect(first.progress).toMatchObject({ done: 12, total: 40, label: '12 of 40 contacted' });
    expect(first.goal).toMatchObject({ lastDone: 12, lastTotal: 40 });

    viewRows = { total: 40, done: 15 };
    const later = new Date('2026-10-12T15:00:00Z');
    const second = await svc.measureGoal(first.goal, { now: later });

    expect(second.progress.label).toBe('15 of 40 contacted');
    expect(second.goal.progressAt?.toISOString()).toBe(later.toISOString());
    expect(second.goal.activity.at(-1)).toMatchObject({ what: '15 of 40 contacted (+3)', by: 'measure' });
  });

  it('is never ticked by hand', async () => {
    const goal = await approved({ ...EXPO, title: 'Contact the rest of the Northwind Expo list' });

    await expect(svc.setGoalMilestone(GTM, goal.id, { userId: DANA, by: 'person' }, 'm1', true)).rejects.toThrow(/counted from the view/);
  });
});

describe('a milestone-measured goal', () => {
  it('marks a step done when its linked record finishes, and the person can override it', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: GTM, slug: 'partner_agreement', label: 'Partner agreement', schema: {} }).returning({ id: businessObjectTypeSchema.id });
    const [record] = await db.insert(businessObjectSchema).values({ orgId: GTM, projectId: GTM, typeId: type!.id, title: 'Contoso Supply referral terms', status: 'draft' }).returning({ id: businessObjectSchema.id });
    const goal = await approved({
      title: 'Activate referral partners',
      horizon: '2026-Q4',
      measure: { kind: 'milestones', milestones: [
        { label: 'Agree terms with Contoso Supply', link: { kind: 'record', id: String(record!.id) } },
        { label: 'Brief the first three partners' },
        { label: 'First referred deal' },
      ] },
    });

    expect((await svc.measureGoal(goal, { now: NOW })).progress.label).toBe('0 of 3 milestones');

    await db.update(businessObjectSchema).set({ status: 'signed' }).where(eq(businessObjectSchema.id, record!.id));
    const after = await svc.measureGoal((await svc.getGoal(GTM, goal.id))!, { now: NOW });

    expect(after.progress.label).toBe('1 of 3 milestones');
    expect(after.goal.activity.at(-1)?.what).toMatch(/Done: Agree terms with Contoso Supply/);

    // The person reopens it: their hand wins over the finished record, every time it is read again.
    await svc.setGoalMilestone(GTM, goal.id, { userId: DANA, by: 'person' }, 'm1', false);
    const reread = await svc.measureGoal((await svc.getGoal(GTM, goal.id))!, { now: NOW });

    expect(reread.progress.label).toBe('0 of 3 milestones');
  });
});

describe('tenant scope', () => {
  it('reads a goal only in its home workspace, and lets only its owner change it', async () => {
    const goal = await approved({ ...EXPO, title: 'Close the Bellwater Hall venue' });

    expect(await svc.getGoal(OTHER, goal.id)).toBeNull();
    await expect(svc.updateGoal(GTM, goal.id, { userId: PAT, by: 'person' }, { status: 'dropped' })).rejects.toThrow(/someone else's goal/);
    await expect(svc.updateGoal(OTHER, goal.id, { userId: DANA, by: 'person' }, { status: 'paused' })).rejects.toThrow(/No GOAL-/);

    const paused = await svc.updateGoal(GTM, goal.id, { userId: DANA, by: 'person' }, { status: 'paused' });

    expect(paused.status).toBe('paused');
    expect(paused.activity.at(-1)).toMatchObject({ what: 'Paused', by: DANA });
  });
});

describe('your goals, in Personal', () => {
  it('lists the person\'s goals across their workspaces with where each lives; an Org kept out of Personal is a count and a link', async () => {
    await approved({ title: 'Expand vertical GTM strategy', horizon: '2026-Q4', measure: { kind: 'milestones', milestones: [{ label: 'Pick two verticals' }, { label: 'Draft the playbook' }, { label: 'Run the first campaign' }] } });
    const personal = await approved({ title: 'Read two books on referral programs', horizon: '2026-12-31', measure: { kind: 'milestones', milestones: [{ label: 'Pick them' }, { label: 'Read one' }, { label: 'Read two' }] } }, { orgId: 'proj-goal-personal' });
    await approved({ title: 'Close the Kestrel Capital round', horizon: '2026-Q4', measure: { kind: 'milestones', milestones: [{ label: 'Term sheet' }, { label: 'Diligence' }, { label: 'Close' }] } }, { orgId: 'proj-goal-kestrel' });
    // Someone else's goal in the same workspace is never in Dana's list.
    await approved({ title: 'Pat\'s own goal', horizon: '2026-Q4', measure: { kind: 'milestones', milestones: [{ label: 'a1' }, { label: 'a2' }, { label: 'a3' }] } }, { userId: PAT });

    const { goals, withheld } = await svc.personalGoals(DANA, { statuses: ['active'] });

    expect(goals.every(g => g.ownerUserId === DANA)).toBe(true);
    expect(goals.find(g => g.title === 'Expand vertical GTM strategy')).toMatchObject({ workspace: { name: 'GTM', accountName: 'Northwind', personal: false }, href: expect.stringContaining('/w/gtm/dashboard/goals/') });
    expect(goals.find(g => g.id === personal.id)?.workspace).toMatchObject({ name: 'Personal', personal: true });
    expect(goals.some(g => g.title.includes('Kestrel'))).toBe(false);
    expect(withheld).toEqual([{ accountName: 'Kestrel Capital', workspace: 'Deal desk', count: 1, link: expect.stringContaining('/w/kestrel-deal/dashboard/goals') }]);
    expect(await svc.activeGoalCount({ userId: DANA })).toBeGreaterThanOrEqual(goals.length);
  });

  it('the lead is told the person\'s active goals at the top of a turn, here or across Personal', async () => {
    const here = await svc.goalsTurnNote({ orgId: GTM, userId: DANA, personal: false });
    const across = await svc.goalsTurnNote({ orgId: 'proj-goal-personal', userId: DANA, personal: true });

    expect(here).toMatch(/^THE PERSON'S ACTIVE GOALS HERE/);
    expect(here).toMatch(/GOAL-\d+ Expand vertical GTM strategy · 0 of 3 milestones · in Q4 2026/);
    expect(here).not.toMatch(/Read two books/);
    expect(across).toMatch(/Read two books on referral programs/);
    expect(await svc.goalsTurnNote({ orgId: GTM, userId: 'usr-goal-nobody', personal: false })).toBe('');
  });
});

describe('the goal tools', () => {
  it('link work, read progress live and mark a milestone with evidence, only on the person\'s own goal', async () => {
    const goal = await approved({ title: 'Build referral partner collateral', horizon: '2026-Q4', measure: { kind: 'milestones', milestones: [{ label: 'One-pager' }, { label: 'Deck' }, { label: 'Case study' }] } });
    const conversationId = await conversation(GTM, DANA);
    const [, update, link, progress, list] = goalTools({ orgId: GTM, userId: DANA, agentSlug: 'lead', emit: () => {} });

    expect(await link!.invoke({ goal: `GOAL-${goal.id}`, add: [{ kind: 'conversation', id: String(conversationId) }] })).toMatch(/links conversation “expo follow-ups”/);
    expect(await link!.invoke({ goal: goal.id, add: [{ kind: 'artifact', id: '999999' }] })).toMatch(/Not found in this workspace: artifact:999999/);
    expect(await progress!.invoke({ goal: goal.id, milestone: 'm1' })).toMatch(/evidence/);
    expect(await progress!.invoke({ goal: goal.id, milestone: 'm1', evidence: 'ART-31 written and shared' })).toMatch(/1 of 3 milestones[\s\S]*\[x\] m1 One-pager/);
    expect(await update!.invoke({ goal: goal.id, horizon: '2026-11-15' })).toMatch(/by Nov 15, 2026/);
    expect(await list!.invoke({})).toMatch(/Build referral partner collateral · 1 of 3/);

    const [, patsUpdate] = goalTools({ orgId: GTM, userId: PAT, agentSlug: 'lead', emit: () => {} });

    expect(await patsUpdate!.invoke({ goal: goal.id, status: 'dropped' })).toMatch(/someone else's goal/);
    expect((await db.select({ status: goalSchema.status }).from(goalSchema).where(and(eq(goalSchema.id, goal.id))))[0]!.status).toBe('active');
  });
});
