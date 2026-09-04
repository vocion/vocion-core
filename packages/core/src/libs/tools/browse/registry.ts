import type { CapabilityStatus } from '../types';
import type { BrowseProvider, BrowseProviderName } from './types';
import process from 'node:process';
import { statusForProvider } from '../status';
import { builtinBrowseProvider } from './builtin';
import { firecrawlBrowseProvider } from './firecrawl';

export function resolveBrowseProviderName(): BrowseProviderName {
  const raw = (process.env.VOCION_BROWSE_PROVIDER ?? 'builtin').toLowerCase();
  return raw === 'firecrawl' ? 'firecrawl' : 'builtin';
}

export function getBrowseProvider(name = resolveBrowseProviderName()): BrowseProvider {
  return name === 'firecrawl' ? firecrawlBrowseProvider() : builtinBrowseProvider();
}

export async function browseStatus(orgId?: string): Promise<CapabilityStatus> {
  const name = resolveBrowseProviderName();
  return statusForProvider('browse', getBrowseProvider(name), orgId);
}
