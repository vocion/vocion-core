import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CORE_TOOL_NAMES, emptyTurnToolStats, noteModelToolUse, planToolLoading, resolveToolLoading, summarizePlan, TOOL_SEARCH_NOTE, toolSearchNote } from './toolLoading';
import { deferColdTools, TOOL_SEARCH } from './toolTiers';

type Meta = { toolFamily?: string; connectorTool?: boolean; alwaysLoaded?: boolean };
const make = (name: string, metadata: Meta = {}, pad = 0) => tool(async () => 'ok', { name, description: `${name} does one thing.${' x'.repeat(pad)}`, schema: z.object({ q: z.string() }), metadata });
const filler = (n: number, family = 'Decks') => Array.from({ length: n }, (_, i) => make(`${family.toLowerCase()}_${i}`, { toolFamily: family }));
const core = () => CORE_TOOL_NAMES.map(n => make(n));
const BUDGET = { maxTools: 25, maxChars: 1_000_000 };

describe('the mode a turn runs in', () => {
  it('is history unless the agent or its workspace says otherwise', () => {
    expect(resolveToolLoading(undefined)).toBe('history');
    expect(resolveToolLoading({})).toBe('history');
    expect(resolveToolLoading({ toolLoading: 'core' })).toBe('core');
    expect(resolveToolLoading({ toolLoading: 'nonsense' })).toBe('history');
  });

  it('reads the old toolSearch: false as all, and an explicit mode wins over it', () => {
    expect(resolveToolLoading({ toolSearch: false })).toBe('all');
    expect(resolveToolLoading({ toolSearch: false, toolLoading: 'core' })).toBe('core');
  });
});

describe('history mode, the default, is the behaviour from before modes', () => {
  const tools = [...core(), ...filler(30), make('generate_image', { alwaysLoaded: true })];

  it('loads everything when the agent has no history', () => {
    expect(planToolLoading({ mode: 'history', tools, hot: null, grants: [], named: [] }).keep).toBeNull();
    expect(planToolLoading({ mode: 'history', tools, hot: [], grants: ['decks_1'], named: [] }).keep).toBeNull();
  });

  it('keeps recent use, grants, named tools and always-loaded tools, and nothing of the core tier it did not use', () => {
    const plan = planToolLoading({ mode: 'history', tools, hot: ['query_state', 'decks_0'], grants: ['decks_1'], named: ['decks_2'] });

    expect([...plan.keep!].sort()).toEqual(['decks_0', 'decks_1', 'decks_2', 'generate_image', 'query_state']);
    expect(plan.keep!.has('recommend_action')).toBe(false);
    expect(toolSearchNote(plan)).toBe(TOOL_SEARCH_NOTE);
  });
});

describe('core mode', () => {
  it('loads everything when the whole catalog is within the budget', () => {
    const plan = planToolLoading({ mode: 'core', tools: [...core(), ...filler(5)], hot: null, grants: [], named: [], budget: BUDGET });

    expect(plan.keep).toBeNull();
    expect(plan.deferred).toBe(0);
  });

  it('keeps the core tier with no history at all: the write path is there from the first turn', () => {
    const plan = planToolLoading({ mode: 'core', tools: [...core(), ...filler(30)], hot: null, grants: [], named: [], budget: BUDGET });

    for (const name of CORE_TOOL_NAMES) {
      expect(plan.keep!.has(name)).toBe(true);
    }

    expect(plan.overBudget).toBe(false);
  });

  it('adds a declared connector a whole family at a time, families already in use first, and defers one that does not fit whole', () => {
    const hubspot = Array.from({ length: 6 }, (_, i) => make(`hubspot_${i}`, { toolFamily: 'HubSpot', connectorTool: true }));
    const gmail = Array.from({ length: 2 }, (_, i) => make(`gmail_${i}`, { toolFamily: 'Gmail', connectorTool: true }));
    const chat = Array.from({ length: 5 }, (_, i) => make(`chat_${i}`, { toolFamily: 'Team chat', connectorTool: true }));
    const plan = planToolLoading({ mode: 'core', tools: [...core(), ...filler(20), ...hubspot, ...gmail, ...chat], hot: ['hubspot_0'], grants: [], named: [], budget: { maxTools: 24, maxChars: 1_000_000 } });

    // 15 core + hubspot_0 from history = 16; HubSpot (in use) next: 5 more = 21; Gmail, the smaller, = 23; Team chat no longer fits.
    expect(hubspot.every(t => plan.keep!.has(t.name))).toBe(true);
    expect(gmail.every(t => plan.keep!.has(t.name))).toBe(true);
    expect(chat.some(t => plan.keep!.has(t.name))).toBe(false);
    expect(plan.searchable.map(s => s.family)).toEqual(['Decks', 'Team chat']);
    expect(plan.loaded).toBe(23);
  });

  it('keeps grants and named tools past the budget, says it is over, and still defers the rest', () => {
    const grants = Array.from({ length: 18 }, (_, i) => `granted_${i}`);
    const tools = [...core(), ...grants.map(g => make(g, { toolFamily: 'Discovery' })), ...filler(30), make('hubspot_0', { toolFamily: 'HubSpot', connectorTool: true })];
    const plan = planToolLoading({ mode: 'core', tools, hot: ['decks_0', 'decks_1'], grants, named: ['decks_9'], budget: BUDGET });

    expect(plan.overBudget).toBe(true);
    expect(grants.every(g => plan.keep!.has(g))).toBe(true);
    expect(plan.keep!.has('decks_9')).toBe(true);
    // Over the budget, history and connectors wait behind the search.
    expect(plan.keep!.has('decks_0')).toBe(false);
    expect(plan.keep!.has('hubspot_0')).toBe(false);
    expect(summarizePlan(plan)).toMatchObject({ mode: 'core', overBudget: true, loaded: 15 + 18 + 1 });
  });

  it('counts characters as well as tools', () => {
    const plan = planToolLoading({ mode: 'core', tools: [...core(), make('big', { toolFamily: 'Wiki' }, 5_000), ...filler(3)], hot: ['big'], grants: [], named: [], budget: { maxTools: 100, maxChars: 8_000 } });

    expect(plan.keep!.has('big')).toBe(false);
    expect(plan.loadedChars).toBeLessThanOrEqual(8_000);
  });

  it('tells the model what is behind the search, by family', () => {
    const plan = planToolLoading({ mode: 'core', tools: [...core(), ...filler(12), ...filler(2, 'Images')], hot: null, grants: [], named: [], budget: { maxTools: 15, maxChars: 1_000_000 } });
    const note = toolSearchNote(plan);

    expect(note.startsWith(TOOL_SEARCH_NOTE)).toBe(true);
    expect(note).toContain('- Decks: decks_0, decks_1, decks_2, decks_3, and 8 more');
    expect(note).toContain('- Images: images_0, images_1');
  });

  it('hands Anthropic exactly the plan: core tools in full, the rest deferred behind the search', () => {
    const tools = [...core(), ...filler(30)];
    const plan = planToolLoading({ mode: 'core', tools, hot: null, grants: [], named: [], budget: BUDGET });
    const search = tool(async () => '', { name: TOOL_SEARCH.name, description: 'search', schema: z.object({}), extras: { providerToolDefinition: TOOL_SEARCH } }) as unknown as ReturnType<typeof make>;
    const params = new ChatAnthropic({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' }).invocationParams({ tools: deferColdTools(tools, plan.keep!, search) } as never) as unknown as { tools: Array<Record<string, unknown>> };

    expect(params.tools.find(t => t.name === 'recommend_action')).not.toHaveProperty('defer_loading');
    expect(params.tools.find(t => t.name === 'decks_0')).toMatchObject({ defer_loading: true });
  });
});

describe('all mode', () => {
  it('defers nothing', () => {
    expect(planToolLoading({ mode: 'all', tools: [...core(), ...filler(80)], hot: ['decks_0'], grants: [], named: [] }).keep).toBeNull();
  });
});

describe('what a turn did with its tools', () => {
  it('counts the searches the model ran and calls to tools the turn does not have', () => {
    const stats = emptyTurnToolStats();
    noteModelToolUse(stats, {
      content: [
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'tool_search_tool_bm25', input: { query: 'chart' } },
        { type: 'tool_use', id: 'toolu_1', name: 'render_chart', input: {} },
      ],
      tool_calls: [{ name: 'render_chart' }, { name: 'update_deal' }],
    }, new Set(['render_chart']));
    noteModelToolUse(stats, { content: 'plain answer' }, new Set());

    expect(stats).toEqual({ searches: 1, unknownTools: 1, toolErrors: 0 });
  });
});
