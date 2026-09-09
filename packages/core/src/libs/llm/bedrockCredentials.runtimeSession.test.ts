/**
 * Minting the credential the runtime artifact signs Bedrock with.
 *
 * The artifact runs out of process — on AgentCore, in another account — with
 * no database and no KMS grant, so core resolves the org's own AWS key and
 * mints a short-lived session from it. What matters here is which of three
 * outcomes each situation produces, because two of them are quiet and one is
 * loud on purpose:
 *
 *   - org has no key            → null, and the artifact uses the platform's own
 *   - org has a working key     → a session the customer's account is billed for
 *   - org has a broken key      → an error, never a silent fall back to ours
 *
 * The third is the point. Returning null there would move that customer's
 * model spend onto the platform account and look like success.
 */
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const stsSend = vi.fn();
/** Every STSClient config the code under test constructed, in order. */
const stsClientConfigs: Array<{ region?: string; credentials?: { accessKeyId: string } }> = [];

vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: class {
    send = stsSend;
    constructor(config: { region?: string; credentials?: { accessKeyId: string } }) {
      stsClientConfigs.push(config);
    }
  },
  GetSessionTokenCommand: class {
    constructor(public input: unknown) {}
  },
}));

const { db } = await import('@/libs/DB');
const { apiTokenSchema, sourceDekSchema } = await import('@/models/Schema');
const { storePlatformKey } = await import('@/services/ApiTokenService');
const { mintBedrockSessionForRuntime } = await import('./bedrockCredentials');

const ORG_WITH_KEY = 'org_runtime_session_a';
const ORG_WITHOUT_KEY = 'org_runtime_session_b';
const STORED_PAIR = {
  accessKeyId: 'AKIACCCCCCCCCCCCCCCC',
  secretAccessKey: 'cccccccccccccccccccccccccccccccccccccccc',
};
const EXPIRES = new Date('2026-09-04T18:00:00.000Z');

function stsIssuesSession(): void {
  stsSend.mockResolvedValue({
    Credentials: {
      AccessKeyId: 'ASIACCCCCCCCCCCCCCCC',
      SecretAccessKey: 'session-secret',
      SessionToken: 'session-token',
      Expiration: EXPIRES,
    },
  });
}

async function clearCredentials(): Promise<void> {
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
}

beforeEach(async () => {
  await clearCredentials();
  stsSend.mockReset();
  stsClientConfigs.length = 0;
  delete process.env.VOCION_BEDROCK_SESSION_SECONDS;
  delete process.env.AWS_REGION;
});

afterEach(clearCredentials);

describe('mintBedrockSessionForRuntime', () => {
  it('returns null when the org has stored no AWS key, without calling STS', async () => {
    await expect(mintBedrockSessionForRuntime(ORG_WITHOUT_KEY)).resolves.toBeNull();
    expect(stsSend).not.toHaveBeenCalled();
  });

  it('mints a session from the org\'s own stored key', async () => {
    await storePlatformKey({ orgId: ORG_WITH_KEY, name: 'aws', platform: 'aws', values: STORED_PAIR });
    stsIssuesSession();

    await expect(mintBedrockSessionForRuntime(ORG_WITH_KEY)).resolves.toEqual({
      accessKeyId: 'ASIACCCCCCCCCCCCCCCC',
      secretAccessKey: 'session-secret',
      sessionToken: 'session-token',
      expiresAt: EXPIRES.toISOString(),
    });
  });

  it('signs the STS call with the org\'s own key', async () => {
    await storePlatformKey({ orgId: ORG_WITH_KEY, name: 'aws', platform: 'aws', values: STORED_PAIR });
    stsIssuesSession();

    await mintBedrockSessionForRuntime(ORG_WITH_KEY);

    expect(stsClientConfigs).toHaveLength(1);
    expect(stsClientConfigs[0]!.credentials).toEqual(STORED_PAIR);
    expect(stsSend).toHaveBeenCalledTimes(1);

    const command = stsSend.mock.calls[0]![0] as { input: { DurationSeconds: number } };

    expect(command.input.DurationSeconds).toBe(3600);
  });

  it('calls STS in the Bedrock region', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    await storePlatformKey({ orgId: ORG_WITH_KEY, name: 'aws', platform: 'aws', values: STORED_PAIR });
    stsIssuesSession();

    await mintBedrockSessionForRuntime(ORG_WITH_KEY);

    expect(stsClientConfigs[0]!.region).toBe('eu-central-1');
  });

  it('honours a configured session length', async () => {
    process.env.VOCION_BEDROCK_SESSION_SECONDS = '7200';
    await storePlatformKey({ orgId: ORG_WITH_KEY, name: 'aws', platform: 'aws', values: STORED_PAIR });
    stsIssuesSession();

    await mintBedrockSessionForRuntime(ORG_WITH_KEY);
    const command = stsSend.mock.calls[0]![0] as { input: { DurationSeconds: number } };

    expect(command.input.DurationSeconds).toBe(7200);
  });

  it('refuses a session length below the AWS minimum and uses the default', async () => {
    process.env.VOCION_BEDROCK_SESSION_SECONDS = '60';
    await storePlatformKey({ orgId: ORG_WITH_KEY, name: 'aws', platform: 'aws', values: STORED_PAIR });
    stsIssuesSession();

    await mintBedrockSessionForRuntime(ORG_WITH_KEY);
    const command = stsSend.mock.calls[0]![0] as { input: { DurationSeconds: number } };

    expect(command.input.DurationSeconds).toBe(3600);
  });

  it('ignores a non-numeric session length', async () => {
    process.env.VOCION_BEDROCK_SESSION_SECONDS = 'soon';
    await storePlatformKey({ orgId: ORG_WITH_KEY, name: 'aws', platform: 'aws', values: STORED_PAIR });
    stsIssuesSession();

    await mintBedrockSessionForRuntime(ORG_WITH_KEY);
    const command = stsSend.mock.calls[0]![0] as { input: { DurationSeconds: number } };

    expect(command.input.DurationSeconds).toBe(3600);
  });

  it('throws rather than falling back to the platform when STS refuses the key', async () => {
    await storePlatformKey({ orgId: ORG_WITH_KEY, name: 'aws', platform: 'aws', values: STORED_PAIR });
    stsSend.mockRejectedValue(new Error('InvalidClientTokenId'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(mintBedrockSessionForRuntime(ORG_WITH_KEY)).rejects.toThrow(/sts:GetSessionToken/);
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });

  it('throws when STS answers without a complete credential', async () => {
    await storePlatformKey({ orgId: ORG_WITH_KEY, name: 'aws', platform: 'aws', values: STORED_PAIR });
    stsSend.mockResolvedValue({ Credentials: { AccessKeyId: 'ASIA', SecretAccessKey: 'secret' } });

    await expect(mintBedrockSessionForRuntime(ORG_WITH_KEY)).rejects.toThrow(/incomplete session credential/);
  });

  it('throws when STS answers with no credential block at all', async () => {
    await storePlatformKey({ orgId: ORG_WITH_KEY, name: 'aws', platform: 'aws', values: STORED_PAIR });
    stsSend.mockResolvedValue({});

    await expect(mintBedrockSessionForRuntime(ORG_WITH_KEY)).rejects.toThrow(/incomplete session credential/);
  });

  it('falls back to the current time when STS omits an expiry', async () => {
    await storePlatformKey({ orgId: ORG_WITH_KEY, name: 'aws', platform: 'aws', values: STORED_PAIR });
    stsSend.mockResolvedValue({
      Credentials: { AccessKeyId: 'ASIA', SecretAccessKey: 'secret', SessionToken: 'token' },
    });

    const minted = await mintBedrockSessionForRuntime(ORG_WITH_KEY);

    expect(Number.isNaN(Date.parse(minted!.expiresAt))).toBe(false);
  });

  it('keeps one org\'s session out of another org\'s call', async () => {
    await storePlatformKey({ orgId: ORG_WITH_KEY, name: 'aws', platform: 'aws', values: STORED_PAIR });
    stsIssuesSession();

    await expect(mintBedrockSessionForRuntime(ORG_WITH_KEY)).resolves.not.toBeNull();
    await expect(mintBedrockSessionForRuntime(ORG_WITHOUT_KEY)).resolves.toBeNull();
    expect(stsSend).toHaveBeenCalledTimes(1);
  });
});
