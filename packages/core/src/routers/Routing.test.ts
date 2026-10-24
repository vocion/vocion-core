/**
 * The Jev key routes (ADR 0006): admins only for a write, the instance key
 * not settable from one Org of a multi-Org server, a bad key refused before
 * it is stored, and no route that returns a key. `guardAuth` is mocked: the
 * session is not under test, what the routes do with its role is.
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn(), guardRole: vi.fn(), loadProject: vi.fn() }));
const multi = vi.hoisted(() => ({ on: false }));
vi.mock('@/services/OrgPolicy', () => ({ orgsMode: () => (multi.on ? 'multi' : 'single') }));

const { db } = await import('@/libs/DB');
const { routingKeySchema } = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const { resetCredentialVault } = await import('@/libs/crypto/credentialVault');
const { removeKey, saveKey, status } = await import('./Routing');

const ORG = 'org_routing_test';
const KEY = 'sk-or-v1-FAKE-router-test-key-00dddd';

function signedInAs(role: 'admin' | 'member') {
  vi.mocked(guardAuth).mockResolvedValue({
    userId: 'usr-1',
    orgId: ORG,
    accountId: 'acct-1',
    projectId: ORG,
    role,
    has: ({ role: required }: { role: string }) => (required === 'org:admin' ? role === 'admin' : true),
  } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

function call<T = unknown>(route: unknown, input?: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

beforeAll(() => {
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('VOCION_JEV_API_KEY', '');
  resetCredentialVault();
});

beforeEach(async () => {
  multi.on = false;
  await db.delete(routingKeySchema);
});

describe('saving the key', () => {
  it('refuses a member at either level', async () => {
    signedInAs('member');

    await expect(call(saveKey, { scope: 'workspace', key: KEY })).rejects.toMatchObject({ status: 403 });
    await expect(call(saveKey, { scope: 'instance', key: KEY })).rejects.toMatchObject({ status: 403 });
    await expect(call(removeKey, { scope: 'workspace' })).rejects.toMatchObject({ status: 403 });
  });

  it('lets an admin save either level, and answers with the hint, never the key', async () => {
    signedInAs('admin');
    const saved = await call(saveKey, { scope: 'workspace', key: KEY });
    await call(saveKey, { scope: 'instance', key: KEY });

    expect(saved).toMatchObject({ hint: '…dddd', source: 'saved' });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(await db.select().from(routingKeySchema)).toHaveLength(2);
  });

  it('refuses something that is not an OpenRouter key, before it is stored', async () => {
    signedInAs('admin');

    await expect(call(saveKey, { scope: 'workspace', key: 'sk-ant-not-openrouter-000000' })).rejects.toMatchObject({ status: 400 });
    expect(await db.select().from(routingKeySchema)).toHaveLength(0);
  });

  it('keeps the instance key out of one Org\'s hands on a multi-Org server', async () => {
    signedInAs('admin');
    multi.on = true;

    await expect(call(saveKey, { scope: 'instance', key: KEY })).rejects.toMatchObject({ status: 400 });
    expect(await call(saveKey, { scope: 'workspace', key: KEY })).toMatchObject({ hint: '…dddd' });
  });
});

describe('the status', () => {
  it('says which level is in force and what this viewer may do, with hints only', async () => {
    signedInAs('admin');
    await call(saveKey, { scope: 'instance', key: KEY });
    signedInAs('member');
    const s = await call<Record<string, unknown>>(status);

    expect(s).toMatchObject({ effective: 'instance', instance: { hint: '…dddd' }, workspace: null, canSetWorkspace: false, canSetInstance: false });
    expect(JSON.stringify(s)).not.toContain(KEY);
  });
});
