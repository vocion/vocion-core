import type { CapabilityStatus } from '../types';
import type { WebSearchProvider, WebSearchProviderName } from './types';
import process from 'node:process';
import { braveProvider } from './brave';
import { tavilyProvider } from './tavily';

/**
 * Resolve the active web-search provider from `VOCION_WEBSEARCH_PROVIDER`
 * (default `tavily`). Mirrors the env-driven resolution in `libs/llm`.
 */
export function resolveWebSearchProviderName(): WebSearchProviderName {
  const raw = (process.env.VOCION_WEBSEARCH_PROVIDER ?? 'tavily').toLowerCase();
  if (raw === 'tavily' || raw === 'brave' || raw === 'anthropic') {
    return raw;
  }
  return 'tavily';
}

export function getWebSearchProvider(name = resolveWebSearchProviderName()): WebSearchProvider {
  switch (name) {
    case 'tavily':
      return tavilyProvider();
    case 'brave':
      return braveProvider();
    case 'anthropic':
      // Provider-native search via the Anthropic Messages `web_search` tool
      // is registered as a declared-but-unbuilt option (mirrors the
      // vertex/azure LLM placeholders). Ship when a tenant needs it.
      throw new Error('anthropic-native web search not yet implemented — use VOCION_WEBSEARCH_PROVIDER=tavily|brave');
    default:
      return tavilyProvider();
  }
}

/** For the dashboard Tools catalog. Never throws. */
export function webSearchStatus(): CapabilityStatus {
  const name = resolveWebSearchProviderName();
  if (name === 'anthropic') {
    return { capability: 'web_search', provider: 'anthropic', ready: false, missingEnv: ['(provider not yet implemented)'] };
  }
  const provider = getWebSearchProvider(name);
  const ready = provider.isReady();
  return {
    capability: 'web_search',
    provider: name,
    ready,
    missingEnv: ready ? [] : provider.requiredEnv,
  };
}
