import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServerForBearer, McpHttpError } from '@/interfaces/mcp/http';

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
      return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
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
