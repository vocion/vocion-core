/**
 * May this person act in that workspace, and as what?
 *
 * The primitive for anything that reads or acts in a workspace other than the
 * one a request was resolved into — a person's own assistant reaching into a
 * shared workspace on their behalf, for one. `auth()` and an agent turn each
 * carry exactly one `orgId`, and tool calls trust it; a cross-workspace read
 * has no such resolved `orgId`, so it asks here first, on every read and every
 * act, and uses the `orgId` this returns.
 *
 * The rule is the one `resolveActiveWorkspace` applies to a picked workspace
 * (`roleInMemberWorkspace`), so acting somewhere can never be wider than
 * switching to it:
 *
 * - **Personal workspace** — its owner, and nobody else, whatever
 *   `VOCION_ENFORCE_WORKSPACE_ACCESS` says.
 * - **Shared workspace, enforced** — `effectiveRole`: an admin of the account,
 *   or a direct or group grant.
 * - **Shared workspace, unenforced** — any member of the owning account, at
 *   their account role, as today.
 */

import type { WorkspaceRole } from '@/services/authz';
import { memberWorkspace, roleInMemberWorkspace } from '@/services/WorkspaceAccessService';

/** Who a person is in a workspace they may act in. */
export type ActingIdentity = {
  /** The workspace, under the name every business-content table scopes by. */
  orgId: string;
  /** The account that owns it. */
  accountId: string;
  /** The role to hand `services/authz.ts`. */
  role: WorkspaceRole;
};

/**
 * The identity to act with in `projectId`, or `null` when this person may not.
 *
 * **Callers must treat `null` as "not found" — a 404, never a 403.** `null`
 * covers a workspace that does not exist, one on an account the person is not
 * in, a shared one they hold no grant on, and someone else's personal
 * workspace. Answering those differently tells the asker that a workspace
 * exists and whose it is, and on a deployment where personal workspaces hold
 * people's mail that is the disclosure this exists to prevent.
 * @param userId - The person on whose behalf the read or act happens.
 * @param projectId - The workspace to act in (`project.id`).
 */
export async function actAs(userId: string, projectId: string): Promise<ActingIdentity | null> {
  const workspace = await memberWorkspace(userId, projectId);
  if (!workspace) {
    return null;
  }
  const role = await roleInMemberWorkspace(userId, workspace);
  return role ? { orgId: workspace.projectId, accountId: workspace.accountId, role } : null;
}
