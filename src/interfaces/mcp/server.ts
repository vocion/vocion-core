import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpConfig } from './config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { contextTools } from './tools/context-tools';
import { dataTools } from './tools/data-tools';
import { pluginTools } from './tools/plugin-tools';
import { runtimeTools, skillRunDetailTool } from './tools/runtime-tools';

/**
 * Create an MCP server wired to the CoreContext runtime.
 *
 * Exposes ~15 tools grouped as:
 *   - context_* : list/get/write/delete/apply/diff/version_history
 *   - runtime_* : run_skill/list_runs/get_run/approve_draft/reject_draft
 *   - objects_* / object_types_* / search_* : read data + search via Onyx
 *
 * Writes auto-commit + auto-apply by default; override per-call with
 * `autoApply: false` / `autoCommit: false`.
 * @param config
 */
export function buildServer(config: McpConfig): McpServer {
  const server = new McpServer(
    { name: config.serverName, version: config.serverVersion },
    { capabilities: { tools: {} } },
  );

  const tools = [
    ...contextTools(config),
    ...runtimeTools(config),
    skillRunDetailTool(config),
    ...dataTools(config),
    ...pluginTools(config),
  ];

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (input: unknown) => {
        try {
          const result = await tool.handler((input ?? {}) as Record<string, unknown>);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [{ type: 'text', text: message }],
          };
        }
      },
    );
  }

  return server;
}

/**
 * Connect a transport and start serving. Caller owns process lifecycle
 * (bin.ts wires SIGINT/SIGTERM for clean shutdown).
 * @param transport
 * @param config
 */
export async function startServer(transport: Transport, config: McpConfig): Promise<McpServer> {
  const server = buildServer(config);
  await server.connect(transport);
  return server;
}
