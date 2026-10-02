import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The real catalog by default; a test swaps in a small one to see onboarding open without a card.
vi.mock('@/libs/workspace', async importActual => ({ ...(await importActual<typeof import('@/libs/workspace')>()), listPlugins: vi.fn() }));
// importActual('./AuthGuards') pulls in next-auth, which cannot load in the node project, so loadProject is mocked
// with a real read against the PGlite DB.
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn(), guardRole: vi.fn(), loadProject: vi.fn() }));
const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { conversationMessageSchema, conversationSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { guardAuth, guardRole, loadProject } = await import('./AuthGuards');
const workspace = await import('@/libs/workspace');
const { start } = await import('./Onboarding');

type StartResult = { conversationId: number | null; reason: string | null };
function call(): Promise<StartResult> {
  const procedure = start as unknown as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<StartResult> } };
  return procedure['~orpc'].handler({ input: undefined, context: {} });
}
function signedInAs(projectId: string, userId = 'usr-admin') {
  const ctx = { userId, orgId: projectId, accountId: 'acct-onb-r', projectId, role: 'admin', has: () => true };
  vi.mocked(guardAuth).mockResolvedValue(ctx as never);
  vi.mocked(guardRole).mockResolvedValue(ctx as never);
  vi.mocked(loadProject).mockImplementation(async (id: string) => (await db.select().from(projectSchema).where(eq(projectSchema.id, id)))[0] ?? null);
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-onb-r', name: 'Kestrel Capital', slug: 'kestrel-onb' });
  await db.insert(projectSchema).values([
    { id: 'org_onb_r1', accountId: 'acct-onb-r', slug: 'r1', name: 'Kestrel Deals', leadAgentSlug: 'workspace-lead' },
    { id: 'org_onb_r2', accountId: 'acct-onb-r', slug: 'r2', name: 'Kestrel Ops' },
  ]);
});

const realListPlugins = (await vi.importActual<typeof import('@/libs/workspace')>('@/libs/workspace')).listPlugins;

beforeEach(() => {
  vi.mocked(guardRole).mockReset();
  vi.mocked(workspace.listPlugins).mockImplementation(realListPlugins);
});

function catalogOf(count: number): ReturnType<typeof workspace.listPlugins> {
  return realListPlugins().filter(plugin => plugin.manifest.recommend.when.length > 0).slice(0, count);
}

async function openingRuns(): Promise<Array<{ type: string }>> {
  await db.update(projectSchema).set({ onboardingStartedAt: null, onboardingStartedBy: null }).where(eq(projectSchema.id, 'org_onb_r1'));
  signedInAs('org_onb_r1');
  const { conversationId } = await call();
  const [opening] = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, conversationId!));

  return opening!.runsJson ?? [];
}

describe('onboarding.start', () => {
  it('opens one conversation with the lead greeting first; a second call opens none', async () => {
    signedInAs('org_onb_r1');
    const first = await call();

    expect(first.conversationId).toEqual(expect.any(Number));

    const [convo] = await db.select().from(conversationSchema).where(eq(conversationSchema.id, first.conversationId!));

    expect(convo!.agentSlug).toBe('workspace-lead');
    expect(await call()).toEqual({ conversationId: null, reason: 'already-started' });
  });

  it('the opening message carries the opener choice card as a run', async () => {
    await db.update(projectSchema).set({ onboardingStartedAt: null, onboardingStartedBy: null }).where(eq(projectSchema.id, 'org_onb_r1'));
    signedInAs('org_onb_r1');
    const { conversationId } = await call();
    const [opening] = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, conversationId!));
    const cards = (opening!.runsJson ?? []).filter(run => run.type === 'card');

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'choice', label: 'What do you want me taking off your plate?', allowOther: true, state: 'proposed' });
    expect((cards[0] as { options: unknown[] }).options.length).toBeGreaterThanOrEqual(2);
  });

  it('two admins at once: exactly one conversation', async () => {
    await db.update(projectSchema).set({ onboardingStartedAt: null, onboardingStartedBy: null }).where(eq(projectSchema.id, 'org_onb_r1'));
    signedInAs('org_onb_r1');
    const results = await Promise.all([call(), call()]);

    expect(results.filter(r => r.conversationId !== null)).toHaveLength(1);
  });

  it.each([0, 1])('a catalog of %i plugins opens setup with no card and asks in prose', async (count) => {
    vi.mocked(workspace.listPlugins).mockReturnValue(catalogOf(count));
    const runs = await openingRuns();

    expect(runs.filter(run => run.type === 'card')).toHaveLength(0);
  });

  it('a catalog of two plugins opens setup with a card the schema accepts', async () => {
    vi.mocked(workspace.listPlugins).mockReturnValue(catalogOf(2));
    const [card] = (await openingRuns()).filter(run => run.type === 'card') as unknown as Array<{ options: unknown[] }>;

    expect(card!.options).toHaveLength(2);
  });

  it('a workspace with no lead opens nothing and stays unclaimed', async () => {
    signedInAs('org_onb_r2');

    expect(await call()).toEqual({ conversationId: null, reason: 'no-lead' });

    const [row] = await db.select({ startedAt: projectSchema.onboardingStartedAt }).from(projectSchema).where(eq(projectSchema.id, 'org_onb_r2'));

    expect(row!.startedAt).toBeNull();
  });

  it('a member is refused before anything is claimed', async () => {
    vi.mocked(guardRole).mockRejectedValueOnce(new Error('forbidden'));

    await expect(call()).rejects.toThrow('forbidden');
  });
});
