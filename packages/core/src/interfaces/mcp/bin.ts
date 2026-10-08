#!/usr/bin/env tsx
import process from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadPlugins } from '@/libs/plugins';
import { flushAccessLog } from '@/services/access/accessLog';
import { readConfig } from './config';
import { startServer } from './server';
import 'dotenv/config';

/**
 * stdio entrypoint for the Vocion MCP server.
 *
 * Wire into Claude Code with:
 *   claude mcp add vocion -- npm --prefix /path/to/vocion run mcp:serve
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
    console.error(`[vocion-mcp] plugin error: ${err.source} — ${err.message}`);
  }

  const transport = new StdioServerTransport();
  const server = await startServer(transport, config);

  const shutdown = async (): Promise<void> => {
    try {
      await server.close();
      // The reads this session's tools noted are still buffered: write them
      // before the process goes (the log says how many, if it cannot).
      await flushAccessLog();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[vocion-mcp] failed to start:', err);
  process.exit(1);
});
