/**
 * THE REVIEW QUEUE OVER MCP — the same decisions a person makes on the
 * Review page, in chat (`decide_proposal`, `decide_ask`) and over the API
 * (`/api/v1/reviews/*`, `/api/v1/asks/:id/decide`). Chris, 2026-09-29: "We
 * should maintain parity for UI, chat, MCP and API." Each tool calls the
 * function the API route calls (`services/writeApi.ts`, `AskService`), so the
 * surfaces cannot drift: the same capability check (`approve`), the same
 * refusals, the same row written, attributed to the token.
 */
import type { McpConfig } from '../config';
import type { Principal } from '@/services/authz';
import type { ApiCaller } from '@/services/writeApi';
import { z } from 'zod';

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * The caller the API would see: the token's principal over HTTP; on stdio
 * (one org, the developer plane) a member of that org.
 * @param config - The MCP config (its org scopes every call).
 * @param identity - Who the calls run as.
 * @param identity.userId - `token:<id>` over HTTP, `mcp` on stdio.
 * @param identity.principal - The token's principal, when the transport has one.
 */
export function mcpCaller(config: McpConfig, identity?: { userId: string; principal?: Principal }): ApiCaller {
  const actorId = identity?.userId ?? 'mcp';
  return {
    orgId: config.orgId,
    actorId,
    principal: identity?.principal ?? { kind: 'user', id: actorId, role: 'member', scope: { orgId: config.orgId } },
    source: 'token',
  };
}

/**
 * An API refusal reads as its code and message, as the route would send it.
 * @param run
 */
async function asApi<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const err = e as { code?: string; status?: number; message?: string };
    throw new Error(err.code ? `${err.code}${err.status ? ` (${err.status})` : ''}: ${err.message}` : (err.message ?? String(e)));
  }
}

/**
 * @param config - MCP runtime config.
 * @param identity - Who the decisions are recorded as.
 * @param identity.userId - The actor id.
 * @param identity.principal - The token's principal.
 */
export function reviewTools(config: McpConfig, identity?: { userId: string; principal?: Principal }): ToolModule[] {
  const caller = mcpCaller(config, identity);
  const kind = z.enum(['action', 'workflow', 'mission']).describe('The plane: an action proposal (a card), a paused workflow run, or a mission run at a gate.');
  return [
    {
      name: 'review_list',
      title: 'List what is waiting for review',
      description: 'The Review queue for this workspace, one page: every proposal, paused workflow and mission gate waiting on a person, newest first, with the total. Narrow by kind, action_ids (card types such as git.merge), suggested_decision (what the agent recommended), or assigned_to (a user id, or "unassigned"). Same rows as GET /api/v1/reviews and the Review page.',
      inputSchema: {
        kind: z.string().optional(),
        action_ids: z.array(z.string()).optional(),
        suggested_decision: z.enum(['approve', 'reject', 'snooze']).optional(),
        assigned_to: z.string().optional(),
        include: z.array(z.enum(['input', 'proposal'])).optional().describe('Inline each item\'s input and/or proposal.'),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
      handler: async (input) => {
        const { apiListReviews } = await import('@/services/writeApi');
        const i = input as { kind?: string; action_ids?: string[]; suggested_decision?: string; assigned_to?: string; include?: string[]; limit?: number; offset?: number };
        return asApi(() => apiListReviews(caller, {
          kind: i.kind,
          actionIds: i.action_ids,
          suggestedDecision: i.suggested_decision,
          assignedTo: i.assigned_to,
          include: i.include,
          limit: i.limit,
          offset: i.offset,
        }));
      },
    },
    {
      name: 'review_get',
      title: 'Read one review item',
      description: 'One item in the Review queue, whole: what it would do, why the agent proposed it, its input and its state. Same as GET /api/v1/reviews/:kind/:id.',
      inputSchema: { kind, id: z.number().int().positive() },
      handler: async (input) => {
        const { apiGetReview } = await import('@/services/writeApi');
        return asApi(() => apiGetReview(caller, input.kind, input.id));
      },
    },
    {
      name: 'review_decide',
      title: 'Approve, reject or close a review item',
      description: 'Decide an item in the Review queue, as a person would on the Review page ("Approve" / "Do not ask"). action: approve (runs it; edited_input approves an edited version), reject (dismisses it; reason says why), or done (closes a released hand-off — a merge, a deploy — with result_url). Recorded as this token, with the approve capability required. Same as POST /api/v1/reviews/decide. For an ask (a question put to a person), use ask_decide.',
      inputSchema: {
        kind,
        id: z.number().int().positive(),
        action: z.enum(['approve', 'reject', 'done']),
        reason: z.string().max(2000).optional(),
        edited_input: z.record(z.string(), z.unknown()).optional(),
        result_url: z.string().url().optional(),
        learn: z.boolean().optional().describe('Whether a reason trains the learning classifier (default true). Pass false for bulk or canned decisions.'),
      },
      handler: async (input) => {
        const { apiDecideReview } = await import('@/services/writeApi');
        const i = input as { kind: 'action' | 'workflow' | 'mission'; id: number; action: 'approve' | 'reject' | 'done'; reason?: string; edited_input?: Record<string, unknown>; result_url?: string; learn?: boolean };
        return asApi(() => apiDecideReview(caller, {
          kind: i.kind,
          id: i.id,
          action: i.action,
          reason: i.reason,
          editedInput: i.edited_input,
          resultUrl: i.result_url,
          learn: i.learn,
        }));
      },
    },
    {
      name: 'ask_decide',
      title: 'Answer an ask',
      description: 'Decide an ask — a question an agent put to a person — with one of its options (the option id or its label), and an optional note. The chosen option\'s action is carried out, as when a person picks it in the UI or chat. Recorded as this token, with the approve capability required. Same as POST /api/v1/asks/:id/decide.',
      inputSchema: {
        id: z.number().int().positive(),
        decision: z.string().min(1).max(200),
        note: z.string().max(2000).optional(),
      },
      handler: async (input) => {
        const { enforce } = await import('@/services/authz');
        enforce(caller.principal, { kind: 'action', action: 'approve', scope: { orgId: caller.orgId } }, 'mutate');
        const { decideAsk } = await import('@/services/AskService');
        const i = input as { id: number; decision: string; note?: string };
        return asApi(() => decideAsk({ orgId: caller.orgId, id: i.id, decision: i.decision, note: i.note ?? null, decidedBy: caller.actorId }));
      },
    },
  ];
}
