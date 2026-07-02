/**
 * Token-aware sliding-window chunker. Splits a document's content into
 * overlapping chunks sized for an embedding model's context window.
 *
 * Defaults match the L.2 plan: 512 tokens per chunk, 64 tokens of
 * overlap. tiktoken's `cl100k_base` encoding is the OpenAI default
 * for `text-embedding-3-*` and Chat-GPT-3.5/4 — good enough for most
 * models we'll plug in (Voyage / Cohere tokenize a bit differently
 * but the chunk sizes are similar enough to not matter).
 *
 * Algorithm:
 *   1. tokenize the full content
 *   2. emit windows of `chunkTokens` shifted by `chunkTokens - overlap`
 *   3. last window may be shorter than the full size
 *   4. decode each window back to text
 *
 * For very short content (< chunkTokens) returns a single chunk.
 */

import { getEncoding } from 'js-tiktoken';

export type Chunk = {
  /** Zero-based position in the document. */
  index: number;
  /** Decoded text for this chunk. */
  content: string;
  /** Token count (matches the encoding used to chunk). */
  tokens: number;
};

export type ChunkOptions = {
  chunkTokens?: number;
  overlapTokens?: number;
  /** Encoding name; default `cl100k_base` matches OpenAI 3-series. */
  encoding?: 'cl100k_base' | 'o200k_base';
};

const DEFAULTS: Required<Omit<ChunkOptions, 'encoding'>> & { encoding: NonNullable<ChunkOptions['encoding']> } = {
  chunkTokens: 512,
  overlapTokens: 64,
  encoding: 'cl100k_base',
};

/**
 * Chunk a string of content into overlapping token-sized windows.
 *
 * Returns at least one chunk for any non-empty input. Empty input
 * returns an empty array.
 * @param content
 * @param opts
 */
export function chunkText(content: string, opts: ChunkOptions = {}): Chunk[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }
  const chunkTokens = opts.chunkTokens ?? DEFAULTS.chunkTokens;
  const overlapTokens = opts.overlapTokens ?? DEFAULTS.overlapTokens;
  if (overlapTokens >= chunkTokens) {
    throw new Error(`overlapTokens (${overlapTokens}) must be < chunkTokens (${chunkTokens})`);
  }
  const stride = chunkTokens - overlapTokens;

  // js-tiktoken (pure JS, no wasm) — the wasm `tiktoken` build fails to
  // resolve `tiktoken_bg.wasm` under Turbopack dev, 500-ing every route that
  // transitively imports this chunker (sources, agent runtime). js-tiktoken is
  // already in the tree via @langchain/core, same `cl100k_base` encoding, and
  // its `decode` returns a string directly (no TextDecoder, no `free()`).
  const enc = getEncoding(opts.encoding ?? DEFAULTS.encoding);
  const tokens = enc.encode(trimmed);
  if (tokens.length <= chunkTokens) {
    // Whole document fits in one chunk; return as-is.
    return [{ index: 0, content: trimmed, tokens: tokens.length }];
  }
  const chunks: Chunk[] = [];
  let cursor = 0;
  let index = 0;
  while (cursor < tokens.length) {
    const end = Math.min(cursor + chunkTokens, tokens.length);
    const slice = tokens.slice(cursor, end);
    const decoded = enc.decode(slice);
    chunks.push({ index, content: decoded, tokens: slice.length });
    index += 1;
    if (end === tokens.length) {
      break;
    }
    cursor += stride;
  }
  return chunks;
}

/**
 * Compute a stable SHA-256 content hash for change-detection. Used by
 * IngestionService to short-circuit re-embed when content hasn't
 * changed since the last ingest.
 * @param content
 */
export async function contentHash(content: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(content).digest('hex');
}
