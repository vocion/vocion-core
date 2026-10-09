/**
 * The model vendors core can build on, as plain data — no SDK, no network — so a workspace
 * schema, a database type and the model factory read one list (principle 6). Adding a vendor is
 * a name here and a case in `./langchain.ts`.
 */

/** Vendors reached through OpenAI's wire format (`./openaiCompatible.ts`). */
export const OPENAI_COMPATIBLE_PROVIDERS = ['azure-openai', 'mistral', 'vertex', 'openai-compatible'] as const;

export type OpenAICompatibleProvider = (typeof OPENAI_COMPATIBLE_PROVIDERS)[number];

/**
 * Every vendor an agent's chat model can be built on — `harness.modelProvider` in workspace
 * YAML, the agent row's type and `VOCION_LLM_PROVIDER`.
 */
export const MODEL_PROVIDERS = ['anthropic', 'openai', 'bedrock', ...OPENAI_COMPATIBLE_PROVIDERS] as const;

export type ModelProviderName = (typeof MODEL_PROVIDERS)[number];

/**
 * Every vendor the workspace's embeddings can run on (`defaults.embeddingProvider`). Each one's
 * vectors are checked against the 1536 the column holds (`libs/retrieval/embeddingBackend.ts`).
 */
export const EMBEDDING_PROVIDERS = ['openai', 'bedrock', 'azure-openai', 'vertex'] as const;

export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];
