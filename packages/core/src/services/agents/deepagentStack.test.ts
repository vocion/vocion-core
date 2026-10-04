import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { createDeepAgent } from 'deepagents';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * What a chat turn's first model call carries, from the agent stack itself
 * (deepagents 1.14). Captured at the HTTP boundary, so a framework upgrade
 * that adds or drops a built-in shows up here, not in production.
 */
describe('the agent stack a turn runs on', () => {
  it('carries our tools, the file tools and task — and no to-do list (conversation 471: write_todos cost steps and a second summary)', async () => {
    let body: { tools: Array<{ name: string }>; system?: unknown } | null = null;
    const model = new ChatAnthropic({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-6',
      clientOptions: {
        fetch: (async (_url: string, init: { body: string }) => {
          body = JSON.parse(init.body);
          return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
        }) as never,
      },
    });
    const lookup = tool(async () => '[]', { name: 'lookup_objects', description: 'List records.', schema: z.object({ type: z.string() }) });
    const graph = createDeepAgent({ model, tools: [lookup], systemPrompt: 'You are the product manager.', subagents: [{ name: 'researcher', description: 'Researches.', systemPrompt: 'Research.' }] });

    await graph.invoke({ messages: [{ role: 'user', content: 'What shipped this week?' }] });
    const names = body!.tools.map(t => t.name);

    expect(names).toContain('lookup_objects');
    expect(names).toContain('task');
    expect(names).toContain('read_file');
    expect(names).not.toContain('write_todos');
    expect(JSON.stringify(body!.system)).not.toContain('write_todos');
  });
});
