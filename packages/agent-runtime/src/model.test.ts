/**
 * The Bedrock credential seam.
 *
 * The behavior under test is narrow but load-bearing: the model client is
 * built once per agent definition and cached across invocations, while the
 * AWS session it signs with belongs to a single invocation. If the credential
 * were captured by value at build time, the cached client would keep signing
 * with the first caller's session — one tenant spending another tenant's AWS
 * account. These tests pin the read-through behavior that prevents it.
 */
import type { InvocationRequest } from './contract.js';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bedrockCredentialProvider, buildChatModel, resolveProvider } from './model.js';

type CredentialProvider = () => Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}>;

/**
 * The credential provider the Bedrock client will actually call.
 *
 * Always a function: the AWS SDK normalises whatever it was handed, so the
 * useful question is not "is one set" but "what does it resolve to".
 * @param model - The chat model whose Bedrock client credential to read.
 */
function clientCredentialsOf(model: unknown): CredentialProvider {
  return (model as { client: { config: { credentials: CredentialProvider } } }).client.config.credentials;
}

const SESSION_A: InvocationRequest['aws'] = {
  accessKeyId: 'ASIAAAAAAAAAAAAAAAAA',
  secretAccessKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  sessionToken: 'token-for-org-a',
  expiresAt: '2026-09-04T12:00:00.000Z',
};

const SESSION_B: InvocationRequest['aws'] = {
  accessKeyId: 'ASIABBBBBBBBBBBBBBBB',
  secretAccessKey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  sessionToken: 'token-for-org-b',
};

const savedEnv = { ...process.env };

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.VOCION_MODEL_PROVIDER = 'bedrock';
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('resolveProvider', () => {
  it('picks bedrock when no Anthropic key is present', () => {
    delete process.env.VOCION_MODEL_PROVIDER;

    expect(resolveProvider()).toBe('bedrock');
  });

  it('picks anthropic when an Anthropic key is present', () => {
    delete process.env.VOCION_MODEL_PROVIDER;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    expect(resolveProvider()).toBe('anthropic');
  });

  it('honours an explicit override over the key heuristic', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.VOCION_MODEL_PROVIDER = 'bedrock';

    expect(resolveProvider()).toBe('bedrock');
  });

  it('ignores an override it does not recognise', () => {
    process.env.VOCION_MODEL_PROVIDER = 'nonsense';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    expect(resolveProvider()).toBe('anthropic');
  });
});

describe('bedrockCredentialProvider', () => {
  it('declines to override the credential chain when the invocation sent no session', () => {
    expect(bedrockCredentialProvider(() => undefined)).toBeUndefined();
  });

  it('resolves the session the invocation supplied', async () => {
    const provider = bedrockCredentialProvider(() => SESSION_A);

    await expect(provider!()).resolves.toEqual({
      accessKeyId: SESSION_A!.accessKeyId,
      secretAccessKey: SESSION_A!.secretAccessKey,
      sessionToken: SESSION_A!.sessionToken,
      expiration: new Date(SESSION_A!.expiresAt!),
    });
  });

  it('omits the expiration when the session did not carry one', async () => {
    const provider = bedrockCredentialProvider(() => SESSION_B);

    await expect(provider!()).resolves.toEqual({
      accessKeyId: SESSION_B!.accessKeyId,
      secretAccessKey: SESSION_B!.secretAccessKey,
      sessionToken: SESSION_B!.sessionToken,
    });
  });

  it('follows the reader to the next invocation instead of keeping the first session', async () => {
    // The cached-model case, in miniature: one provider, two callers.
    let current: InvocationRequest['aws'] = SESSION_A;
    const provider = bedrockCredentialProvider(() => current)!;

    await expect(provider()).resolves.toMatchObject({ sessionToken: 'token-for-org-a' });

    current = SESSION_B;

    await expect(provider()).resolves.toMatchObject({ sessionToken: 'token-for-org-b' });
  });

  it('refuses to sign once the session has been cleared', async () => {
    let current: InvocationRequest['aws'] = SESSION_A;
    const provider = bedrockCredentialProvider(() => current)!;

    current = undefined;

    await expect(provider()).rejects.toThrow(/session was cleared/);
  });
});

describe('buildChatModel on the bedrock path', () => {
  it('hands the invocation session to the Bedrock client', async () => {
    const model = await buildChatModel({ readAwsSession: () => SESSION_A });

    await expect(clientCredentialsOf(model)()).resolves.toMatchObject({
      accessKeyId: SESSION_A!.accessKeyId,
      sessionToken: SESSION_A!.sessionToken,
    });
  });

  it('does not hand it a session when the org stored no key', async () => {
    const model = await buildChatModel({ readAwsSession: () => undefined });

    // Left on the SDK's own chain, so whatever it resolves is not our session.
    await expect(clientCredentialsOf(model)()
      .then(c => c.sessionToken)
      .catch(() => undefined)).resolves.not.toBe(SESSION_A!.sessionToken);
  });

  it('does not hand it a session when no reader is supplied at all', async () => {
    const model = await buildChatModel({});

    await expect(clientCredentialsOf(model)()
      .then(c => c.sessionToken)
      .catch(() => undefined)).resolves.not.toBe(SESSION_A!.sessionToken);
  });
});

describe('buildChatModel on the anthropic path', () => {
  it('ignores an AWS session entirely', async () => {
    process.env.VOCION_MODEL_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const model = await buildChatModel({ readAwsSession: () => SESSION_A });

    expect((model as { client?: unknown }).client).toBeUndefined();
    expect(model.getName()).toBe('ChatAnthropic');
  });
});
