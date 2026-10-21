/**
 * GET /api/connect/mcp/start?workspace=<id>&source=<slug>
 *
 * Starts a person's own sign-in to a per-person MCP source (`auth: person`,
 * docs/guides/mcp-sources.md): discover the server's OAuth, register Vocion as
 * a public client, and send the person to the server's sign-in with a signed
 * state carrying the client id and a PKCE challenge derived from that state.
 * Any member of the workspace may start it: the grant is theirs alone and is
 * kept in their Personal (`services/outboundMcp/personSignIn.ts`).
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { clerkAuth as auth } from '@/libs/Auth';
import { safeReturnPath } from '@/libs/connect/returnTo';
import { callbackUri, connectOrigin } from '@/libs/connect/routes';
import { pkceChallengeFor, pkceVerifierFor, signState } from '@/libs/connect/state';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { resolvesPublicly } from '@/libs/net/publicUrl';
import { discoverMcpAuth, mcpAuthorizeUrl, mcpEndpoint, registerMcpClient } from '@/libs/outboundMcp/oauth';
import { personMcpSourceFor } from '@/libs/outboundMcp/personSource';

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Sign in to Vocion first.' }, { status: 401 });
  }
  const orgId = req.nextUrl.searchParams.get('workspace')?.trim() ?? '';
  const slug = req.nextUrl.searchParams.get('source')?.trim() ?? '';
  const source = orgId && slug ? await personMcpSourceFor({ userId, orgId, slug }) : null;
  if (!source) {
    return NextResponse.json({ error: 'No per-person MCP source by that name in a workspace you can open.' }, { status: 404 });
  }
  const origin = connectOrigin();
  if (!origin || !Env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Signing in to an MCP server needs AUTH_SECRET and NEXT_PUBLIC_APP_URL on the server.' }, { status: 500 });
  }
  const baseUrl = mcpEndpoint(source.url);
  if (!(await resolvesPublicly(baseUrl)).ok) {
    return NextResponse.json({ error: `${source.name}'s endpoint does not resolve to a public address.` }, { status: 400 });
  }
  const redirectUri = callbackUri(origin, 'mcp');
  try {
    const server = await discoverMcpAuth(baseUrl);
    const clientId = await registerMcpClient(server, redirectUri);
    const params = req.nextUrl.searchParams;
    const returnTo = safeReturnPath(params.get('returnTo'));
    const conversation = params.get('conversation') ?? '';
    const card = params.get('card') ?? '';
    // From a chat card: land back in that conversation and mark the card done.
    const from = /^[1-9]\d{0,9}$/.test(conversation) && /^[\w-]{1,64}$/.test(card) ? { conversationId: Number(conversation), cardId: card } : {};
    const state = signState({ provider: 'mcp', orgId, sourceSlug: slug, userId, loginClientId: clientId, ...(returnTo ? { returnTo } : {}), ...from });
    return NextResponse.redirect(mcpAuthorizeUrl(server, { clientId, redirectUri, state, codeChallenge: pkceChallengeFor(pkceVerifierFor(state)) }), 302);
  } catch (error) {
    logger.warn('An MCP sign-in could not start', { orgId, source: slug, errorName: error instanceof Error ? error.name : 'unknown' });
    const reason = error instanceof Error && error.message.startsWith('The MCP server') ? error.message : 'Its OAuth discovery or client registration failed.';
    return NextResponse.json({ error: `Could not start signing in to ${source.name}. ${reason}` }, { status: 502 });
  }
}
