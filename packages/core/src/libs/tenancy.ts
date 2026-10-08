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
import { resolveProjectForUser } from '@/services/ProjectService';
import { resolveActiveWorkspace } from '@/services/WorkspaceAccessService';
import { ACTIVE_PROJECT_COOKIE } from './activeProject';
import { parseWorkspacePath, WORKSPACE_ACCOUNT_PARAM, WORKSPACE_HEADER } from './links';
import { runAsSystem } from './tenantContext';

export type Tenancy = {
  accountId: string | null;
  projectId: string | null;
  role: 'admin' | 'member' | null;
  workspaceRole: WorkspaceRole | null;
};

/**
 * The workspace the page that sent this request is on, from its `Referer`.
 *
 * A browser fetch (`/rpc`, `/api/chat`, the session poll) carries no
 * workspace of its own; only page loads go through the proxy's `/w/<slug>`
 * rewrite. Without this, those calls fell back to the last-active cookie, so
 * with two tabs open on two workspaces, the tab switched to first made its
 * reads and saves in the other tab's workspace, and with two accounts that is
 * another client's data (vocion-core#128). Browsers send the page's URL as
 * `Referer` on same-origin requests by default, so the tab's own `/w/<slug>`
 * (and `?account=`, when the URL has it) decides instead.
 *
 * A Referer is caller-supplied, like the header; it only ever picks among
 * workspaces this person can open, because the slug is resolved on their own
 * accounts and `resolveActiveWorkspace` checks membership again.
 * @param userId - The signed-in person.
 * @param referer - The request's `Referer`, if any.
 * @param lastActiveProjectId - The cookie, to break a slug tie between accounts.
 * @returns The workspace id, or undefined when the Referer names none they can open.
 */
async function workspaceFromReferer(userId: string, referer: string | null, lastActiveProjectId: string | undefined): Promise<string | undefined> {
  if (!referer || !URL.canParse(referer)) {
    return undefined;
  }
  const pageUrl = new URL(referer);
  const canonical = parseWorkspacePath(pageUrl.pathname);
  if (!canonical) {
    return undefined;
  }
  const project = await resolveProjectForUser(userId, { slug: canonical.slug }, {
    accountSlug: pageUrl.searchParams.get(WORKSPACE_ACCOUNT_PARAM),
    lastActiveProjectId,
  });
  return project?.id;
}

/**
 * The workspace this request names, before anything checks it: the URL's
 * (`/w/<slug>/…`, resolved by the proxy and forwarded as
 * `WORKSPACE_HEADER.projectId`), else the page's the request came from
 * (`Referer`, see {@link workspaceFromReferer}), else the
 * `vocion_active_project` cookie.
 *
 * `headers()` and `cookies()` are available in Route Handlers, Server Actions
 * and Server Components — the JWT and session callbacks run in one of those
 * contexts; both throw outside a request scope (a script, the worker), where
 * there is nothing picked and the caller falls back to the default.
 * @param userId - The signed-in person, to resolve a Referer's slug for.
 */
async function requestedWorkspaceId(userId: string): Promise<string | undefined> {
  let requestHeaders: Awaited<ReturnType<typeof headers>>;
  let cookie: string | undefined;
  try {
    requestHeaders = await headers();
    cookie = (await cookies()).get(ACTIVE_PROJECT_COOKIE)?.value || undefined;
  } catch {
    // Not in a request scope — there is no URL, page or cookie to read.
    return undefined;
  }
  const fromUrl = requestHeaders.get(WORKSPACE_HEADER.projectId)?.trim();
  if (fromUrl) {
    return fromUrl;
  }
  return (await workspaceFromReferer(userId, requestHeaders.get('referer'), cookie)) ?? cookie;
}

/**
 * Find the user's current tenant + active project.
 *
 * **The account follows the workspace** (vocion-core#128). The picked
 * workspace is, in order:
 *
 * 1. the one the **URL** names — `/w/<slug>/…`, resolved by the proxy and
 *    forwarded as `WORKSPACE_HEADER.projectId` (`src/proxy.ts`). The URL wins
 *    so a refresh cannot resolve a record against whichever workspace was
 *    switched to last.
 * 2. for a browser fetch from a page (`/rpc`, `/api/…`), the page's own
 *    `/w/<slug>`, from the `Referer` — so a tab's saves land in the tab's
 *    workspace, not whichever one another tab switched to last.
 * 3. the one the `vocion_active_project` cookie names — "last active", which
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
  // Choosing among the person's workspaces reads across their tenants, before
  // any one of them is known: system work (libs/tenantContext.ts).
  const active = await runAsSystem('resolve-tenancy', async () =>
    resolveActiveWorkspace(userId, await requestedWorkspaceId(userId)));
  if (!active) {
    return { accountId: null, projectId: null, role: null, workspaceRole: null };
  }
  // Null projectId is a real state: a person can hold no workspace at all.
  // `guardAuth` already 401s on it, and the dashboard needs an empty state
  // rather than assuming a project exists.
  return { accountId: active.accountId, projectId: active.projectId, role: active.accountRole, workspaceRole: active.workspaceRole };
}
