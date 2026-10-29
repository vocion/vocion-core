/**
 * The tool catalog's caps, held in CI (ADR 0009). No model call: the catalog
 * is built from configuration and measured as the model would receive it.
 *
 * A failure here means a change made the catalog bigger than the caps allow.
 * Shorten what was added. Raise a cap only with a reason in the ADR.
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadWorkspace } from '@/libs/workspace/loader';
import { EVAL_AGENTS } from '@/services/evals/agentBehaviour/dataset';
import { CORE_TOOL_NAMES, TOOL_BUDGET, toolDefinitionChars } from './toolLoading';
import { catalogContext, measureCatalog } from './toolMeasure';
import { buildDomainTools } from './tools/registry';

/** No one tool's definition (name, description, input schema) past this. The largest, update_project, is 8.7k. */
const MAX_TOOL_DEFINITION_CHARS = 9_000;
/** No one description past this. The largest, query_state, is 4.0k and carries the state catalog. */
const MAX_DESCRIPTION_CHARS = 4_500;
/** The whole catalog of an agent with every common connector: 175k characters, about 70k tokens, on 2026-10-29. */
const MAX_CATALOG_CHARS = 180_000;

const EVERYTHING = { slug: 'every-connector', connectorSources: ['hubspot', 'gmail', 'drive', 'google-calendar', 'zoom', 'slack'], grantTools: [], enabledPlugins: ['wiki'] };

const TEMPLATES = resolve(__dirname, '../../../templates/workspaces');

function templateAgents() {
  return readdirSync(TEMPLATES, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'fixtures')
    .flatMap((d) => {
      const ws = loadWorkspace(join(TEMPLATES, d.name)) as unknown as { enabledPlugins?: string[]; agents: Array<{ slug: string; resolvedSystemPrompt?: string; connectorSources?: string[]; harness?: { grantTools?: string[] } }> };
      return ws.agents.map(a => ({ slug: `${d.name}/${a.slug}`, systemPrompt: a.resolvedSystemPrompt ?? null, connectorSources: a.connectorSources ?? [], grantTools: a.harness?.grantTools ?? [], enabledPlugins: ws.enabledPlugins ?? [] }));
    });
}

describe('the tool catalog stays under its caps', () => {
  const tools = buildDomainTools(catalogContext(EVERYTHING));

  it('has no tool definition and no description past its cap', () => {
    const over = tools
      .map(t => ({ name: t.name, chars: toolDefinitionChars(t), description: (t.description ?? '').length }))
      .filter(t => t.chars > MAX_TOOL_DEFINITION_CHARS || t.description > MAX_DESCRIPTION_CHARS);

    expect(over).toEqual([]);
  });

  it('keeps the whole catalog under its cap', () => {
    expect(tools.reduce((n, t) => n + toolDefinitionChars(t), 0)).toBeLessThanOrEqual(MAX_CATALOG_CHARS);
  });

  it('builds every core-tier tool for every agent', () => {
    const names = new Set(tools.map(t => t.name));

    expect(CORE_TOOL_NAMES.filter(n => !names.has(n))).toEqual([]);
  });
});

describe('core loading fits the budget for every shipped agent', () => {
  const agents = [...templateAgents(), ...EVAL_AGENTS];

  it.each(agents.map(a => [a.slug, a] as const))('%s', (_slug, agent) => {
    const { modes } = measureCatalog(agent);

    if (modes.core.deferred > 0 && !modes.core.overBudget) {
      expect(modes.core.loaded).toBeLessThanOrEqual(TOOL_BUDGET.maxTools);
      expect(modes.core.loadedChars).toBeLessThanOrEqual(TOOL_BUDGET.maxChars);
    }

    // Over the budget is allowed only when grants and named tools alone put
    // it there (ADR 0009); no shipped agent is.
    expect(modes.core.overBudget).toBe(false);
  });
});
