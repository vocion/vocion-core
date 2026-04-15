import type { z } from 'zod';
import type { McpConfig } from '../config';
import { loadPlugins, pluginRegistry } from '@/libs/plugins';

/**
 * Plugin tools: discovery + dev-time reload. Reloading re-imports every
 * plugin specifier from `VOCION_PLUGINS` — Node's ESM loader caches
 * imports, so reload works well when pointing at npm packages whose code
 * hasn't changed, but edits to local-path plugins may need a server restart
 * to pick up. Good enough for v0.1.
 */

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

export function pluginTools(config: McpConfig): ToolModule[] {
  return [
    {
      name: 'plugins_list',
      title: 'List registered plugins',
      description: 'Return every skill registered via the plugin system (separate from prompt-only skills in the DB).',
      inputSchema: {},
      handler: async () => {
        return {
          plugins: pluginRegistry.listPlugins().map(p => ({ id: p.id, version: p.version, description: p.description })),
          skills: pluginRegistry.list(),
        };
      },
    },
    {
      name: 'plugins_reload',
      title: 'Re-import all plugins',
      description: 'Clear the registry and re-run plugin discovery. Use during local development after updating a plugin package. Hot-reload of edited local files is limited by Node ESM caching.',
      inputSchema: {},
      handler: async () => {
        pluginRegistry.clear();
        const result = await loadPlugins({ orgId: config.orgId });
        return result;
      },
    },
  ];
}
