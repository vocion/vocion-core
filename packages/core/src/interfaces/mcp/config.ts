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
  // COMPILES_ORG_ID is the canonical env var; CORECONTEXT_ORG_ID is a legacy
  // alias kept for one release after the @compiles/core rename.
  const orgId = process.env.COMPILES_ORG_ID ?? process.env.CORECONTEXT_ORG_ID ?? process.env.SEED_ORG_ID;
  if (!orgId) {
    throw new Error('COMPILES_ORG_ID is required (or SEED_ORG_ID fallback)');
  }
  const orgName = process.env.COMPILES_ORG_NAME ?? process.env.CORECONTEXT_ORG_NAME ?? 'metacto';
  const contextPath = resolve(process.env.CONTEXT_PATH ?? `context/${orgName}`);

  return {
    orgId,
    contextPath,
    autoCommit: process.env.CONTEXT_AUTO_COMMIT !== 'false',
    autoApply: process.env.CONTEXT_AUTO_APPLY !== 'false',
    serverName: 'corecontext',
    serverVersion: '0.1.0',
  };
}
