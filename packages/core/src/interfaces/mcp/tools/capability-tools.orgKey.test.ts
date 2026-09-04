/**
 * The MCP capability tools spend the same key the agent tools do.
 *
 * An MCP client reaches the same providers through a different door, so the
 * org has to travel with the call here too — otherwise a workspace's own
 * Tavily or Firecrawl key is honoured in chat and quietly ignored over MCP.
 *
 * The providers are mocked; these tests assert the wiring, not the vendor
 * call. No network, no database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.fn(async (_query: string, _opts?: { count?: number; orgId?: string }) => []);
const fetchPage = vi.fn(async (url: string, _opts?: { orgId?: string }) => ({
  url,
  title: 'A page',
  content: 'page text',
}));

vi.mock('@/libs/tools/websearch/registry', () => ({
  getWebSearchProvider: () => ({ name: 'tavily', requiredEnv: [], isReady: () => true, search }),
}));

vi.mock('@/libs/tools/browse/registry', () => ({
  getBrowseProvider: () => ({ name: 'firecrawl', requiredEnv: [], isReady: () => true, fetchPage }),
}));

const { capabilityTools } = await import('./capability-tools');

const config = { orgId: 'org_mcp' } as Parameters<typeof capabilityTools>[0];

/**
 * The handler of one capability tool by name.
 * @param name - The MCP tool name, e.g. `fetch_url`.
 */
function handlerFor(name: string) {
  const capabilityTool = capabilityTools(config).find(tool => tool.name === name);
  if (!capabilityTool) {
    throw new Error(`no MCP capability tool named ${name}`);
  }
  return capabilityTool.handler;
}

beforeEach(() => {
  search.mockClear();
  fetchPage.mockClear();
});

describe('MCP capability tools handing down the org', () => {
  it('web_search searches on the configured org', async () => {
    await handlerFor('web_search')({ query: 'vocion', count: 5 });

    expect(search).toHaveBeenCalledWith('vocion', expect.objectContaining({ orgId: 'org_mcp' }));
  });

  it('fetch_url fetches on the configured org', async () => {
    await handlerFor('fetch_url')({ url: 'https://example.com/post' });

    expect(fetchPage).toHaveBeenCalledWith('https://example.com/post', { orgId: 'org_mcp' });
  });

  it('crawl_site crawls on the configured org', async () => {
    await handlerFor('crawl_site')({ start_url: 'https://example.com', max_pages: 1 });

    expect(fetchPage).toHaveBeenCalledWith('https://example.com', { orgId: 'org_mcp' });
  });
});
