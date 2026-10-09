import type { ResolvedCode } from '@/services/codes';
import { workspaceUrl } from '@/libs/links';
import { inboxHref } from '@/services/inbox/inboxRef';
import { recordHref, recordLinksForOrg } from '@/services/objects/recordHref';

/**
 * Where a resolved code opens — the record's own page, the run, the ask in
 * the inbox, the conversation — so ⌘K, `/dashboard/go/<code>` and anything
 * else that turns a code into a link agree (`services/codes.ts`).
 * @param orgId - The workspace.
 * @param resolved - What {@link import('@/services/codes').resolveCode} found.
 */
export async function hrefForCode(orgId: string, resolved: ResolvedCode): Promise<string> {
  if (resolved.kind === 'record') {
    return recordHref(orgId, { objectType: resolved.typeSlug, id: resolved.id });
  }
  const path = {
    run: `/dashboard/p/runs/${resolved.id}`,
    action: inboxHref('proposal', resolved.id),
    ask: inboxHref('ask', resolved.id),
    conversation: `/dashboard/chat/${resolved.id}`,
    artifact: `/dashboard/artifacts/${resolved.id}`,
    automation: '/dashboard/automation/runs',
    goal: `/dashboard/goals/${resolved.id}`,
  }[resolved.kind];
  const { workspaceSlug } = await recordLinksForOrg(orgId);
  return workspaceSlug ? workspaceUrl(workspaceSlug, path) : path;
}
