import { resolve } from 'node:path';
import process from 'node:process';

/**
 * MCP server runtime config. Stdio transport is single-tenant — one org per process.
 * HTTP transport (future) will derive orgId from bearer/OAuth instead.
 */
export type McpConfig = {
  orgId: string;
  contextPath: string;
  autoCommit: boolean;
  autoApply: boolean;
  serverName: string;
  serverVersion: string;
};

export function readConfig(): McpConfig {
  const orgId = process.env.CORECONTEXT_ORG_ID ?? process.env.SEED_ORG_ID;
  if (!orgId) {
    throw new Error('CORECONTEXT_ORG_ID is required (or SEED_ORG_ID fallback)');
  }
  const contextPath = resolve(process.env.CONTEXT_PATH ?? `context/${process.env.CORECONTEXT_ORG_NAME ?? 'metacto'}`);

  return {
    orgId,
    contextPath,
    autoCommit: process.env.CONTEXT_AUTO_COMMIT !== 'false',
    autoApply: process.env.CONTEXT_AUTO_APPLY !== 'false',
    serverName: 'corecontext',
    serverVersion: '0.1.0',
  };
}
