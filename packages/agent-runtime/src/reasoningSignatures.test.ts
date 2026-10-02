/**
 * Thinking signatures survive a tool loop on Bedrock.
 *
 * The first production turn on the Metacto runtime (Opus 5, 2026-09-28) died
 * on its second model call with `thinking.signature: Field required`, because
 * `@langchain/aws`'s event-stream path drops the signature Bedrock streams and
 * writes the thinking back without it. These tests drive the client seam the
 * fix sits on, with a fake client and the request shape the library builds —
 * including the one seen live, where Opus 5's thinking streams with empty text.
 */
import { describe, expect, it } from 'vitest';
import { noteSignatures, preserveReasoningSignatures, restoreSignatures } from './reasoningSignatures.js';

/**
 * A Converse stream for one response that thought, then called a tool.
 * @param thought - The thinking text ('' for the live Opus 5 shape).
 * @param signature - The signature streamed after it.
 * @param toolUseId - The tool call it makes.
 */
async function* thinkingThenTool(thought: string, signature: string, toolUseId = 'tooluse_1') {
  yield { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: thought } } } };
  yield { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature } } } };
  yield { contentBlockStop: { contentBlockIndex: 0 } };
  yield { contentBlockStart: { contentBlockIndex: 1, start: { toolUse: { toolUseId, name: 'lookup' } } } };
  yield { contentBlockStop: { contentBlockIndex: 1 } };
}

/**
 * The next request as the library builds it: the thinking comes back unsigned.
 * @param thought - The thinking text it replays.
 * @param toolUseId - The tool call it replays.
 */
function nextRequest(thought: string, toolUseId = 'tooluse_1') {
  return {
    input: {
      messages: [
        { role: 'user', content: [{ text: 'go' }] },
        { role: 'assistant', content: [{ reasoningContent: { reasoningText: { text: thought } } }, { text: 'Checking.' }, { toolUse: { toolUseId, name: 'lookup', input: {} } }] },
        { role: 'user', content: [{ toolResult: { toolUseId, content: [{ text: 'found' }] } }] },
      ],
    },
  };
}

type Sent = { messages: Array<{ content: Array<{ reasoningContent?: { reasoningText: { signature?: string } } }> }> };

/**
 * A model whose client records each request and answers with a stream.
 * @param stream - What the first call streams back.
 */
function fakeModel(stream: () => AsyncIterable<unknown>) {
  const sent: Sent[] = [];
  const model = { client: { send: async (command: { input?: unknown }) => {
    sent.push(structuredClone(command.input) as Sent);
    return { stream: stream() };
  } } };
  preserveReasoningSignatures(model);
  return { model, sent };
}

/**
 * Drain a response stream the way the library does.
 * @param response - What `send` returned.
 */
async function drain(response: unknown): Promise<void> {
  for await (const _event of (response as { stream: AsyncIterable<unknown> }).stream) {
    // consumed
  }
}

describe('preserveReasoningSignatures', () => {
  it('hands the signature back on the request after a turn that thought', async () => {
    const { model, sent } = fakeModel(() => thinkingThenTool('Let me look that up first.', 'sig-abc'));

    await drain(await model.client.send({ input: { messages: [] } }));
    await model.client.send(nextRequest('Let me look that up first.'));

    expect(sent[1]!.messages[1]!.content[0]!.reasoningContent!.reasoningText.signature).toBe('sig-abc');
  });

  it('restores it when the thinking streamed with no text at all, as Opus 5 does', async () => {
    const { model, sent } = fakeModel(() => thinkingThenTool('', 'sig-empty'));

    await drain(await model.client.send({ input: { messages: [] } }));
    await model.client.send(nextRequest(''));

    expect(sent[1]!.messages[1]!.content[0]!.reasoningContent!.reasoningText.signature).toBe('sig-empty');
  });

  it('restores it when the call streamed first was dropped from the replay', async () => {
    // Seen live on a mission turn: three tool calls streamed, the first one's
    // arguments did not parse, and the library replayed only the other two.
    async function* threeCalls() {
      yield { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: 'sig-three' } } } };
      yield { contentBlockStop: { contentBlockIndex: 0 } };
      for (const [index, id] of [[1, 'tooluse_bad'], [2, 'tooluse_B'], [3, 'tooluse_C']] as const) {
        yield { contentBlockStart: { contentBlockIndex: index, start: { toolUse: { toolUseId: id, name: 'lookup' } } } };
        yield { contentBlockStop: { contentBlockIndex: index } };
      }
    }
    const { model, sent } = fakeModel(threeCalls);

    await drain(await model.client.send({ input: { messages: [] } }));
    await model.client.send(nextRequest('', 'tooluse_C'));

    expect(sent[1]!.messages[1]!.content[0]!.reasoningContent!.reasoningText.signature).toBe('sig-three');
  });

  it('never puts one response\'s signature on another tool call', async () => {
    const { model, sent } = fakeModel(() => thinkingThenTool('', 'sig-first', 'tooluse_A'));

    await drain(await model.client.send({ input: { messages: [] } }));
    await model.client.send(nextRequest('', 'tooluse_B'));

    expect(sent[1]!.messages[1]!.content[0]!.reasoningContent!.reasoningText.signature).toBeUndefined();
  });

  it('passes every stream event through unchanged', async () => {
    const seen = [];
    for await (const event of noteSignatures(thinkingThenTool('Some thinking here.', 's'), new Map())) {
      seen.push(event);
    }

    expect(seen).toHaveLength(5);
  });

  it('leaves a block that already carries a signature alone', () => {
    const memory = new Map([['tooluse_1', ['remembered']]]);
    const input = nextRequest('x');
    (input.input.messages[1]!.content[0] as { reasoningContent: { reasoningText: { signature?: string } } }).reasoningContent.reasoningText.signature = 'its-own';

    restoreSignatures(input.input, memory);

    expect((input.input.messages[1]!.content[0] as { reasoningContent: { reasoningText: { signature?: string } } }).reasoningContent.reasoningText.signature).toBe('its-own');
  });

  it('is a no-op on something with no client', () => {
    const notAModel = { name: 'x' };

    expect(preserveReasoningSignatures(notAModel)).toBe(notAModel);
  });
});
