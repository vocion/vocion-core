import { NextResponse } from 'next/server';
import { callbackUri, connectOrigin } from '@/libs/connect/routes';
import { logger } from '@/libs/Logger';
import { CredentialValidationError } from '@/libs/platforms/registry';
import { loginAppPlatformForProvider, revokeLoginApp, saveLoginApp } from '@/services/connect/loginApps';
import { authApi, isErrorResponse, jsonError, readJsonBody, requireWorkspaceAdmin } from '../../_shared';

/** The longest value a field takes, as on the Developers form. */
const MAX_FIELD_LENGTH = 8192;

/**
 * PUT /api/v1/login-apps/:provider
 *
 * Save the workspace's own OAuth login app for one vendor, replacing the one
 * saved before. Body: `{ clientId, clientSecret, name? }`. New logins with
 * that vendor then run on this app, with no server redeploy. Answers
 * `{ loginApp: { provider, name, keyHint, redirectUrl, replaced } }`; the
 * secret is never returned. When `replaced` is true, logins made with the old
 * app need an admin to log in again.
 *
 * `provider` is one of google, slack, atlassian, hubspot, notion, zoom,
 * apollo. GitHub and PostHog take no login app.
 *
 * Requires a workspace admin, as the Developers page does.
 * Auth: tenant API token or dashboard session.
 * @param req - The request.
 * @param context - Route params.
 * @param context.params - The `provider` path segment.
 */
export async function PUT(req: Request, context: { params: Promise<{ provider: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const notAdmin = requireWorkspaceAdmin(caller, 'save a login app');
  if (notAdmin) {
    return notAdmin;
  }
  const { provider } = await context.params;
  const platform = loginAppPlatformForProvider(provider);
  if (!platform) {
    return jsonError('NOT_FOUND', noLoginAppFor(provider), 404);
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const fields = loginAppFields(body);
  if (typeof fields === 'string') {
    return jsonError('VALIDATION_FAILED', fields, 400);
  }
  const vendor = platform.label.replace(/ login app$/, '');
  try {
    const saved = await saveLoginApp({ orgId: caller.orgId, platform, name: fields.name ?? platform.label, clientId: fields.clientId, clientSecret: fields.clientSecret, createdBy: caller.actorId });
    const origin = connectOrigin();
    return NextResponse.json({
      loginApp: {
        provider,
        name: fields.name ?? platform.label,
        keyHint: saved.keyHint,
        redirectUrl: origin ? callbackUri(origin, provider) : null,
        replaced: saved.replaced,
        ...(saved.replaced ? { note: `Logins made with the previous ${vendor} login app need an admin to log in with ${vendor} again.` } : {}),
      },
    });
  } catch (error) {
    if (error instanceof CredentialValidationError) {
      return jsonError('VALIDATION_FAILED', error.message, 400);
    }
    // Never the error itself: a database error can echo the values it was sent.
    logger.error('[api/v1/login-apps] could not save a login app', { orgId: caller.orgId, provider, errorName: error instanceof Error ? error.name : 'unknown' });
    return jsonError('LOGIN_APP_SAVE_FAILED', 'Could not save the login app.', 500);
  }
}

/**
 * DELETE /api/v1/login-apps/:provider
 *
 * Revoke the workspace's login app for one vendor. New logins go back to the
 * server's app, if it has one, and logins made with this app need an admin to
 * log in again. Answers `{ revoked }`: false when none was saved, so running
 * it twice is safe.
 *
 * Requires a workspace admin, as the Developers page does.
 * Auth: tenant API token or dashboard session.
 * @param req - The request.
 * @param context - Route params.
 * @param context.params - The `provider` path segment.
 */
export async function DELETE(req: Request, context: { params: Promise<{ provider: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const notAdmin = requireWorkspaceAdmin(caller, 'revoke a login app');
  if (notAdmin) {
    return notAdmin;
  }
  const { provider } = await context.params;
  const platform = loginAppPlatformForProvider(provider);
  if (!platform) {
    return jsonError('NOT_FOUND', noLoginAppFor(provider), 404);
  }
  return NextResponse.json({ revoked: await revokeLoginApp(caller.orgId, platform) });
}

/**
 * Why a provider has no login app, naming the ones that do.
 * @param provider - The path segment the caller sent.
 */
function noLoginAppFor(provider: string): string {
  return `No login app for "${provider}". Login apps exist for google, slack, atlassian, hubspot, notion, zoom and apollo; GitHub and PostHog take none.`;
}

/**
 * The fields of a PUT body, or the sentence saying what is wrong with them.
 * Blank values are left to `storePlatformKey`, which trims and refuses them
 * with the same sentence the Developers form shows.
 * @param body - The parsed JSON body.
 */
function loginAppFields(body: Record<string, unknown>): { clientId: string; clientSecret: string; name: string | null } | string {
  const { clientId, clientSecret, name } = body;
  if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
    return 'clientId and clientSecret are required strings.';
  }
  if (clientId.length > MAX_FIELD_LENGTH || clientSecret.length > MAX_FIELD_LENGTH) {
    return `clientId and clientSecret are at most ${MAX_FIELD_LENGTH} characters.`;
  }
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 80)) {
    return 'name, when given, is 1 to 80 characters.';
  }
  return { clientId, clientSecret, name: typeof name === 'string' ? name.trim() : null };
}
