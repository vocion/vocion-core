/**
 * Embedding backends — the provider seam behind `./embedder.ts`.
 *
 * The embedder used to be OpenAI with no switch: one client, one model id, one
 * request shape. This module is what lets the same batching, retry and tracing
 * loop run against Amazon Bedrock instead, chosen by configuration rather than
 * by editing a call site.
 *
 * A backend owns three things the loop cannot know for itself: which model it
 * is calling, how many texts fit in one request, and how to turn a request into
 * vectors. Everything else — retries, Langfuse spans, gap checking, the
 * record/replay cache — stays in the embedder, so adding a provider never
 * duplicates that logic.
 *
 * **Vector dimensions are a hard constraint, not a preference.** The
 * `knowledge_chunk.embedding` column is declared `vector(1536)` in
 * `models/Schema.ts`, and pgvector fixes that width in the DDL. A model that
 * returns any other width cannot be stored without a schema migration and a
 * re-embed of every existing chunk. So every backend checks the width of what
 * it got back and fails loudly rather than letting a mismatch reach the insert,
 * where it would surface as an opaque database error halfway through a sync.
 */

import type { AwsCredentials } from '@/services/ApiTokenService';
import process from 'node:process';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { db } from '@/libs/DB';
import { buildBedrockRuntimeClient } from '@/libs/llm/bedrock';
import { bedrockRegion, resolveBedrockCredentials } from '@/libs/llm/bedrockCredentials';
import { resolveOrgProviderKey } from '@/libs/llm/orgKey';
import { projectSchema } from '@/models/Schema';

/**
 * The width the `knowledge_chunk.embedding` column accepts.
 *
 * Kept here rather than read from the schema because pgvector's dimension is
 * part of the column type, not a value we can query cheaply per request, and
 * because the check has to run before the insert to be useful. If the column
 * ever changes width, this constant changes with it in the same commit.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/** Which vendor produces embeddings. */
export type EmbeddingProviderName = 'openai' | 'bedrock';

/** What one embedding request returned. */
export type EmbeddingBatchResult = {
  /** Vectors in the same order as the texts that were passed in. */
  vectors: number[][];
  /** Tokens the provider counted for this request, for cost attribution. */
  inputTokens: number;
};

export type EmbeddingBackend = {
  provider: EmbeddingProviderName;
  /** The model id calls will name — also the record/replay cache key. */
  model: string;
  /**
   * How many texts may go in one request.
   *
   * OpenAI takes many per call. Bedrock's Titan models take exactly one, so the
   * loop above sends one request per text rather than pretending otherwise.
   */
  batchSize: number;
  /**
   * Embed one request's worth of text.
   * @param texts - At most `batchSize` strings.
   */
  embedBatch: (texts: string[]) => Promise<EmbeddingBatchResult>;
};

/**
 * A workspace's authored embedding settings, as stored on `project`.
 *
 * Both keys optional and the whole thing nullable: a workspace may pin the
 * provider, the model, both, or neither, and each unset key falls through to
 * the environment on its own.
 */
export type WorkspaceEmbeddingConfig = {
  provider?: EmbeddingProviderName;
  model?: string;
} | null;

/**
 * The workspace's authored embedding settings, or null when it has none.
 *
 * One indexed read by primary key. The embedder already reads and decrypts a
 * credential row per call, so this is the cheaper of the two lookups it does.
 * @param orgId - The workspace (project id) the embeddings belong to.
 */
export async function loadWorkspaceEmbeddingConfig(orgId: string): Promise<WorkspaceEmbeddingConfig> {
  const [project] = await db
    .select({ embeddingConfig: projectSchema.embeddingConfig })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  return project?.embeddingConfig ?? null;
}

/**
 * Which provider embeddings should run on.
 *
 * Resolution order:
 *
 *   1. The workspace's own `defaults.embeddingProvider`, authored in
 *      workspace.yaml and applied to the project row. Highest precedence
 *      because it is the setting a workspace's stored vectors were actually
 *      produced under — an env var changing underneath it would invalidate
 *      every one of them.
 *   2. `VOCION_EMBEDDING_PROVIDER` — the deployment-wide answer, and the one to
 *      set when chat and embeddings should live on different vendors.
 *   3. `VOCION_LLM_PROVIDER_EMBEDDER` / `VOCION_LLM_PROVIDER` — so that
 *      pointing the whole deployment at Bedrock moves embeddings too, without a
 *      second variable. Only honoured when it names a provider that actually
 *      has an embedding model: `anthropic` ships none, so an Anthropic
 *      deployment keeps embedding on OpenAI rather than failing.
 *   4. `openai` — the historical default, and what every stored vector in an
 *      existing deployment was produced by.
 * @param stored - The workspace's authored settings, or null for none.
 */
export function resolveEmbeddingProvider(stored: WorkspaceEmbeddingConfig = null): EmbeddingProviderName {
  if (stored?.provider) {
    return stored.provider;
  }
  const explicit = process.env.VOCION_EMBEDDING_PROVIDER?.toLowerCase();
  if (explicit) {
    if (explicit !== 'openai' && explicit !== 'bedrock') {
      throw new Error(
        `unknown embedding provider "${explicit}"; expected 'openai' or 'bedrock'`,
      );
    }
    return explicit;
  }
  const inherited = (
    process.env.VOCION_LLM_PROVIDER_EMBEDDER ?? process.env.VOCION_LLM_PROVIDER
  )?.toLowerCase();
  if (inherited === 'bedrock') {
    return 'bedrock';
  }
  return 'openai';
}

/** Per-provider default model, overridable with `VOCION_EMBEDDING_MODEL`. */
const DEFAULT_MODELS: Record<EmbeddingProviderName, string> = {
  // 1536-d, which is the width the schema column was built for.
  openai: 'text-embedding-3-small',
  // Titan Text Embeddings G1. Chosen over Titan V2 because V2 emits 1024, 512
  // or 256 dimensions and cannot be asked for 1536 — switching to it means a
  // schema migration plus a re-embed of every stored chunk. AWS's own docs
  // disagree about G1's width (the launch blog says 1536, the AI service card
  // says 1024), which is exactly why `assertDimensions` below checks rather
  // than trusts: the first real call settles it, and says so in the error.
  bedrock: 'amazon.titan-embed-text-v1',
};

/**
 * The model id to call for `provider`.
 *
 * Same precedence as the provider: the workspace's authored model first, then
 * `VOCION_EMBEDDING_MODEL`, then the provider's default.
 * @param provider - The provider being used.
 * @param stored - The workspace's authored settings, or null for none.
 */
export function resolveEmbeddingModel(
  provider: EmbeddingProviderName,
  stored: WorkspaceEmbeddingConfig = null,
): string {
  return stored?.model ?? process.env.VOCION_EMBEDDING_MODEL ?? DEFAULT_MODELS[provider];
}

/**
 * Refuse a vector the database cannot store.
 *
 * Named in the error: the model, the width it produced, and the width the column
 * takes — because the fix depends on all three, and the person reading the log
 * needs to know whether to change the model or migrate the column.
 * @param vector - The vector the provider returned.
 * @param model - The model that produced it, for the message.
 */
function assertDimensions(vector: number[], model: string): void {
  if (vector.length === EMBEDDING_DIMENSIONS) {
    return;
  }
  throw new Error(
    `embedding model ${model} returned ${vector.length}-dimension vectors, but knowledge_chunk.embedding is vector(${EMBEDDING_DIMENSIONS}) — `
    + `storing these needs a schema migration and a re-embed of every existing chunk. Pick a ${EMBEDDING_DIMENSIONS}-dimension model or run that migration first.`,
  );
}

/**
 * An OpenAI embedding backend for one org, on that org's own key when it has
 * stored one and on the server's key otherwise.
 *
 * Built per call rather than cached, for the reason the whole LLM client cache
 * was removed: a cached client holds one org's key and hands it to the next org
 * that asks. A constructor is nothing next to an HTTP round trip, and building
 * fresh means a rotated or revoked key takes effect on the very next batch.
 * @param orgId - The org whose embeddings are being generated.
 * @param stored - The workspace's authored embedding settings, or null.
 */
async function openAiEmbeddingBackend(orgId: string, stored: WorkspaceEmbeddingConfig): Promise<EmbeddingBackend> {
  const apiKey = await resolveOrgProviderKey('openai', orgId) ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('No OpenAI key available — embeddings require one. Store an OpenAI key for this workspace under API credentials, or set OPENAI_API_KEY on the running container or in .env.local.');
  }
  const model = resolveEmbeddingModel('openai', stored);
  // maxRetries: 0 — retrying is handled by the embedder's own loop, and this
  // client would otherwise retry the same request twice more underneath it.
  // Two layers that can't see each other multiply: five of our attempts become
  // fifteen requests, each already carrying the client's own waits. Ours is the
  // layer to keep, because it logs each retry and honours `Retry-After`.
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  return {
    provider: 'openai',
    model,
    // OpenAI accepts up to 2048 inputs per request, but the latency curve
    // flattens around 100 and this keeps memory bounded.
    batchSize: 100,
    async embedBatch(texts: string[]): Promise<EmbeddingBatchResult> {
      const response = await client.embeddings.create({ model, input: texts });
      const vectors: number[][] = [];
      // Placed by the index the response reports, not by arrival order — the
      // API does not promise the latter. The embedder checks for gaps.
      for (const item of response.data) {
        assertDimensions(item.embedding, model);
        vectors[item.index] = item.embedding;
      }
      return { vectors, inputTokens: response.usage?.total_tokens ?? 0 };
    },
  };
}

/**
 * The shape Titan returns from `InvokeModel`.
 *
 * Both Titan G1 and Titan V2 answer with these two fields for a float
 * embedding, so one type covers the model ids this backend is used with.
 */
type TitanEmbeddingResponse = {
  embedding?: number[];
  inputTextTokenCount?: number;
};

/**
 * A Bedrock embedding backend for one org, on that org's own AWS key pair when
 * it has stored one and on the process's AWS identity otherwise.
 *
 * Speaks `InvokeModel` rather than Converse: Converse is a chat API and Titan
 * is not a chat model. That also fixes the batch size at one — Titan's request
 * body carries a single `inputText`, with no array form — so a hundred chunks
 * are a hundred requests. The embedder's retry and tracing run per request
 * either way, so this costs round trips, not correctness.
 * @param orgId - The org whose embeddings are being generated.
 * @param stored - The workspace's authored embedding settings, or null.
 */
async function bedrockEmbeddingBackend(orgId: string, stored: WorkspaceEmbeddingConfig): Promise<EmbeddingBackend> {
  const { keyPair } = await resolveBedrockCredentials(orgId);
  return buildBedrockEmbeddingBackend({
    credentials: keyPair,
    region: bedrockRegion(),
    model: resolveEmbeddingModel('bedrock', stored),
  });
}

/**
 * The Bedrock backend for an explicit credential and region.
 *
 * Split out from {@link bedrockEmbeddingBackend} so a test can supply
 * credentials without a database, and so a caller that already resolved them
 * does not resolve them twice.
 * @param options - Credential, region and model for the client.
 * @param options.credentials - An explicit key pair, or null to let the AWS SDK
 * resolve one.
 * @param options.region - The AWS region to call.
 * @param options.model - The Bedrock embedding model id to invoke.
 */
export function buildBedrockEmbeddingBackend(options: {
  credentials: AwsCredentials | null;
  region: string;
  model: string;
}): EmbeddingBackend {
  const model = options.model;
  const client = buildBedrockRuntimeClient({
    region: options.region,
    credentials: options.credentials,
  });
  return {
    provider: 'bedrock',
    model,
    batchSize: 1,
    async embedBatch(texts: string[]): Promise<EmbeddingBatchResult> {
      const inputText = texts[0];
      if (texts.length !== 1 || inputText === undefined) {
        throw new Error(
          `Bedrock embeddings take exactly one text per request, got ${texts.length}`,
        );
      }
      const response = await client.send(new InvokeModelCommand({
        modelId: model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ inputText }),
      }));
      // InvokeModel hands back the body as bytes, not parsed JSON.
      const decoded = JSON.parse(
        new TextDecoder().decode(response.body),
      ) as TitanEmbeddingResponse;
      const vector = decoded.embedding;
      if (!vector) {
        throw new Error(
          `embedding model ${model} returned no embedding field — refusing to store an incomplete result`,
        );
      }
      assertDimensions(vector, model);
      return { vectors: [vector], inputTokens: decoded.inputTextTokenCount ?? 0 };
    },
  };
}

/**
 * The embedding backend for one org, on the provider that org is configured for.
 *
 * Resolved once per `embed()` call: every batch in that call belongs to the same
 * org, so one settings read and one credential lookup cover them all.
 * @param orgId - The org whose embeddings are being generated.
 */
export async function embeddingBackendForOrg(orgId: string): Promise<EmbeddingBackend> {
  const stored = await loadWorkspaceEmbeddingConfig(orgId);
  const provider = resolveEmbeddingProvider(stored);
  if (provider === 'bedrock') {
    return bedrockEmbeddingBackend(orgId, stored);
  }
  return openAiEmbeddingBackend(orgId, stored);
}
