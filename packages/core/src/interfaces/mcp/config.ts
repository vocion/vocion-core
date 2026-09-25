import { resolve } from 'node:path';
import process from 'node:process';

/**
 * MCP server runtime config. Stdio transport is single-tenant — one org per process.
 * HTTP transport (future) will derive orgId from bearer/OAuth instead.
 */
export type McpConfig = {
  orgId: string;
  contextPath: string;
  /**
   * Whether `contextPath` is the CALLER's workspace checkout.
   *
   * True on stdio/CI, where the process serves one org and the path is chosen
   * for it. False on HTTP, where one process serves every org and the path is
   * whatever `WORKSPACE_PATH` names — one org's folder for all of them. The
   * disk-backed workspace tools are omitted when this is false; see
   * `tools/workspace-tools.ts`.
   */
  diskWorkspace: boolean;
  autoCommit: boolean;
  autoApply: boolean;
  serverName: string;
  serverVersion: string;
  /**
   * Default agent for the bridged domain tools (`tools/agent-tools.ts`).
   * Unset → the org's workspace lead (`project.leadAgentSlug`).
   */
  agentSlug?: string;
};

export function readConfig(): McpConfig {
  const orgId = process.env.VOCION_ORG_ID ?? process.env.SEED_ORG_ID;
  if (!orgId) {
    throw new Error('VOCION_ORG_ID is required (or SEED_ORG_ID fallback)');
  }
  const orgName = process.env.VOCION_ORG_NAME ?? 'metacto';
  const contextPath = resolve(process.env.WORKSPACE_PATH ?? `workspace/${orgName}`);

  return {
    orgId,
    contextPath,
    // Stdio is single-tenant: this process was started for one org and
    // WORKSPACE_PATH was chosen for that org.
    diskWorkspace: true,
    autoCommit: process.env.WORKSPACE_AUTO_COMMIT !== 'false',
    autoApply: process.env.WORKSPACE_AUTO_APPLY !== 'false',
    serverName: 'vocion',
    serverVersion: '0.1.0',
    agentSlug: process.env.VOCION_MCP_AGENT_SLUG || undefined,
  };
}
