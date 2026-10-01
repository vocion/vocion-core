import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// importActual('./AuthGuards') pulls in next-auth, which cannot load in the node project, so loadProject is mocked
// with a real read against the PGlite DB.
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn(), guardRole: vi.fn(), loadProject: vi.fn() }));
const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { conversationSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { guardAuth, guardRole, loadProject } = await import('./AuthGuards');
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

beforeEach(() => vi.mocked(guardRole).mockReset());

describe('onboarding.start', () => {
  it('opens one conversation with the lead greeting first; a second call opens none', async () => {
    signedInAs('org_onb_r1');
    const first = await call();

    expect(first.conversationId).toEqual(expect.any(Number));

    const [convo] = await db.select().from(conversationSchema).where(eq(conversationSchema.id, first.conversationId!));

    expect(convo!.agentSlug).toBe('workspace-lead');
    expect(await call()).toEqual({ conversationId: null, reason: 'already-started' });
  });

  it('two admins at once: exactly one conversation', async () => {
    await db.update(projectSchema).set({ onboardingStartedAt: null, onboardingStartedBy: null }).where(eq(projectSchema.id, 'org_onb_r1'));
    signedInAs('org_onb_r1');
    const results = await Promise.all([call(), call()]);

    expect(results.filter(r => r.conversationId !== null)).toHaveLength(1);
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
