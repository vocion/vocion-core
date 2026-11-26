/**
 * The caller identity every MCP tool module builds its service calls from.
 * Shared here so no tool module has to import a sibling tool module for it.
 */
import type { McpConfig } from '../config';
import type { Principal } from '@/services/authz';
import type { ApiCaller } from '@/services/writeApi';

/**
 * The caller the API would see: the token's principal over HTTP; on stdio
 * (one org, the developer plane) a member of that org.
 * @param config - The MCP config (its org scopes every call).
 * @param identity - Who the calls run as.
 * @param identity.userId - `token:<id>` over HTTP, `mcp` on stdio.
 * @param identity.principal - The token's principal, when the transport has one.
 */
export function mcpCaller(config: McpConfig, identity?: { userId: string; principal?: Principal }): ApiCaller {
  const actorId = identity?.userId ?? 'mcp';
  return {
    orgId: config.orgId,
    actorId,
    principal: identity?.principal ?? { kind: 'user', id: actorId, role: 'member', scope: { orgId: config.orgId } },
    source: 'token',
  };
}
