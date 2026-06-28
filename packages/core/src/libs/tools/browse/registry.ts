import type { CapabilityStatus } from '../types';
import type { BrowseProvider, BrowseProviderName } from './types';
import process from 'node:process';
import { builtinBrowseProvider } from './builtin';
import { firecrawlBrowseProvider } from './firecrawl';

export function resolveBrowseProviderName(): BrowseProviderName {
  const raw = (process.env.VOCION_BROWSE_PROVIDER ?? 'builtin').toLowerCase();
  return raw === 'firecrawl' ? 'firecrawl' : 'builtin';
}

export function getBrowseProvider(name = resolveBrowseProviderName()): BrowseProvider {
  return name === 'firecrawl' ? firecrawlBrowseProvider() : builtinBrowseProvider();
}

export function browseStatus(): CapabilityStatus {
  const name = resolveBrowseProviderName();
  const provider = getBrowseProvider(name);
  const ready = provider.isReady();
  return {
    capability: 'browse',
    provider: name,
    ready,
    missingEnv: ready ? [] : provider.requiredEnv,
  };
}
