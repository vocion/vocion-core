/**
 * GET /api/connect/[provider]/start?connector=<slug>|source=<slug>[&returnTo=/dashboard/...][&conversation=<id>&card=<id>]
 *
 * Sends a workspace admin to the vendor to log in (#1080). It can start from a
 * connector alone: the login is stored first and sources are linked to it
 * afterwards. The state it carries is signed and bound to this org, this
 * connector or source and this person; the callback trusts nothing else. Same gate as pasting a key: admins only.
 *
 * Fails closed on configuration: no AUTH_SECRET means no state can be signed,
 * and no NEXT_PUBLIC_APP_URL means no redirect_uri can be named honestly.
 */

import type { NextRequest } from 'next/server';
import type { ConnectProvider } from '@/libs/connect/provider';
import { NextResponse } from 'next/server';
import { clerkAuth as auth } from '@/libs/Auth';
import { loginClientForNewLogin } from '@/libs/connect/loginClient';
import { providerFor, providerForConnector } from '@/libs/connect/registry';
import { safeReturnPath } from '@/libs/connect/returnTo';
import { callbackUri, connectOrigin } from '@/libs/connect/routes';
import { findSourceBySlug } from '@/libs/connect/sources';
import { pkceChallengeFor, pkceVerifierFor, signState } from '@/libs/connect/state';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { loginAppPlatformFor } from '@/libs/platforms/registry';

type StartTarget
  = | { ok: true; connectorSlug: string; sourceSlug?: string }
    | { ok: false; status: number; error: string };

/**
 * What the login is for: a connector this provider serves, or an existing
 * source of one. A connector needs no source row.
 * @param orgId - The workspace.
 * @param provider - The provider the URL named.
 * @param params - The start route's query string.
 */
async function resolveTarget(orgId: string, provider: ConnectProvider, params: URLSearchParams): Promise<StartTarget> {
  const connector = params.get('connector')?.trim() ?? '';
  if (connector) {
    if (providerForConnector(connector)?.id !== provider.id) {
      return { ok: false, status: 400, error: `${connector} is not a ${provider.label} connector` };
    }
    return { ok: true, connectorSlug: connector };
  }
  const sourceSlug = params.get('source')?.trim() ?? '';
  if (!sourceSlug) {
    return { ok: false, status: 400, error: 'Missing connector or source' };
  }
  const source = await findSourceBySlug(orgId, sourceSlug);
  if (!source) {
    return { ok: false, status: 404, error: 'Source not found' };
  }
  if (providerForConnector(source.connectorSlug)?.id !== provider.id) {
    return { ok: false, status: 400, error: `${source.slug} is not a ${provider.label} source` };
  }
  return { ok: true, connectorSlug: source.connectorSlug, sourceSlug: source.slug };
}

/**
 * The chat card the login came from, when the query names one properly. A
 * malformed conversation or card id drops both: half a card is no card.
 * @param params - The start route's query string.
 */
function cardFromQuery(params: URLSearchParams): { conversationId?: number; cardId?: string } {
  const conversation = params.get('conversation') ?? '';
  const card = params.get('card') ?? '';
  if (!/^[1-9]\d{0,9}$/.test(conversation) || !/^[\w-]{1,64}$/.test(card)) {
    return {};
  }
  return { conversationId: Number(conversation), cardId: card };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { orgId, userId, role } = await auth();
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can connect a source' }, { status: 403 });
  }
  const { provider: providerId } = await ctx.params;
  const provider = providerFor(providerId);
  if (!provider) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
  }
  const target = await resolveTarget(orgId, provider, req.nextUrl.searchParams);
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: target.status });
  }
  // The app the login runs on: the workspace's own login app, else the server's.
  let client;
  try {
    client = await loginClientForNewLogin(orgId, provider.id);
  } catch (error) {
    logger.error('[connect] the workspace login app could not be read', { orgId, provider: provider.id, errorName: error instanceof Error ? error.name : 'unknown' });
    return NextResponse.json(
      { error: `The saved ${provider.label} login app could not be read. An admin needs to save it again on the Developers page.` },
      { status: 500 },
    );
  }
  if (!client && !provider.configured()) {
    const bringYourOwn = loginAppPlatformFor(provider.id) ? `, or a ${provider.label} login app saved on the Developers page` : '';
    return NextResponse.json(
      { error: `Connecting with ${provider.label} needs ${provider.requiredEnv.join(', ')} on the server${bringYourOwn}.` },
      { status: 400 },
    );
  }
  const origin = connectOrigin();
  const missing = [
    ...(Env.AUTH_SECRET ? [] : ['AUTH_SECRET']),
    ...(origin ? [] : ['NEXT_PUBLIC_APP_URL']),
  ];
  if (missing.length > 0 || !origin) {
    return NextResponse.json(
      { error: `Connecting at a vendor needs ${missing.join(', ')} on the server.` },
      { status: 500 },
    );
  }
  const returnTo = safeReturnPath(req.nextUrl.searchParams.get('returnTo'));
  const card = cardFromQuery(req.nextUrl.searchParams);
  const state = signState({
    provider: provider.id,
    orgId,
    userId,
    ...(target.sourceSlug ? { sourceSlug: target.sourceSlug } : {}),
    connectorSlug: target.connectorSlug,
    ...(returnTo ? { returnTo } : {}),
    ...card,
  });
  const codeChallenge = provider.pkce ? pkceChallengeFor(pkceVerifierFor(state)) : undefined;
  return NextResponse.redirect(provider.authorizeUrl({ state, redirectUri: callbackUri(origin, provider.id), connector: target.connectorSlug, ...(codeChallenge ? { codeChallenge } : {}), ...(client ? { client } : {}) }), 302);
}
