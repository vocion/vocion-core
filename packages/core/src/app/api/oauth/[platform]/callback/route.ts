/**
 * GET /api/oauth/[platform]/callback — take the grant and send the person back.
 *
 * Reads exactly two things off the request: `state` and `code`. Which org,
 * which connector and whose grant all come from the stored state row, because
 * this is a GET anybody can hand a signed-in browser and a crafted link must
 * not be able to say any of them.
 *
 * No session is required. The state row IS the authorisation — it was minted
 * for one person in one org — and demanding a session too would break the
 * flow for anyone whose vendor consent landed in a fresh browser context.
 */

import { completeOAuth, OAuthSetupError, safeReturnPath } from '@/services/OAuthService';

/**
 * Send the browser somewhere with a message it can render.
 * @param origin
 * @param path
 * @param params
 */
function backTo(origin: string, path: string, params: Record<string, string>): Response {
  const url = new URL(safeReturnPath(path) ?? '/dashboard/connectors', origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return Response.redirect(url.toString(), 302);
}

export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const vendorError = url.searchParams.get('error');

  // The person pressed Cancel, or the vendor refused. Not an error of ours:
  // send them back where they were with nothing changed.
  if (vendorError) {
    return backTo(url.origin, '/dashboard/connectors', { connect_error: vendorError });
  }
  if (!state || !code) {
    return backTo(url.origin, '/dashboard/connectors', { connect_error: 'incomplete' });
  }

  try {
    const result = await completeOAuth({ state, code, origin: url.origin });
    return backTo(url.origin, result.returnTo, { connected: result.connectorSlug });
  } catch (err) {
    if (err instanceof OAuthSetupError) {
      return backTo(url.origin, '/dashboard/connectors', { connect_error: err.message });
    }
    // Anything else can carry whatever the vendor or the vault produced.
    console.error('[oauth/callback] could not complete the consent', {
      platform,
      message: err instanceof Error ? err.message : String(err),
    });
    return backTo(url.origin, '/dashboard/connectors', { connect_error: 'Could not complete the connection.' });
  }
}
