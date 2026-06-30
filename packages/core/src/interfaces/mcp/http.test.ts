import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateBearer } from '@/services/ApiTokenService';
import { buildServerForBearer, mcpConfigForBearer, McpHttpError } from './http';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({
  authenticateBearer: vi.fn(),
}));

const mockAuth = vi.mocked(authenticateBearer);

const identity = {
  orgId: 'org_http',
  tokenId: 'tk1',
  principal: { kind: 'user' as const, id: 'token:tk1', role: 'owner' as const, scope: { orgId: 'org_http' }, grants: ['*'] },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mcp over http (multi-tenant bearer)', () => {
  it('rejects a request without a valid token (401)', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(mcpConfigForBearer('Bearer bad')).rejects.toBeInstanceOf(McpHttpError);
    await expect(mcpConfigForBearer('Bearer bad')).rejects.toMatchObject({ status: 401 });
  });

  it('derives an org-scoped config from the token (authoring off over HTTP)', async () => {
    mockAuth.mockResolvedValue(identity);
    const { config, identity: id } = await mcpConfigForBearer('Bearer ok');

    expect(config.orgId).toBe('org_http');
    expect(config.autoCommit).toBe(false);
    expect(config.autoApply).toBe(false);
    expect(id.orgId).toBe('org_http');
  });

  it('serves the tool surface end-to-end for the token org', async () => {
    mockAuth.mockResolvedValue(identity);
    const { server } = await buildServerForBearer('Bearer ok');

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);

    expect(names.length).toBeGreaterThan(8);
    expect(names).toContain('search_query');
    expect(names).toContain('runtime_list_runs');

    await client.close();
  });
});
