import { Buffer } from 'node:buffer';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { azureEmbeddingBackend, EMBEDDING_DIMENSIONS, resolveEmbeddingModel, resolveEmbeddingProvider, vertexEmbeddingBackend } from './embeddingBackend';

/**
 * Embeddings on Azure OpenAI and Vertex AI: the width check every backend owes the
 * `vector(1536)` column, and which credential each spends. Keys are fixtures.
 */

vi.mock('@/libs/llm/orgKey', () => ({
  resolveOrgProviderKey: async () => null,
  resolveOrgProviderCredential: async (provider: string, orgId: string) => {
    if (provider === 'azure-openai' && orgId === 'org_a') {
      return { endpoint: 'https://kestrel.openai.azure.com', apiKey: 'a'.repeat(32) };
    }
    if (provider === 'vertex' && orgId === 'org_a') {
      return { apiKey: 'ya29.fixture', projectId: 'northwind-ai', location: 'us-central1' };
    }
    return null;
  },
}));

afterEach(() => {
  delete process.env.VOCION_LLM_PROVIDER;
});

/**
 * The OpenAI SDK asks for base64 floats and decodes them, so the stand-in answers that way.
 * @param width - The width.
 */
function vector(width: number): number[] {
  return Array.from({ length: width }, (_, i) => i / width);
}

describe('cloud embedding backends', () => {
  it('inherit Azure or Vertex from the chat provider, never Mistral or a self-hosted server', () => {
    process.env.VOCION_LLM_PROVIDER = 'azure-openai';

    expect(resolveEmbeddingProvider()).toBe('azure-openai');

    process.env.VOCION_LLM_PROVIDER = 'mistral';

    expect(resolveEmbeddingProvider()).toBe('openai');
    expect(resolveEmbeddingModel('vertex')).toBe('gemini-embedding-001');
  });

  it('Azure: the workspace\'s own resource, and a vector of the wrong width is refused', async () => {
    const seen: string[] = [];
    const answer = (width: number) => (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: Buffer.from(new Float32Array(vector(width)).buffer).toString('base64') }], model: 'text-embedding-3-small', usage: { prompt_tokens: 3, total_tokens: 3 } }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const ok = await azureEmbeddingBackend('org_a', null, answer(EMBEDDING_DIMENSIONS));

    await expect(ok.embedBatch(['Northwind renewal'])).resolves.toMatchObject({ inputTokens: 3 });
    expect(seen[0]).toBe('https://kestrel.openai.azure.com/openai/v1/embeddings');

    const wide = await azureEmbeddingBackend('org_a', { model: 'text-embedding-3-large' }, answer(3072));

    await expect(wide.embedBatch(['x'])).rejects.toThrow(/3072-dimension vectors, but knowledge_chunk.embedding is vector\(1536\)/);
  });

  it('Vertex: asks Gemini for 1536 dimensions on the workspace\'s project, and checks what came back', async () => {
    const bodies: unknown[] = [];
    const urls: string[] = [];
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      urls.push(input);
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ predictions: [{ embeddings: { values: vector(EMBEDDING_DIMENSIONS), statistics: { token_count: 4 } } }] }));
    }) as typeof fetch;
    const backend = await vertexEmbeddingBackend('org_a', null, fetchImpl);
    const out = await backend.embedBatch(['Kestrel Capital', 'Contoso Supply']);

    expect(out.vectors).toHaveLength(2);
    expect(out.inputTokens).toBe(8);
    expect(urls[0]).toBe('https://us-central1-aiplatform.googleapis.com/v1/projects/northwind-ai/locations/us-central1/publishers/google/models/gemini-embedding-001:predict');
    expect(bodies[0]).toEqual({ instances: [{ content: 'Kestrel Capital' }], parameters: { outputDimensionality: 1536 } });

    const narrow = await vertexEmbeddingBackend('org_a', null, (async () => new Response(JSON.stringify({ predictions: [{ embeddings: { values: vector(768) } }] }))) as unknown as typeof fetch);

    await expect(narrow.embedBatch(['x'])).rejects.toThrow(/768-dimension vectors/);
  });
});
