import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { acceptSignIn, SignInRefusedError } from '@/services/browser/keptSignIn';
import { resumeWaitingOnSignIn, squarespaceConnectionFor } from '@/services/publish/squarespaceSignIn';
import { authApi, isErrorResponse, jsonError, readJsonBody, requireWorkspaceAdmin } from '../../_shared';

/**
 * PUT /api/v1/squarespace/session
 *
 * Keep a Squarespace sign-in on the workspace's connector for a site, so the
 * browser runs that publish to it start signed in. Squarespace has no API for
 * posts and refuses a password typed from a data centre, so a person signs in
 * on their own machine and this takes the result: what
 * `npm run squarespace:session` sends (`docs/guides/squarespace.md`).
 *
 * Body: `{ site, state, workspace?, savedFrom? }`. `site` is the site's
 * address, matched by host to the workspace's Squarespace connector. `state`
 * is the browser's storage state (Playwright's `storageState`: `cookies` and
 * `origins`), or the CLI's `--out` file around it; every cookie and origin must
 * be on squarespace.com, or the whole session is refused. `workspace`, when
 * given, is the slug or id the sender meant, checked against the token's.
 * The state is sealed under the workspace's key; it is never returned.
 *
 * Answers `{ session: { site, connector, savedAt, savedFrom, cookies, resumed } }`,
 * where `resumed` lists the pages that were waiting on a fresh sign-in and now
 * carry on. 404 when the workspace has no Squarespace connector for the site.
 * A 400 names the bad field in `error.details.field`.
 *
 * Requires a workspace admin, as the Developers page does.
 * Auth: tenant API token or dashboard session.
 * @param req - The request.
 */
export async function PUT(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const notAdmin = requireWorkspaceAdmin(caller, 'keep a Squarespace sign-in');
  if (notAdmin) {
    return notAdmin;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const site = typeof body.site === 'string' ? body.site.trim() : '';
  if (!/^https:\/\/\S+$/i.test(site)) {
    return jsonError('VALIDATION_FAILED', 'Give the site\'s https:// address, e.g. https://example-site.squarespace.com.', 400, { field: 'site' });
  }
  if (typeof body.workspace === 'string' && body.workspace.trim() && !await isThisWorkspace(caller.orgId, body.workspace.trim())) {
    return jsonError('VALIDATION_FAILED', `This token belongs to another workspace than "${body.workspace.trim().slice(0, 80)}". Use a token made in that workspace.`, 400, { field: 'workspace' });
  }
  const connection = await squarespaceConnectionFor(caller.orgId, site);
  if (!connection) {
    return jsonError('NOT_FOUND', `This workspace has no Squarespace connector for ${site}. Connect the site under Connectors → Squarespace first.`, 404, { field: 'site' });
  }
  try {
    const savedFrom = typeof body.savedFrom === 'string' && body.savedFrom.trim() ? body.savedFrom.trim() : 'the API';
    const kept = await acceptSignIn({ orgId: caller.orgId, sourceId: connection.sourceId, raw: body.state, site: connection.siteUrl, savedFrom, savedBy: caller.actorId });
    const resumed = await resumeWaitingOnSignIn(caller.orgId, { sourceId: connection.sourceId, siteUrl: connection.siteUrl }).catch(() => []);
    return NextResponse.json({ session: { site: connection.siteUrl, connector: connection.slug, savedAt: kept.savedAt, savedFrom: kept.savedFrom, cookies: kept.cookies, resumed } });
  } catch (error) {
    if (error instanceof SignInRefusedError) {
      return jsonError(error.status === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED', error.message, error.status, { field: error.field });
    }
    // Never the error itself: it could quote the cookies it was sent.
    logger.error('[api/v1/squarespace/session] could not keep a sign-in', { orgId: caller.orgId, errorName: error instanceof Error ? error.name : 'unknown' });
    return jsonError('SESSION_SAVE_FAILED', 'Could not keep the sign-in.', 500);
  }
}

/**
 * Whether a slug or id names the caller's workspace.
 * @param orgId - The caller's workspace id.
 * @param named - What the sender named.
 */
async function isThisWorkspace(orgId: string, named: string): Promise<boolean> {
  if (named === orgId) {
    return true;
  }
  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { projectSchema } = await import('@/models/Schema');
  const [row] = await db.select({ slug: projectSchema.slug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return row?.slug === named;
}
