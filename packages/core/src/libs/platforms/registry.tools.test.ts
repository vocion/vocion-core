/**
 * The credential platforms behind the built-in tools.
 *
 * A tool provider (Tavily, Brave, Firecrawl) is paid for per call, so a
 * workspace that supplies its own key should spend its own account rather than
 * the server's. That means each of them needs a platform in the registry, and
 * a way back from "the provider about to be called" to "the platform whose
 * credential authenticates it" — the tool equivalent of `llmProvider` for
 * models and `connectorSlug` for connectors.
 *
 * These platforms are deliberately `one-live`: a tool has no instance to tell
 * two keys apart, unlike a Strapi connector pointed at staging or production,
 * so one live key per org is the whole answer. That also keeps them inside the
 * existing `api_token_org_platform_live_idx` unique index, which constrains
 * every platform *not* named in the `many` list.
 */
import { describe, expect, it } from 'vitest';
import {
  getPlatform,
  listPlatforms,
  MANY_CREDENTIAL_PLATFORM_IDS,
  platformForToolProvider,
} from './registry';

const TOOL_PROVIDERS = ['tavily', 'brave', 'firecrawl'] as const;

describe('finding the platform behind a tool provider', () => {
  it.each(TOOL_PROVIDERS)('maps %s to its own platform', (provider) => {
    expect(platformForToolProvider(provider)?.id).toBe(provider);
  });

  it('answers null for a provider no platform claims', () => {
    expect(platformForToolProvider('builtin')).toBeNull();
  });

  it('never maps two platforms to one tool provider', () => {
    const claimed = listPlatforms()
      .map(platform => platform.toolProvider)
      .filter(provider => provider !== null);

    expect(claimed).toHaveLength(new Set(claimed).size);
  });
});

describe('the image tool', () => {
  it('resolves through the same OpenAI platform the model calls use', () => {
    // Image generation bills the OpenAI account, so it has no platform of its
    // own — the workspace's existing OpenAI key is the one it spends.
    expect(platformForToolProvider('openai')?.id).toBe('openai');
  });
});

describe('how a tool platform stores its key', () => {
  it.each(TOOL_PROVIDERS)('%s holds a key the workspace pasted, not one Vocion minted', (provider) => {
    expect(getPlatform(provider).keySource).toBe('supplied');
  });

  it.each(TOOL_PROVIDERS)('%s holds at most one live key per org', (provider) => {
    expect(getPlatform(provider).credentialsPerOrg).toBe('one-live');
  });

  it.each(TOOL_PROVIDERS)('%s stays out of the many-credential list, so the existing unique index covers it', (provider) => {
    expect(MANY_CREDENTIAL_PLATFORM_IDS).not.toContain(provider);
  });

  it.each(TOOL_PROVIDERS)('%s asks for exactly one secret field', (provider) => {
    const fields = getPlatform(provider).fields;

    expect(fields).toHaveLength(1);
    expect(fields[0]?.secret).toBe(true);
  });

  it.each(TOOL_PROVIDERS)('%s belongs to no connector and no model provider', (provider) => {
    const platform = getPlatform(provider);

    expect(platform.connectorSlug).toBeNull();
    expect(platform.llmProvider).toBeNull();
  });
});
