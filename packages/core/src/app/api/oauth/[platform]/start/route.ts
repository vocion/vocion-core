/**
 * GET /api/oauth/[platform]/start — send the browser to the vendor's consent.
 *
 * Outside `[locale]` on purpose. A redirect URI is registered once in the
 * vendor's console and has to match byte for byte, so it cannot carry a
 * segment that changes with the reader's language.
 *
 * `connector` says which connector is being connected (one Google consent
 * covers Gmail, Drive and Calendar, so the platform alone does not say);
 * `scopes` is what the tool that triggered this actually needs, which is how
 * consent stays minimal — reading a calendar asks for `calendar.readonly`, and
 * only a later write asks for the write scope.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { getConnector } from '@/libs/sources/registry';
import { resolveIdentity } from '@/libs/sources/types';
import { beginOAuth, OAuthSetupError, safeReturnPath } from '@/services/OAuthService';

export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { orgId, userId, role } = await auth();
  if (!orgId || !userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { platform } = await ctx.params;
  const url = new URL(req.url);
  const connectorSlug = url.searchParams.get('connector') ?? platform;
  const connector = getConnector(connectorSlug);
  if (!connector) {
    return Response.json({ error: `No connector named ${connectorSlug}` }, { status: 404 });
  }
  // The same rule the card states and the connect route enforces: a shared
  // credential is a company asset, so a member is told who connects it rather
  // than walked into a consent screen that would bind one for everybody.
  if (resolveIdentity(connector.identity) === 'shared' && role !== 'admin') {
    return Response.json({ error: 'An admin connects this for the workspace.' }, { status: 403 });
  }

  const scopes = (url.searchParams.get('scopes') ?? '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);

  try {
    const { url: consentUrl } = await beginOAuth({
      orgId,
      userId,
      connectorSlug,
      scopes,
      origin: url.origin,
      returnTo: safeReturnPath(url.searchParams.get('return_to')),
    });
    return Response.redirect(consentUrl, 302);
  } catch (err) {
    if (err instanceof OAuthSetupError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error('[oauth/start] could not begin the consent', {
      platform,
      connectorSlug,
      message: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Could not start the connection.' }, { status: 500 });
  }
}
