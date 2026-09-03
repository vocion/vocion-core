import process from 'node:process';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Reading a workspace's embedding settings and an org's own provider key both
// hit the database. PGlite stands in for it.
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, projectSchema, sourceDekSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { storePlatformKey } = await import('@/services/ApiTokenService');
const { embeddingBackendForOrg, loadWorkspaceEmbeddingConfig } = await import('./embeddingBackend');

/**
 * Workspace-scoped embedding settings, end to end from the project row.
 *
 * This is the half that `embeddingBackend.config.test.ts` cannot cover: that
 * one pins the precedence rules as pure functions, this one proves the settings
 * are actually read off the project row and reach the backend that gets built.
 */

const ORG = 'org_embedding_ws';
const OTHER_ORG = 'org_embedding_other';
const AWS_PAIR = { accessKeyId: 'AKIAAAAAAAAAAAAAAAAA', secretAccessKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };

async function cleanDb(): Promise<void> {
  for (const table of [apiTokenSchema, sourceDekSchema, projectSchema, tenantAccountSchema, userSchema]) {
    await db.delete(table);
  }
}

async function seedProjects(): Promise<void> {
  await cleanDb();
  await db.insert(tenantAccountSchema).values({ id: 'acct-emb', name: 'MetaCTO', slug: 'metacto-emb' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-emb', slug: 'emb', name: 'Embedding' });
  await db.insert(projectSchema).values({ id: OTHER_ORG, accountId: 'acct-emb', slug: 'emb-other', name: 'Other' });
}

async function setEmbeddingConfig(orgId: string, config: { provider?: 'openai' | 'bedrock'; model?: string } | null): Promise<void> {
  await db
    .update(projectSchema)
    .set({ embeddingConfig: config })
    .where(eq(projectSchema.id, orgId));
}

const originalEnv = new Map<string, string | undefined>();
const ENV_KEYS = ['VOCION_EMBEDDING_PROVIDER', 'VOCION_EMBEDDING_MODEL', 'VOCION_LLM_PROVIDER', 'OPENAI_API_KEY'] as const;

beforeEach(async () => {
  await seedProjects();
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.OPENAI_API_KEY = 'sk-server-fallback-key';
});

afterEach(async () => {
  await cleanDb();
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('loadWorkspaceEmbeddingConfig', () => {
  it('returns null for a workspace that authored nothing', async () => {
    await expect(loadWorkspaceEmbeddingConfig(ORG)).resolves.toBeNull();
  });

  it('returns null for an org with no project row at all', async () => {
    await expect(loadWorkspaceEmbeddingConfig('org_does_not_exist')).resolves.toBeNull();
  });

  it('returns what workspace:apply stored', async () => {
    await setEmbeddingConfig(ORG, { provider: 'bedrock', model: 'amazon.titan-embed-text-v1' });

    await expect(loadWorkspaceEmbeddingConfig(ORG)).resolves.toEqual({
      provider: 'bedrock',
      model: 'amazon.titan-embed-text-v1',
    });
  });

  it('reads each workspace own settings, never a neighbour settings', async () => {
    await setEmbeddingConfig(ORG, { provider: 'bedrock' });
    await setEmbeddingConfig(OTHER_ORG, { provider: 'openai' });

    await expect(loadWorkspaceEmbeddingConfig(ORG)).resolves.toEqual({ provider: 'bedrock' });
    await expect(loadWorkspaceEmbeddingConfig(OTHER_ORG)).resolves.toEqual({ provider: 'openai' });
  });
});

describe('embeddingBackendForOrg', () => {
  it('builds an OpenAI backend for a workspace that pinned nothing', async () => {
    const backend = await embeddingBackendForOrg(ORG);

    expect(backend.provider).toBe('openai');
    expect(backend.model).toBe('text-embedding-3-small');
  });

  it('builds a Bedrock backend when the workspace pinned bedrock', async () => {
    await setEmbeddingConfig(ORG, { provider: 'bedrock' });

    const backend = await embeddingBackendForOrg(ORG);

    expect(backend.provider).toBe('bedrock');
    expect(backend.model).toBe('amazon.titan-embed-text-v1');
    expect(backend.batchSize).toBe(1);
  });

  it('lets the workspace override an env var pointing the other way', async () => {
    process.env.VOCION_EMBEDDING_PROVIDER = 'openai';
    await setEmbeddingConfig(ORG, { provider: 'bedrock' });

    await expect(embeddingBackendForOrg(ORG)).resolves.toMatchObject({ provider: 'bedrock' });
  });

  it('uses the workspace pinned model', async () => {
    await setEmbeddingConfig(ORG, { provider: 'bedrock', model: 'amazon.titan-embed-text-v2:0' });

    await expect(embeddingBackendForOrg(ORG)).resolves.toMatchObject({
      model: 'amazon.titan-embed-text-v2:0',
    });
  });

  it('gives two workspaces different providers in the same process', async () => {
    // The case a cached backend would break: one workspace on Bedrock and one
    // on OpenAI, resolved back to back.
    await setEmbeddingConfig(ORG, { provider: 'bedrock' });
    await setEmbeddingConfig(OTHER_ORG, { provider: 'openai' });

    const first = await embeddingBackendForOrg(ORG);
    const second = await embeddingBackendForOrg(OTHER_ORG);

    expect(first.provider).toBe('bedrock');
    expect(second.provider).toBe('openai');
  });

  it('still resolves the org own AWS pair for a bedrock workspace', async () => {
    await setEmbeddingConfig(ORG, { provider: 'bedrock' });
    await storePlatformKey({ orgId: ORG, name: 'aws', platform: 'aws', values: AWS_PAIR });

    // The backend holds the client, so the credential itself is not readable
    // from here; what this pins is that storing a pair does not change which
    // provider or model is chosen, and does not throw.
    await expect(embeddingBackendForOrg(ORG)).resolves.toMatchObject({
      provider: 'bedrock',
      model: 'amazon.titan-embed-text-v1',
    });
  });

  it('refuses an OpenAI workspace with no key anywhere, rather than faking success', async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(embeddingBackendForOrg(ORG)).rejects.toThrow(/No OpenAI key available/);
  });

  it('needs no OpenAI key at all for a bedrock workspace', async () => {
    delete process.env.OPENAI_API_KEY;
    await setEmbeddingConfig(ORG, { provider: 'bedrock' });

    await expect(embeddingBackendForOrg(ORG)).resolves.toMatchObject({ provider: 'bedrock' });
  });
});
