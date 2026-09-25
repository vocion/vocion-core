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
import { and, asc, eq } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { accountMembershipSchema, projectSchema } from '@/models/Schema';
import { accessibleProjects, effectiveRole, enforcementEnabled } from '@/services/WorkspaceAccessService';
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
 * Find the user's current tenant + active project. Self-hosted: each user
 * belongs to exactly one tenant_account; the active project is, in order:
 *
 * 1. the one the **URL** names — `/w/<slug>/…`, resolved by the proxy and
 *    forwarded as `WORKSPACE_HEADER.projectId` (`src/proxy.ts`). The URL wins
 *    so two tabs on two workspaces both stay right, and a refresh cannot
 *    resolve a record against whichever workspace was switched to last.
 * 2. the one the `vocion_active_project` cookie names — "last active", which
 *    is all a bare `/dashboard/…` URL has to go on.
 * 3. the first project on the account.
 *
 * Both 1 and 2 are CANDIDATES only. Unenforced, each is accepted when the
 * project belongs to this user's account, which stops a forged header reaching
 * another tenant. Enforced, that is not enough: workspaces inside one account
 * stop being interchangeable, so each candidate must be one this person
 * actually holds.
 *
 * Exported for its test. This function decides what a request may touch, and
 * the header it reads is attacker-suppliable on every `/api/` route (the proxy
 * returns early for those and nothing strips it), so the decision is worth
 * pinning directly rather than inferring from a layer above it.
 * @param userId
 */
export async function resolveTenancyForUser(userId: string): Promise<Tenancy> {
  const [membership] = await db
    .select({
      accountId: accountMembershipSchema.accountId,
      role: accountMembershipSchema.role,
    })
    .from(accountMembershipSchema)
    .where(eq(accountMembershipSchema.userId, userId))
    .limit(1);

  if (!membership) {
    return { accountId: null, projectId: null, role: null, workspaceRole: null };
  }
  const accountRole = membership.role as 'admin' | 'member';

  // The URL first, then "last active". `headers()` and `cookies()` are
  // available in Route Handlers, Server Actions and Server Components — the
  // JWT and session callbacks run in one of those contexts; both throw
  // outside a request scope (a script, the worker), where the first project
  // is the only sensible answer.
  let requestedId: string | undefined;
  try {
    const hdrs = await headers();
    requestedId = hdrs.get(WORKSPACE_HEADER.projectId)?.trim() || undefined;
  } catch {
    // Not in a request scope — fall through.
  }
  if (!requestedId) {
    try {
      const jar = await cookies();
      requestedId = jar.get(ACTIVE_PROJECT_COOKIE)?.value;
    } catch {
      // cookies() throws when called outside a request scope; fall through
      // to the default first-project selection.
    }
  }

  // ENFORCED: a candidate is accepted only when this person actually holds the
  // workspace. The header this reads is set by the proxy on a `/w/<slug>/…`
  // rewrite, but `proxy.ts` returns early for everything under `/api/`, so on
  // those routes it arrives from the caller and nothing strips it. Checking it
  // against the ACCOUNT — which is all the unenforced path below can do — is
  // therefore not a check at all once workspaces stop being interchangeable:
  // one header would name any workspace on the account, including someone's
  // personal one. This is the line that has to hold, not `ProjectService`.
  if (enforcementEnabled()) {
    if (requestedId) {
      const role = await effectiveRole(userId, requestedId);
      if (role) {
        return { accountId: membership.accountId, projectId: requestedId, role: accountRole, workspaceRole: role };
      }
      // Not theirs. Fall through to what IS theirs rather than erroring, so a
      // stale cookie or a bad link lands them somewhere they belong.
    }
    const reachable = await accessibleProjects(userId);
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

  // UNENFORCED: unchanged. Every member of the account reaches every project,
  // and the workspace role stands in from the account role — the same mapping
  // `app/api/v1/_shared.ts` has always applied, stated here once so both
  // surfaces agree while the flag is off.
  const standInRole: WorkspaceRole = accountRole === 'admin' ? 'owner' : 'pm';

  if (requestedId) {
    const [chosen] = await db
      .select({ id: projectSchema.id })
      .from(projectSchema)
      .where(and(eq(projectSchema.id, requestedId), eq(projectSchema.accountId, membership.accountId)))
      .limit(1);
    if (chosen) {
      return { accountId: membership.accountId, projectId: chosen.id, role: accountRole, workspaceRole: standInRole };
    }
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
    workspaceRole: proj ? standInRole : null,
  };
}
