import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Resolving an org's own AWS pair reads and decrypts an `api_token` row.
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, sourceDekSchema } = await import('@/models/Schema');
const { storePlatformKey } = await import('@/services/ApiTokenService');
const { getLLMClient, getLLMClientForOrg } = await import('./registry');

/**
 * The provider-neutral `LLMClient` for Bedrock.
 *
 * Bedrock takes its own route through the registry: it has an adapter but no
 * single env-var key, so the generic "which env var holds this provider's key"
 * check does not apply to it. These tests pin both halves of that — that it is
 * not refused for a missing env var, and that the providers which genuinely
 * have no adapter still are.
 */

const ORG = 'org_registry_bedrock';
const PAIR = { accessKeyId: 'AKIAAAAAAAAAAAAAAAAA', secretAccessKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };

const originalBearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;

async function clearCredentials(): Promise<void> {
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
}

beforeEach(async () => {
  await clearCredentials();
  delete process.env.AWS_BEARER_TOKEN_BEDROCK;
});

afterEach(async () => {
  await clearCredentials();
  if (originalBearerToken === undefined) {
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  } else {
    process.env.AWS_BEARER_TOKEN_BEDROCK = originalBearerToken;
  }
});

describe('getLLMClient for bedrock', () => {
  it('constructs a bedrock client with no env var set at all', () => {
    // Not a missing check: the AWS credential chain resolves at request time
    // from four possible sources, one of which is a host's instance role that
    // sets no variable. Refusing here would break the deployed path.
    const client = getLLMClient('bedrock');

    expect(client.provider).toBe('bedrock');
    expect(typeof client.generate).toBe('function');
  });

  it('still refuses a provider that has no adapter', () => {
    expect(() => getLLMClient('vertex')).toThrow(/not yet implemented/);
    expect(() => getLLMClient('azure-openai')).toThrow(/not yet implemented/);
  });
});

describe('getLLMClientForOrg for bedrock', () => {
  it('returns a bedrock client for an org that stored nothing', async () => {
    const client = await getLLMClientForOrg('bedrock', ORG);

    expect(client.provider).toBe('bedrock');
  });

  it('returns a bedrock client for an org that stored its own pair', async () => {
    await storePlatformKey({ orgId: ORG, name: 'aws', platform: 'aws', values: PAIR });

    const client = await getLLMClientForOrg('bedrock', ORG);

    expect(client.provider).toBe('bedrock');
  });

  it('reports bedrock as the provider, never anthropic', async () => {
    // The regression this guards: `buildClient` was a ternary where anything
    // that was not `openai` fell through to Anthropic, so widening the provider
    // union silently produced an Anthropic client under a Bedrock name.
    const client = await getLLMClientForOrg('bedrock', ORG);

    expect(client.provider).not.toBe('anthropic');
    expect(client.provider).toBe('bedrock');
  });

  it('still refuses vertex, which has a stored key but no adapter', async () => {
    await storePlatformKey({ orgId: ORG, name: 'v', platform: 'vertex', apiKey: 'some-vertex-credential' });

    await expect(getLLMClientForOrg('vertex', ORG)).rejects.toThrow(/not yet implemented/);
  });
});
