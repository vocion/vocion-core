import type { LLMClient, LLMProviderName } from '@vocion/sdk';
import process from 'node:process';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { anthropicClient } from './anthropic';
import { openaiClient } from './openai';

/**
 * Lazy-initialised per-process singleton clients per provider. Avoids
 * repeated constructor calls on every skill run and shares TCP pools.
 *
 * Unconfigured providers throw on first use with a clear message about
 * which env var is missing. Vertex + azure-openai are registered as
 * "not yet implemented" placeholders so plugin authors can declare the
 * intent today; we ship the adapters when a real customer needs them.
 */

let openaiSingleton: LLMClient | null = null;
let anthropicSingleton: LLMClient | null = null;

export function getLLMClient(provider: LLMProviderName): LLMClient {
  switch (provider) {
    case 'openai': {
      if (!openaiSingleton) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          throw new Error('OPENAI_API_KEY is not set; cannot construct openai provider');
        }
        openaiSingleton = openaiClient(new OpenAI({ apiKey }));
      }
      return openaiSingleton;
    }
    case 'anthropic': {
      if (!anthropicSingleton) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          throw new Error('ANTHROPIC_API_KEY is not set; cannot construct anthropic provider');
        }
        anthropicSingleton = anthropicClient(new Anthropic({ apiKey }));
      }
      return anthropicSingleton;
    }
    case 'vertex':
      throw new Error('vertex provider not yet implemented — coming in Phase 5 with retrieval backends');
    case 'azure-openai':
      throw new Error('azure-openai provider not yet implemented — coming in Phase 5 with retrieval backends');
    default:
      throw new Error(`unknown llm provider: ${provider as string}`);
  }
}

/** Reset singletons — test-only escape hatch. */
export function resetLLMClients(): void {
  openaiSingleton = null;
  anthropicSingleton = null;
}
