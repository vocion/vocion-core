import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpConfig } from './config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { agentTools } from './tools/agent-tools';
import { capabilityTools } from './tools/capability-tools';
import { dataTools } from './tools/data-tools';
import { missionTools } from './tools/mission-tools';
import { playbookTools } from './tools/playbook-tools';
import { pluginTools } from './tools/plugin-tools';
import { runtimeTools, skillRunDetailTool } from './tools/runtime-tools';
import { teamsTools } from './tools/teams-tools';
import { workflowTools } from './tools/workflow-tools';
import { workspaceTools } from './tools/workspace-tools';

/**
 * Create an MCP server wired to the Vocion runtime.
 *
 * Exposes ~15 tools grouped as:
 *   - context_* : list/get/write/delete/apply/diff/version_history
 *   - runtime_* : run_skill/list_runs/get_run/approve_draft/reject_draft
 *   - objects_* / object_types_* / search_* : read data + hybrid retrieval
 *   - teams_* : the F1 org chart (workspace lead + teams with provenance)
 *
 * Writes auto-commit + auto-apply by default; override per-call with
 * `autoApply: false` / `autoCommit: false`.
 *
 * Async because the agent-tools bridge resolves the default agent row at
 * build time (per-process on stdio; per-request over HTTP, matching the
 * stateless transport). `identity` names who the bridged domain tools run
 * as (`ctx.userId`): `'mcp'` on stdio, `token:<id>` over HTTP.
 * @param config
 * @param identity
 * @param identity.userId
 */
export async function buildServer(
  config: McpConfig,
  identity?: { userId: string },
): Promise<McpServer> {
  const server = new McpServer(
    { name: config.serverName, version: config.serverVersion },
    { capabilities: { tools: {} } },
  );

  const tools = [
    ...workspaceTools(config),
    ...runtimeTools(config),
    skillRunDetailTool(config),
    ...dataTools(config),
    ...capabilityTools(config),
    ...missionTools(config),
    ...teamsTools(config),
    ...pluginTools(config),
    ...workflowTools(config),
    ...playbookTools(config),
    ...(await agentTools(config, identity)),
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
  // stdio is the developer plane — the domain tools run as the generic 'mcp' user.
  const server = await buildServer(config, { userId: 'mcp' });
  await server.connect(transport);
  return server;
}
