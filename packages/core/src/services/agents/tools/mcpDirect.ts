import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { newCardId } from '@/libs/cards/card';
import { callMcpTool, listMcpTools, mcpCredentialsOf, validateMcpInput, withMcp } from '@/libs/outboundMcp/client';
import { loadMcpSources } from '@/libs/outboundMcp/sources';
import { personMcpCredentials, signInPath } from '@/services/outboundMcp/personSignIn';
import { getCredentialsForSource } from '@/services/SourceCredentialService';

/** A per-person source the person in the turn cannot read yet: the sentence says why and where to sign in. */
class SignInNeeded extends Error {}

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
  // A `person` source reads as the person in the turn, never with a workspace token.
  async function credentialsFor(source: Awaited<ReturnType<typeof sourceFor>>) {
    if (source.config.auth !== 'person' || !source.config.url) {
      return mcpCredentialsOf(await getCredentialsForSource(ctx.orgId, source.slug));
    }
    const person = { orgId: ctx.orgId, slug: source.slug, name: source.name, url: source.config.url };
    const signedIn = await personMcpCredentials({ source: person, userId: ctx.userId });
    if (!signedIn.ok) {
      throw new SignInNeeded(signedIn.signIn ? offerSignIn(person) : signedIn.why);
    }
    return signedIn.credentials;
  }
  // The same one-tap card a connector login is offered with, docked above the
  // composer, once per source per turn; the sign-in lands back in this conversation.
  const offered = new Set<string>();
  function offerSignIn(source: { orgId: string; slug: string; name: string }): string {
    if (!offered.has(source.slug)) {
      offered.add(source.slug);
      const cardId = newCardId();
      ctx.emit({
        type: 'card',
        card: { id: cardId, kind: 'link', title: `Sign in to ${source.name}`, actions: [], source: { agentSlug: ctx.agentSlug, tool: 'mcp_read' }, href: signInPath(source, { conversationId: ctx.conversationId, cardId }), hrefLabel: 'Sign in', state: 'proposed' },
      });
    }
    return `${source.name} answers each person as themselves, and this person has not signed in to it yet. A sign-in card is docked above their composer: say in one line that they sign in there once (it covers every workspace). When the card comes back answered (they chose Sign in), they are signed in: call this tool again at once and carry on with what they asked. Never ask them to ask again, and do not answer from other sources as if it were this one. No tool was called.`;
  }
  return [
    tool(async ({ sourceSlug }) => {
      try {
        const source = await sourceFor(sourceSlug);
        const credentials = await credentialsFor(source);
        return JSON.stringify(await withMcp(credentials, async client => ({
          sourceSlug,
          tools: (await listMcpTools(client)).filter(remote => source.config.readTools.includes(remote.name) || source.config.writeTools.includes(remote.name)),
          writes: 'Propose declared writes with propose_action, action_id=mcp.call. Approval executes the exact submitted arguments.',
        })));
      } catch (error) {
        if (error instanceof SignInNeeded) {
          return JSON.stringify({ isError: true, error: error.message });
        }
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
        const credentials = await credentialsFor(source);
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
      } catch (error) {
        if (error instanceof SignInNeeded) {
          return JSON.stringify({ isError: true, error: error.message });
        }
        // Transport/provider exceptions can contain credentials and raw bodies.
        // A read failure is recoverable and must not imply an uncertain write.
        return JSON.stringify({ isError: true, error: 'MCP read failed. No write tool was invoked. Check that the source is assigned, permitted and connected; retry a valid read or report that it is unavailable.' });
      }
    }, { name: 'mcp_read', description: 'Execute an explicitly declared read-only MCP tool. Writes are unavailable here.', metadata: { alwaysLoaded: true }, schema: z.object({ sourceSlug: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) }) }),
  ];
}
