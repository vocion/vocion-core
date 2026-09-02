import process from 'node:process';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Resolving an org's own key reads the `api_token` table, so the registry now
// reaches the database. PGlite stands in for it.
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, sourceDekSchema } = await import('@/models/Schema');
const { storePlatformKey } = await import('@/services/ApiTokenService');
const { buildChatModel, buildChatModelForOrg, withPromptCache } = await import('./langchain');
const { getLLMClient, getLLMClientForOrg, resolveOrgProviderKey } = await import('./registry');

/**
 * Provider registry tests — construction + error paths. We don't hit real
 * APIs here; adapter-shape tests mock the SDK clients directly.
 */
describe('getLLMClient', () => {
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalOpenAI === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAI;
    }
    if (originalAnthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
  });

  it('constructs openai client when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test-abc';
    const client = getLLMClient('openai');

    expect(client.provider).toBe('openai');
    expect(typeof client.generate).toBe('function');
  });

  it('constructs anthropic client when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const client = getLLMClient('anthropic');

    expect(client.provider).toBe('anthropic');
  });

  it('throws with a helpful message when openai key is missing', () => {
    delete process.env.OPENAI_API_KEY;

    expect(() => getLLMClient('openai')).toThrow(/OPENAI_API_KEY/);
  });

  it('throws with a helpful message when anthropic key is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => getLLMClient('anthropic')).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('declares vertex as not-yet-implemented', () => {
    expect(() => getLLMClient('vertex')).toThrow(/not yet implemented/);
  });

  it('declares azure-openai as not-yet-implemented', () => {
    expect(() => getLLMClient('azure-openai')).toThrow(/not yet implemented/);
  });

  it('builds a fresh client per call, so no client is ever shared', () => {
    // The old per-provider singleton is gone on purpose: it was the thing that
    // would have handed one tenant's client to another once keys became
    // per-org. Fresh construction is the guarantee.
    process.env.OPENAI_API_KEY = 'sk-test';

    expect(getLLMClient('openai')).not.toBe(getLLMClient('openai'));
  });
});

/**
 * Bring-your-own-key resolution. The thing worth proving here is not that a
 * stored key is found — it is that two orgs with different keys can never end
 * up sharing a client, which is exactly what a per-provider singleton used to
 * guarantee they would.
 */
describe('getLLMClientForOrg', () => {
  const ORG_A = 'org_llm_a';
  const ORG_B = 'org_llm_b';
  const KEY_A = 'sk-aaaaaaaaaaaaaaaa1111';
  const KEY_B = 'sk-bbbbbbbbbbbbbbbb2222';
  const originalOpenAI = process.env.OPENAI_API_KEY;

  beforeEach(async () => {
    await db.delete(apiTokenSchema);
    await db.delete(sourceDekSchema);
    process.env.OPENAI_API_KEY = 'sk-server-key-fallback';
  });

  afterEach(async () => {
    await db.delete(apiTokenSchema);
    await db.delete(sourceDekSchema);
    if (originalOpenAI === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAI;
    }
  });

  it('falls back to the server key when the org has stored none', async () => {
    expect(await resolveOrgProviderKey('openai', ORG_A)).toBeNull();
    expect((await getLLMClientForOrg('openai', ORG_A)).provider).toBe('openai');
  });

  it('resolves the org own key once it is stored', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'a', platform: 'openai', apiKey: KEY_A });

    expect(await resolveOrgProviderKey('openai', ORG_A)).toBe(KEY_A);
  });

  it('resolves each org to its own key, never the other org key', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'a', platform: 'openai', apiKey: KEY_A });
    await storePlatformKey({ orgId: ORG_B, name: 'b', platform: 'openai', apiKey: KEY_B });

    expect(await resolveOrgProviderKey('openai', ORG_A)).toBe(KEY_A);
    expect(await resolveOrgProviderKey('openai', ORG_B)).toBe(KEY_B);
  });

  it('picks up a rotated key on the very next call, with nothing to invalidate', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'a', platform: 'openai', apiKey: KEY_A });

    expect(await resolveOrgProviderKey('openai', ORG_A)).toBe(KEY_A);

    await storePlatformKey({ orgId: ORG_A, name: 'a rotated', platform: 'openai', apiKey: KEY_B });

    expect(await resolveOrgProviderKey('openai', ORG_A)).toBe(KEY_B);
  });

  it('goes back to the server key once the org key is revoked', async () => {
    const { id } = await storePlatformKey({ orgId: ORG_A, name: 'a', platform: 'openai', apiKey: KEY_A });
    const { revokeToken } = await import('@/services/ApiTokenService');
    await revokeToken(ORG_A, id);

    expect(await resolveOrgProviderKey('openai', ORG_A)).toBeNull();
    expect((await getLLMClientForOrg('openai', ORG_A)).provider).toBe('openai');
  });

  it('refuses a provider we have no adapter for, even with a key on file', async () => {
    await storePlatformKey({ orgId: ORG_A, name: 'v', platform: 'vertex', apiKey: 'some-vertex-credential' });

    await expect(getLLMClientForOrg('vertex', ORG_A)).rejects.toThrow(/not yet implemented/);
  });
});

describe('buildChatModelForOrg', () => {
  const ORG = 'org_chat_model';
  const ORG_KEY = 'sk-ant-cccccccccccccccc3333';
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;

  beforeEach(async () => {
    await db.delete(apiTokenSchema);
    await db.delete(sourceDekSchema);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-server-fallback';
  });

  afterEach(async () => {
    await db.delete(apiTokenSchema);
    await db.delete(sourceDekSchema);
    if (originalAnthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
  });

  it('builds the model on the org own key when it has one', async () => {
    await storePlatformKey({ orgId: ORG, name: 'ant', platform: 'anthropic', apiKey: ORG_KEY });
    const model = await buildChatModelForOrg('main', ORG);

    expect((model as unknown as { apiKey: string }).apiKey).toBe(ORG_KEY);
  });

  it('falls back to the server key when the org has none', async () => {
    const model = await buildChatModelForOrg('main', ORG);

    expect((model as unknown as { apiKey: string }).apiKey).toBe('sk-ant-server-fallback');
  });

  it('lets an explicit apiKey option win and skips the lookup', async () => {
    await storePlatformKey({ orgId: ORG, name: 'ant', platform: 'anthropic', apiKey: ORG_KEY });
    const model = await buildChatModelForOrg('main', ORG, { apiKey: 'sk-ant-explicit-override' });

    expect((model as unknown as { apiKey: string }).apiKey).toBe('sk-ant-explicit-override');
  });

  it('keeps the role model resolution it inherits from buildChatModel', async () => {
    const model = await buildChatModelForOrg('classifier', ORG);

    expect((model as unknown as { model: string }).model).toMatch(/^claude-haiku-4-5/);
  });
});

describe('buildChatModel', () => {
  const originalProvider = process.env.VOCION_LLM_PROVIDER;
  const originalRoleProvider = process.env.VOCION_LLM_PROVIDER_MAIN;
  const originalRoleModel = process.env.VOCION_LLM_MODEL_MAIN;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.VOCION_LLM_PROVIDER;
    delete process.env.VOCION_LLM_PROVIDER_MAIN;
    delete process.env.VOCION_LLM_MODEL_MAIN;
  });

  afterEach(() => {
    const restore = (k: string, v: string | undefined): void => {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    };
    restore('VOCION_LLM_PROVIDER', originalProvider);
    restore('VOCION_LLM_PROVIDER_MAIN', originalRoleProvider);
    restore('VOCION_LLM_MODEL_MAIN', originalRoleModel);
    restore('ANTHROPIC_API_KEY', originalAnthropic);
    restore('OPENAI_API_KEY', originalOpenAI);
  });

  it('defaults main role to ChatAnthropic with claude-sonnet-4-6', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const model = buildChatModel('main');

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect((model as unknown as { model: string }).model).toBe('claude-sonnet-4-6');
  });

  it('defaults classifier role to claude-haiku', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const model = buildChatModel('classifier');

    expect((model as unknown as { model: string }).model).toMatch(/^claude-haiku-4-5/);
  });

  it('honours VOCION_LLM_PROVIDER override', () => {
    process.env.VOCION_LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    const model = buildChatModel('main');

    expect(model).toBeInstanceOf(ChatOpenAI);
  });

  it('role-specific provider beats process-wide provider', () => {
    process.env.VOCION_LLM_PROVIDER = 'anthropic';
    process.env.VOCION_LLM_PROVIDER_MAIN = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const main = buildChatModel('main');
    const classifier = buildChatModel('classifier');

    expect(main).toBeInstanceOf(ChatOpenAI);
    expect(classifier).toBeInstanceOf(ChatAnthropic);
  });

  it('honours VOCION_LLM_MODEL_<ROLE> override', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.VOCION_LLM_MODEL_MAIN = 'claude-opus-4-7';
    const model = buildChatModel('main');

    expect((model as unknown as { model: string }).model).toBe('claude-opus-4-7');
  });

  it('inline options beat env vars', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.VOCION_LLM_MODEL_MAIN = 'claude-sonnet-4-6';
    const model = buildChatModel('main', { model: 'claude-opus-4-7' });

    expect((model as unknown as { model: string }).model).toBe('claude-opus-4-7');
  });

  it('throws a helpful error when the required key is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => buildChatModel('main')).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('rejects unknown provider strings', () => {
    process.env.VOCION_LLM_PROVIDER = 'cohere';

    expect(() => buildChatModel('main')).toThrow(/unknown llm provider/);
  });
});

describe('withPromptCache', () => {
  it('marks the last content block of the last message as ephemeral', () => {
    const out = withPromptCache([
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello' },
    ]);
    const last = out[out.length - 1]!;

    expect(Array.isArray(last.content)).toBe(true);

    const blocks = last.content as unknown as Array<{ type: string; cache_control?: { type: string } }>;

    expect(blocks[blocks.length - 1]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('returns the input unchanged when the list is empty', () => {
    const out = withPromptCache([]);

    expect(out).toEqual([]);
  });

  it('does not mutate earlier messages', () => {
    const out = withPromptCache([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user message' },
    ]);

    expect(out[0]?.content).toBe('system prompt');
  });

  it('preserves an existing block array', () => {
    const out = withPromptCache([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
    ]);
    const blocks = out[0]!.content as Array<{ type: string; text: string; cache_control?: { type: string } }>;

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.cache_control).toBeUndefined();
    expect(blocks[1]?.cache_control).toEqual({ type: 'ephemeral' });
  });
});
