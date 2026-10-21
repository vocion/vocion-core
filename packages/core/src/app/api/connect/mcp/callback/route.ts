/**
 * GET /api/connect/mcp/callback
 *
 * The MCP server's sign-in sends the person back here. The signed state must
 * check out (signature, expiry, provider `mcp`) and name the person in this
 * session; the source must still be per-person in a workspace they can open.
 * Only then is the code exchanged, with the state's own PKCE verifier and
 * client id, and the grant stored in the person's Personal. Nothing is written
 * before every check passes, and nothing the server sent is echoed.
 */

import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { clerkAuth as auth } from '@/libs/Auth';
import { returnUrl } from '@/libs/connect/returnTo';
import { callbackUri, connectOrigin } from '@/libs/connect/routes';
import { pkceVerifierFor, verifyState } from '@/libs/connect/state';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { logger } from '@/libs/Logger';
import { exchangeMcpCode, mcpEndpoint } from '@/libs/outboundMcp/oauth';
import { personMcpSourceFor } from '@/libs/outboundMcp/personSource';
import { projectSchema } from '@/models/Schema';
import { approveLoginCard } from '@/services/connect/completeLogin';
import { storePersonGrant } from '@/services/outboundMcp/personSignIn';

/**
 * A refusal the person reads in the browser tab.
 * @param message - What went wrong, with no vendor text in it.
 * @param status - The HTTP status.
 */
function refuse(message: string, status: number) {
  return new NextResponse(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return refuse('Sign in to Vocion first, then sign in to the MCP server again.', 401);
  }
  const rawState = req.nextUrl.searchParams.get('state');
  const verified = verifyState(rawState);
  if (!verified.ok || verified.payload.provider !== 'mcp' || verified.payload.userId !== userId || !verified.payload.sourceSlug || !verified.payload.loginClientId) {
    return refuse('This sign-in link is not valid for you or has expired. Start it again from Vocion.', 400);
  }
  const { orgId, sourceSlug, loginClientId, returnTo, conversationId, cardId } = verified.payload;
  const source = await personMcpSourceFor({ userId, orgId, slug: sourceSlug });
  if (!source) {
    return refuse('That MCP source no longer signs people in, or you can no longer open its workspace.', 404);
  }
  const [workspace] = await db.select({ slug: projectSchema.slug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  const origin = connectOrigin() ?? '';
  // Back where the sign-in was offered, with the outcome every connect lands
  // with: the chat card's step is answered, or says why it was not.
  const land = (outcome: { ok: true } | { ok: false; reason: string }) => {
    const path = returnUrl('', outcome, { connector: sourceSlug, returnTo: returnTo ?? '/dashboard' });
    return NextResponse.redirect(workspace ? workspaceUrl(workspace.slug, path, { absolute: true }) : `${origin}${path}`, 303);
  };
  if (req.nextUrl.searchParams.get('error')) {
    return land({ ok: false, reason: 'access_denied' });
  }
  const code = req.nextUrl.searchParams.get('code');
  if (!code || !origin) {
    return land({ ok: false, reason: 'no_code' });
  }
  try {
    const grant = await exchangeMcpCode({
      baseUrl: mcpEndpoint(source.url),
      clientId: loginClientId,
      code,
      codeVerifier: pkceVerifierFor(rawState!),
      redirectUri: callbackUri(origin, 'mcp'),
    });
    await storePersonGrant({ userId, sourceName: source.name, grant });
  } catch (error) {
    logger.warn('An MCP sign-in could not finish', { orgId, source: sourceSlug, errorName: error instanceof Error ? error.name : 'unknown' });
    return land({ ok: false, reason: 'exchange_failed' });
  }
  if (conversationId !== undefined && cardId) {
    // The card is a view: the sign-in stands whether or not it can be marked.
    await approveLoginCard({ orgId, userId, card: { conversationId, cardId } }).catch((error: unknown) => {
      logger.warn('The MCP sign-in card could not be marked done', { orgId, errorName: error instanceof Error ? error.name : 'unknown' });
    });
  }
  return land({ ok: true });
}
