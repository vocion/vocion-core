import type { RuntimeContext } from '../types';
import type { Card } from '@/libs/cards/card';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { newCardId } from '@/libs/cards/card';
import { lastConnectAttempts } from '@/libs/connect/attempts';
import { connectStartHref } from '@/libs/connect/returnTo';
import { getPlatform, howToConnectFor, isCredentialPlatformId, platformForConnectorSlug } from '@/libs/platforms/registry';
import { connectorOfSource } from '@/libs/sources/connectorOf';
import { getConnector } from '@/libs/sources/registry';
import { newestLiveCredential } from '@/services/connect/createSourceOnLogin';
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
  return `/dashboard/connectors?add=${encodeURIComponent(connectorSlug)}&returnTo=${encodeURIComponent(returnPath(conversationId))}`;
}

/**
 * The Developers page add form for a platform that has no connector, such as
 * `app-login`, carrying a way back to this conversation (#1028). The sign-in
 * is pasted there, never typed in chat.
 * @param platformId - e.g. "app-login".
 * @param conversationId - The setup conversation, when the turn has one.
 * @returns An in-app URL.
 */
export function credentialHref(platformId: string, conversationId: number | undefined): string {
  return `/dashboard/developers?add=${encodeURIComponent(platformId)}&returnTo=${encodeURIComponent(returnPath(conversationId))}`;
}

/**
 * A credential-only platform: no connector, but it declares how to paste one.
 * @param slug - What the model passed as `connector`.
 * @returns The platform's id and label, or null when the slug is not one.
 */
function credentialOnlyPlatform(slug: string): { id: string; label: string } | null {
  if (getConnector(slug) || !isCredentialPlatformId(slug)) {
    return null;
  }
  const platform = getPlatform(slug);
  return platform.connectorSlugs.length === 0 && platform.howToConnect?.paste ? { id: platform.id, label: platform.label } : null;
}

/**
 * Put the paste-a-credential card in chat for a platform with no connector.
 * @param ctx - The turn's runtime context.
 * @param platform - The platform to paste.
 * @param platform.id - Platform id.
 * @param platform.label - Display name.
 * @param why - The card's rationale line.
 * @returns The text the model reads.
 */
async function offerCredential(ctx: RuntimeContext, platform: { id: string; label: string }, why: string): Promise<string> {
  const membership = ctx.userId ? await memberWorkspace(ctx.userId, ctx.orgId) : null;
  if (membership?.accountRole !== 'admin') {
    return `Only a workspace admin can add ${platform.label}. Ask an admin to add it from Developers.`;
  }
  const href = credentialHref(platform.id, ctx.conversationId);
  const source = { agentSlug: ctx.agentSlug, tool: 'offer_connection' };
  const card: Card = { id: newCardId(), kind: 'link', title: `Connect ${platform.label}`, rationale: why, actions: [], source, href, hrefLabel: `Connect ${platform.label}`, state: 'proposed' };
  ctx.emit({ type: 'card', card });
  return `Showed a "Connect ${platform.label}" card (${href}). The person pastes the credential on that page and lands back in this conversation. Never ask for it in chat. Do not claim it is saved until they say so.`;
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
  const credentialOnly = credentialOnlyPlatform(input.connector);
  if (credentialOnly) {
    return offerCredential(ctx, credentialOnly, input.why);
  }
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
  const how = howToConnectFor(connector.slug);
  const login = how?.login;
  const source = { agentSlug: ctx.agentSlug, tool: 'offer_connection' };
  if (!login) {
    const href = connectHref(connector.slug, ctx.conversationId);
    const card: Card = { id: newCardId(), kind: 'link', title: `Connect ${name}`, rationale: input.why, actions: [], source, href, hrefLabel: `Connect ${name}`, state: 'proposed' };
    ctx.emit({ type: 'card', card });
    return connectedWording(name, href);
  }
  // A live login with no source yet: the next step is picking what to sync,
  // not another login.
  const platform = platformForConnectorSlug(connector.slug);
  const live = platform ? await newestLiveCredential(ctx.orgId, platform.id) : null;
  if (live?.obtainedVia === 'login') {
    return `Already logged in to ${name} as ${live.account ?? 'the connected account'}. Call browse_connection to offer what it can see, then save the pick with source.connect.`;
  }
  const returnTo = returnPath(ctx.conversationId);
  const cardId = newCardId();
  const href = connectStartHref({ provider: login.provider, connector: connector.slug, returnTo, conversationId: ctx.conversationId, cardId });
  const failed = (await lastConnectAttempts(ctx.orgId)).get(connector.slug);
  const lastAttempt = failed && !failed.ok && failed.summary ? { at: failed.at.toISOString(), reason: failed.reason ?? 'unknown', summary: failed.summary } : undefined;
  const card: Card = {
    id: cardId,
    kind: 'link',
    title: `Connect ${name}`,
    rationale: input.why,
    ...(login.access.length > 0 ? { body: `Asks for: ${login.access.join(', ')}` } : {}),
    actions: [],
    source,
    href,
    hrefLabel: `Connect ${name}`,
    secondaryHref: `/dashboard/connectors?add=${encodeURIComponent(connector.slug)}&paste=1&returnTo=${encodeURIComponent(returnTo)}`,
    secondaryHrefLabel: 'Paste a token',
    ...(lastAttempt ? { lastAttempt } : {}),
    state: 'proposed',
  };
  ctx.emit({ type: 'card', card });
  return connectedWording(name, href);
}

/**
 * Where the person lands after the login: this conversation when there is one.
 * @param conversationId - The setup conversation, when the turn has one.
 */
function returnPath(conversationId: number | undefined): string {
  return conversationId ? `/dashboard/chat?conversation=${conversationId}` : '/dashboard/chat';
}

/**
 * What the model reads after the card is shown.
 * @param name - The connector's display name.
 * @param href - The card's button target.
 */
function connectedWording(name: string, href: string): string {
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
        connector: z.string().min(1).describe('Connector slug from list_capabilities, e.g. "github"; or a credential-only platform such as "app-login" (QA sign-in), pasted on the Developers page.'),
        why: z.string().min(1).max(200).describe('One sentence on what connecting it lets this workspace do.'),
      }),
    },
  );
}
