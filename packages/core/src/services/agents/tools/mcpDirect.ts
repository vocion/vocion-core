import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { callMcpTool, listMcpTools, mcpCredentialsOf, validateMcpInput, withMcp } from '@/libs/outboundMcp/client';
import { loadMcpSources } from '@/libs/outboundMcp/sources';
import { getCredentialsForSource } from '@/services/SourceCredentialService';

/**
 * Keep structured reads line-addressable when large results spill to a file.
 * @param result
 */
function readableResult(result: Record<string, unknown>) {
  const structured = result.structuredContent;
  if (structured === undefined || !Array.isArray(result.content)) {
    return result;
  }
  return {
    ...result,
    // MCP servers commonly include the same JSON twice. The escaped text copy
    // becomes one enormous line and prevents useful line-based file reads.
    content: result.content.filter((block) => {
      if (block.type !== 'text' || typeof block.text !== 'string') {
        return true;
      }
      try {
        return JSON.stringify(JSON.parse(block.text)) !== JSON.stringify(structured);
      } catch {
        return true;
      }
    }),
  };
}

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
      try {
        const source = await sourceFor(sourceSlug);
        const credentials = mcpCredentialsOf(await getCredentialsForSource(ctx.orgId, sourceSlug));
        return JSON.stringify(await withMcp(credentials, async client => ({
          sourceSlug,
          tools: (await listMcpTools(client)).filter(remote => source.config.readTools.includes(remote.name) || source.config.writeTools.includes(remote.name)),
          writes: 'Propose declared writes with propose_action, action_id=mcp.call. Approval executes the exact submitted arguments.',
        })));
      } catch {
        return JSON.stringify({ isError: true, error: 'MCP discovery failed. Use an assigned, permitted source with a connected credential; no provider tool was called.' });
      }
    }, { name: 'mcp_list_tools', description: 'Discover declared MCP tools and their input schemas for an assigned source.', metadata: { alwaysLoaded: true }, schema: z.object({ sourceSlug: z.string() }) }),
    tool(async ({ sourceSlug, name, input }) => {
      try {
        const source = await sourceFor(sourceSlug);
        if (!source.config.readTools.includes(name)) {
          return JSON.stringify({
            isError: true,
            error: 'Only explicitly declared reads may execute here. Choose an availableReadTools name and discover its schema with mcp_list_tools; propose declared writes through mcp.call. No tool was called.',
            availableReadTools: source.config.readTools,
          });
        }
        const credentials = mcpCredentialsOf(await getCredentialsForSource(ctx.orgId, sourceSlug));
        return JSON.stringify(await withMcp(credentials, async (client) => {
          const remote = (await listMcpTools(client)).find(remote => remote.name === name);
          if (!remote || remote.annotations?.readOnlyHint !== true) {
            return { isError: true, error: 'Provider has not classified this tool as read-only. No tool was called.' };
          }
          try {
            validateMcpInput(remote, input);
          } catch {
            // Keep schema mistakes in the tool result so the model can correct
            // its arguments instead of aborting the entire chat graph.
            return { isError: true, error: 'Arguments do not match the tool schema. Correct them using inputSchema; no tool was called.', inputSchema: remote.inputSchema };
          }
          return readableResult(await callMcpTool(client, remote, input));
        }), null, 2);
      } catch {
        // Transport/provider exceptions can contain credentials and raw bodies.
        // A read failure is recoverable and must not imply an uncertain write.
        return JSON.stringify({ isError: true, error: 'MCP read failed. No write tool was invoked. Check that the source is assigned, permitted and connected; retry a valid read or report that it is unavailable.' });
      }
    }, { name: 'mcp_read', description: 'Execute an explicitly declared read-only MCP tool. Writes are unavailable here.', metadata: { alwaysLoaded: true }, schema: z.object({ sourceSlug: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) }) }),
  ];
}
