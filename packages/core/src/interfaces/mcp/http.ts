/**
 * MCP over HTTP — the agent/tool plane, multi-tenant.
 *
 * Stdio MCP is single-tenant: one org per process, fixed by env (`bin.ts`).
 * That's right for a developer's local IDE, wrong for a hosted runtime an app
 * or a fleet of agents connects to. This module derives the org from a tenant
 * **Bearer token** (`vcn_live_…`, the same credential the write API uses), so
 * a single server process serves every tenant — each request scoped to exactly
 * the token's org, through the same `authz` principal as everything else.
 *
 * Framework-free (no `next/server`): the Next route is a thin wrapper that
 * hands the Web `Request` to a per-request transport.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TokenIdentity } from '@/services/ApiTokenService';
import { resolve } from 'node:path';
import process from 'node:process';
import { authenticateBearer } from '@/services/ApiTokenService';
import { buildServer } from './server';

/** An MCP-over-HTTP failure with the HTTP status + code the route should emit. */
export class McpHttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'McpHttpError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Derive a per-tenant MCP config from an `Authorization: Bearer …` header, or
 * throw `McpHttpError(401)`. Over HTTP the workspace-authoring tools are off by
 * default (`autoCommit`/`autoApply` false) — HTTP is the runtime/data/search
 * plane; authoring stays on stdio/CI where a per-org git workspace lives.
 * @param authHeader
 */
export async function mcpConfigForBearer(
  authHeader: string | null | undefined,
): Promise<{ config: import('./config').McpConfig; identity: TokenIdentity }> {
  const identity = await authenticateBearer(authHeader);
  if (!identity) {
    throw new McpHttpError(401, 'UNAUTHORIZED', 'Missing or invalid bearer token');
  }
  const config = {
    orgId: identity.orgId,
    contextPath: resolve(process.env.WORKSPACE_PATH ?? `workspace/${identity.orgId}`),
    autoCommit: false,
    autoApply: false,
    serverName: 'vocion',
    serverVersion: '0.1.0',
  };
  return { config, identity };
}

/**
 * Build a fresh MCP server scoped to the bearer token's org. A new server +
 * transport is created per HTTP request (the HTTP transport is stateless).
 * @param authHeader
 */
export async function buildServerForBearer(
  authHeader: string | null | undefined,
): Promise<{ server: McpServer; identity: TokenIdentity }> {
  const { config, identity } = await mcpConfigForBearer(authHeader);
  return { server: buildServer(config), identity };
}
