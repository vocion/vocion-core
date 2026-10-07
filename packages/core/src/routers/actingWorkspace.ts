import { actAs } from '@/services/workspace/actAs';
import { ApiError } from './ApiError';

/**
 * The workspace a review request acts in.
 *
 * A request runs in the session's workspace (`guardAuth().orgId`). A card the
 * person's own assistant brought back from a workspace it asked
 * (`ask_workspace`) is decided from the personal thread it shows in, but its
 * proposal lives in that other workspace, so the card names it
 * (`card.workspace.id`) and the review routes act there instead.
 *
 * It is never wider than switching would be: the person must be able to act
 * in the named workspace by `actAs`, the rule the switcher and the assistant
 * already use. Anything else — a workspace that does not exist, one on an
 * account they are not in, a shared one they hold no grant on, someone else's
 * personal workspace — is the same 404, so asking discloses nothing.
 * @param session - Who is asking, and the workspace the session is in.
 * @param session.userId - The signed-in person.
 * @param session.orgId - The session's workspace.
 * @param workspaceId - The workspace the request names, if it names one.
 * @returns The `orgId` to scope every read and write by.
 */
export async function actingOrgId(session: { userId: string; orgId: string }, workspaceId: string | undefined): Promise<string> {
  if (!workspaceId || workspaceId === session.orgId) {
    return session.orgId;
  }
  const identity = await actAs(session.userId, workspaceId);
  if (!identity) {
    throw ApiError.notFound();
  }
  return identity.orgId;
}
