import type { PersonMcpSource } from '@/services/outboundMcp/personSignIn';
import { loadMcpSources } from '@/libs/outboundMcp/sources';
import { effectiveRole } from '@/services/WorkspaceAccessService';

/**
 * A per-person MCP source the person may sign in to: it exists in a workspace
 * they can open and is declared `auth: person`. Null otherwise.
 * @param input - The person, the workspace and the source slug.
 * @param input.userId - The signed-in person.
 * @param input.orgId - The workspace (`project.id`).
 * @param input.slug - The source slug.
 */
export async function personMcpSourceFor(input: { userId: string; orgId: string; slug: string }): Promise<PersonMcpSource | null> {
  if (!(await effectiveRole(input.userId, input.orgId))) {
    return null;
  }
  const [source] = await loadMcpSources(input.orgId, [input.slug]);
  if (!source || source.config.auth !== 'person' || !source.config.url) {
    return null;
  }
  return { orgId: input.orgId, slug: source.slug, name: source.name, url: source.config.url };
}
