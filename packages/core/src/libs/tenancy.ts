/**
 * Which tenant and which workspace a request belongs to.
 *
 * Extracted from `libs/Auth.ts` so the decision can be tested without standing
 * up next-auth: this function decides what a request may touch, and the header
 * it reads is attacker-suppliable on every `/api/` route, so it is worth
 * pinning directly rather than inferring from a layer above it. `Auth.ts` is
 * the only caller.
 */

import type { WorkspaceRole } from '@/services/authz';
import { cookies, headers } from 'next/headers';
import { resolveActiveWorkspace } from '@/services/WorkspaceAccessService';
import { ACTIVE_PROJECT_COOKIE } from './activeProject';
import { WORKSPACE_HEADER } from './links';

export type Tenancy = {
  accountId: string | null;
  projectId: string | null;
  role: 'admin' | 'member' | null;
  workspaceRole: WorkspaceRole | null;
};

/**
 * The workspace this request names, before anything checks it: the URL's
 * (`/w/<slug>/…`, resolved by the proxy and forwarded as
 * `WORKSPACE_HEADER.projectId`), else the `vocion_active_project` cookie.
 *
 * `headers()` and `cookies()` are available in Route Handlers, Server Actions
 * and Server Components — the JWT and session callbacks run in one of those
 * contexts; both throw outside a request scope (a script, the worker), where
 * there is nothing picked and the caller falls back to the default.
 */
async function requestedWorkspaceId(): Promise<string | undefined> {
  try {
    const fromUrl = (await headers()).get(WORKSPACE_HEADER.projectId)?.trim();
    if (fromUrl) {
      return fromUrl;
    }
  } catch {
    // Not in a request scope — there is no URL to read.
  }
  try {
    return (await cookies()).get(ACTIVE_PROJECT_COOKIE)?.value || undefined;
  } catch {
    // Not in a request scope — there is no cookie to read either.
    return undefined;
  }
}

/**
 * Find the user's current tenant + active project.
 *
 * **The account follows the workspace** (vocion-core#128). The picked
 * workspace is, in order:
 *
 * 1. the one the **URL** names — `/w/<slug>/…`, resolved by the proxy and
 *    forwarded as `WORKSPACE_HEADER.projectId` (`src/proxy.ts`). The URL wins
 *    so two tabs on two workspaces both stay right, and a refresh cannot
 *    resolve a record against whichever workspace was switched to last.
 * 2. the one the `vocion_active_project` cookie names — "last active", which
 *    is all a bare `/dashboard/…` URL has to go on.
 *
 * `resolveActiveWorkspace` makes the decision from there: the picked
 * workspace's account when the person is a member of it (and, enforced, holds
 * the workspace), otherwise the first workspace they can open. So switching
 * workspace in the sidebar is also how a person in two accounts switches
 * account: the switch lands on `/w/<slug>/…`, and the proxy moves the cookie
 * with it.
 *
 * Exported for its test. This function decides what a request may touch, and
 * the header it reads is attacker-suppliable on every `/api/` route (the proxy
 * returns early for those and nothing strips it), so the decision is worth
 * pinning directly rather than inferring from a layer above it.
 * @param userId - The signed-in person.
 */
export async function resolveTenancyForUser(userId: string): Promise<Tenancy> {
  const active = await resolveActiveWorkspace(userId, await requestedWorkspaceId());
  if (!active) {
    return { accountId: null, projectId: null, role: null, workspaceRole: null };
  }
  // Null projectId is a real state: a person can hold no workspace at all.
  // `guardAuth` already 401s on it, and the dashboard needs an empty state
  // rather than assuming a project exists.
  return { accountId: active.accountId, projectId: active.projectId, role: active.accountRole, workspaceRole: active.workspaceRole };
}
