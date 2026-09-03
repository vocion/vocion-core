import type { InvokeModelCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Bedrock embedding backend — the Titan `InvokeModel` request and response.
 *
 * The runtime client is replaced with a stub, so no AWS call is made and no
 * credentials are needed. `InvokeModelCommand` stays real, which is what lets
 * these assertions read the exact body that would have gone over the wire.
 *
 * The dimension cases carry the weight here. AWS's own documentation disagrees
 * about Titan G1's output width, so the code refuses a vector the
 * `vector(1536)` column cannot hold rather than trusting either source — and
 * these tests are what prove the refusal happens before any insert.
 */

// The module reads the project row in `loadWorkspaceEmbeddingConfig`, which is
// not exercised here but is imported. PGlite stands in so no real connection is
// opened.
vi.mock('@/libs/DB');

/** What the stub client's `send` should do next. Set per test. */
let sendImplementation: (input: InvokeModelCommandInput) => unknown = () => {
  throw new Error('no send implementation set');
};

/** Every command input the stub was sent, in order. */
const sentInputs: InvokeModelCommandInput[] = [];

vi.mock('@/libs/llm/bedrock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/llm/bedrock')>();
  return {
    ...actual,
    buildBedrockRuntimeClient: () => ({
      send: async (command: { input: InvokeModelCommandInput }) => {
        sentInputs.push(command.input);
        return sendImplementation(command.input);
      },
    }),
  };
});

const { buildBedrockEmbeddingBackend } = await import('./embeddingBackend');

/**
 * A Titan response, encoded the way `InvokeModel` returns it — bytes, not JSON.
 * @param body - The parsed body to encode.
 */
function titanReply(body: unknown): { body: Uint8Array } {
  return { body: new TextEncoder().encode(JSON.stringify(body)) };
}

/** A vector of the width the schema column accepts. */
function validVector(): number[] {
  return Array.from({ length: 1536 }, (_, index) => index / 1536);
}

function backend() {
  return buildBedrockEmbeddingBackend({
    credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' },
    region: 'us-west-2',
    model: 'amazon.titan-embed-text-v1',
  });
}

beforeEach(() => {
  sentInputs.length = 0;
});

afterEach(() => {
  sendImplementation = () => {
    throw new Error('no send implementation set');
  };
});

describe('buildBedrockEmbeddingBackend request', () => {
  it('reports the provider and model it will call', () => {
    const created = backend();

    expect(created.provider).toBe('bedrock');
    expect(created.model).toBe('amazon.titan-embed-text-v1');
  });

  it('takes one text per request, because Titan has no array input form', () => {
    expect(backend().batchSize).toBe(1);
  });

  it('sends the text as Titan inputText, with JSON content types', async () => {
    sendImplementation = () => titanReply({ embedding: validVector(), inputTextTokenCount: 4 });

    await backend().embedBatch(['a chunk of text']);

    expect(sentInputs[0]?.modelId).toBe('amazon.titan-embed-text-v1');
    expect(sentInputs[0]?.contentType).toBe('application/json');
    expect(sentInputs[0]?.accept).toBe('application/json');
    expect(JSON.parse(String(sentInputs[0]?.body))).toEqual({ inputText: 'a chunk of text' });
  });

  it('refuses more than one text rather than silently embedding only the first', async () => {
    await expect(backend().embedBatch(['one', 'two'])).rejects.toThrow(
      /exactly one text per request, got 2/,
    );
  });

  it('refuses an empty batch, which would otherwise send an undefined inputText', async () => {
    await expect(backend().embedBatch([])).rejects.toThrow(
      /exactly one text per request, got 0/,
    );
  });
});

describe('buildBedrockEmbeddingBackend response', () => {
  it('returns the vector and the token count Titan reported', async () => {
    const vector = validVector();
    sendImplementation = () => titanReply({ embedding: vector, inputTextTokenCount: 9 });

    const result = await backend().embedBatch(['text']);

    expect(result.vectors).toEqual([vector]);
    expect(result.inputTokens).toBe(9);
  });

  it('reports zero tokens rather than NaN when Titan omits the count', async () => {
    sendImplementation = () => titanReply({ embedding: validVector() });

    await expect(backend().embedBatch(['text'])).resolves.toMatchObject({ inputTokens: 0 });
  });

  it('refuses a reply with no embedding field', async () => {
    sendImplementation = () => titanReply({ inputTextTokenCount: 3 });

    await expect(backend().embedBatch(['text'])).rejects.toThrow(
      /returned no embedding field/,
    );
  });

  it('refuses a vector of the wrong width, naming both widths and the model', async () => {
    // 1024 is what Titan V2 emits, and what one AWS page claims for G1. Either
    // way it cannot go in a vector(1536) column.
    sendImplementation = () => titanReply({
      embedding: Array.from({ length: 1024 }, () => 0.1),
      inputTextTokenCount: 3,
    });

    await expect(backend().embedBatch(['text'])).rejects.toThrow(
      /amazon\.titan-embed-text-v1 returned 1024-dimension vectors, but knowledge_chunk\.embedding is vector\(1536\)/,
    );
  });

  it('says what fixing a width mismatch takes, so the log is actionable', async () => {
    sendImplementation = () => titanReply({ embedding: [0.1, 0.2], inputTextTokenCount: 1 });

    await expect(backend().embedBatch(['text'])).rejects.toThrow(
      /schema migration and a re-embed/,
    );
  });

  it('lets an AccessDeniedException reach the caller unchanged', async () => {
    sendImplementation = () => {
      throw Object.assign(new Error('User is not authorized to perform bedrock:InvokeModel'), {
        name: 'AccessDeniedException',
        $metadata: { httpStatusCode: 403 },
      });
    };

    await expect(backend().embedBatch(['text'])).rejects.toThrow(/not authorized/);
  });

  it('calls the model the caller named, not the env default', async () => {
    sendImplementation = () => titanReply({ embedding: validVector(), inputTextTokenCount: 1 });

    const created = buildBedrockEmbeddingBackend({
      credentials: null,
      region: 'us-east-1',
      model: 'amazon.titan-embed-text-v2:0',
    });
    await created.embedBatch(['text']);

    expect(created.model).toBe('amazon.titan-embed-text-v2:0');
    expect(sentInputs[0]?.modelId).toBe('amazon.titan-embed-text-v2:0');
  });
});
