/**
 * list_capabilities — what this workspace COULD turn on, and what it has.
 *
 * Chris, 2026-09-18: "chat also has some context of what plugins or apps or
 * modules are available and will start to recommend them being enabled, same
 * with connectors, if the chat pattern indicates they would be useful."
 *
 * The system prompt carries a one-line note per plugin that is off (built in
 * `harness.ts` from the same catalogue); this tool is the full read the agent
 * makes when a conversation touches one: every plugin with whether it is on,
 * what it adds and when it helps, and every connector this core ships with
 * whether the workspace has connected it. Enabling is the `plugin.enable`
 * action (recommend it as a one-tap card); connecting is a person's move —
 * `where_to connect-source` gives the link.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listConnectors } from '@/libs/sources/registry';
import { listPlugins } from '@/libs/workspace/plugins';
import { listSources } from '@/services/SourceSyncService';

export function listCapabilitiesTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const enabled = new Set(ctx.enabledPlugins ?? []);
      const plugins = listPlugins().map((p) => {
        const on = enabled.has(p.manifest.slug);
        const adds = [
          p.contents.agents.length ? `${p.contents.agents.length} agents` : null,
          p.contents.skills.length ? `${p.contents.skills.length} skills` : null,
          p.contents.pages.length ? `${p.contents.pages.length} pages` : null,
          p.contents.automations.length ? `${p.contents.automations.length} automations` : null,
        ].filter(Boolean).join(', ');
        return `- ${p.manifest.name} (${p.manifest.slug}) — ${on ? 'ON' : 'off'}. ${p.manifest.description}${adds ? ` Adds ${adds}.` : ''}${p.manifest.recommend.when.length ? ` Helps when: ${p.manifest.recommend.when.join('; ')}.` : ''}${p.manifest.recommend.connectors.length ? ` Works best with: ${p.manifest.recommend.connectors.join(', ')}.` : ''}${p.manifest.depends.length ? ` Needs: ${p.manifest.depends.join(', ')}.` : ''}`;
      });
      const connected = new Set((await listSources(ctx.orgId)).map(s => s.kind ?? s.slug));
      const connectors = listConnectors().map(c => `- ${c.name ?? c.slug} (${c.slug}) — ${connected.has(c.slug) ? 'connected' : 'not connected'}`);
      return [
        'PLUGINS (turn one on with recommend_action → plugin.enable {slug}; a person can also do it in the Plugins section of /dashboard/marketplace):',
        ...plugins,
        '',
        'CONNECTORS (a person connects at /dashboard/connectors — use where_to connect-source for the link):',
        ...connectors,
      ].join('\n');
    },
    {
      name: 'list_capabilities',
      description: 'What this workspace could turn on: every plugin (wiki, data rooms, proposals…) with whether it is on, what it adds and when it helps, and every connector with whether it is connected. Call it when a conversation asks for something a plugin or connector would do better — then recommend turning it on (recommend_action with plugin.enable) or connecting (where_to), instead of working around the gap.',
      schema: z.object({}),
    },
  );
}
