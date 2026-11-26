import { NextResponse } from 'next/server';
import { connectOrigin } from '@/libs/connect/routes';
import { logger } from '@/libs/Logger';
import { CredentialValidationError, loginAppPlatforms } from '@/libs/platforms/registry';
import { loginAppPlatformForProvider, LoginAppSaveConflictError, revokeLoginApp, saveLoginApp } from '@/services/connect/loginApps';
import { authApi, isErrorResponse, jsonError, readJsonBody, requireWorkspaceAdmin } from '../../_shared';

/** The longest client ID or secret taken, as on the Developers form. */
const MAX_FIELD_LENGTH = 8192;

/** The longest name taken, as on the Developers form. */
const MAX_NAME_LENGTH = 80;

/**
 * PUT /api/v1/login-apps/:provider
 *
 * Save the workspace's own OAuth login app for one vendor, replacing the one
 * saved before. New logins with that vendor then run on this app, with no
 * server redeploy. The login itself stays a click in the dashboard: this
 * saves the app, it does not log in.
 *
 * Body: `{ clientId, clientSecret, name? }`. `clientId` and `clientSecret` are
 * strings of up to 8192 characters, trimmed; `name` is 1 to 80 characters and
 * defaults to `<Vendor> login app`. A 400 names the field in
 * `error.details.field`.
 *
 * Answers `{ loginApp: { provider, vendor, name, keyHint, redirectUrl,
 * replaced, loginsNeedLoggingInAgain, note } }`. `keyHint` is the client ID,
 * masked to its last characters; the secret is never returned. `redirectUrl`
 * is the callback to register at the vendor, null when the server has no
 * public address (NEXT_PUBLIC_APP_URL). `replaced` says an app was saved
 * before. `loginsNeedLoggingInAgain` is true only when the client ID changed:
 * logins made with the old app then need an admin to log in again, and `note`
 * says so; a new secret for the same app leaves them working.
 *
 * `provider` is one of google, slack, atlassian, hubspot, notion, zoom,
 * apollo. GitHub and PostHog take no login app. A 409 means another save of
 * the same app kept landing at the same moment; send it again.
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
  // Read field by field here, so the OpenAPI generator lists the body's fields.
  const fields = loginAppFields({ clientId: body.clientId, clientSecret: body.clientSecret, name: body.name });
  if ('field' in fields) {
    return jsonError('VALIDATION_FAILED', fields.message, 400, { field: fields.field });
  }
  try {
    const saved = await saveLoginApp({ orgId: caller.orgId, platform, ...fields, savedBy: caller.actorId, origin: connectOrigin() });
    return NextResponse.json({
      loginApp: {
        provider: saved.provider,
        vendor: saved.vendor,
        name: saved.name,
        keyHint: saved.keyHint,
        redirectUrl: saved.redirectUrl,
        replaced: saved.replaced,
        loginsNeedLoggingInAgain: saved.loginsNeedLoggingInAgain,
        note: saved.note,
      },
    });
  } catch (error) {
    if (error instanceof CredentialValidationError) {
      return jsonError('VALIDATION_FAILED', error.message, 400);
    }
    if (error instanceof LoginAppSaveConflictError) {
      return jsonError('CONFLICT', error.message, 409);
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
  return NextResponse.json({ revoked: await revokeLoginApp({ orgId: caller.orgId, platform, revokedBy: caller.actorId }) });
}

/**
 * Why a provider has no login app, naming the ones that do.
 * @param provider - The path segment the caller sent.
 */
function noLoginAppFor(provider: string): string {
  // From the registry, so a vendor added there is named here without an edit.
  const providers = loginAppPlatforms().map(platform => platform.loginAppFor).filter((id): id is NonNullable<typeof id> => Boolean(id));
  const named = providers.length > 1 ? `${providers.slice(0, -1).join(', ')} and ${providers.at(-1)}` : providers.join('');
  return `No login app for "${provider}". Login apps exist for ${named}; GitHub and PostHog take none.`;
}

/**
 * The fields of a PUT body, or the field that is wrong and a sentence saying
 * how. Blank values are left to `storePlatformKey`, which trims and refuses
 * them with the same sentence the Developers form shows.
 * @param body - The body's fields, as sent.
 * @param body.clientId - The app's client ID.
 * @param body.clientSecret - The app's client secret.
 * @param body.name - What to call it, if given.
 */
function loginAppFields(body: { clientId: unknown; clientSecret: unknown; name: unknown }): { clientId: string; clientSecret: string; name: string | null } | { field: string; message: string } {
  for (const field of ['clientId', 'clientSecret'] as const) {
    const value = body[field];
    if (typeof value !== 'string') {
      return { field, message: `${field} is required, as a string.` };
    }
    if (value.length > MAX_FIELD_LENGTH) {
      return { field, message: `${field} is at most ${MAX_FIELD_LENGTH} characters.` };
    }
  }
  const { name } = body;
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME_LENGTH)) {
    return { field: 'name', message: `name, when given, is 1 to ${MAX_NAME_LENGTH} characters.` };
  }
  return {
    clientId: body.clientId as string,
    clientSecret: body.clientSecret as string,
    name: typeof name === 'string' ? name.trim() : null,
  };
}
