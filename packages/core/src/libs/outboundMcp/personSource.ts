import type { PersonMcpSource } from '@/services/outboundMcp/personSignIn';
import { loadMcpSources } from '@/libs/outboundMcp/sources';
import { effectiveRole } from '@/services/WorkspaceAccessService';

/**
 * A per-person MCP source the person may sign in to from a workspace they can
 * open: one it declares `auth: person`, or one of the person's own servers
 * that joins their turns there because the Org declares it elsewhere
 * (`services/outboundMcp/followingSources.ts`). Null otherwise.
 * @param input - The person, the workspace and the source slug.
 * @param input.userId - The signed-in person.
 * @param input.orgId - The workspace (`project.id`).
 * @param input.slug - The source slug, as that workspace's turns name it.
 */
export async function personMcpSourceFor(input: { userId: string; orgId: string; slug: string }): Promise<PersonMcpSource | null> {
  if (!(await effectiveRole(input.userId, input.orgId))) {
    return null;
  }
  const [source] = await loadMcpSources(input.orgId, [input.slug]);
  if (source) {
    return source.config.auth === 'person' && source.config.url ? { orgId: input.orgId, slug: source.slug, name: source.name, url: source.config.url } : null;
  }
  const { followingMcpSources } = await import('@/services/outboundMcp/followingSources');
  const yours = (await followingMcpSources({ userId: input.userId, orgId: input.orgId, personTurn: true })).find(f => f.slug === input.slug);
  return yours ? { orgId: input.orgId, slug: yours.slug, name: yours.name, url: yours.url } : null;
}
