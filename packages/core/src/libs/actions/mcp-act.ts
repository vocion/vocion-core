/**
 * `mcp.act` — ask a connected system to do something, on the person's word.
 *
 * `mcp.call` is for a change of record in somebody else's system (a journal
 * entry, an invoice date): core cannot know what the provider does with it,
 * so a person reads every one. That is the wrong shape for a REQUEST: "file
 * this with the factory", "tell it the answer is yes". Nothing of record
 * changes until the other system does its own work behind its own gates, and
 * a person who asked for it in a thread should not then approve a card that
 * repeats their sentence (principle 13: the person's word runs).
 *
 * So a workspace declares those tools apart, in the source's `actTools`, and
 * they run through this action: at once when the person asked for exactly
 * this (`saidToDecide`), and for an agent on its own under the workspace's
 * trust rule `mcp.act.<source>.<tool>`, or as a card when there is none.
 * A tool is one or the other, never both, and a per-person source has none.
 *
 * WHERE IT WAS ASKED goes with it. When the provider's tool takes an `origin`
 * object, this fills in the conversation and a stable id for the filing, so
 * the provider can say what happened in the same thread later
 * (`services/jobs/mcpUpdates.ts`) and a retry files nothing twice.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Action, ActionContext } from './types';
import { z } from 'zod';
import { callMcpTool, listMcpTools, mcpCredentialsOf, validateMcpInput, withMcp } from '@/libs/outboundMcp/client';
import { loadMcpSources } from '@/libs/outboundMcp/sources';
import { getCredentialsForSource } from '@/services/SourceCredentialService';
import { changeRows, firstSentence, shortTitle } from './mcpCard';

const MCP_ACT_ACTION_ID = 'mcp.act';

const inputSchema = z.object({
  sourceSlug: z.string().min(1),
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  summary: z.string().min(1).max(1000),
});

/**
 * The arguments as they are sent: the agent's, with where it was asked added
 * when the provider's tool takes an `origin` object. What the agent wrote in
 * `origin` (who asked, a link to the message) is kept; the conversation and
 * the filing's id are ours to give.
 * @param remote - The provider's tool contract.
 * @param input - The agent's arguments.
 * @param ctx - The run: its conversation and its id.
 */
export function withOrigin(remote: Pick<Tool, 'inputSchema'>, input: Record<string, unknown>, ctx: Pick<ActionContext, 'origin' | 'runId'>): Record<string, unknown> {
  const properties = (remote.inputSchema as { properties?: Record<string, { type?: string }> }).properties ?? {};
  const conversationId = ctx.origin?.conversationId;
  if (properties.origin?.type !== 'object' || conversationId == null) {
    return input;
  }
  const given = input.origin && typeof input.origin === 'object' && !Array.isArray(input.origin) ? input.origin as Record<string, unknown> : {};
  return { ...input, origin: { ...given, conversation: String(conversationId), ...(ctx.runId != null && given.request === undefined ? { request: `action:${ctx.runId}` } : {}) } };
}

/**
 * What the provider answered, as one short text the agent can tell the person
 * from: the structured answer when there is one, else its text blocks.
 * @param result - The tool result.
 */
export function answerOf(result: Record<string, unknown>): string {
  const structured = result.structuredContent;
  if (structured && typeof structured === 'object') {
    return JSON.stringify(structured).slice(0, 2000);
  }
  const blocks = Array.isArray(result.content) ? result.content as Array<{ type?: string; text?: unknown }> : [];
  return blocks.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n').slice(0, 2000);
}

export const mcpActAction: Action<typeof inputSchema> = {
  id: MCP_ACT_ACTION_ID,
  name: 'Ask a connected system to do something',
  description: 'Make a request of a connected MCP system through one of its declared act tools (file a ticket, answer a question it asked). Discover the schema with mcp_list_tools, then submit sourceSlug, tool, input and a summary. Runs at once on the person\'s word and returns the system\'s answer; on your own it follows the workspace\'s trust rule.',
  inputSchema,
  grant: 'mcp_call',
  external: true,
  sourceSlugFor: input => input.sourceSlug,
  policyKeyFor: input => `${MCP_ACT_ACTION_ID}.${input.sourceSlug}.${input.tool}`,
  parentRuleGoverns: true,
  async precheck(ctx, input) {
    const [source] = await loadMcpSources(ctx.orgId, [input.sourceSlug]);
    if (!source?.config.actTools.includes(input.tool)) {
      return `${input.tool} is not one of this source's act tools${source?.config.actTools.length ? ` (${source.config.actTools.join(', ')})` : ''}. A change of record goes through mcp.call instead.`;
    }
    const credentials = await getCredentialsForSource(ctx.orgId, input.sourceSlug);
    return withMcp(mcpCredentialsOf(credentials), async (client) => {
      const remote = (await listMcpTools(client)).find(tool => tool.name === input.tool);
      if (!remote) {
        return 'This act tool is not available on the provider. Discover the current tools before proposing it.';
      }
      try {
        validateMcpInput(remote, input.input);
        return undefined;
      } catch {
        return `Invalid arguments for ${input.tool}; nothing was sent. Correct them using this input schema: ${JSON.stringify(remote.inputSchema)}`;
      }
    });
  },
  async reviewCard(ctx, input) {
    const [source] = await loadMcpSources(ctx.orgId, [input.sourceSlug]).catch(() => []);
    const system = source?.name ?? input.sourceSlug;
    const rows = changeRows(input.input, input.summary);
    return {
      title: shortTitle(input.summary),
      system,
      headline: firstSentence(input.summary),
      fields: rows,
      content: [
        { kind: 'text', id: 'request', label: 'What is asked', body: [...rows.map(r => `${r.label}: ${r.value}`), '', input.summary].join('\n').trim() },
        { kind: 'text', id: 'arguments', label: 'Technical details', tabLabel: 'Technical details', body: `${input.tool} on ${input.sourceSlug}\n\n${JSON.stringify(input.input, null, 2)}`, preformatted: true },
      ],
      verbs: { approve: `Send to ${system}`, reject: 'Don\'t send' },
      nextAction: `Send this to ${system} now. Nothing is sent until you approve.`,
    };
  },
  async execute(ctx, input) {
    const [source] = await loadMcpSources(ctx.orgId, [input.sourceSlug]);
    if (!source?.config.actTools.includes(input.tool)) {
      throw new Error('This act tool is no longer enabled for the source.');
    }
    const result = await withMcp(mcpCredentialsOf(ctx.credentials), async (client) => {
      const remote = (await listMcpTools(client)).find(tool => tool.name === input.tool);
      if (!remote) {
        throw new Error('MCP tool is no longer available.');
      }
      return callMcpTool(client, remote, withOrigin(remote, input.input, ctx));
    });
    const answer = answerOf(result as Record<string, unknown>);
    return {
      sourceSlug: input.sourceSlug,
      tool: input.tool,
      result,
      // The agent tells the person from this: the link, what waits, any question.
      ...(answer ? { advice: `${source.name} answered: ${answer}` } : {}),
    };
  },
};
