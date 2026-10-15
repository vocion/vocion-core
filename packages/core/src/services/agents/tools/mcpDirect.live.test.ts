/** Optional read-only smoke test against a real remote provider. */
import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: async () => ({ baseUrl: process.env.MCP_READ_TEST_URL, token: process.env.MCP_READ_TEST_KEY }),
}));
const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { mcpTools } = await import('./mcpDirect');

describe.skipIf(!process.env.MCP_READ_TEST_URL)('direct remote MCP read', () => {
  it('reads through the agent tool with tenant source configuration and scoped credentials', async () => {
    const name = process.env.MCP_READ_TEST_TOOL!;
    await db.insert(knowledgeSourceSchema).values({ orgId: 'remote_read_test', slug: 'remote', configJson: { _connector: 'mcp', readTools: [name], writeTools: [] } });
    const ctx = { orgId: 'remote_read_test', connectorSources: ['remote'], sourceKinds: { remote: 'mcp' }, allowedSourceSlugs: ['remote'] } as unknown as RuntimeContext;
    const tools = mcpTools(ctx);
    const result = JSON.parse(await tools.find(t => t.name === 'mcp_read')!.invoke({ sourceSlug: 'remote', name, input: {} }) as string);

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.ok).toBe(true);
  });
});
