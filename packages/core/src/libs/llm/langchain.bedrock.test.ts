import type { ChatBedrockConverse } from '@langchain/aws';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `buildChatModelForOrg` resolves the org's stored AWS pair, which reads and
// decrypts an `api_token` row. PGlite stands in for the database.
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, sourceDekSchema } = await import('@/models/Schema');
const { storePlatformKey } = await import('@/services/ApiTokenService');
const { buildChatModel, buildChatModelForOrg } = await import('./langchain');

/**
 * Bedrock chat models — provider selection, model defaults, and whose AWS
 * identity the model ends up signing with.
 *
 * No AWS call happens: constructing a `ChatBedrockConverse` builds a client but
 * sends nothing. The credential assertions read that client's resolved
 * credentials, which is the only place the pair actually lands — the chat model
 * does not keep it as an own property.
 */

const ORG_A = 'org_bedrock_chat_a';
const ORG_B = 'org_bedrock_chat_b';
const PAIR_A = { accessKeyId: 'AKIAAAAAAAAAAAAAAAAA', secretAccessKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
const PAIR_B = { accessKeyId: 'AKIABBBBBBBBBBBBBBBB', secretAccessKey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };

const ENV_KEYS = ['VOCION_LLM_PROVIDER', 'VOCION_LLM_PROVIDER_MAIN', 'VOCION_LLM_MODEL_MAIN', 'AWS_REGION'] as const;
const originalEnv = new Map<string, string | undefined>();

/**
 * The access key id a chat model would sign with, or undefined when it left the
 * AWS credential chain in charge.
 * @param model - The model to inspect.
 */
async function signingAccessKeyId(model: unknown): Promise<string | undefined> {
  const client = (model as ChatBedrockConverse).client;
  const resolved = await client.config.credentials();
  return resolved?.accessKeyId;
}

async function clearCredentials(): Promise<void> {
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
}

beforeEach(async () => {
  await clearCredentials();
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(async () => {
  await clearCredentials();
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('buildChatModel for bedrock', () => {
  it('builds a Bedrock chat model when the provider is passed explicitly', () => {
    const model = buildChatModel('main', { provider: 'bedrock' }) as ChatBedrockConverse;

    expect(model._llmType()).toBe('chat_bedrock_converse');
  });

  it('builds one when VOCION_LLM_PROVIDER names bedrock', () => {
    process.env.VOCION_LLM_PROVIDER = 'bedrock';

    const model = buildChatModel('main') as ChatBedrockConverse;

    expect(model._llmType()).toBe('chat_bedrock_converse');
  });

  it('defaults main to the Sonnet cross-region inference profile', () => {
    const model = buildChatModel('main', { provider: 'bedrock' }) as ChatBedrockConverse;

    // The `us.` prefix is load-bearing: Sonnet 4.6 has no in-region id in
    // us-west-2, so a bare `anthropic.claude-sonnet-4-6` would not resolve.
    expect(model.model).toBe('us.anthropic.claude-sonnet-4-6');
  });

  it('defaults classifier to the Haiku cross-region inference profile', () => {
    const model = buildChatModel('classifier', { provider: 'bedrock' }) as ChatBedrockConverse;

    expect(model.model).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
  });

  it('lets the caller override the model id', () => {
    const model = buildChatModel('main', {
      provider: 'bedrock',
      model: 'global.anthropic.claude-sonnet-4-6',
    }) as ChatBedrockConverse;

    expect(model.model).toBe('global.anthropic.claude-sonnet-4-6');
  });

  it('honours the per-role model env override', () => {
    process.env.VOCION_LLM_MODEL_MAIN = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

    const model = buildChatModel('main', { provider: 'bedrock' }) as ChatBedrockConverse;

    expect(model.model).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
  });

  it('uses AWS_REGION when it is set', () => {
    process.env.AWS_REGION = 'us-east-1';

    const model = buildChatModel('main', { provider: 'bedrock' }) as ChatBedrockConverse;

    expect(model.region).toBe('us-east-1');
  });

  it('defaults the region to us-west-2, matching the agent-runtime artifact', () => {
    const model = buildChatModel('main', { provider: 'bedrock' }) as ChatBedrockConverse;

    expect(model.region).toBe('us-west-2');
  });

  it('lets the caller override the region', () => {
    const model = buildChatModel('main', { provider: 'bedrock', region: 'eu-west-1' }) as ChatBedrockConverse;

    expect(model.region).toBe('eu-west-1');
  });

  it('passes the output cap through', () => {
    const model = buildChatModel('main', { provider: 'bedrock', maxTokens: 4096 }) as ChatBedrockConverse;

    expect(model.maxTokens).toBe(4096);
  });

  it('does not throw for a missing key, because instance roles carry no env var', () => {
    // The Anthropic and OpenAI branches refuse when their env var is empty.
    // Bedrock must not: a deployed host authenticates by instance role and sets
    // nothing, and refusing here would break that path outright.
    expect(() => buildChatModel('main', { provider: 'bedrock' })).not.toThrow();
  });

  it('rejects a provider outside the union, naming the ones it accepts', () => {
    process.env.VOCION_LLM_PROVIDER = 'cohere';

    expect(() => buildChatModel('main')).toThrow(/unknown llm provider "cohere".*anthropic, openai, bedrock/);
  });
});

describe('buildChatModelForOrg for bedrock', () => {
  it('signs with the org own AWS pair once it is stored', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'aws', platform: 'aws', values: PAIR_A });

    const model = await buildChatModelForOrg('main', ORG_A, { provider: 'bedrock' });

    await expect(signingAccessKeyId(model)).resolves.toBe(PAIR_A.accessKeyId);
  });

  it('gives each org its own pair, never the other org pair', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'aws a', platform: 'aws', values: PAIR_A });
    await storePlatformKey({ orgId: ORG_B, name: 'aws b', platform: 'aws', values: PAIR_B });

    const first = await buildChatModelForOrg('main', ORG_A, { provider: 'bedrock' });
    const second = await buildChatModelForOrg('main', ORG_B, { provider: 'bedrock' });

    await expect(signingAccessKeyId(first)).resolves.toBe(PAIR_A.accessKeyId);
    await expect(signingAccessKeyId(second)).resolves.toBe(PAIR_B.accessKeyId);
  });

  it('picks up a rotated pair on the next call, with nothing to invalidate', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'aws', platform: 'aws', values: PAIR_A });

    await expect(signingAccessKeyId(await buildChatModelForOrg('main', ORG_A, { provider: 'bedrock' })))
      .resolves
      .toBe(PAIR_A.accessKeyId);

    await storePlatformKey({ orgId: ORG_A, name: 'aws rotated', platform: 'aws', values: PAIR_B });

    await expect(signingAccessKeyId(await buildChatModelForOrg('main', ORG_A, { provider: 'bedrock' })))
      .resolves
      .toBe(PAIR_B.accessKeyId);
  });

  it('lets an explicit awsCredentials option win over the stored pair', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'aws', platform: 'aws', values: PAIR_A });

    const model = await buildChatModelForOrg('main', ORG_A, {
      provider: 'bedrock',
      awsCredentials: PAIR_B,
    });

    await expect(signingAccessKeyId(model)).resolves.toBe(PAIR_B.accessKeyId);
  });

  it('builds a model for an org that stored nothing, leaving the AWS chain in charge', async () => {
    const model = await buildChatModelForOrg('main', ORG_A, { provider: 'bedrock' });

    // What matters is that it built at all rather than refusing — what the AWS
    // chain then resolves to depends on the machine, so it is not asserted.
    expect((model as ChatBedrockConverse)._llmType()).toBe('chat_bedrock_converse');
  });

  it('does not hand a stored OpenAI key to a Bedrock model', async () => {
    // `resolveOrgProviderKey` is skipped entirely on the bedrock branch. Were
    // it not, the `aws` platform's first field — the access key id — would
    // arrive as `apiKey` and authenticate nothing.
    await storePlatformKey({ orgId: ORG_A, name: 'oai', platform: 'openai', apiKey: 'sk-not-for-bedrock-1234' });

    const model = await buildChatModelForOrg('main', ORG_A, { provider: 'bedrock' });

    expect((model as ChatBedrockConverse)._llmType()).toBe('chat_bedrock_converse');
  });
});
