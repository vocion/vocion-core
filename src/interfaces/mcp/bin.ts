#!/usr/bin/env tsx
import process from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadPlugins } from '@/libs/plugins';
import { readConfig } from './config';
import { startServer } from './server';
import 'dotenv/config';

/**
 * stdio entrypoint for the CoreContext MCP server.
 *
 * Wire into Claude Code with:
 *   claude mcp add corecontext -- npm --prefix /path/to/context-stack run mcp:serve
 *
 * Or directly in an `.mcp.json` / Claude Desktop config:
 *   { "command": "npm", "args": ["--prefix", "/abs/path", "run", "mcp:serve"] }
 */
async function main(): Promise<void> {
  const config = readConfig();

  // Discover + register plugins before accepting connections so the first
  // tool call sees the full catalog.
  const pluginResult = await loadPlugins({ orgId: config.orgId });
  for (const err of pluginResult.errors) {
    console.error(`[corecontext-mcp] plugin error: ${err.source} — ${err.message}`);
  }

  const transport = new StdioServerTransport();
  const server = await startServer(transport, config);

  const shutdown = async (): Promise<void> => {
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[corecontext-mcp] failed to start:', err);
  process.exit(1);
});
