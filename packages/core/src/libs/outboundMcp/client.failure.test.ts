import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ transportFailure: false }));
vi.mock('@/libs/net/publicUrl', () => ({ resolvesPublicly: async () => ({ ok: true }) }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class {} }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    async connect() {
      if (state.transportFailure) {
        throw new Error('Bearer secret-provider-response');
      }
    }

    async close() {}

    async callTool() {
      return { isError: true, content: [{ type: 'text', text: 'secret-provider-response' }] };
    }
  },
}));
const { withMcp, callMcpTool } = await import('./client');

it('preserves a known tool failure instead of claiming transport uncertainty', async () => {
  state.transportFailure = false;

  await expect(withMcp({ baseUrl: 'https://example.com/mcp', token: 'test' }, client => callMcpTool(client, { name: 'write', inputSchema: { type: 'object' } }, {}))).rejects.toThrow('This execution is not pending');
});

describe('transport failures', () => {
  it('keeps raw provider responses out of errors', async () => {
    state.transportFailure = true;

    await expect(withMcp({ baseUrl: 'https://example.com/mcp', token: 'test' }, async () => null)).rejects.toThrow('MCP request failed. A submitted write may have succeeded; inspect provider state before retrying.');

    state.transportFailure = false;
  });
});
