/**
 * The Amplitude System Key: a workspace's own key beats the instance's, the
 * instance's saved key beats the environment's, and it never collides with
 * the Jev key in the same table. Runs against PGlite with a throwaway vault
 * key. The keys are fake.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { routingKeySchema } = await import('@/models/Schema');
const { resetCredentialVault } = await import('@/libs/crypto/credentialVault');
const { AMPLITUDE_KEY, amplitudeKeyFor, amplitudeKeyStatus, removeAmplitudeKey, resetAmplitudeKeyCacheForTests, saveAmplitudeKey } = await import('./amplitudeKey');
const { resolveJevKey, saveJevKey } = await import('@/services/routing/jevKey');

const VAULT_KEY = randomBytes(32).toString('base64');
const WS = 'ws-kestrel';
const OTHER = 'ws-heron';
const INSTANCE_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa0001';
const WORKSPACE_KEY = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb0002';
const ENV_KEY = 'cccccccccccccccccccccccccccc0003';

beforeAll(() => {
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', VAULT_KEY);
  resetCredentialVault();
});

beforeEach(async () => {
  await db.delete(routingKeySchema);
  resetAmplitudeKeyCacheForTests();
  vi.stubEnv('AMPLITUDE_API_KEY', '');
  vi.stubEnv('TYPESAFE_API_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', VAULT_KEY);
});

describe('which project a workspace\'s events go to', () => {
  it('is none by default: analytics is off', async () => {
    await expect(amplitudeKeyFor(WS)).resolves.toBeNull();
  });

  it('is the environment\'s, then the instance\'s saved key, then the workspace\'s own', async () => {
    vi.stubEnv('AMPLITUDE_API_KEY', ENV_KEY);

    await expect(amplitudeKeyFor(WS)).resolves.toBe(ENV_KEY);

    await saveAmplitudeKey({ scope: 'instance', orgId: WS, key: INSTANCE_KEY, by: 'usr-1' });

    await expect(amplitudeKeyFor(WS)).resolves.toBe(INSTANCE_KEY);

    await saveAmplitudeKey({ scope: 'workspace', orgId: WS, key: WORKSPACE_KEY, by: 'usr-1' });

    await expect(amplitudeKeyFor(WS)).resolves.toBe(WORKSPACE_KEY);
    await expect(amplitudeKeyFor(OTHER)).resolves.toBe(INSTANCE_KEY);

    await removeAmplitudeKey('workspace', WS);

    await expect(amplitudeKeyFor(WS)).resolves.toBe(INSTANCE_KEY);
  });

  it('lives beside the Jev key without touching it', async () => {
    await saveJevKey({ scope: 'instance', orgId: WS, key: 'ts-FAKE-typesafe-instance-key-0000aaaa', by: 'usr-1' });
    await saveAmplitudeKey({ scope: 'instance', orgId: WS, key: INSTANCE_KEY, by: 'usr-1' });

    await expect(resolveJevKey(WS)).resolves.toMatchObject({ key: 'ts-FAKE-typesafe-instance-key-0000aaaa' });
    await expect(amplitudeKeyFor(WS)).resolves.toBe(INSTANCE_KEY);

    await removeAmplitudeKey('instance', WS);

    await expect(resolveJevKey(WS)).resolves.toMatchObject({ key: 'ts-FAKE-typesafe-instance-key-0000aaaa' });
  });
});

describe('what a settings card sees', () => {
  it('the hint and the level in force, never the key', async () => {
    await saveAmplitudeKey({ scope: 'instance', orgId: WS, key: INSTANCE_KEY, by: 'usr-1' });
    const status = await amplitudeKeyStatus(WS);

    expect(status).toMatchObject({ instance: { hint: '…0001', source: 'saved' }, workspace: null, effective: 'instance' });
    expect(JSON.stringify(status)).not.toContain(INSTANCE_KEY);
  });
});

describe('what may be saved', () => {
  it('a 32-character project API key, nothing else', () => {
    expect(AMPLITUDE_KEY.problem(INSTANCE_KEY)).toBeNull();
    expect(AMPLITUDE_KEY.problem('')).toMatch(/Paste/);
    expect(AMPLITUDE_KEY.problem('not-a-key')).toMatch(/32 letters and digits/);
  });
});
