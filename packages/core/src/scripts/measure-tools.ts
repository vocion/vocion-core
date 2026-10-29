import type { CatalogAgent, CatalogReport } from '@/services/agents/toolMeasure';
/**
 * How big each agent's tool catalog is, and what each loading mode would
 * load (ADR 0009, `services/agents/toolMeasure.ts`).
 *
 *   tsx --tsconfig ./tsconfig.json src/scripts/measure-tools.ts [workspace-dir ...] [--json out.json]
 *
 * With no directory it measures the template workspaces and the
 * `agent-behaviour` eval agents. Pass a workspace repo's directories to
 * measure real agents. Prints a table; `--json` writes every number. Makes
 * no model call and reads no database.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { loadWorkspace } from '@/libs/workspace/loader';
import { measureCatalog } from '@/services/agents/toolMeasure';
import { EVAL_AGENTS } from '@/services/evals/agentBehaviour/dataset';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: 'string' } } });

/**
 * Every agent a workspace directory declares, as the catalog sees it.
 * @param dir - A directory holding `workspace.yaml`.
 */
export function workspaceAgents(dir: string): CatalogAgent[] {
  const ws = loadWorkspace(dir) as unknown as { enabledPlugins?: string[]; agents: Array<{ slug: string; resolvedSystemPrompt?: string; connectorSources?: string[]; harness?: { grantTools?: string[] } }> };
  return ws.agents.map(a => ({
    slug: a.slug,
    systemPrompt: a.resolvedSystemPrompt ?? null,
    connectorSources: a.connectorSources ?? [],
    grantTools: a.harness?.grantTools ?? [],
    enabledPlugins: ws.enabledPlugins ?? [],
  }));
}

function main(): void {
  const templates = resolve(process.cwd(), 'templates/workspaces');
  const dirs = positionals.length
    ? positionals
    : readdirSync(templates, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'fixtures').map(d => join(templates, d.name));
  const reports: Array<CatalogReport & { workspace: string }> = [];
  for (const dir of dirs) {
    for (const agent of workspaceAgents(dir)) {
      reports.push({ workspace: dir.split('/').pop()!, ...measureCatalog(agent) });
    }
  }
  if (!positionals.length) {
    for (const agent of EVAL_AGENTS) {
      reports.push({ workspace: 'agent-behaviour eval', ...measureCatalog(agent) });
    }
  }
  console.table(reports.map(r => ({
    workspace: r.workspace,
    agent: r.slug,
    tools: r.tools,
    kChars: (r.chars / 1000).toFixed(0),
    kTokens: (r.tokens / 1000).toFixed(1),
    history: r.modes.history.deferred ? `${r.modes.history.loaded} loaded` : 'all',
    core: r.modes.core.deferred ? `${r.modes.core.loaded} loaded, ${(r.modes.core.loadedChars / 1000).toFixed(0)}k chars${r.modes.core.overBudget ? ' (over budget)' : ''}` : 'all',
  })));
  if (values.json) {
    writeFileSync(values.json, JSON.stringify(reports, null, 2));
    console.log(`wrote ${values.json}`);
  }
}

main();
