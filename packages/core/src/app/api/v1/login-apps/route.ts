import { NextResponse } from 'next/server';
import { connectOrigin } from '@/libs/connect/routes';
import { listLoginApps } from '@/services/connect/loginApps';
import { authApi, isErrorResponse, requireWorkspaceAdmin } from '../_shared';

/**
 * GET /api/v1/login-apps
 *
 * List the workspace's vendor login apps, saved or not.
 *
 * One entry per vendor that takes one (Google, Slack, Atlassian, HubSpot,
 * Notion, Zoom, Apollo):
 * `{ loginApps: [{ provider, vendor, saved, name, keyHint, savedAt, redirectUrl }] }`.
 * `keyHint` is the saved client ID, masked; the secret is never returned.
 * `redirectUrl` is the callback to register at the vendor, null when the
 * server has no public address (NEXT_PUBLIC_APP_URL).
 *
 * Requires a workspace admin, as the Developers page does.
 * Auth: tenant API token or dashboard session.
 * @param req - The request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const notAdmin = requireWorkspaceAdmin(caller, 'list login apps');
  if (notAdmin) {
    return notAdmin;
  }
  return NextResponse.json({ loginApps: await listLoginApps(caller.orgId, connectOrigin()) });
}
