import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Resolving an org's own AWS pair reads and decrypts an `api_token` row, so
// this reaches the database. PGlite stands in for it.
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, sourceDekSchema } = await import('@/models/Schema');
const { storePlatformKey } = await import('@/services/ApiTokenService');
const { bedrockRegion, resolveBedrockCredentials } = await import('./bedrockCredentials');
const { resolveOrgProviderKey } = await import('./orgKey');

/**
 * Bedrock credential resolution — the org's own AWS pair first, the process's
 * own AWS identity second.
 *
 * The two-orgs-in-sequence case is the one that matters most: a helper that
 * cached anything would hand the first org's key to the second, which is the
 * failure the whole per-call construction rule exists to prevent.
 */

const ORG_A = 'org_bedrock_a';
const ORG_B = 'org_bedrock_b';
const PAIR_A = { accessKeyId: 'AKIAAAAAAAAAAAAAAAAA', secretAccessKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
const PAIR_B = { accessKeyId: 'AKIABBBBBBBBBBBBBBBB', secretAccessKey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };

async function clearCredentials(): Promise<void> {
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
}

describe('resolveBedrockCredentials', () => {
  beforeEach(clearCredentials);

  afterEach(clearCredentials);

  it('falls back to the environment when the org has stored nothing', async () => {
    await expect(resolveBedrockCredentials(ORG_A)).resolves.toEqual({
      source: 'environment',
      keyPair: null,
    });
  });

  it('returns a null key pair on the fallback, so the AWS chain stays in charge', async () => {
    // Null, not an empty pair. An empty pair would replace the SDK's credential
    // chain — the only route by which AWS_BEARER_TOKEN_BEDROCK or an instance
    // role can authenticate — with credentials that authenticate nothing.
    const { keyPair } = await resolveBedrockCredentials(ORG_A);

    expect(keyPair).toBeNull();
  });

  it('prefers the org own AWS pair once it is stored', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'aws', platform: 'aws', values: PAIR_A });

    await expect(resolveBedrockCredentials(ORG_A)).resolves.toEqual({
      source: 'org',
      keyPair: PAIR_A,
    });
  });

  it('resolves each org to its own pair, never the other org pair', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'aws a', platform: 'aws', values: PAIR_A });
    await storePlatformKey({ orgId: ORG_B, name: 'aws b', platform: 'aws', values: PAIR_B });

    const first = await resolveBedrockCredentials(ORG_A);
    const second = await resolveBedrockCredentials(ORG_B);

    expect(first.keyPair).toEqual(PAIR_A);
    expect(second.keyPair).toEqual(PAIR_B);
  });

  it('picks up a rotated pair on the very next call, with nothing to invalidate', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'aws', platform: 'aws', values: PAIR_A });

    await expect(resolveBedrockCredentials(ORG_A)).resolves.toMatchObject({ keyPair: PAIR_A });

    await storePlatformKey({ orgId: ORG_A, name: 'aws rotated', platform: 'aws', values: PAIR_B });

    await expect(resolveBedrockCredentials(ORG_A)).resolves.toMatchObject({ keyPair: PAIR_B });
  });

  it('does not let one org stored pair leak into an org that stored none', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'aws a', platform: 'aws', values: PAIR_A });

    await expect(resolveBedrockCredentials(ORG_B)).resolves.toEqual({
      source: 'environment',
      keyPair: null,
    });
  });
});

describe('resolveOrgProviderKey for bedrock', () => {
  beforeEach(clearCredentials);

  afterEach(clearCredentials);

  it('returns null rather than the access key id, which authenticates nothing', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'aws', platform: 'aws', values: PAIR_A });

    // The `aws` platform maps to `bedrock`, so without the multi-field guard
    // this would hand back field one — the access key id — as if it were a key.
    await expect(resolveOrgProviderKey('bedrock', ORG_A)).resolves.toBeNull();
  });

  it('still resolves a single-key provider normally', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'oai', platform: 'openai', apiKey: 'sk-single-field-key-1234' });

    await expect(resolveOrgProviderKey('openai', ORG_A)).resolves.toBe('sk-single-field-key-1234');
  });
});

describe('bedrockRegion', () => {
  const original = process.env.AWS_REGION;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AWS_REGION;
    } else {
      process.env.AWS_REGION = original;
    }
  });

  it('uses AWS_REGION when it is set', () => {
    process.env.AWS_REGION = 'eu-central-1';

    expect(bedrockRegion()).toBe('eu-central-1');
  });

  it('defaults to us-west-2, matching the agent-runtime artifact', () => {
    delete process.env.AWS_REGION;

    expect(bedrockRegion()).toBe('us-west-2');
  });
});
