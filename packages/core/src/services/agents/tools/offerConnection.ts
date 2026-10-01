import type { RuntimeContext } from '../types';
import type { Card } from '@/libs/cards/card';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { newCardId } from '@/libs/cards/card';
import { connectorOfSource } from '@/libs/sources/connectorOf';
import { getConnector } from '@/libs/sources/registry';
import { listSources } from '@/services/SourceSyncService';
import { memberWorkspace } from '@/services/WorkspaceAccessService';

/**
 * The existing Sources add flow for one connector, carrying a way back to
 * this conversation (#1028). One connect path, not a second one in chat.
 * @param connectorSlug - e.g. "github".
 * @param conversationId - The setup conversation, when the turn has one.
 * @returns An in-app URL.
 */
export function connectHref(connectorSlug: string, conversationId: number | undefined): string {
  const back = conversationId ? `/dashboard/chat?conversation=${conversationId}` : '/dashboard/chat';
  return `/dashboard/connectors?add=${encodeURIComponent(connectorSlug)}&returnTo=${encodeURIComponent(back)}`;
}

/**
 * Check the connector, then put its link card in chat.
 * @param ctx - The turn's runtime context.
 * @param input - The connector slug and one sentence on why.
 * @param input.connector - Connector slug.
 * @param input.why - Shown on the card as its rationale line.
 * @returns The text the model reads.
 */
async function offerConnection(ctx: RuntimeContext, input: { connector: string; why: string }): Promise<string> {
  const connector = getConnector(input.connector);
  if (!connector) {
    return `Refused: there is no connector "${input.connector}". Call list_capabilities for the connector slugs.`;
  }
  const name = connector.name ?? connector.slug;
  // The OAuth start route is admin-only (403 otherwise), so a card for anyone
  // else is a button that cannot work. Same account role the route reads;
  // no user or no membership fails safe to the refusal.
  const membership = ctx.userId ? await memberWorkspace(ctx.userId, ctx.orgId) : null;
  if (membership?.accountRole !== 'admin') {
    return `Only a workspace admin can connect ${name}. Ask an admin to connect it from Sources.`;
  }
  if ((await listSources(ctx.orgId)).some(s => connectorOfSource(s) === connector.slug)) {
    return `${name} is already connected; nothing to offer.`;
  }
  const href = connectHref(connector.slug, ctx.conversationId);
  const card: Card = { id: newCardId(), kind: 'link', title: `Connect ${name}`, rationale: input.why, actions: [], source: { agentSlug: ctx.agentSlug, tool: 'offer_connection' }, href, hrefLabel: `Connect ${name}`, state: 'proposed' };
  ctx.emit({ type: 'card', card });
  return `Showed a "Connect ${name}" card (${href}). After connecting, the person lands back in this conversation. Do not claim it is connected until they say so or workspace_setup shows it.`;
}

/**
 * `offer_connection` (#1028): a one-tap card that opens the connect flow for
 * one connector and returns to this conversation afterwards.
 * @param ctx - The turn's runtime context.
 * @returns The tool.
 */
export function offerConnectionTool(ctx: RuntimeContext) {
  return tool(
    async (input: { connector: string; why: string }) => offerConnection(ctx, input),
    {
      name: 'offer_connection',
      description: 'Show the person a one-tap card to connect one tool (GitHub, Jira, Slack…) to this workspace. It opens the connect flow and comes back to this conversation. Use during setup, once per connector the workspace needs.',
      schema: z.object({
        connector: z.string().min(1).describe('Connector slug from list_capabilities, e.g. "github".'),
        why: z.string().min(1).max(200).describe('One sentence on what connecting it lets this workspace do.'),
      }),
    },
  );
}
