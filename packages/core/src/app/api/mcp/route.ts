import type { NextRequest } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServerForBearer, McpHttpError } from '@/interfaces/mcp/http';
import { publicOrigin } from '@/libs/http/publicOrigin';

/**
 * POST/GET/DELETE /api/mcp
 *
 * MCP over Streamable HTTP, multi-tenant. Authenticate with a tenant Bearer
 * token (`Authorization: Bearer vcn_live_…`); the server is scoped to that
 * token's org. Stateless — a fresh server + transport per request — using the
 * SDK's Web-standard transport (`Request` in, `Response` out), so it runs
 * directly in the Next route with no Node req/res bridge.
 *
 * Point any MCP client at `https://your-install/api/mcp` with the Bearer
 * header (e.g. Claude/Cursor/Zed remote-server config).
 * @param req
 */
async function handle(req: Request): Promise<Response> {
  let server;
  try {
    ({ server } = await buildServerForBearer(req.headers.get('authorization')));
  } catch (e) {
    if (e instanceof McpHttpError) {
      // The MCP authorization spec: a 401 names where to sign in, so an
      // assistant that arrived with no token starts the OAuth flow itself
      // (backlog 027). The metadata URL carries the resource's path.
      const headers: Record<string, string> = {};
      if (e.status === 401) {
        const origin = publicOrigin(req as NextRequest);
        headers['WWW-Authenticate'] = `Bearer realm="vocion", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`;
      }
      return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers });
    }
    throw e;
  }

  // Stateless: one fresh transport per request (reuse would collide message ids).
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
