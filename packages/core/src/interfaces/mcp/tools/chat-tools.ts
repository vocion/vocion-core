/**
 * Chat tools — ask the WORKSPACE over MCP, rather than work AS one agent.
 *
 * The bridged domain tools (`agent-tools.ts`) let an MCP client act as an
 * agent: its sources, its grants, its tool exclusions. What they could not do
 * is ask a question and get judgement back, and the natural thing to ask is
 * the workspace, not a slug: `ask_workspace` routes the message to the
 * registered agent that handles it (`services/agents/router.ts`), runs one
 * real turn through `services/chat/workspaceTurn.ts` — the same harness,
 * tools, trust gating, plugin gating and wiki mount the dashboard chat runs —
 * and returns the reply with the routing decision beside it, persisted as a
 * conversation the caller can continue here and a person can open there.
 *
 * `list_agents` is the roster the router chooses from, with what each agent
 * `handles` and its `initiative`, so a caller can read a decision against it
 * or name a slug to skip the router. `teams_list` stays the org chart.
 *
 * Identity: the turn runs as the caller — `token:<id>` over HTTP, `mcp` on
 * stdio — and that is what the conversation records. The agent's own
 * identity is attributed the way the app does it: anything it files rides
 * its agent principal at working autonomy, so a proposal from here lands in
 * the review queue exactly as one from the dashboard would.
 */

import type { McpConfig } from '../config';
import { z } from 'zod';
import { askWorkspace, listAgentRoster, MAX_MESSAGE_CHARS, WorkspaceTurnError } from '@/services/chat/workspaceTurn';

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * @param config - MCP runtime config (orgId scopes every read and every turn).
 * @param identity - Who the turns run as; `mcp` when the transport has no caller identity.
 * @param identity.userId
 */
export function chatTools(config: McpConfig, identity?: { userId: string }): ToolModule[] {
  const actorId = identity?.userId ?? 'mcp';
  return [
    {
      name: 'list_agents',
      title: 'List the registered agents',
      description: 'Every agent in this workspace: slug, name, eyebrow, description, active, role, team, what it handles (the topics the router matches), its initiative (low | normal | high — how much it volunteers), its suggested opening prompts, and whether it is the workspace lead (the router\'s default). Read a routing decision against this, or pass a slug to ask_workspace to skip the router. For who reports to whom, use teams_list.',
      inputSchema: {},
      handler: async () => ({ agents: await listAgentRoster(config.orgId) }),
    },
    {
      name: 'ask_workspace',
      title: 'Ask the workspace',
      description: `Send one message to the workspace and get an answer from the agent that handles it. The router matches the message against each agent's handles, description and suggestions, breaks ties on initiative, and defaults to the workspace lead; the decision (candidates, chosen slug, reason) comes back as routing. Pass agent_slug to skip the router, or conversation_id to continue an earlier conversation (its agent answers). One real turn — the agent's tools, sources, trust rules and wiki — persisted as a conversation. Returns the whole reply (not a stream), who answered, the routing, the conversation id, the turn id, anything the agent filed for a person (proposals, asks) with statuses, and the dashboard URL. A turn longer than the surface's time limit returns what was said so far with truncated: true; the rest lands in the conversation when the turn finishes. Messages are capped at ${MAX_MESSAGE_CHARS} characters.`,
      inputSchema: {
        message: z.string().min(1).max(MAX_MESSAGE_CHARS).describe('What to ask. Plain text or markdown.'),
        agent_slug: z.string().min(1).optional().describe('Skip the router and ask this agent (a slug from list_agents).'),
        conversation_id: z.number().int().positive().optional().describe('Continue this conversation (from an earlier reply). Its agent answers; no routing.'),
        title: z.string().min(1).max(200).optional().describe('Title for a new conversation. Omit and the first message names it.'),
      },
      handler: async (input) => {
        const { message, agent_slug, conversation_id, title } = input as { message: string; agent_slug?: string; conversation_id?: number; title?: string };
        try {
          return await askWorkspace({
            orgId: config.orgId,
            message,
            actorId,
            ...(agent_slug !== undefined ? { agentSlug: agent_slug } : {}),
            ...(conversation_id !== undefined ? { conversationId: conversation_id } : {}),
            ...(title !== undefined ? { title } : {}),
          });
        } catch (error) {
          if (error instanceof WorkspaceTurnError) {
            // The server turns a thrown Error into an isError result carrying
            // its message; the code goes in front so a client can branch on it.
            throw new Error(`${error.code}: ${error.message}`);
          }
          throw error;
        }
      },
    },
  ];
}
