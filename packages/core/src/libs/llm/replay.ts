/**
 * LLM replay plumbing for the hosted demo sandbox.
 *
 * Modes (VOCION_LLM_MODE):
 *   live    - normal operation (default). No caching, no fixtures.
 *   record  - every model call goes to the provider AND is persisted to
 *             the cache dir, keyed by a hash of the exact prompt. Run the
 *             demo flows once locally with real keys in this mode.
 *   replay  - no provider is ever called. Cache hits return the recorded
 *             generation; misses return a friendly canned response that
 *             points visitors at the recorded flows. Zero LLM spend, zero
 *             prompt-injection surface, deterministic behavior.
 *
 * Cache layout (VOCION_LLM_CACHE_DIR, default `<cwd>/demo/llm-cache`):
 *   chat/<sha256>.json        - LangChain Generation[] for a prompt+llmKey
 *   embeddings/<sha256>.json  - number[] vector for a text+model
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export type LLMMode = 'live' | 'record' | 'replay';

export function llmMode(): LLMMode {
  const raw = (process.env.VOCION_LLM_MODE ?? 'live').toLowerCase();
  return raw === 'record' || raw === 'replay' ? raw : 'live';
}

export function cacheDir(sub: 'chat' | 'embeddings'): string {
  const base = process.env.VOCION_LLM_CACHE_DIR ?? join(process.cwd(), 'demo', 'llm-cache');
  const dir = join(base, sub);
  if (llmMode() === 'record') {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function hashKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join(' ')).digest('hex');
}

export function readEntry<T>(sub: 'chat' | 'embeddings', key: string): T | null {
  const file = join(cacheDir(sub), `${key}.json`);
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeEntry(sub: 'chat' | 'embeddings', key: string, value: unknown): void {
  writeFileSync(join(cacheDir(sub), `${key}.json`), JSON.stringify(value));
}

/** What a visitor gets when they go off the recorded path in replay mode. */
export const REPLAY_FALLBACK_TEXT
  = 'This shared sandbox replays recorded runs, so I cannot take novel requests here. '
    + 'Try one of the sample prompts on this workspace - or clone the repo and run this exact '
    + 'workspace live with your own keys. Everything you see (agents, runs, reviews, learnings) '
    + 'is the real product on real data.';

/**
 * Deterministic unit-norm pseudo-vector for replay-mode embedding misses.
 * @param text
 * @param dims
 */
export function pseudoVector(text: string, dims = 1536): number[] {
  let seed = 0;
  const h = hashKey(text);
  for (let i = 0; i < h.length; i += 8) {
    seed = (seed ^ Number.parseInt(h.slice(i, i + 8), 16)) >>> 0;
  }
  const out: number[] = Array.from({ length: dims });
  let a = seed;
  let norm = 0;
  for (let i = 0; i < dims; i++) {
    a = (Math.imul(a ^ (a >>> 15), 2246822519) + 0x9E3779B9) >>> 0;
    const v = ((a / 4294967296) - 0.5) * 2;
    out[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  return out.map(v => v / norm);
}
