/**
 * Two decisions the tool page makes that are easy to get subtly wrong, and
 * invisible when they are: which sentence a member reads, and what name a
 * replacement key inherits.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listPlatformCredentials = vi.fn();

vi.mock('@/services/ApiTokenService', () => ({
  listPlatformCredentials: (orgId: string, platformId: string) => listPlatformCredentials(orgId, platformId),
}));

const { liveCredentialName, memberKeyExplanation } = await import('./keyExplanations');

beforeEach(() => {
  listPlatformCredentials.mockReset();
});

describe('what a member is told about the key', () => {
  it('says the workspace pays when the workspace stored a key', () => {
    const text = memberKeyExplanation('Tavily', true, false);

    expect(text).toContain('this workspace\'s own Tavily key');
    // Nothing to ask an admin for: the workspace is already on its own key.
    expect(text).not.toContain('Ask a workspace admin');
  });

  it('does not send a member hunting for an admin when the server key covers it', () => {
    // The bug this catches: collapsing "the workspace has no key" into "no key
    // exists" and printing "ask an admin to add one" directly under a green
    // Ready badge. The tool works; there is nothing for the member to chase.
    const text = memberKeyExplanation('Firecrawl', false, true);

    expect(text).toContain('Vocion server\'s Firecrawl key');
    expect(text).not.toContain('Ask a workspace admin');
  });

  it('asks for an admin only when nobody holds a key at all', () => {
    const text = memberKeyExplanation('Brave Search', false, false);

    expect(text).toContain('Ask a workspace admin to add one');
  });

  it('prefers the workspace key when both exist', () => {
    // Both can be true — a deployment with its own key, and a workspace that
    // stored one anyway. The workspace's wins at call time, so the sentence
    // has to match, or a member reads that Vocion is paying when they are.
    const text = memberKeyExplanation('OpenAI', true, true);

    expect(text).toContain('this workspace\'s own OpenAI key');
  });
});

describe('the name a replacement key inherits', () => {
  it('carries the name the admin gave the key they are replacing', async () => {
    listPlatformCredentials.mockResolvedValue([
      { name: 'Shared OpenAI — billing', expiresAt: null },
    ]);

    expect(await liveCredentialName('org-1', 'openai')).toBe('Shared OpenAI — billing');
  });

  it('ignores a key the vendor already stopped honouring', async () => {
    // Renaming a fresh key after an expired one hides that a different
    // credential is now in play.
    listPlatformCredentials.mockResolvedValue([
      { name: 'Expired last quarter', expiresAt: new Date(Date.now() - 60_000) },
    ]);

    expect(await liveCredentialName('org-1', 'openai')).toBeNull();
  });

  it('takes the live key when an expired one is listed alongside it', async () => {
    listPlatformCredentials.mockResolvedValue([
      { name: 'Expired last quarter', expiresAt: new Date(Date.now() - 60_000) },
      { name: 'Current key', expiresAt: new Date(Date.now() + 60_000) },
    ]);

    expect(await liveCredentialName('org-1', 'openai')).toBe('Current key');
  });

  it('has no name to offer when the workspace holds nothing', async () => {
    listPlatformCredentials.mockResolvedValue([]);

    expect(await liveCredentialName('org-1', 'tavily')).toBeNull();
  });
});
