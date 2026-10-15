import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { callMcpTool, listMcpTools, mcpCredentialsOf, withMcp } from '@/libs/outboundMcp/client';
import { loadMcpSources } from '@/libs/outboundMcp/sources';
import { getCredentialsForSource } from '@/services/SourceCredentialService';

/**
 * Both the agent assignment and requesting user's source ACL must permit access.
 * @param ctx - The agent and requesting user scope.
 */
export function mcpTools(ctx: RuntimeContext) {
  const slugs = ctx.connectorSources.filter(slug => ctx.sourceKinds?.[slug] === 'mcp'
    && (!ctx.allowedSourceSlugs || ctx.allowedSourceSlugs.includes(slug)));
  if (!slugs.length) {
    return [];
  }
  async function sourceFor(slug: string) {
    if (!slugs.includes(slug)) {
      throw new Error('MCP source is outside this request scope.');
    }
    const [source] = await loadMcpSources(ctx.orgId, [slug]);
    if (!source) {
      throw new Error('MCP source is unavailable.');
    }
    return source;
  }
  return [
    tool(async ({ sourceSlug }) => {
      const source = await sourceFor(sourceSlug);
      const credentials = mcpCredentialsOf(await getCredentialsForSource(ctx.orgId, sourceSlug));
      return JSON.stringify(await withMcp(credentials, async client => ({
        sourceSlug,
        tools: (await listMcpTools(client)).filter(remote => source.config.readTools.includes(remote.name) || source.config.writeTools.includes(remote.name)),
        writes: 'Propose declared writes with propose_action, action_id=mcp.call. Approval executes the exact submitted arguments.',
      })));
    }, { name: 'mcp_list_tools', description: 'Discover declared MCP tools and their input schemas for an assigned source.', schema: z.object({ sourceSlug: z.string() }) }),
    tool(async ({ sourceSlug, name, input }) => {
      const source = await sourceFor(sourceSlug);
      if (!source.config.readTools.includes(name)) {
        throw new Error('Only explicitly declared reads may execute here; propose writes through mcp.call.');
      }
      const credentials = mcpCredentialsOf(await getCredentialsForSource(ctx.orgId, sourceSlug));
      return JSON.stringify(await withMcp(credentials, async (client) => {
        const remote = (await listMcpTools(client)).find(remote => remote.name === name);
        if (!remote || remote.annotations?.readOnlyHint !== true) {
          throw new Error('Provider has not classified this tool as read-only.');
        }
        return callMcpTool(client, remote, input);
      }));
    }, { name: 'mcp_read', description: 'Execute an explicitly declared read-only MCP tool. Writes are unavailable here.', schema: z.object({ sourceSlug: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) }) }),
  ];
}
