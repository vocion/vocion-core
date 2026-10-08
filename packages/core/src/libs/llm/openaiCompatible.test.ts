import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlatform, platformForLLMProvider, validatePlatformCredential } from '@/libs/platforms/registry';
import { canonicalModelId, tokenCostCents } from '@/libs/pricing';
import { buildChatModel, inferProviderForModel } from './langchain';
import { connectionFrom, envConnectionSync, resetVertexTokenCache, resolveOpenAIConnection, vertexBaseUrl } from './openaiCompatible';
import { MODEL_PROVIDERS } from './providers';

/**
 * Azure OpenAI, Mistral, Vertex AI and a self-hosted OpenAI-compatible server: one wire format,
 * four ways to find where to call and with which key. Every key here is a fixture.
 */

const ENV_KEYS = ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'MISTRAL_API_KEY', 'VERTEX_CREDENTIALS', 'VERTEX_PROJECT_ID', 'VERTEX_LOCATION', 'VOCION_OPENAI_COMPATIBLE_BASE_URL', 'VOCION_OPENAI_COMPATIBLE_API_KEY'];

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  vi.doUnmock('@/services/ApiTokenService');
  vi.resetModules();
  resetVertexTokenCache();
});

describe('the four providers on the OpenAI wire format', () => {
  it('are model providers with a platform each, so a workspace can store its own key', () => {
    for (const provider of ['azure-openai', 'mistral', 'vertex', 'openai-compatible'] as const) {
      expect(MODEL_PROVIDERS, provider).toContain(provider);
      expect(platformForLLMProvider(provider)?.credentialsPerOrg, provider).toBe('one-live');
    }

    expect(validatePlatformCredential('mistral', { apiKey: 'a'.repeat(32) })).toEqual({ apiKey: 'a'.repeat(32) });
    expect(validatePlatformCredential('openai-compatible', { baseUrl: 'http://gpu-box.northwind.example:11434/v1' })).toEqual({ baseUrl: 'http://gpu-box.northwind.example:11434/v1' });
    expect(getPlatform('openai-compatible').fields.find(f => f.name === 'apiKey')?.optional).toBe(true);
  });

  it('reach Azure on the resource\'s v1 API with the key in both headers Azure reads', async () => {
    const c = await connectionFrom('azure-openai', { endpoint: 'https://northwind.openai.azure.com/', apiKey: 'k'.repeat(32) }, 'org');

    expect(c).toMatchObject({ baseURL: 'https://northwind.openai.azure.com/openai/v1/', apiKey: 'k'.repeat(32), defaultHeaders: { 'api-key': 'k'.repeat(32) }, streamUsage: true });
  });

  it('reach Mistral at its own API, and a self-hosted server at its base URL even with no key', async () => {
    await expect(connectionFrom('mistral', { apiKey: 'm'.repeat(32) }, 'org')).resolves.toMatchObject({ baseURL: 'https://api.mistral.ai/v1', streamUsage: false });
    await expect(connectionFrom('openai-compatible', { baseUrl: 'http://localhost:8000/v1/' }, 'org')).resolves.toMatchObject({ baseURL: 'http://localhost:8000/v1', apiKey: 'not-needed' });
    await expect(connectionFrom('openai-compatible', {}, 'org')).resolves.toBeNull();
  });

  it('reach Vertex with a token minted from the service account, for the key\'s own project', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const sa = JSON.stringify({ type: 'service_account', client_email: 'vocion@northwind-ai.iam.gserviceaccount.com', private_key: privateKey.export({ format: 'pem', type: 'pkcs8' }), project_id: 'northwind-ai' });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
      const claims = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString());

      expect(claims).toMatchObject({ iss: 'vocion@northwind-ai.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/cloud-platform' });

      return new Response(JSON.stringify({ access_token: 'ya29.minted', expires_in: 3600 }));
    });
    const c = await connectionFrom('vertex', { apiKey: sa, location: 'europe-west4' }, 'org', fetchImpl as unknown as typeof fetch);

    expect(c).toMatchObject({ apiKey: 'ya29.minted', baseURL: vertexBaseUrl('northwind-ai', 'europe-west4') });

    // The token is reused for the same key, not minted per call.
    await connectionFrom('vertex', { apiKey: sa }, 'org', fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vertexBaseUrl('p', 'global')).toBe('https://aiplatform.googleapis.com/v1/projects/p/locations/global/endpoints/openapi');
  });

  it('falls back to the env, and names the variables when neither holds a credential', () => {
    expect(() => envConnectionSync('mistral')).toThrow(/MISTRAL_API_KEY/);

    process.env.MISTRAL_API_KEY = 'e'.repeat(32);

    expect(envConnectionSync('mistral')).toMatchObject({ apiKey: 'e'.repeat(32), from: 'environment' });

    process.env.VERTEX_CREDENTIALS = '{"type":"service_account"}';
    process.env.VERTEX_PROJECT_ID = 'northwind-ai';

    expect(() => envConnectionSync('vertex')).toThrow(/buildChatModelForOrg/);
  });

  it('uses each workspace\'s own credential, one after the other, then the server\'s', async () => {
    const stored: Record<string, Record<string, string>> = {
      org_a: { endpoint: 'https://kestrel.openai.azure.com', apiKey: 'a'.repeat(32) },
      org_b: { endpoint: 'https://contoso.openai.azure.com', apiKey: 'b'.repeat(32) },
    };
    vi.doMock('@/services/ApiTokenService', () => ({
      resolvePlatformCredential: async (orgId: string, platform: string) => (platform === 'azure-openai' ? stored[orgId] ?? null : null),
      resolvePlatformKey: async () => null,
    }));
    process.env.AZURE_OPENAI_ENDPOINT = 'https://server.openai.azure.com';
    process.env.AZURE_OPENAI_API_KEY = 'e'.repeat(32);
    const { resolveOpenAIConnection: resolve } = await import('./openaiCompatible');

    await expect(resolve('azure-openai', 'org_a')).resolves.toMatchObject({ apiKey: 'a'.repeat(32), baseURL: 'https://kestrel.openai.azure.com/openai/v1/', from: 'org' });
    await expect(resolve('azure-openai', 'org_b')).resolves.toMatchObject({ apiKey: 'b'.repeat(32), baseURL: 'https://contoso.openai.azure.com/openai/v1/', from: 'org' });
    await expect(resolve('azure-openai', 'org_c')).resolves.toMatchObject({ apiKey: 'e'.repeat(32), from: 'environment' });
  });

  it('refuses with the env names when nothing is stored or set', async () => {
    await expect(resolveOpenAIConnection('openai-compatible', null)).rejects.toThrow(/VOCION_OPENAI_COMPATIBLE_BASE_URL/);
  });
});

describe('the chat model on these providers', () => {
  it('is a ChatOpenAI pointed at the provider\'s base URL with its key', () => {
    const model = buildChatModel('main', { provider: 'mistral', connection: { provider: 'mistral', baseURL: 'https://api.mistral.ai/v1', apiKey: 'm'.repeat(32), streamUsage: false, from: 'org' } }) as unknown as { model: string; clientConfig?: { baseURL?: string }; apiKey?: string; streamUsage?: boolean };

    expect(model.model).toBe('mistral-large-latest');
    expect(model.clientConfig?.baseURL).toBe('https://api.mistral.ai/v1');
    expect(model.apiKey).toBe('m'.repeat(32));
    expect(model.streamUsage).toBe(false);
  });

  it('reads a vendor off a Mistral or Gemini id, for the model-upgrade test', () => {
    expect(inferProviderForModel('mistral-large-latest')).toBe('mistral');
    expect(inferProviderForModel('google/gemini-2.5-flash')).toBe('vertex');
  });

  it('prices Gemini as Vertex reports it and Mistral Large; a self-hosted model costs nothing', () => {
    expect(canonicalModelId('google/gemini-2.5-flash')).toBe('gemini-2.5-flash');
    expect(tokenCostCents('google/gemini-2.5-pro', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(125);
    expect(tokenCostCents('mistral-large-latest', { inputTokens: 0, outputTokens: 1_000_000 })).toBe(150);
    expect(tokenCostCents('llama3.1', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0);
  });
});
