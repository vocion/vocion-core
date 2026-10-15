import type { Action } from './types';
import { z } from 'zod';
import { callMcpTool, listMcpTools, mcpCredentialsOf, withMcp } from '@/libs/outboundMcp/client';
import { loadMcpSources } from '@/libs/outboundMcp/sources';

const inputSchema = z.object({
  sourceSlug: z.string().min(1),
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  summary: z.string().min(1).max(1000),
});

export const mcpCallAction: Action<typeof inputSchema> = {
  id: 'mcp.call',
  name: 'Execute an MCP tool',
  description: 'Propose a declared MCP write. Discover its schema with mcp_list_tools, then submit sourceSlug, tool, input and a summary. Always waits for human Review.',
  inputSchema,
  grant: 'mcp_call',
  external: true,
  approvalRequired: true,
  sourceSlugFor: input => input.sourceSlug,
  policyKeyFor: input => `mcp.call.${input.sourceSlug}.${input.tool}`,
  async precheck(ctx, input) {
    const [source] = await loadMcpSources(ctx.orgId, [input.sourceSlug]);
    return source?.config.writeTools.includes(input.tool) ? undefined : 'This MCP write is not declared for this workspace source.';
  },
  async reviewCard(_ctx, input) {
    return {
      title: `${input.tool} on ${input.sourceSlug}`,
      system: input.sourceSlug,
      headline: input.summary,
      fields: [{ label: 'Source', value: input.sourceSlug }, { label: 'Tool', value: input.tool }],
      content: [{ kind: 'text', id: 'arguments', label: 'Exact arguments to execute', body: JSON.stringify(input.input, null, 2), preformatted: true }],
      verbs: { approve: 'Execute', reject: 'Reject' },
    };
  },
  async execute(ctx, input) {
    if (!ctx.reviewedBy) {
      throw new Error('MCP writes require an explicit Review decision.');
    }
    const [source] = await loadMcpSources(ctx.orgId, [input.sourceSlug]);
    if (!source?.config.writeTools.includes(input.tool)) {
      throw new Error('This MCP write is no longer enabled.');
    }
    const result = await withMcp(mcpCredentialsOf(ctx.credentials), async (client) => {
      const remote = (await listMcpTools(client)).find(tool => tool.name === input.tool);
      if (!remote) {
        throw new Error('MCP tool is no longer available.');
      }
      return callMcpTool(client, remote, input.input);
    });
    return { sourceSlug: input.sourceSlug, tool: input.tool, result };
  },
};
