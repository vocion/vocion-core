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
import { asc, eq } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { projectSchema } from '@/models/Schema';
import { accessibleProjects, defaultMembershipFor, effectiveRole, enforcementEnabled, memberWorkspace } from '@/services/WorkspaceAccessService';
import { ACTIVE_PROJECT_COOKIE } from './activeProject';
import { db } from './DB';
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
 * **The account follows the workspace** (vocion-core#128). Every workspace
 * belongs to exactly one account, so the workspace a person picked settles
 * which of their accounts this request runs in. Switching workspace in the
 * sidebar is therefore also how a person in two accounts switches account:
 * the switch lands on `/w/<slug>/…`, and the proxy moves the cookie with it.
 *
 * The picked workspace is, in order:
 *
 * 1. the one the **URL** names — `/w/<slug>/…`, resolved by the proxy and
 *    forwarded as `WORKSPACE_HEADER.projectId` (`src/proxy.ts`). The URL wins
 *    so two tabs on two workspaces both stay right, and a refresh cannot
 *    resolve a record against whichever workspace was switched to last.
 * 2. the one the `vocion_active_project` cookie names — "last active", which
 *    is all a bare `/dashboard/…` URL has to go on.
 *
 * Both are CANDIDATES only. A candidate picks the account only when the person
 * is a member of the account that owns it, which stops a forged header or
 * cookie reaching another tenant. Enforced, that is not enough: workspaces
 * inside one account stop being interchangeable, so the candidate must also be
 * one this person actually holds.
 *
 * With no acceptable candidate — a fresh browser, a stale cookie, a script —
 * the person lands in their oldest account (`defaultMembershipFor`) and its
 * first workspace, the same one on every read.
 *
 * Exported for its test. This function decides what a request may touch, and
 * the header it reads is attacker-suppliable on every `/api/` route (the proxy
 * returns early for those and nothing strips it), so the decision is worth
 * pinning directly rather than inferring from a layer above it.
 * @param userId
 */
export async function resolveTenancyForUser(userId: string): Promise<Tenancy> {
  const requestedId = await requestedWorkspaceId();
  const requested = requestedId ? await memberWorkspace(userId, requestedId) : null;

  // The picked workspace's account when the person is in it; otherwise the
  // default. A picked workspace they may not open (enforced, below) still keeps
  // them in its account: they chose that client, just not a room they hold.
  const membership = requested
    ? { accountId: requested.accountId, role: requested.accountRole }
    : await defaultMembershipFor(userId);
  if (!membership) {
    return { accountId: null, projectId: null, role: null, workspaceRole: null };
  }
  const accountRole = membership.role;

  // ENFORCED: a candidate is accepted only when this person actually holds the
  // workspace. The header this reads is set by the proxy on a `/w/<slug>/…`
  // rewrite, but `proxy.ts` returns early for everything under `/api/`, so on
  // those routes it arrives from the caller and nothing strips it. Checking it
  // against the ACCOUNT — which is all the unenforced path below can do — is
  // therefore not a check at all once workspaces stop being interchangeable:
  // one header would name any workspace on the account, including someone's
  // personal one. This is the line that has to hold, not `ProjectService`.
  if (enforcementEnabled()) {
    if (requested) {
      const role = await effectiveRole(userId, requested.projectId);
      if (role) {
        return { accountId: membership.accountId, projectId: requested.projectId, role: accountRole, workspaceRole: role };
      }
      // Not theirs. Fall through to what IS theirs in the same account rather
      // than erroring, so a stale cookie or a bad link lands them somewhere
      // they belong.
    }
    const reachable = await accessibleProjects(userId, membership.accountId);
    const first = [...reachable].sort((a, b) => a.projectId.localeCompare(b.projectId))[0];
    return {
      accountId: membership.accountId,
      projectId: first?.projectId ?? null,
      role: accountRole,
      // Null projectId is a real state now: a person can hold no workspace at
      // all. `guardAuth` already 401s on it, and the dashboard needs an empty
      // state rather than assuming a project exists.
      workspaceRole: first?.role ?? null,
    };
  }

  // UNENFORCED: every member of an account reaches every project on it, and
  // the workspace role IS the account role. There is no longer a mapping to
  // state: a workspace role and an account role are the same two names.

  if (requested) {
    return { accountId: membership.accountId, projectId: requested.projectId, role: accountRole, workspaceRole: accountRole };
  }

  // Ordered, because "the first project" with no ORDER BY is whatever Postgres
  // hands back. With four company workspaces that is stable enough to look
  // deliberate; it is not. Once an account holds many projects, an unordered
  // pick drops a person into an arbitrary one, and a person's landing workspace
  // should not change between requests.
  const [proj] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(eq(projectSchema.accountId, membership.accountId))
    .orderBy(asc(projectSchema.createdAt), asc(projectSchema.id))
    .limit(1);

  return {
    accountId: membership.accountId,
    projectId: proj?.id ?? null,
    role: accountRole,
    workspaceRole: proj ? accountRole : null,
  };
}
