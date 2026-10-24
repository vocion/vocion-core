/**
 * The key that turns dynamic routing on (ADR 0006): a workspace's own key
 * beats the instance's, the instance's saved key beats the environment's, and
 * nothing but the resolver ever hands a key back. Runs against PGlite with a
 * throwaway vault key. The OpenRouter keys are fake.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { routingKeySchema } = await import('@/models/Schema');
const { resetCredentialVault } = await import('@/libs/crypto/credentialVault');
const { jevKeyProblem, jevKeyStatus, removeJevKey, resolveJevKey, saveJevKey } = await import('./jevKey');

const VAULT_KEY = randomBytes(32).toString('base64');
const WS = 'ws-kestrel';
const OTHER = 'ws-heron';
const INSTANCE_KEY = 'sk-or-v1-FAKE-instance-key-0000aaaa';
const WORKSPACE_KEY = 'sk-or-v1-FAKE-workspace-key-000bbbb';
const ENV_KEY = 'sk-or-v1-FAKE-environment-key-0cccc';

beforeAll(() => {
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', VAULT_KEY);
  resetCredentialVault();
});

beforeEach(async () => {
  await db.delete(routingKeySchema);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', VAULT_KEY);
});

describe('which key a workspace\'s Jev calls spend', () => {
  it('is none at all by default: routing is off', async () => {
    expect(await resolveJevKey(WS, { env: {} })).toBeNull();
    expect((await jevKeyStatus(WS, { env: {} })).effective).toBeNull();
  });

  it('is the environment\'s, then the instance\'s saved key, then the workspace\'s own', async () => {
    const env = { VOCION_JEV_API_KEY: ENV_KEY };

    expect(await resolveJevKey(WS, { env })).toEqual({ key: ENV_KEY, scope: 'instance' });

    await saveJevKey({ scope: 'instance', orgId: WS, key: INSTANCE_KEY, by: 'u-sam' });

    expect(await resolveJevKey(WS, { env })).toEqual({ key: INSTANCE_KEY, scope: 'instance' });

    await saveJevKey({ scope: 'workspace', orgId: WS, key: WORKSPACE_KEY, by: 'u-sam' });

    expect(await resolveJevKey(WS, { env })).toEqual({ key: WORKSPACE_KEY, scope: 'workspace' });
    // Another workspace is not touched by this one's override.
    expect(await resolveJevKey(OTHER, { env })).toEqual({ key: INSTANCE_KEY, scope: 'instance' });

    await removeJevKey('workspace', WS);

    expect(await resolveJevKey(WS, { env })).toEqual({ key: INSTANCE_KEY, scope: 'instance' });
  });

  it('stores the key encrypted, with only its last four characters in the clear', async () => {
    await saveJevKey({ scope: 'workspace', orgId: WS, key: WORKSPACE_KEY, by: 'u-sam' });
    const [row] = await db.select().from(routingKeySchema);

    expect(row).toMatchObject({ holder: `workspace:${WS}`, orgId: WS, keyHint: '…bbbb', setBy: 'u-sam' });
    expect(JSON.stringify(row)).not.toContain(WORKSPACE_KEY);
  });
});

describe('what a settings card sees', () => {
  it('both levels by their hints, which one is in force, and never a key', async () => {
    await saveJevKey({ scope: 'instance', orgId: WS, key: INSTANCE_KEY, by: 'u-sam' });
    await saveJevKey({ scope: 'workspace', orgId: WS, key: WORKSPACE_KEY, by: 'u-ana' });
    const status = await jevKeyStatus(WS, { env: { VOCION_JEV_API_KEY: ENV_KEY } });

    expect(status).toMatchObject({ effective: 'workspace', workspace: { hint: '…bbbb', source: 'saved', setBy: 'u-ana' }, instance: { hint: '…aaaa', source: 'saved' } });
    expect(JSON.stringify(status)).not.toMatch(/sk-or-/);
  });

  it('says when the instance key comes from the environment', async () => {
    expect((await jevKeyStatus(WS, { env: { VOCION_JEV_API_KEY: ENV_KEY } })).instance).toEqual({ hint: '…cccc', source: 'env', setBy: null, updatedAt: null });
  });
});

describe('what may be saved', () => {
  it('only something shaped like an OpenRouter key', async () => {
    expect(jevKeyProblem('')).toMatch(/Paste/);
    expect(jevKeyProblem('sk-ant-abc123abc123abc123abc')).toMatch(/sk-or-/);
    expect(jevKeyProblem(` ${INSTANCE_KEY} `)).toBeNull();
    await expect(saveJevKey({ scope: 'instance', orgId: WS, key: 'nope', by: 'u-sam' })).rejects.toThrow(/OpenRouter/);
    expect(await db.select().from(routingKeySchema)).toHaveLength(0);
  });
});
