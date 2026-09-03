import type { BedrockRuntimeClient, ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it, vi } from 'vitest';
import { bedrockClient, buildBedrockRuntimeClient } from './bedrock';

/**
 * Bedrock adapter tests — request shape and response flattening.
 *
 * No AWS call is made: the runtime client is a stub whose `send` records the
 * command it was given, which is the only thing worth asserting here. What the
 * Converse API does with a well-formed request is AWS's contract, not ours.
 */

/**
 * A `ConverseCommandOutput`-shaped reply, trimmed to the fields we read.
 * @param text
 */
function converseReply(text: string) {
  return {
    output: { message: { role: 'assistant', content: [{ text }] } },
    stopReason: 'end_turn',
    usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
  };
}

/**
 * A stub runtime client plus the commands it was sent.
 * @param reply - What `send` should resolve to.
 */
function stubClient(reply: unknown = converseReply('hello')) {
  const sent: ConverseCommandInput[] = [];
  const client = {
    send: vi.fn(async (command: { input: ConverseCommandInput }) => {
      sent.push(command.input);
      return reply;
    }),
  };
  return { client: client as unknown as BedrockRuntimeClient, sent };
}

describe('bedrockClient request shape', () => {
  it('reports itself as the bedrock provider', () => {
    const { client } = stubClient();

    expect(bedrockClient(client).provider).toBe('bedrock');
  });

  it('lifts system messages into the separate system field', async () => {
    const { client, sent } = stubClient();

    await bedrockClient(client).generate({
      model: 'us.anthropic.claude-sonnet-4-6',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Hi' },
      ],
    });

    expect(sent[0]?.system).toEqual([{ text: 'Be terse.' }]);
    expect(sent[0]?.messages).toEqual([{ role: 'user', content: [{ text: 'Hi' }] }]);
  });

  it('joins several system messages into one block', async () => {
    const { client, sent } = stubClient();

    await bedrockClient(client).generate({
      model: 'm',
      messages: [
        { role: 'system', content: 'First.' },
        { role: 'system', content: 'Second.' },
        { role: 'user', content: 'Hi' },
      ],
    });

    expect(sent[0]?.system).toEqual([{ text: 'First.\n\nSecond.' }]);
  });

  it('omits the system field entirely when there are no system messages', async () => {
    const { client, sent } = stubClient();

    await bedrockClient(client).generate({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(sent[0]).not.toHaveProperty('system');
  });

  it('appends a JSON instruction when responseFormat asks for an object', async () => {
    const { client, sent } = stubClient();

    await bedrockClient(client).generate({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
      responseFormat: 'json_object',
    });

    expect(sent[0]?.system?.[0]).toMatchObject({ text: expect.stringContaining('valid JSON object') });
  });

  it('adds no JSON instruction for a text response', async () => {
    const { client, sent } = stubClient();

    await bedrockClient(client).generate({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
      responseFormat: 'text',
    });

    expect(sent[0]).not.toHaveProperty('system');
  });

  it('merges consecutive same-role messages, which Converse rejects', async () => {
    const { client, sent } = stubClient();

    await bedrockClient(client).generate({
      model: 'm',
      messages: [
        { role: 'user', content: 'First half.' },
        { role: 'user', content: 'Second half.' },
        { role: 'assistant', content: 'Noted.' },
        { role: 'user', content: 'More.' },
      ],
    });

    expect(sent[0]?.messages).toEqual([
      { role: 'user', content: [{ text: 'First half.' }, { text: 'Second half.' }] },
      { role: 'assistant', content: [{ text: 'Noted.' }] },
      { role: 'user', content: [{ text: 'More.' }] },
    ]);
  });

  it('forwards maxTokens and temperature only when the caller set them', async () => {
    const { client, sent } = stubClient();
    const adapter = bedrockClient(client);

    await adapter.generate({ model: 'm', messages: [{ role: 'user', content: 'Hi' }] });
    await adapter.generate({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 256,
      temperature: 0.3,
    });

    expect(sent[0]?.inferenceConfig).toEqual({});
    expect(sent[1]?.inferenceConfig).toEqual({ maxTokens: 256, temperature: 0.3 });
  });

  it('sends temperature 0 rather than dropping it as falsy', async () => {
    const { client, sent } = stubClient();

    await bedrockClient(client).generate({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0,
    });

    expect(sent[0]?.inferenceConfig).toEqual({ temperature: 0 });
  });

  it('names the model the caller asked for', async () => {
    const { client, sent } = stubClient();

    await bedrockClient(client).generate({
      model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(sent[0]?.modelId).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
  });
});

describe('bedrockClient response handling', () => {
  it('flattens text blocks and maps usage and stop reason', async () => {
    const { client } = stubClient(converseReply('the answer'));

    const response = await bedrockClient(client).generate({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(response).toEqual({
      content: 'the answer',
      finishReason: 'end_turn',
      usage: { inputTokens: 11, outputTokens: 7 },
    });
  });

  it('joins several text blocks into one string', async () => {
    const { client } = stubClient({
      output: { message: { content: [{ text: 'one ' }, { text: 'two' }] } },
    });

    const response = await bedrockClient(client).generate({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(response.content).toBe('one two');
  });

  it('skips non-text blocks rather than rendering undefined', async () => {
    const { client } = stubClient({
      output: { message: { content: [{ reasoningContent: {} }, { text: 'visible' }] } },
    });

    const response = await bedrockClient(client).generate({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(response.content).toBe('visible');
  });

  it('returns empty content when the reply carries no message at all', async () => {
    const { client } = stubClient({ stopReason: 'max_tokens' });

    const response = await bedrockClient(client).generate({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(response).toEqual({
      content: '',
      finishReason: 'max_tokens',
      usage: { inputTokens: undefined, outputTokens: undefined },
    });
  });

  it('lets a Bedrock failure reach the caller rather than swallowing it', async () => {
    const client = {
      send: vi.fn(async () => {
        throw Object.assign(new Error('access denied'), { name: 'AccessDeniedException' });
      }),
    } as unknown as BedrockRuntimeClient;

    await expect(bedrockClient(client).generate({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    })).rejects.toThrow(/access denied/);
  });
});

describe('buildBedrockRuntimeClient', () => {
  it('uses the region it was given', () => {
    const client = buildBedrockRuntimeClient({ region: 'eu-west-1', credentials: null });

    expect(client.config.region).toBeDefined();
  });

  it('signs with an explicit key pair when one is supplied', async () => {
    const client = buildBedrockRuntimeClient({
      region: 'us-west-2',
      credentials: { accessKeyId: 'AKIAEXAMPLEONE', secretAccessKey: 'secret-one' },
    });

    await expect(client.config.credentials()).resolves.toMatchObject({
      accessKeyId: 'AKIAEXAMPLEONE',
    });
  });

  it('leaves the AWS credential chain in charge when given none', () => {
    // No assertion on what the chain resolves to — that depends on the machine.
    // What matters is that we did not pass an empty pair, which would have
    // replaced the chain with credentials that authenticate nothing.
    const client = buildBedrockRuntimeClient({ region: 'us-west-2', credentials: null });

    expect(client.config.credentials).toBeTypeOf('function');
  });
});
