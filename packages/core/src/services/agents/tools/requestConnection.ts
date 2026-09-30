/**
 * request_connection — put ONE card in front of the person that connects
 * what the work needs (backlog 053): "connect vocion-core to GitHub" in chat,
 * or a seat that found it cannot reach a repository.
 *
 * The card is an ask (`ask.file`, kind `credential`), one per gap: the
 * provider and the account the repositories live on. Its link is the one
 * move that closes it — GitHub's install screen, or the installation's
 * permissions for an upgrade — and it closes by itself when GitHub confirms
 * the connection (`services/connections/connectionRequests.ts`). Asking again
 * refreshes the same card; a repository the workspace already reaches is
 * answered as connected and raises nothing.
 *
 * Granted-only (`harness.grantTools: [request_connection]`): the
 * software-factory plugin grants it to the seats that work in repositories.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { CONNECTION_PROVIDERS, describeConnectionGaps } from '@/services/connections/connectionRequests';

export const REQUEST_CONNECTION_TOOL = 'request_connection';

export function requestConnectionTools(ctx: RuntimeContext) {
  if (!(ctx.harnessConfig.grantTools ?? []).includes(REQUEST_CONNECTION_TOOL)) {
    return [];
  }
  return [tool(
    async (args) => {
      try {
        const gaps = await describeConnectionGaps({ orgId: ctx.orgId, provider: args.provider, resources: args.repos, why: args.why, kind: args.upgrade ? 'upgrade' : 'install' });
        const { proposeAction } = await import('@/services/ActionService');
        const lines: string[] = [];
        for (const gap of gaps) {
          if (gap.connected) {
            lines.push(`${gap.account}: already connected; every repository asked for is reachable. Nothing was raised.`);
            continue;
          }
          if (gap.declined || !gap.ask) {
            lines.push(`${gap.account}: a request to connect it was turned down earlier. Nothing was raised; say so, and that it can be connected from Connections.`);
            continue;
          }
          const input = {
            ...gap.ask,
            agentSlug: ctx.agentSlug,
            ...(ctx.missionRunId || ctx.conversationId ? { origin: { missionRunId: ctx.missionRunId, conversationId: ctx.conversationId } } : {}),
          };
          const res = await proposeAction({
            orgId: ctx.orgId,
            actionId: 'ask.file',
            input,
            principal: { kind: 'agent', id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : 'agent:unknown', scope: { orgId: ctx.orgId }, grants: ['*'], autonomy: 2 },
            invokedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : ctx.userId,
            // A gap the workspace cannot close itself is worth a person's
            // minute by construction: the machinery checked it is real.
            proposal: { confidence: 0.95, rationale: args.why, agentSlug: ctx.agentSlug, suggestedDecision: null, suggestedDecisionReason: null },
          });
          // The card, already filed: its title is the request, its link the one move.
          ctx.emit({
            type: 'recommended_action',
            recommendation: {
              actionId: 'ask.file',
              input,
              label: gap.title,
              rationale: args.why,
              confidence: 0.95,
              agentSlug: ctx.agentSlug,
              runId: res.runId,
              ...(gap.fixUrl ? { href: gap.fixUrl, hrefLabel: gap.fixLabel ?? 'Connect' } : {}),
            },
          } as never);
          const askId = (res.result as { askId?: number } | undefined)?.askId;
          lines.push(res.status === 'done'
            ? `${gap.account}: the card is up${askId ? ` (ask #${askId})` : ''}. ${gap.fixLabel} is one click: ${gap.fixUrl}. It closes by itself when ${gap.provider === 'github' ? 'GitHub' : gap.provider} confirms the connection; do not say it is connected until then.`
            : `${gap.account}: the request is waiting for a person's go-ahead first (run #${res.runId}); say it is queued, not asked.`);
        }
        return lines.join('\n');
      } catch (err) {
        return `No connection request was raised: ${(err as Error).message}`;
      }
    },
    {
      name: REQUEST_CONNECTION_TOOL,
      description: 'Ask the person to connect a system this workspace needs and cannot reach yet, as ONE card with the one-click install link. Use it when a person asks to connect a repository ("connect vocion-core to GitHub"), or when your work needs a repository nothing here can reach. One card per account: asking again refreshes it. It closes by itself when the connection lands. Repositories already reachable are answered as connected.',
      schema: z.object({
        provider: z.enum(CONNECTION_PROVIDERS).describe('The system to connect. "github".'),
        repos: z.array(z.string().min(3).max(200)).min(1).max(20).describe('The repositories, written owner/name, e.g. "Northwind/orders-api".'),
        why: z.string().min(1).max(600).describe('One or two sentences for the person: what the connection is for, in their words when they asked.'),
        upgrade: z.boolean().optional().describe('True when the workspace reaches the repository but GitHub refused a call for a missing permission (a 403 on a write), so an owner must accept more access.'),
      }),
    },
  )];
}
