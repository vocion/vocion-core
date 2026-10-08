/**
 * The Software Factory section's routes (Vocion 5.1): runner tokens minted, listed and revoked by
 * an account admin, and the target per workspace, against PGlite. `guardAuth` is mocked because
 * the session is not under test; what the routes do with the account and role it reports is.
 * Two companies, Northwind and Kestrel Capital, share the host. Every id and secret is invented.
 */
import process from 'node:process';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const previousRunners = process.env.VOCION_RUNNERS;
process.env.VOCION_RUNNERS = JSON.stringify({
  targets: [
    { name: 'on-box', kind: 'on-box' },
    { name: 'northwind-fargate', kind: 'aws-fargate', region: 'us-east-1', cluster: 'northwind-runners', taskDefinition: 'vocion-runner', subnets: ['subnet-0aaa1111bbbb2222c'], securityGroups: ['sg-0ddd3333eeee4444f'] },
  ],
});

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn(), guardRole: vi.fn(), loadProject: vi.fn() }));

const { db } = await import('@/libs/DB');
const { projectSchema, runnerTokenSchema, tenantAccountSchema } = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const routes = await import('./Runners');
const { verifyRunnerToken } = await import('@/services/runners/runnerTokens');

const NORTHWIND = 'acct_runners_router_nw';
const KESTREL = 'acct_runners_router_kc';
const NW_FACTORY = 'org_runners_router_nw';
const NW_LABS = 'org_runners_router_nw_labs';
const KC_FACTORY = 'org_runners_router_kc';

function signedInAs(role: 'admin' | 'member', accountId = NORTHWIND, projectId = NW_FACTORY) {
  vi.mocked(guardAuth).mockResolvedValue({
    userId: `usr-${accountId}`,
    orgId: projectId,
    accountId,
    projectId,
    role,
    has: ({ role: required }: { role: string }) => (required === 'org:admin' ? role === 'admin' : true),
  } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

function call<T = any>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

beforeEach(async () => {
  await db.delete(runnerTokenSchema);
  await db.delete(projectSchema).where(inArray(projectSchema.id, [NW_FACTORY, NW_LABS, KC_FACTORY]));
  await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, [NORTHWIND, KESTREL]));
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-runners-router' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-runners-router' },
  ]);
  await db.insert(projectSchema).values([
    { id: NW_FACTORY, accountId: NORTHWIND, slug: 'factory', name: 'Northwind factory' },
    { id: NW_LABS, accountId: NORTHWIND, slug: 'labs', name: 'Northwind labs' },
    { id: KC_FACTORY, accountId: KESTREL, slug: 'factory', name: 'Kestrel factory' },
  ]);
});

afterAll(() => {
  process.env.VOCION_RUNNERS = previousRunners;
});

describe('runner tokens', () => {
  it('only an account admin sees or mints them', async () => {
    signedInAs('member');

    await expect(call(routes.overviewRoute, {})).rejects.toMatchObject({ status: 403 });
    await expect(call(routes.createTokenRoute, { name: 'x', projectIds: null, expiresAt: null })).rejects.toMatchObject({ status: 403 });
  });

  it('shows the token once, lists it without its secret, and the token claims for its account', async () => {
    signedInAs('admin');
    const created = await call<{ id: string; token: string }>(routes.createTokenRoute, { name: 'Northwind on-box', projectIds: [NW_LABS], expiresAt: null });

    expect(created.token).toMatch(/^vcn_runner_[a-f0-9]{16}_[a-f0-9]{64}$/);
    expect(await verifyRunnerToken(created.token)).toEqual({ tokenId: created.id, accountId: NORTHWIND, projectIds: [NW_LABS] });

    const overview = await call(routes.overviewRoute, {});

    expect(overview.tokens).toEqual([expect.objectContaining({ id: created.id, name: 'Northwind on-box', keyHint: `…${created.token.slice(-4)}`, workspaces: [{ id: NW_LABS, name: 'Northwind labs' }], revokedAt: null })]);
    // Nothing on the list could be used to claim: no secret, no hash.
    expect(JSON.stringify(overview)).not.toContain(created.token.split('_').pop()!.slice(0, 12));
    expect(overview.workspaces.map((w: { id: string }) => w.id)).toEqual([NW_FACTORY, NW_LABS]);
    expect(overview.targets).toEqual([{ name: 'on-box', kind: 'on-box' }, { name: 'northwind-fargate', kind: 'aws-fargate' }]);
  });

  it('an empty workspace list is refused, never read as every workspace', async () => {
    signedInAs('admin');

    await expect(call(routes.createTokenRoute, { name: 'Nothing', projectIds: [], expiresAt: null })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/at least one workspace/) });
    expect((await call(routes.overviewRoute, {})).tokens).toEqual([]);
  });

  it('cannot be minted for another account\'s workspace', async () => {
    signedInAs('admin');

    await expect(call(routes.createTokenRoute, { name: 'Reach', projectIds: [KC_FACTORY], expiresAt: null })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/this account's own workspaces/) });
  });

  it('one account cannot see or revoke another account\'s token', async () => {
    signedInAs('admin');
    const created = await call<{ id: string; token: string }>(routes.createTokenRoute, { name: 'Northwind on-box', projectIds: null, expiresAt: null });

    signedInAs('admin', KESTREL, KC_FACTORY);

    expect((await call(routes.overviewRoute, {})).tokens).toEqual([]);
    await expect(call(routes.revokeTokenRoute, { id: created.id })).rejects.toMatchObject({ status: 404 });
    expect(await verifyRunnerToken(created.token)).not.toBeNull();

    signedInAs('admin');
    await call(routes.revokeTokenRoute, { id: created.id });

    expect(await verifyRunnerToken(created.token)).toBeNull();
    expect((await call(routes.overviewRoute, {})).tokens).toEqual([]);
    expect((await call(routes.overviewRoute, { includeRevoked: true })).tokens[0].revokedAt).toBeInstanceOf(Date);
  });
});

describe('the target per workspace', () => {
  it('an admin names a declared target for a workspace or the account, and the workspace\'s wins', async () => {
    signedInAs('admin');
    await call(routes.setAccountTargetRoute, { target: 'on-box' });

    expect((await call(routes.overviewRoute, {})).current).toEqual({ target: 'on-box', from: 'account' });

    await call(routes.setWorkspaceTargetRoute, { projectId: NW_FACTORY, target: 'northwind-fargate' });

    expect((await call(routes.overviewRoute, {})).current).toEqual({ target: 'northwind-fargate', from: 'workspace' });

    await call(routes.setWorkspaceTargetRoute, { projectId: NW_FACTORY, target: null });

    expect((await call(routes.overviewRoute, {})).current).toEqual({ target: 'on-box', from: 'account' });
  });

  it('refuses a target the installation does not declare, and another account\'s workspace', async () => {
    signedInAs('admin');

    await expect(call(routes.setWorkspaceTargetRoute, { projectId: NW_FACTORY, target: 'azure-east' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/not a runner target this installation declares/) });
    await expect(call(routes.setWorkspaceTargetRoute, { projectId: KC_FACTORY, target: 'on-box' })).rejects.toMatchObject({ status: 404 });

    const [kestrel] = await db.select().from(projectSchema).where(eq(projectSchema.id, KC_FACTORY));

    expect(kestrel!.runnerTarget).toBeNull();
  });

  it('a member cannot move where a workspace\'s code runs', async () => {
    signedInAs('member');

    await expect(call(routes.setWorkspaceTargetRoute, { projectId: NW_FACTORY, target: 'on-box' })).rejects.toMatchObject({ status: 403 });
    await expect(call(routes.setAccountTargetRoute, { target: 'on-box' })).rejects.toMatchObject({ status: 403 });
  });
});
