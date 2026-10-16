import type { Action } from './types';

/** Source scope is narrowed per request; a connector name is not a credential check. */
export type ActionSourceScope = {
  connectorSources: readonly string[];
  sourceKinds?: Record<string, string>;
  allowedSourceSlugs?: readonly string[];
};

/**
 * Sources available to both the agent and the person, never another workspace.
 * @param scope
 */
function sources(scope: ActionSourceScope): Array<{ slug: string; kind: string }> {
  return (scope.connectorSources ?? [])
    .filter(slug => !scope.allowedSourceSlugs || scope.allowedSourceSlugs.includes(slug))
    .map(slug => ({ slug, kind: scope.sourceKinds?.[slug] ?? slug }));
}

/**
 * Hide native actions that cannot use any source in this scope. Execution still checks credentials.
 * @param action
 * @param scope
 */
export function actionInSourceScope(action: Pick<Action, 'sourceKinds'>, scope: ActionSourceScope): boolean {
  return !action.sourceKinds?.length || sources(scope).some(source => action.sourceKinds!.includes(source.kind));
}

/**
 * A wrong interface is not a broken connection; return the next supported discovery step.
 * @param action
 * @param scope
 */
export function actionConnectionGuidance(action: Pick<Action, 'id' | 'sourceKinds'>, scope: ActionSourceScope): string | undefined {
  if (actionInSourceScope(action, scope)) {
    return undefined;
  }
  const mcp = sources(scope).filter(source => source.kind === 'mcp');
  const needed = action.sourceKinds!.join(', ');
  const setup = `If no assigned source supplies the requested capability, use list_capabilities to find the appropriate connector and offer_connection to show its setup card. For an existing source needing authentication, link its reconnect step with where_to. Do not ask for credentials in chat.`;
  if (mcp.length) {
    return `${action.id} is a native action for ${needed}, not an action for the assigned MCP source(s): ${mcp.map(source => source.slug).join(', ')}. Discover their declared tools with mcp_list_tools; use mcp_read for reads and propose mcp.call for a declared write, using its exact schema. A native-interface mismatch is not evidence that MCP is disconnected. ${setup}`;
  }
  return `${action.id} needs an assigned ${needed} source; none is available to this agent and person. Nothing was proposed or changed. Check describe_sources for an existing connection and its access before asking for a new connection. ${setup}`;
}
