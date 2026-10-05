import type { RuntimeContext } from '../types';
import type { Card } from '@/libs/cards/card';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { newCardId } from '@/libs/cards/card';
import { lastConnectAttempts } from '@/libs/connect/attempts';
import { connectOptionFor } from '@/libs/connect/registry';
import { connectStartHref } from '@/libs/connect/returnTo';
import { afterLoginText, howToConnectFor, platformForConnectorSlug } from '@/libs/platforms/registry';
import { getConnector } from '@/libs/sources/registry';
import { connectorHasLiveSource, newestLiveCredential } from '@/services/connect/createSourceOnLogin';
import { loginCannotServe } from '@/services/connect/createSourceWithCredential';
import { memberWorkspace } from '@/services/WorkspaceAccessService';

/**
 * The existing Sources add flow for one connector, carrying a way back to
 * this conversation (#1080). One connect path, not a second one in chat.
 * @param connectorSlug - e.g. "github".
 * @param conversationId - The current conversation, when the turn has one.
 * @returns An in-app URL.
 */
export function connectHref(connectorSlug: string, conversationId: number | undefined): string {
  return `/dashboard/connectors?add=${encodeURIComponent(connectorSlug)}&returnTo=${encodeURIComponent(returnPath(conversationId))}`;
}

/**
 * The Connectors page's token form for one connector, back to this conversation.
 * @param connectorSlug - e.g. "notion".
 * @param conversationId - The current conversation, when the turn has one.
 * @returns An in-app URL.
 */
export function pasteHref(connectorSlug: string, conversationId: number | undefined): string {
  return `/dashboard/connectors?add=${encodeURIComponent(connectorSlug)}&paste=1&returnTo=${encodeURIComponent(returnPath(conversationId))}`;
}

/**
 * What to paste and where to get it, from the connector's own declaration.
 * @param paste - The connector's `howToConnect.paste`.
 * @param paste.credential
 * @param paste.access
 * @param paste.getItAt
 * @param paste.getItAt.url
 * @param paste.getItAt.steps
 */
function pasteBody(paste: { credential: string; access: readonly string[]; getItAt?: { url: string; steps: readonly string[] } }): string {
  const lines = [`Paste a ${paste.credential}.`];
  if (paste.access.length > 0) {
    lines.push(`It needs: ${paste.access.join('; ')}.`);
  }
  if (paste.getItAt) {
    lines.push(`Get one at ${paste.getItAt.url}: ${paste.getItAt.steps.join('; ')}.`);
  }
  return lines.join(' ');
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
  // A source whose login was revoked or expired is not connected: fall through and offer the login again.
  if (await connectorHasLiveSource(ctx.orgId, connector.slug)) {
    return `${name} is already connected; nothing to offer.`;
  }
  const how = howToConnectFor(connector.slug);
  // A login this server has no app for would be a card that only errors, so
  // it is offered as paste instead.
  const login = connectOptionFor(connector.slug)?.configured ? how?.login : undefined;
  const source = { agentSlug: ctx.agentSlug, tool: 'offer_connection' };
  if (!login) {
    // No login for this connector: the button opens its token form. A connector
    // with no declaration keeps the plain Connectors link.
    const href = how ? pasteHref(connector.slug, ctx.conversationId) : connectHref(connector.slug, ctx.conversationId);
    const body = how ? { body: pasteBody(how.paste) } : {};
    const card: Card = { id: newCardId(), kind: 'link', title: `Connect ${name}`, rationale: input.why, ...body, actions: [], source, href, hrefLabel: `Connect ${name}`, state: 'proposed' };
    ctx.emit({ type: 'card', card });
    return connectedWording(name, href, null);
  }
  // A live login with no source yet: the next step is picking what to sync,
  // not another login. Unless the login lacks this connector's access (a
  // Google login made for Drive, asked for Gmail): then offer the login again.
  const platform = platformForConnectorSlug(connector.slug);
  const live = platform ? await newestLiveCredential(ctx.orgId, platform.id) : null;
  if (live?.obtainedVia === 'login' && !(await loginCannotServe(ctx.orgId, live, connector.slug))) {
    const account = live.account ?? 'the connected account';
    return login.settingsAfterLogin.length === 0
      ? `Already logged in to ${name} as ${account}, but it has no source yet. Send them to Connectors to add it.`
      : `Already logged in to ${name} as ${account}. Ask which ${settingNames(login.settingsAfterLogin)} they want, then save the source with source.connect.`;
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
    body: `${login.access.length > 0 ? `Asks for: ${login.access.join(', ')}. ` : ''}${afterLoginText(login.settingsAfterLogin)}`,
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
  return connectedWording(name, href, login.settingsAfterLogin);
}

/**
 * Where the person lands after the login: this conversation when there is one.
 * @param conversationId - The current conversation, when the turn has one.
 */
function returnPath(conversationId: number | undefined): string {
  return conversationId ? `/dashboard/chat?conversation=${conversationId}` : '/dashboard/chat';
}

/**
 * The declared settings as a phrase: "repositories", "site and project keys".
 * @param settings - The login's `settingsAfterLogin`.
 */
function settingNames(settings: readonly { label: string }[]): string {
  return settings.map(setting => setting.label).join(' and ');
}

/**
 * What the model reads after the card is shown, including what the login does
 * next, read from the connector's declaration: with no settings left the login
 * itself makes the source; otherwise the person lands back here and waits to
 * be asked for the declared settings.
 * @param name - The connector's display name.
 * @param href - The card's button target.
 * @param settingsAfterLogin - The login's declared settings, or null when the button opens the token form instead.
 */
function connectedWording(name: string, href: string, settingsAfterLogin: readonly { label: string }[] | null): string {
  let how: string;
  if (settingsAfterLogin === null) {
    how = `The button opens the ${name} token form; saving it there connects ${name}. The person lands back in this conversation.`;
  } else if (settingsAfterLogin.length === 0) {
    how = `Logging in is all ${name} needs: the login creates its source, and the person lands back in this conversation.`;
  } else {
    how = `The person lands back in this conversation after logging in: ask which ${settingNames(settingsAfterLogin)} they want, then save the source with source.connect.`;
  }
  return `Showed a "Connect ${name}" card (${href}). ${how} Do not claim it is connected until they say so or list_capabilities shows it.`;
}

/**
 * `offer_connection` (#1080): a one-tap card that opens the connect flow for
 * one connector and returns to this conversation afterwards.
 * @param ctx - The turn's runtime context.
 * @returns The tool.
 */
export function offerConnectionTool(ctx: RuntimeContext) {
  return tool(
    async (input: { connector: string; why: string }) => offerConnection(ctx, input),
    {
      name: 'offer_connection',
      description: 'Show the person a one-tap card to connect one tool (GitHub, Jira, Slack…) to this workspace. It opens the connect flow and comes back to this conversation. Use when the person asks to connect a tool, or a missing connection is what blocks the work; once per connector.',
      schema: z.object({
        connector: z.string().min(1).describe('Connector slug from list_capabilities, e.g. "github".'),
        why: z.string().min(1).max(200).describe('One sentence on what connecting it lets this workspace do.'),
      }),
    },
  );
}
