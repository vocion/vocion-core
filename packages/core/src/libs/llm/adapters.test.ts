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
      system: 'you are terse',
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

    const calls = create.mock.calls as Array<Array<{ system?: string }>>;
    const firstArg = calls[0]?.[0];

    expect(firstArg?.system).toMatch(/valid JSON object/i);
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
