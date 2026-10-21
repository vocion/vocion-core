import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Ajv from 'ajv';
import { resolvesPublicly } from '@/libs/net/publicUrl';

class McpToolFailure extends Error {}

/** The server refused the credential (401/403): for a per-person source, the person signs in again. */
export class McpUnauthorized extends Error {}

export type McpCredentials = { baseUrl: string; token: string };

/**
 * Validate the vaulted endpoint; model arguments never select a host.
 * @param raw - The decrypted endpoint and token.
 */
export function mcpCredentialsOf(raw: Record<string, unknown> | undefined): McpCredentials {
  if (typeof raw?.baseUrl !== 'string' || typeof raw.token !== 'string' || !raw.token) {
    throw new Error('Connect an MCP endpoint and bearer token first.');
  }
  const url = new URL(raw.baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    throw new Error('MCP requires an HTTPS endpoint without embedded credentials, query or fragment.');
  }
  return { baseUrl: url.toString(), token: raw.token };
}

/**
 * One authenticated session per operation; no credentials or clients cross tenants.
 * @param credentials - Credentials for this source only.
 * @param work - The operation to run in this session.
 */
export async function withMcp<T>(credentials: McpCredentials, work: (client: Client) => Promise<T>): Promise<T> {
  if (!(await resolvesPublicly(credentials.baseUrl)).ok) {
    throw new Error('MCP endpoint must resolve to a public address.');
  }
  const client = new Client({ name: 'vocion', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(credentials.baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${credentials.token}` }, redirect: 'error' },
  });
  try {
    await client.connect(transport, { timeout: 30_000 });
    return await work(client);
  } catch (error) {
    if (error instanceof McpToolFailure) {
      throw error;
    }
    if (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403)) {
      throw new McpUnauthorized(`MCP server refused the credential (${error.code}).`);
    }
    // SDK transport exceptions can contain response bodies; do not send secrets to the ledger.
    throw new Error('MCP request failed. A submitted write may have succeeded; inspect provider state before retrying.');
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Follow bounded discovery pagination rather than silently hiding write tools.
 * @param client - The connected MCP client.
 */
export async function listMcpTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await client.listTools(cursor ? { cursor } : undefined, { timeout: 30_000 });
    tools.push(...result.tools);
    cursor = result.nextCursor;
    if (!cursor) {
      return tools;
    }
  }
  throw new Error('MCP discovery exceeded 20 pages.');
}

/**
 * Provider schemas are checked before a call; unknown keywords do not grant authority.
 * @param remote - The discovered tool contract.
 * @param input - The exact arguments to validate or execute.
 */
export function validateMcpInput(remote: Tool, input: Record<string, unknown>): void {
  const validate = new Ajv({ strict: false, allErrors: true }).compile(remote.inputSchema);
  if (!validate(input)) {
    throw new Error(`Arguments do not match the schema for ${remote.name}.`);
  }
}

/**
 * MCP protocol success may still contain a tool error. Never mark that execution done.
 * @param client - The connected MCP client.
 * @param remote - The discovered tool contract.
 * @param input - The exact arguments to validate or execute.
 */
export async function callMcpTool(client: Client, remote: Tool, input: Record<string, unknown>) {
  validateMcpInput(remote, input);
  const result = await client.callTool({ name: remote.name, arguments: input }, undefined, { timeout: 60_000 });
  if (result.isError) {
    throw new McpToolFailure('MCP tool reported failure. This execution is not pending. Inspect the provider write receipt and current record before proposing a recovery; do not reuse an idempotency key with different arguments.');
  }
  return result;
}
