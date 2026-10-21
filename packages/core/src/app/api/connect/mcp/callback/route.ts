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
  if (req.nextUrl.searchParams.get('error')) {
    return refuse(`${source.name} did not grant access. Start the sign-in again from Vocion if that was not intended.`, 400);
  }
  const code = req.nextUrl.searchParams.get('code');
  const origin = connectOrigin();
  if (!code || !origin) {
    return refuse(`${source.name} sent no authorization code.`, 400);
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
    const reason = error instanceof Error && /^(?:The MCP server|You have no Personal)/.test(error.message) ? ` ${error.message}` : '';
    return refuse(`Could not finish signing in to ${source.name}.${reason} Start it again from Vocion.`, 502);
  }
  if (conversationId !== undefined && cardId) {
    // The card is a view: the sign-in stands whether or not it can be marked.
    await approveLoginCard({ orgId, userId, card: { conversationId, cardId } }).catch((error: unknown) => {
      logger.warn('The MCP sign-in card could not be marked done', { orgId, errorName: error instanceof Error ? error.name : 'unknown' });
    });
  }
  const back = returnTo ?? '/dashboard';
  const [workspace] = await db.select({ slug: projectSchema.slug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return NextResponse.redirect(workspace ? workspaceUrl(workspace.slug, back, { absolute: true }) : `${origin}${back}`, 303);
}
