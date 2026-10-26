import type { RuntimeContext } from '../types';
import type { Card } from '@/libs/cards/card';
import type { ConnectorKind } from '@/libs/connect/connectorKinds';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { newCardId } from '@/libs/cards/card';
import { lastConnectAttempts } from '@/libs/connect/attempts';
import { loginSetupNote } from '@/libs/connect/clickToAuth';
import { connectOptionFor, providerFor } from '@/libs/connect/registry';
import { connectStartHref } from '@/libs/connect/returnTo';
import { FAMILY_LABEL, familyOfKind, familySourcesForOrg } from '@/libs/connectors/families';
import { howToConnectFor, platformForConnectorSlug } from '@/libs/platforms/registry';
import { getConnector } from '@/libs/sources/registry';
import { connectKindCheck } from '@/services/connect/connectorKindRouting';
import { connectorHasLiveSource, newestLiveCredential } from '@/services/connect/createSourceOnLogin';
import { loginCannotServe } from '@/services/connect/loginCannotServe';
import { memberWorkspace } from '@/services/WorkspaceAccessService';
import { withArticle } from '@/utils/withArticle';
import { CONNECTOR_KIND_FIELD } from './connectSystems';

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
  const lines = [`Paste ${withArticle(paste.credential)}.`];
  if (paste.access.length > 0) {
    lines.push(`It needs: ${paste.access.join('; ')}.`);
  }
  if (paste.getItAt) {
    lines.push(`Get one at ${paste.getItAt.url}: ${paste.getItAt.steps.join('; ')}.`);
  }
  return lines.join(' ');
}

/**
 * Check the connector, then put its link card in chat. Exported for the
 * workspace lead's setup plan (`propose_setup`), which offers connections with
 * this same card rather than a second one.
 * @param ctx - The turn's runtime context.
 * @param input - The connector slug and one sentence on why.
 * @param input.connector - Connector slug.
 * @param input.why - The agent's reason, for its own words above the card; not drawn on it.
 * @param input.kind
 * @param input.named
 * @returns The text the model reads.
 */
export async function offerConnection(ctx: RuntimeContext, input: { connector: string; why: string; kind?: ConnectorKind; named?: boolean }): Promise<string> {
  const connector = getConnector(input.connector);
  if (!connector) {
    return `Refused: there is no connector "${input.connector}". Call list_capabilities for the connector slugs.`;
  }
  // THE WORKSPACE'S OWN SOURCE FIRST (Chris, 2026-10-25: "I got LinkedIn ads
  // connector when I asked for 'ads'"). A family pick never beats a source
  // the workspace declares, unless the person named this vendor themselves.
  const declared = input.named ? null : await declaredInstead(ctx.orgId, connector.slug);
  if (declared?.kind === 'one') {
    const offered = await offerConnection(ctx, { ...input, connector: declared.slug, named: true });
    return `${declared.note} ${offered}`;
  }
  if (declared?.kind === 'several') {
    return declared.reply;
  }
  // A team connector is offered here; the other kind, or any offer in a
  // Personal workspace, gets one line pointing to the right page instead.
  if (ctx.workspaceKind === 'personal' || input.kind === 'personal') {
    const decision = await connectKindCheck(ctx, [connector.slug], input.kind);
    if (!decision.proceed) {
      return decision.reply;
    }
  }
  const name = connector.name ?? connector.slug;
  // The OAuth start route is admin-only (403 otherwise), so a card for anyone
  // else is a button that cannot work. Same account role the route reads;
  // no user or no membership fails safe to the refusal.
  const membership = ctx.userId ? await memberWorkspace(ctx.userId, ctx.orgId) : null;
  if (membership?.accountRole !== 'admin') {
    return `${name} is a team connector, and only a workspace admin connects team connectors. Ask an admin to connect it in Team connectors.`;
  }
  // A source whose login was revoked or expired is not connected: fall through and offer the login again.
  if (await connectorHasLiveSource(ctx.orgId, connector.slug)) {
    return `${name} is already connected; nothing to offer.`;
  }
  const how = howToConnectFor(connector.slug);
  // A login with no app to run on (neither the server's nor the workspace's
  // own) would be a card that only errors, so it is offered as paste instead.
  const option = await connectOptionFor(ctx.orgId, connector.slug);
  const login = option?.configured ? how?.login : undefined;
  const source = { agentSlug: ctx.agentSlug, tool: 'offer_connection' };
  // The card draws the service's logo, from the connector's own brand.
  const brand = connector.brand ? { brand: connector.brand } : {};
  if (!login) {
    // CLICK TO AUTH, ALWAYS (Chris, 2026-10-25). A vendor with a login whose
    // app this server lacks still gets the login path first: the Connectors
    // add flow, which shows the sign-in button and what an admin must set up.
    // The key is the second button, never the only one.
    if (how?.login && option) {
      const href = connectHref(connector.slug, ctx.conversationId);
      const note = loginSetupNote(option);
      const card: Card = {
        id: newCardId(),
        kind: 'link',
        title: `Connect ${name}`,
        body: note,
        ...brand,
        actions: [],
        source,
        href,
        hrefLabel: `Connect ${name}`,
        ...(how.paste ? { secondaryHref: pasteHref(connector.slug, ctx.conversationId), secondaryHrefLabel: 'Use an API key instead' } : {}),
        state: 'proposed',
      };
      ctx.emit({ type: 'card', card });
      return `Asked them to connect ${name} — docked above their composer (${href}). ${note} Say that plainly; do not tell them to paste a key unless they choose to. Do not claim it is connected until list_capabilities shows it.`;
    }
    // No login at all for this connector: the vendor takes a key, so the
    // button opens its token form. A connector with nothing to paste keeps
    // the plain Connectors link.
    const href = how?.paste ? pasteHref(connector.slug, ctx.conversationId) : connectHref(connector.slug, ctx.conversationId);
    const body = how?.paste ? { body: pasteBody(how.paste) } : {};
    const card: Card = { id: newCardId(), kind: 'link', title: `Connect ${name}`, ...body, ...brand, actions: [], source, href, hrefLabel: `Connect ${name}`, state: 'proposed' };
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
  // THE CARD IS ITS TITLE AND ITS BUTTONS (Jamie, 2026-10-07, crossing out
  // the paragraph under "Connect GitHub"). What the login asks for is on the
  // vendor's own consent page, where the person reads it anyway; why it is
  // offered is in the words the agent wrote above the card.
  const card: Card = {
    id: cardId,
    kind: 'link',
    title: `Connect ${name}`,
    actions: [],
    source,
    href,
    // The button says what the tap does: "Log in with Google" (Chris,
    // 2026-10-26: one tap, the sign-in, nothing else to choose).
    hrefLabel: loginLabel(login.provider, name),
    // A connector with nothing to paste offers its login alone.
    ...(how?.paste
      ? {
          secondaryHref: `/dashboard/connectors?add=${encodeURIComponent(connector.slug)}&paste=1&returnTo=${encodeURIComponent(returnTo)}`,
          secondaryHrefLabel: 'Use an API key instead',
        }
      : {}),
    ...(lastAttempt ? { lastAttempt } : {}),
    ...brand,
    state: 'proposed',
  };
  ctx.emit({ type: 'card', card });
  return connectedWording(name, href, login.settingsAfterLogin);
}

/**
 * The source this workspace declares in the offered connector's family, when
 * it declares one and not this connector. One declared kind is offered in its
 * place; several are named back for the agent to ask which. Structured: the
 * family and the declared rows, never the person's words.
 * @param orgId - The workspace.
 * @param slug - The connector the agent picked.
 */
async function declaredInstead(orgId: string, slug: string): Promise<{ kind: 'one'; slug: string; note: string } | { kind: 'several'; reply: string } | null> {
  const family = familyOfKind(slug);
  if (!family) {
    return null;
  }
  const sources = await familySourcesForOrg(orgId, family);
  const kinds = [...new Set(sources.map(s => s.kind))];
  if (kinds.length === 0 || kinds.includes(slug)) {
    return null;
  }
  const nameOf = (kind: string) => getConnector(kind)?.name ?? kind;
  if (kinds.length === 1) {
    const only = kinds[0]!;
    return { kind: 'one', slug: only, note: `This workspace declares ${nameOf(only)} as its ${FAMILY_LABEL[family]}, so the card is for ${nameOf(only)}, not ${nameOf(slug)}.` };
  }
  return { kind: 'several', reply: `No card yet: this workspace declares ${kinds.map(k => `${nameOf(k)} (${k})`).join(', ')} as its ${FAMILY_LABEL[family]}s. Ask which one they mean, then call offer_connection with that connector and named: true.` };
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
  return `Asked them to connect ${name} — docked above their composer (${href}). ${how} Their answer comes back to you when they are back. Do not claim it is connected until list_capabilities shows it.`;
}

/**
 * `offer_connection` (#1080): a one-tap card that opens the connect flow for
 * one connector and returns to this conversation afterwards.
 * @param ctx - The turn's runtime context.
 * @returns The tool.
 */
export function offerConnectionTool(ctx: RuntimeContext) {
  return tool(
    async (input: { connector: string; why: string; kind?: ConnectorKind; named?: boolean }) => offerConnection(ctx, input),
    {
      name: 'offer_connection',
      description: 'Show the person a one-tap card to connect one team connector (GitHub, Jira, Slack…) — a shared system this workspace\'s agents use. It opens the connect flow and comes back to this conversation. Use when the person asks to connect a tool, or a missing connection is what blocks the work; once per connector. Say which kind it is and why in your line above the card.',
      schema: z.object({
        kind: CONNECTOR_KIND_FIELD,
        connector: z.string().min(1).describe('Connector slug from list_capabilities, e.g. "github".'),
        why: z.string().min(1).max(200).describe('One sentence on what connecting it lets this workspace do.'),
        named: z.boolean().optional().describe('true only when the person named this vendor themselves ("connect LinkedIn Ads"). Leave it out when you chose the connector for a need like "ads": the source this workspace declares is offered first.'),
      }),
    },
  );
}

/**
 * The words on a login card's button: "Log in with <vendor>", the vendor's own
 * sign-in, else "Connect <name>".
 * @param provider - The connect provider the login runs on.
 * @param name - The connector's name.
 */
export function loginLabel(provider: string, name: string): string {
  const label = providerFor(provider)?.label;
  return label ? `Log in with ${label}` : `Connect ${name}`;
}
