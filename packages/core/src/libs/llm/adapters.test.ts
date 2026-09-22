import { describe, expect, it, vi } from 'vitest';
import { anthropicClient } from './anthropic';
import { openaiClient } from './openai';

/**
 * Adapter tests — pass mock SDK clients through the generic LLMClient
 * shape and assert request/response translation. Does not hit real APIs.
 */

describe('openai adapter', () => {
  it('maps LLMOptions to chat.completions.create and unwraps the response', async () => {
    const create = vi.fn(async () => ({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
    const mockOpenai = { chat: { completions: { create } } } as never;
    const client = openaiClient(mockOpenai);

    const result = await client.generate({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      maxTokens: 100,
    });

    expect(result.content).toBe('hello');
    expect(result.finishReason).toBe('stop');
    expect(result.usage?.inputTokens).toBe(10);
    expect(result.usage?.outputTokens).toBe(5);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o',
      temperature: 0.2,
      max_completion_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
    }));
  });

  it('forwards response_format when json_object is requested', async () => {
    const create = vi.fn(async () => ({ choices: [{ message: { content: '{}' } }], usage: {} }));
    const client = openaiClient({ chat: { completions: { create } } } as never);

    await client.generate({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
      responseFormat: 'json_object',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      response_format: { type: 'json_object' },
    }));
  });
});

describe('anthropic adapter', () => {
  it('splits system messages, forwards user/assistant turns, and flattens text blocks', async () => {
    const create = vi.fn(async () => ({
      content: [{ type: 'text', text: 'hello back' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 8, output_tokens: 3 },
    }));
    const client = anthropicClient({ messages: { create } } as never);

    const result = await client.generate({
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'system', content: 'you are terse' },
        { role: 'user', content: 'hi' },
      ],
      maxTokens: 64,
    });

    expect(result.content).toBe('hello back');
    expect(result.finishReason).toBe('end_turn');
    expect(result.usage?.inputTokens).toBe(8);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-sonnet-4-5',
      // The system prompt goes as a block, not a bare string, because that is
      // the only shape that can carry `cache_control` — see promptCache.ts.
      system: [{ type: 'text', text: 'you are terse', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 64,
    }));
  });

  it('appends a JSON hint to the system prompt when json_object is requested', async () => {
    const create = vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }], usage: {} }));
    const client = anthropicClient({ messages: { create } } as never);

    await client.generate({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'give json' }],
      responseFormat: 'json_object',
    });

    const calls = create.mock.calls as Array<Array<{ system?: Array<{ text: string }> }>>;
    const firstArg = calls[0]?.[0];

    expect(firstArg?.system?.[0]?.text).toMatch(/valid JSON object/i);
  });

  it('marks the system prompt cacheable, and drops the mark when asked not to', async () => {
    // The system prompt is the part that repeats between one-shot calls — the
    // schema, the rules, the few-shot examples — so it is the block worth
    // caching. `promptCache: false` is for a prompt that must not sit in the
    // vendor's cache at all.
    const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], usage: {} }));
    const client = anthropicClient({ messages: { create } } as never);
    const messages = [
      { role: 'system' as const, content: 'rules and examples' },
      { role: 'user' as const, content: 'go' },
    ];

    await client.generate({ model: 'claude-sonnet-4-5', messages });
    await client.generate({ model: 'claude-sonnet-4-5', messages, promptCache: false });

    const calls = create.mock.calls as Array<Array<{ system?: unknown }>>;

    expect(calls[0]?.[0]?.system).toEqual([
      { type: 'text', text: 'rules and examples', cache_control: { type: 'ephemeral' } },
    ]);
    expect(calls[1]?.[0]?.system).toBe('rules and examples');
  });

  it('counts cached tokens as part of the input side', async () => {
    // Anthropic reports `input_tokens` as the UNCACHED remainder. Reading it
    // straight through would make a warm turn look 10x cheaper in tokens than
    // it was, and the token cap would stop binding.
    const create = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 21, output_tokens: 7, cache_read_input_tokens: 3_163, cache_creation_input_tokens: 0 },
    }));
    const client = anthropicClient({ messages: { create } } as never);

    const result = await client.generate({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'go' }] });

    expect(result.usage?.inputTokens).toBe(3_184);
    expect(result.usage?.cacheReadTokens).toBe(3_163);
  });

  it('ignores non-text content blocks (e.g. thinking) in the flattened output', async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: 'thinking', thinking: 'internal reasoning' },
        { type: 'text', text: 'the answer is 42' },
      ],
      usage: {},
    }));
    const client = anthropicClient({ messages: { create } } as never);

    const result = await client.generate({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'what is it' }],
    });

    expect(result.content).toBe('the answer is 42');
  });

  it('applies default maxTokens of 2048 when caller omits it', async () => {
    const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], usage: {} }));
    const client = anthropicClient({ messages: { create } } as never);

    await client.generate({ model: 'x', messages: [{ role: 'user', content: 'hi' }] });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 2048 }));
  });
});
