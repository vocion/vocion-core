import type { SourceConnector } from './types';
import { listMcpTools, mcpCredentialsOf, withMcp } from '@/libs/outboundMcp/client';
import { mcpConfigSchema } from '@/libs/outboundMcp/sources';

export const mcpConnector: SourceConnector<typeof mcpConfigSchema> = {
  slug: 'mcp',
  name: 'MCP server',
  description: 'Connect a remote MCP server. Declared reads run live; writes require a Review decision.',
  icon: 'Plug',
  category: 'other',
  authKind: 'apikey',
  syncless: true,
  configSchema: mcpConfigSchema,
  async inspect({ credentials }) {
    const remote = await withMcp(mcpCredentialsOf(credentials), listMcpTools);
    return { reachable: true, authorized: true, checks: [{ key: 'tools', label: 'Tool discovery', ok: true, detail: `${remote.length} tools advertised.` }], note: 'Discovery only; no tools executed.', error: null };
  },
  async* sync() {},
};
