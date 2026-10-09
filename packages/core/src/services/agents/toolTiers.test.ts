import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { deferColdTools, hotFrom, TOOL_SEARCH } from './toolTiers';

const make = (name: string) => tool(async () => 'ok', { name, description: `${name} does one thing.`, schema: z.object({ q: z.string() }) });

describe('which tools a turn carries in full', () => {
  it('keeps the tools that cover nine calls in ten, at least four and at most twelve', () => {
    expect(hotFrom([
      { tool: 'lookup_objects', calls: 492 },
      { tool: 'read_object', calls: 201 },
      { tool: 'read_wiki_page', calls: 175 },
      { tool: 'search_knowledge', calls: 134 },
      { tool: 'render_record', calls: 7 },
      { tool: 'generate_image', calls: 3 },
    ])).toEqual(['lookup_objects', 'read_object', 'read_wiki_page', 'search_knowledge']);
    expect(hotFrom([{ tool: 'a', calls: 1 }])).toEqual(['a']);
    expect(hotFrom([])).toEqual([]);
  });

  it('defers every other tool and adds the search, and Anthropic receives exactly that', () => {
    const search = tool(async () => '', { name: TOOL_SEARCH.name, description: 'search', schema: z.object({}), extras: { providerToolDefinition: TOOL_SEARCH } }) as unknown as ReturnType<typeof make>;
    const tools = deferColdTools([make('lookup_objects'), make('generate_image')], new Set(['lookup_objects']), search);
    const params = new ChatAnthropic({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' }).invocationParams({ tools } as never) as unknown as { tools: Array<Record<string, unknown>> };

    expect(params.tools.find(t => t.name === 'lookup_objects')).not.toHaveProperty('defer_loading');
    expect(params.tools.find(t => t.name === 'generate_image')).toMatchObject({ defer_loading: true });
    expect(params.tools.find(t => t.name === TOOL_SEARCH.name)).toEqual(TOOL_SEARCH);
  });

  it('never defers a tool that says it must always be loaded, whatever its history', () => {
    const search = tool(async () => '', { name: TOOL_SEARCH.name, description: 'search', schema: z.object({}), extras: { providerToolDefinition: TOOL_SEARCH } }) as unknown as ReturnType<typeof make>;
    const always = tool(async () => '', { name: 'query_state', description: 'state', schema: z.object({}), metadata: { alwaysLoaded: true } }) as unknown as ReturnType<typeof make>;
    const tools = deferColdTools([make('lookup_objects'), always], new Set(['lookup_objects']), search);
    const params = new ChatAnthropic({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' }).invocationParams({ tools } as never) as unknown as { tools: Array<Record<string, unknown>> };

    expect(params.tools.find(t => t.name === 'query_state')).not.toHaveProperty('defer_loading');
  });
});

describe('a search step goes back to the model whole', () => {
  it('keeps the search, its result and the found tool\'s call in the next request (live shapes, 2026-10-04)', async () => {
    const { AIMessage, HumanMessage, ToolMessage } = await import('@langchain/core/messages');
    const turn = [
      new HumanMessage('Make a picture of a red stamp on an envelope for our launch post.'),
      new AIMessage({
        content: [
          { type: 'text', text: 'Let me search for an image generation tool.' },
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'tool_search_tool_bm25', input: { query: 'generate image picture' } },
          { type: 'tool_search_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'tool_search_tool_search_result', tool_references: [{ type: 'tool_reference', tool_name: 'generate_image' }] } },
          { type: 'tool_use', id: 'toolu_1', name: 'generate_image', input: { query: 'A red stamp on a white envelope' } },
        ] as never,
        tool_calls: [{ id: 'toolu_1', name: 'generate_image', args: { query: 'A red stamp on a white envelope' } }],
      }),
      new ToolMessage({ tool_call_id: 'toolu_1', content: 'Image created: artifact 812.' }),
    ];
    // What the next model call actually sends, captured at the HTTP boundary.
    let body: { messages: Array<{ role: string; content: Array<{ type: string }> }> } | null = null;
    const model = new ChatAnthropic({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-6',
      clientOptions: {
        fetch: (async (_url: string, init: { body: string }) => {
          body = JSON.parse(init.body);
          return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'Here it is.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
        }) as never,
      },
    });
    await model.invoke(turn);
    const types = body!.messages.find(m => m.role === 'assistant')!.content.map(c => c.type);

    expect(types).toEqual(['text', 'server_tool_use', 'tool_search_tool_result', 'tool_use']);
  });
});
